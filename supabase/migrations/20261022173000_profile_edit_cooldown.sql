-- Enforce one personal-profile change per member every 30 days.
alter table public.profiles
  add column if not exists profile_updated_at timestamptz;

create or replace function public.limit_profile_edits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_personal_data_changed boolean;
  v_next_edit_at timestamptz;
begin
  v_personal_data_changed :=
    new.display_name is distinct from old.display_name or
    new.academic_number is distinct from old.academic_number or
    new.phone is distinct from old.phone or
    new.avatar_path is distinct from old.avatar_path;

  if not v_personal_data_changed then
    return new;
  end if;

  v_next_edit_at := old.profile_updated_at + interval '30 days';
  if old.profile_updated_at is not null and now() < v_next_edit_at then
    raise exception 'تعديل بيانات الملف متاح مرة كل 30 يومًا. يمكنك التعديل مجددًا بعد %',
      to_char(v_next_edit_at at time zone 'UTC', 'YYYY-MM-DD');
  end if;

  new.profile_updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_limit_personal_edits on public.profiles;
create trigger profiles_limit_personal_edits
before update on public.profiles
for each row execute function public.limit_profile_edits();
