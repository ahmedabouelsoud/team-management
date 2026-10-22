-- Give each personal profile field its own 30-day edit window.
alter table public.profiles
  add column if not exists display_name_updated_at timestamptz,
  add column if not exists academic_number_updated_at timestamptz,
  add column if not exists phone_updated_at timestamptz,
  add column if not exists avatar_updated_at timestamptz;

-- Preserve the existing cooldown for text fields. The photo gets its own fresh
-- window because the old shared timestamp cannot tell whether a photo changed.
update public.profiles
set display_name_updated_at = coalesce(display_name_updated_at, profile_updated_at),
    academic_number_updated_at = coalesce(academic_number_updated_at, profile_updated_at),
    phone_updated_at = coalesce(phone_updated_at, profile_updated_at);

create or replace function public.limit_profile_edits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  if new.display_name is distinct from old.display_name then
    if old.display_name_updated_at is not null
       and v_now < old.display_name_updated_at + interval '30 days' then
      raise exception 'تعديل الاسم متاح مرة كل 30 يومًا. يمكنك التعديل مجددًا بعد %',
        to_char(old.display_name_updated_at + interval '30 days', 'YYYY-MM-DD');
    end if;
    new.display_name_updated_at := v_now;
  end if;

  if new.academic_number is distinct from old.academic_number then
    if old.academic_number_updated_at is not null
       and v_now < old.academic_number_updated_at + interval '30 days' then
      raise exception 'تعديل الرقم الأكاديمي متاح مرة كل 30 يومًا. يمكنك التعديل مجددًا بعد %',
        to_char(old.academic_number_updated_at + interval '30 days', 'YYYY-MM-DD');
    end if;
    new.academic_number_updated_at := v_now;
  end if;

  if new.phone is distinct from old.phone then
    if old.phone_updated_at is not null
       and v_now < old.phone_updated_at + interval '30 days' then
      raise exception 'تعديل رقم التليفون متاح مرة كل 30 يومًا. يمكنك التعديل مجددًا بعد %',
        to_char(old.phone_updated_at + interval '30 days', 'YYYY-MM-DD');
    end if;
    new.phone_updated_at := v_now;
  end if;

  if new.avatar_path is distinct from old.avatar_path then
    if old.avatar_updated_at is not null
       and v_now < old.avatar_updated_at + interval '30 days' then
      raise exception 'تعديل الصورة متاح مرة كل 30 يومًا. يمكنك التعديل مجددًا بعد %',
        to_char(old.avatar_updated_at + interval '30 days', 'YYYY-MM-DD');
    end if;
    new.avatar_updated_at := v_now;
  end if;

  if new.display_name is distinct from old.display_name
     or new.academic_number is distinct from old.academic_number
     or new.phone is distinct from old.phone
     or new.avatar_path is distinct from old.avatar_path then
    new.profile_updated_at := v_now;
  end if;

  return new;
end;
$$;
