alter table public.profiles
  add column if not exists password_changed_at timestamptz;

create or replace function public.claim_password_change(p_user_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed_at timestamptz;
begin
  update public.profiles
  set password_changed_at = now()
  where id = p_user_id
    and (password_changed_at is null or password_changed_at <= now() - interval '60 days')
  returning password_changed_at into v_changed_at;

  if v_changed_at is null then
    raise exception 'PASSWORD_CHANGE_COOLDOWN';
  end if;

  return v_changed_at;
end;
$$;

revoke all on function public.claim_password_change(uuid) from public, anon, authenticated;
grant execute on function public.claim_password_change(uuid) to service_role;
