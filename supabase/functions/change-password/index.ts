import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const keys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
const publicKey = keys ? JSON.parse(keys).default as string : Deno.env.get('SUPABASE_ANON_KEY')!;
const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
const serviceKey = secretKeys ? JSON.parse(secretKeys).default as string : Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authorization = request.headers.get('Authorization') || '';
  const jwt = authorization.replace(/^Bearer\s+/i, '');
  if (!jwt || jwt === authorization) return json({ error: 'يجب تسجيل الدخول أولًا.' }, 401);

  const { data: { user }, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !user?.email) return json({ error: 'انتهت جلسة الدخول. سجّل الدخول مرة أخرى.' }, 401);

  let currentPassword = '';
  let newPassword = '';
  try {
    const body = await request.json();
    currentPassword = String(body.currentPassword || '');
    newPassword = String(body.newPassword || '');
  } catch {
    return json({ error: 'البيانات المرسلة غير مكتملة.' }, 400);
  }
  if (newPassword.length < 8) return json({ error: 'كلمة المرور الجديدة لازم تكون 8 أحرف على الأقل.' }, 400);
  if (newPassword === currentPassword) return json({ error: 'اختار كلمة مرور مختلفة عن الحالية.' }, 400);

  const { data: profile, error: profileError } = await admin.from('profiles').select('password_changed_at').eq('id', user.id).single();
  if (profileError) return json({ error: 'تعذر التحقق من سجل كلمة المرور.' }, 500);
  const priorChangedAt = profile.password_changed_at as string | null;
  const nextAllowedAt = priorChangedAt ? new Date(new Date(priorChangedAt).getTime() + 60 * 24 * 60 * 60 * 1000) : null;
  if (nextAllowedAt && Date.now() < nextAllowedAt.getTime()) {
    return json({ error: `تقدر تغير كلمة المرور مرة أخرى ابتداءً من ${nextAllowedAt.toISOString()}.`, nextAllowedAt: nextAllowedAt.toISOString() }, 429);
  }

  const verifier = createClient(supabaseUrl, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: passwordError } = await verifier.auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (passwordError) return json({ error: 'كلمة المرور الحالية غير صحيحة.' }, 400);

  const { data: claimedAt, error: claimError } = await admin.rpc('claim_password_change', { p_user_id: user.id });
  if (claimError) {
    const { data: freshProfile } = await admin.from('profiles').select('password_changed_at').eq('id', user.id).single();
    const freshDate = freshProfile?.password_changed_at ? new Date(new Date(freshProfile.password_changed_at).getTime() + 60 * 24 * 60 * 60 * 1000) : null;
    if (freshDate) return json({ error: `تقدر تغير كلمة المرور مرة أخرى ابتداءً من ${freshDate.toISOString()}.`, nextAllowedAt: freshDate.toISOString() }, 429);
    return json({ error: 'تعذر بدء تغيير كلمة المرور.' }, 500);
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { password: newPassword });
  if (updateError) {
    await admin.from('profiles').update({ password_changed_at: priorChangedAt }).eq('id', user.id);
    return json({ error: updateError.message }, 400);
  }

  return json({ success: true, passwordChangedAt: claimedAt });
});
