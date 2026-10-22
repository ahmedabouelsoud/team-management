-- Cap outstanding invitations and serialize invite creation per team.
create or replace function public.create_team_invite(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_token uuid := gen_random_uuid();
  v_email text := lower(btrim(p_email));
  v_pending_count integer;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول أولًا'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'أدخل بريدًا إلكترونيًا صحيحًا';
  end if;

  select p.team_id into v_team_id
  from public.profiles p
  where p.id = auth.uid() and p.role = 'leader' and p.is_active;
  if v_team_id is null then raise exception 'إنشاء الدعوات متاح لقائد الفريق فقط'; end if;

  -- Serialize requests by this team so simultaneous calls cannot bypass the cap.
  perform 1 from public.teams t where t.id = v_team_id for update;
  select count(*)::integer into v_pending_count
  from public.team_invites i
  where i.team_id = v_team_id and i.accepted_at is null and i.expires_at > now();
  if v_pending_count >= 20 then
    raise exception 'وصل الفريق للحد الأقصى من الدعوات المعلقة. ألغِ دعوة أو انتظر انتهاء صلاحيتها.';
  end if;
  if exists(select 1 from public.team_invites i where i.team_id = v_team_id and i.email = v_email and i.accepted_at is null and i.expires_at > now()) then
    raise exception 'يوجد بالفعل رابط دعوة صالح لهذا البريد الإلكتروني.';
  end if;

  insert into public.team_invites(team_id,email,token,invited_by)
  values (v_team_id,v_email,v_token,auth.uid());
  return v_token::text;
end;
$$;
revoke all on function public.create_team_invite(text) from public, anon;
grant execute on function public.create_team_invite(text) to authenticated;
