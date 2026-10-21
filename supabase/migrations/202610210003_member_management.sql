-- Keep member history while revoking access when a leader removes someone.
alter table public.profiles
  add column if not exists is_active boolean not null default true;
create index if not exists profiles_active_team_idx
  on public.profiles(team_id, created_at desc) where is_active;

create or replace function public.is_team_leader(target_team uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.team_id = target_team
      and p.role = 'leader' and p.is_active
  );
$$;

create or replace function public.my_team_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select p.team_id from public.profiles p
  where p.id = auth.uid() and p.is_active;
$$;

create or replace function public.create_team_invite(p_email text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_team_id uuid;
  v_token uuid := gen_random_uuid();
  v_email text := lower(btrim(p_email));
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول أولًا'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'أدخل بريدًا إلكترونيًا صحيحًا';
  end if;
  select p.team_id into v_team_id
  from public.profiles p
  where p.id = auth.uid() and p.role = 'leader' and p.is_active;
  if v_team_id is null then raise exception 'إنشاء الدعوات متاح لقائد الفريق فقط'; end if;

  insert into public.team_invites(team_id,email,token,invited_by)
  values (v_team_id,v_email,v_token,auth.uid());
  return v_token::text;
end;
$$;
revoke all on function public.create_team_invite(text) from public;
grant execute on function public.create_team_invite(text) to authenticated;

create or replace function public.remove_team_member(p_member_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_team_id uuid;
  v_member_team uuid;
  v_member_role text;
begin
  select p.team_id into v_team_id
  from public.profiles p
  where p.id = auth.uid() and p.role = 'leader' and p.is_active;
  if v_team_id is null then raise exception 'إزالة الأعضاء متاحة لقائد الفريق فقط'; end if;
  if p_member_id = auth.uid() then raise exception 'لا يمكنك إزالة حسابك كقائد'; end if;

  select p.team_id, p.role into v_member_team, v_member_role
  from public.profiles p where p.id = p_member_id and p.is_active;
  if v_member_team is null or v_member_team <> v_team_id then
    raise exception 'العضو غير موجود ضمن فريقك';
  end if;
  if v_member_role <> 'member' then raise exception 'يمكن إزالة أعضاء الفريق فقط'; end if;

  update public.profiles set is_active = false
  where id = p_member_id and team_id = v_team_id;
end;
$$;
revoke all on function public.remove_team_member(uuid) from public;
grant execute on function public.remove_team_member(uuid) to authenticated;
