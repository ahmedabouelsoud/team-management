-- Team Management: single-team foundation for a zero-cost Supabase Free deployment.
-- Apply from Supabase SQL Editor. All access is invite-only; no public signup flow.
create extension if not exists pgcrypto;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
insert into public.teams (id, name) values ('00000000-0000-4000-8000-000000000001', 'فريق مشروع السنتر')
on conflict (id) do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  team_id uuid not null references public.teams(id),
  display_name text not null default 'عضو الفريق',
  role text not null default 'member' check (role in ('leader','member')),
  yawmi_url text not null default '/yawmi-v4.html',
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id),
  name text not null,
  summary text not null default '',
  repository_url text not null default '',
  target_date date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.phases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique(project_id, name)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  phase_id uuid references public.phases(id) on delete set null,
  title text not null,
  description text not null default '',
  acceptance_criteria text not null default '',
  assignee_id uuid not null references public.profiles(id),
  due_date date,
  priority text not null default 'medium' check (priority in ('high','medium','low')),
  status text not null default 'todo' check (status in ('todo','doing','review','changes','done','blocked')),
  learning_url text not null default '',
  repository_url text not null default '',
  branch_name text not null default '',
  pull_request_url text not null default '',
  review_feedback text not null default '',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_team_assignee_status_idx on public.tasks(team_id, assignee_id, status);
create index if not exists tasks_project_phase_idx on public.tasks(project_id, phase_id);

-- New invited users always become members of this one team. Promote the first user to leader manually.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, team_id, display_name, role)
  values (
    new.id,
    '00000000-0000-4000-8000-000000000001'::uuid,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    'member'
  ) on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created_team_profile on auth.users;
create trigger on_auth_user_created_team_profile after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_team_leader(target_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.team_id = target_team and p.role = 'leader');
$$;
create or replace function public.my_team_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.team_id from public.profiles p where p.id = auth.uid();
$$;

alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.phases enable row level security;
alter table public.tasks enable row level security;

create policy "team members can read own team" on public.teams for select to authenticated
using (id = public.my_team_id());
create policy "profiles visible to self and leader" on public.profiles for select to authenticated
using (id = auth.uid() or public.is_team_leader(team_id));
create policy "users update own daily planner link" on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());
create policy "team project visible to its team" on public.projects for select to authenticated
using (team_id = public.my_team_id());
create policy "leader creates team project" on public.projects for insert to authenticated
with check (public.is_team_leader(team_id) and created_by = auth.uid());
create policy "leader updates team project" on public.projects for update to authenticated
using (public.is_team_leader(team_id)) with check (public.is_team_leader(team_id));
create policy "team phases visible to team" on public.phases for select to authenticated
using (exists(select 1 from public.projects p where p.id = project_id and p.team_id = public.my_team_id()));
create policy "leader manages phases" on public.phases for all to authenticated
using (exists(select 1 from public.projects p where p.id = project_id and public.is_team_leader(p.team_id)))
with check (exists(select 1 from public.projects p where p.id = project_id and public.is_team_leader(p.team_id)));
create policy "leader and assignee see task" on public.tasks for select to authenticated
using (team_id = public.my_team_id() and (assignee_id = auth.uid() or public.is_team_leader(team_id)));
create policy "leader creates task" on public.tasks for insert to authenticated
with check (team_id = public.my_team_id() and public.is_team_leader(team_id) and created_by = auth.uid()
  and exists(select 1 from public.profiles a where a.id = assignee_id and a.team_id = tasks.team_id)
  and exists(select 1 from public.projects p where p.id = project_id and p.team_id = tasks.team_id));
create policy "leader updates task" on public.tasks for update to authenticated
using (team_id = public.my_team_id() and public.is_team_leader(team_id))
with check (team_id = public.my_team_id() and public.is_team_leader(team_id));

-- Members submit progress through this checked operation, keeping task assignment and requirements immutable.
create or replace function public.submit_task(p_task_id uuid, p_status text, p_branch_name text default '', p_pull_request_url text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare current_status text;
begin
  if p_status not in ('doing','review','changes','blocked') then raise exception 'حالة المهمة غير مسموحة'; end if;
  select t.status into current_status from public.tasks t
  where t.id = p_task_id and t.assignee_id = auth.uid() and t.team_id = public.my_team_id() for update;
  if current_status is null then raise exception 'المهمة غير موجودة ضمن مهامك'; end if;
  if current_status = 'done' then raise exception 'المهمة مكتملة بالفعل'; end if;
  if p_status = 'review' and coalesce(p_pull_request_url, '') = '' then raise exception 'أضف رابط Pull Request قبل إرسال المهمة للمراجعة'; end if;
  update public.tasks set status = p_status, branch_name = coalesce(p_branch_name,''), pull_request_url = coalesce(p_pull_request_url,''), updated_at = now()
  where id = p_task_id;
end;
$$;
create or replace function public.review_task(p_task_id uuid, p_accepted boolean, p_feedback text default '')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_team_leader(public.my_team_id()) then raise exception 'هذه العملية لقائد الفريق فقط'; end if;
  update public.tasks set status = case when p_accepted then 'done' else 'changes' end,
    review_feedback = coalesce(p_feedback,''), updated_at = now()
  where id = p_task_id and team_id = public.my_team_id() and status = 'review';
  if not found then raise exception 'لا توجد مهمة بانتظار المراجعة بهذا المعرف'; end if;
end;
$$;
revoke all on function public.submit_task(uuid,text,text,text) from public;
revoke all on function public.review_task(uuid,boolean,text) from public;
grant execute on function public.submit_task(uuid,text,text,text) to authenticated;
grant execute on function public.review_task(uuid,boolean,text) to authenticated;

-- Keep project links public to logged-in teammates. Never put a service-role key in the browser.
grant select on public.teams, public.profiles, public.projects, public.phases, public.tasks to authenticated;
grant update (display_name, yawmi_url) on public.profiles to authenticated;
grant insert, update, delete on public.projects, public.phases to authenticated;
grant insert, update on public.tasks to authenticated;
revoke all on public.teams, public.profiles, public.projects, public.phases, public.tasks from anon;
