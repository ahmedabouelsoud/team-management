-- Invite-only member onboarding without exposing a service-role key.
create table if not exists public.team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  email text not null,
  token uuid not null unique,
  invited_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id),
  constraint team_invites_email_is_normalized check (email = lower(btrim(email)))
);
create index if not exists team_invites_team_created_idx
  on public.team_invites(team_id, created_at desc);
create index if not exists team_invites_pending_email_idx
  on public.team_invites(email, expires_at) where accepted_at is null;

alter table public.team_invites enable row level security;
drop policy if exists "leaders read own team invites" on public.team_invites;
create policy "leaders read own team invites" on public.team_invites
  for select to authenticated
  using (public.is_team_leader(team_id));
grant select on public.team_invites to authenticated;
revoke insert, update, delete on public.team_invites from anon, authenticated;

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
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول أولًا'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'أدخل بريدًا إلكترونيًا صحيحًا';
  end if;
  select p.team_id into v_team_id
  from public.profiles p
  where p.id = auth.uid() and p.role = 'leader';
  if v_team_id is null then raise exception 'إنشاء الدعوات متاح لقائد الفريق فقط'; end if;

  insert into public.team_invites(team_id,email,token,invited_by)
  values (v_team_id,v_email,v_token,auth.uid());
  return v_token::text;
end;
$$;
revoke all on function public.create_team_invite(text) from public;
grant execute on function public.create_team_invite(text) to authenticated;

-- New accounts can join only when their email matches an active invitation.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.team_invites%rowtype;
  v_token uuid;
begin
  begin
    v_token := (new.raw_user_meta_data ->> 'invite_token')::uuid;
  exception when invalid_text_representation then
    raise exception 'رابط الدعوة غير صالح';
  end;
  if v_token is null then raise exception 'التسجيل يحتاج دعوة من قائد الفريق'; end if;

  select * into v_invite
  from public.team_invites i
  where i.token = v_token
    and i.email = lower(btrim(new.email))
    and i.accepted_at is null
    and i.expires_at > now()
  for update;
  if not found then raise exception 'الدعوة غير صالحة أو منتهية أو مخصصة لبريد آخر'; end if;

  insert into public.profiles (id, team_id, display_name, role)
  values (
    new.id,
    v_invite.team_id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    'member'
  );
  update public.team_invites
  set accepted_at = now(), accepted_by = new.id
  where id = v_invite.id;
  return new;
end;
$$;
