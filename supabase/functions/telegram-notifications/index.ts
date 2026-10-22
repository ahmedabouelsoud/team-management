import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-telegram-bot-api-secret-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const publicKey = (() => {
  const keys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  return keys ? JSON.parse(keys).default as string : Deno.env.get('SUPABASE_ANON_KEY')!;
})();
const serviceKey = (() => {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  return keys ? JSON.parse(keys).default as string : Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
})();
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function telegram(method: string, body?: Record<string, unknown>) {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('لم يُضف رمز بوت تليجرام إلى أسرار Supabase بعد.');
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.description || 'تعذر الاتصال ببوت تليجرام.');
  return result.result;
}

async function webhookSecret() {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('لم يُضف رمز بوت تليجرام إلى أسرار Supabase بعد.');
  return await hash(`${token}:fariqi-telegram-webhook-v1`);
}

async function currentUser(request: Request) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const client = createClient(supabaseUrl, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  return error ? null : data.user;
}

async function hash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'الطريقة غير مدعومة.' }, 405);

  try {
    const body = await request.json();

    // Telegram webhook calls are authenticated with Telegram's dedicated secret header.
    if (request.headers.has('X-Telegram-Bot-Api-Secret-Token')) {
      const expected = await webhookSecret();
      const provided = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (!expected || provided !== expected) return json({ error: 'Webhook authentication failed.' }, 401);

      const text = body?.message?.text;
      const chatId = body?.message?.chat?.id;
      if (typeof text !== 'string' || !text.startsWith('/start ') || chatId === undefined) return json({ ok: true });
      const token = text.slice('/start '.length).trim().split(/\s/)[0];
      if (!/^[a-f0-9]{32}$/.test(token)) return json({ ok: true });

      const { data: link, error: lookupError } = await admin.from('telegram_link_tokens')
        .select('user_id').eq('token_hash', await hash(token)).gt('expires_at', new Date().toISOString()).maybeSingle();
      if (lookupError) throw lookupError;
      if (!link) {
        await telegram('sendMessage', { chat_id: chatId, text: 'رابط الربط غير صالح أو انتهت صلاحيته. أنشئ رابطًا جديدًا من تطبيق فريقي.' });
        return json({ ok: true });
      }

      const { error: saveError } = await admin.from('telegram_connections').upsert({
        user_id: link.user_id,
        chat_id: String(chatId),
        telegram_username: body.message.from?.username ?? null,
        linked_at: new Date().toISOString(),
      });
      if (saveError) throw saveError;
      await admin.from('telegram_link_tokens').delete().eq('user_id', link.user_id);
      await telegram('sendMessage', { chat_id: chatId, text: 'تم ربط حسابك بتطبيق فريقي. هتوصلك رسالة هنا لما تتسند لك مهمة جديدة.' });
      return json({ ok: true });
    }

    const user = await currentUser(request);
    if (!user) return json({ error: 'سجّل الدخول إلى التطبيق أولًا.' }, 401);
    const { data: profile, error: profileError } = await admin.from('profiles')
      .select('id,team_id,role,is_active,display_name').eq('id', user.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.is_active) return json({ error: 'الحساب غير نشط في الفريق.' }, 403);

    if (body.action === 'status') {
      const { data, error } = await admin.from('telegram_connections')
        .select('telegram_username,linked_at').eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      return json({ connected: Boolean(data), username: data?.telegram_username ?? null });
    }

    if (body.action === 'create-link') {
      const { data: bot } = await telegram('getMe');
      const token = [...crypto.getRandomValues(new Uint8Array(16))]
        .map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const { error: deleteError } = await admin.from('telegram_link_tokens').delete().eq('user_id', user.id);
      if (deleteError) throw deleteError;
      const { error: insertError } = await admin.from('telegram_link_tokens').insert({
        token_hash: await hash(token), user_id: user.id,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
      if (insertError) throw insertError;
      return json({ url: `https://t.me/${bot.username}?start=${token}`, expiresInMinutes: 10 });
    }

    if (body.action === 'configure-webhook') {
      if (profile.role !== 'leader') return json({ error: 'إعداد البوت متاح لقائد الفريق فقط.' }, 403);
      const secret = await webhookSecret();
      const endpoint = `${supabaseUrl}/functions/v1/telegram-notifications`;
      await telegram('setWebhook', { url: endpoint, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: false });
      return json({ configured: true });
    }

    if (body.action === 'notify-task') {
      if (profile.role !== 'leader') return json({ error: 'إشعارات إسناد المهام متاحة لقائد الفريق فقط.' }, 403);
      if (typeof body.taskId !== 'string') return json({ error: 'رقم المهمة غير صالح.' }, 400);
      const { data: task, error: taskError } = await admin.from('tasks')
        .select('id,title,description,due_date,assignee_id,team_id,project_id').eq('id', body.taskId).maybeSingle();
      if (taskError) throw taskError;
      if (!task || task.team_id !== profile.team_id) return json({ error: 'المهمة غير موجودة ضمن فريقك.' }, 404);
      const { data: assignee, error: assigneeError } = await admin.from('profiles')
        .select('id,display_name,is_active').eq('id', task.assignee_id).maybeSingle();
      if (assigneeError) throw assigneeError;
      if (!assignee?.is_active) return json({ sent: false, reason: 'inactive-member' });
      const { data: connection, error: connectionError } = await admin.from('telegram_connections')
        .select('chat_id').eq('user_id', task.assignee_id).maybeSingle();
      if (connectionError) throw connectionError;
      if (!connection) return json({ sent: false, reason: 'not-connected' });
      const { data: project } = await admin.from('projects').select('name').eq('id', task.project_id).maybeSingle();
      const due = task.due_date ? `\nموعد التسليم: ${task.due_date}` : '';
      const appUrl = Deno.env.get('APP_URL') || 'https://fariqi.pages.dev';
      await telegram('sendMessage', {
        chat_id: connection.chat_id,
        text: `أهلًا ${assignee.display_name}، اتسندت لك مهمة جديدة في مشروع ${project?.name || 'الفريق'}:\n\n${task.title}${due}\n\nافتح تطبيق فريقي لمراجعة التفاصيل: ${appUrl}`,
        disable_web_page_preview: true,
      });
      return json({ sent: true });
    }

    return json({ error: 'الطلب غير معروف.' }, 400);
  } catch (error) {
    console.error('Telegram notification error:', error);
    return json({ error: error instanceof Error ? error.message : 'حدث خطأ غير متوقع.' }, 500);
  }
});
