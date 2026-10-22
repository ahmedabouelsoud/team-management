import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'الطلب غير مدعوم.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = request.headers.get('Authorization')
  if (!url || !anonKey || !serviceRoleKey) return json({ error: 'إعدادات الدالة غير مكتملة.' }, 500)
  if (!authorization) return json({ error: 'سجّل الدخول أولًا.' }, 401)

  const callerClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  })
  const { data: { user }, error: authError } = await callerClient.auth.getUser()
  if (authError || !user) return json({ error: 'انتهت جلسة الدخول. سجّل الدخول مجددًا.' }, 401)

  let memberId = ''
  try {
    const body = await request.json()
    memberId = typeof body?.memberId === 'string' ? body.memberId : ''
  } catch {
    return json({ error: 'بيانات العضو غير صحيحة.' }, 400)
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(memberId)) {
    return json({ error: 'معرّف العضو غير صحيح.' }, 400)
  }
  if (memberId === user.id) return json({ error: 'لا يمكنك حذف حسابك من هنا.' }, 400)

  const adminClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: leader, error: leaderError } = await adminClient
    .from('profiles').select('team_id, role, is_active').eq('id', user.id).maybeSingle()
  if (leaderError) return json({ error: 'تعذر التحقق من صلاحياتك.' }, 500)
  if (!leader || leader.role !== 'leader' || !leader.is_active) {
    return json({ error: 'الحذف النهائي متاح للقائد النشط فقط.' }, 403)
  }

  const { data: member, error: memberError } = await adminClient
    .from('profiles').select('team_id, role, is_active').eq('id', memberId).maybeSingle()
  if (memberError) return json({ error: 'تعذر العثور على العضو.' }, 500)
  if (!member || member.team_id !== leader.team_id || member.role !== 'member') {
    return json({ error: 'العضو غير موجود ضمن فريقك.' }, 404)
  }
  if (member.is_active) return json({ error: 'أوقف عضوية العضو قبل حذفه نهائيًا.' }, 409)

  const [assignedTasks, createdTasks, createdProjects] = await Promise.all([
    adminClient.from('tasks').select('id', { count: 'exact', head: true }).eq('assignee_id', memberId),
    adminClient.from('tasks').select('id', { count: 'exact', head: true }).eq('created_by', memberId),
    adminClient.from('projects').select('id', { count: 'exact', head: true }).eq('created_by', memberId),
  ])
  if (assignedTasks.error || createdTasks.error || createdProjects.error) {
    return json({ error: 'تعذر التحقق من نشاط العضو. لم يُحذف الحساب.' }, 500)
  }
  const activityCount = (assignedTasks.count ?? 0) + (createdTasks.count ?? 0) + (createdProjects.count ?? 0)
  if (activityCount > 0) {
    return json({ error: 'لا يمكن الحذف النهائي؛ للعضو مهام أو مشروعات مرتبطة. أزل عضويته واحتفظ بسجله.' }, 409)
  }

  const { error: inviteError } = await adminClient.from('team_invites').delete()
    .or(`invited_by.eq.${memberId},accepted_by.eq.${memberId}`)
  if (inviteError) return json({ error: 'تعذر حذف الدعوات المرتبطة؛ لم يُحذف الحساب.' }, 500)

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(memberId)
  if (deleteError) return json({ error: 'تعذر حذف حساب Auth. لم تُحذف بيانات المهام أو المشروعات.' }, 500)

  return json({ ok: true })
})
