create or replace function public.prevent_profile_identity_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if nullif(pg_catalog.btrim(old.display_name), '') is not null
     and old.display_name is distinct from new.display_name then
    raise exception using errcode = '22000', message = 'PROFILE_NAME_IMMUTABLE';
  end if;

  if nullif(pg_catalog.btrim(old.academic_number), '') is not null
     and old.academic_number is distinct from new.academic_number then
    raise exception using errcode = '22000', message = 'PROFILE_ACADEMIC_NUMBER_IMMUTABLE';
  end if;

  if old.password_changed_at is distinct from new.password_changed_at
     and current_user not in ('postgres', 'service_role') then
    raise exception using errcode = '42501', message = 'PASSWORD_COOLDOWN_TIMESTAMP_PROTECTED';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_identity_fields_immutable on public.profiles;
create trigger profiles_identity_fields_immutable
before update of display_name, academic_number, password_changed_at on public.profiles
for each row execute function public.prevent_profile_identity_changes();
