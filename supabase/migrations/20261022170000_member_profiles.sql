-- Member profile details and private profile photos.
alter table public.profiles
  add column if not exists academic_number text,
  add column if not exists phone text not null default '',
  add column if not exists avatar_path text;

create unique index if not exists profiles_academic_number_unique
  on public.profiles (academic_number)
  where academic_number is not null;

alter table public.profiles
  drop constraint if exists profiles_academic_number_not_blank;
alter table public.profiles
  add constraint profiles_academic_number_not_blank
  check (academic_number is null or btrim(academic_number) <> '');

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.team_invites%rowtype;
  v_token uuid;
  v_academic_number text := nullif(btrim(new.raw_user_meta_data ->> 'academic_number'), '');
begin
  begin
    v_token := (new.raw_user_meta_data ->> 'invite_token')::uuid;
  exception when invalid_text_representation then
    raise exception 'رابط الدعوة غير صالح';
  end;
  if v_token is null then raise exception 'التسجيل يحتاج دعوة من قائد الفريق'; end if;
  if v_academic_number is null then raise exception 'الرقم الأكاديمي مطلوب'; end if;

  select * into v_invite
  from public.team_invites i
  where i.token = v_token
    and i.email = lower(btrim(new.email))
    and i.accepted_at is null
    and i.expires_at > now()
  for update;
  if not found then raise exception 'الدعوة غير صالحة أو منتهية أو مخصصة لبريد آخر'; end if;

  insert into public.profiles (id, team_id, display_name, role, academic_number)
  values (
    new.id,
    v_invite.team_id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    'member',
    v_academic_number
  );
  update public.team_invites
  set accepted_at = now(), accepted_by = new.id
  where id = v_invite.id;
  return new;
end;
$$;

grant update (display_name, academic_number, phone, avatar_path) on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "Users can view own profile photo" on storage.objects;
create policy "Users can view own profile photo" on storage.objects
  for select to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can upload own profile photo" on storage.objects;
create policy "Users can upload own profile photo" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can update own profile photo" on storage.objects;
create policy "Users can update own profile photo" on storage.objects
  for update to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can delete own profile photo" on storage.objects;
create policy "Users can delete own profile photo" on storage.objects
  for delete to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
