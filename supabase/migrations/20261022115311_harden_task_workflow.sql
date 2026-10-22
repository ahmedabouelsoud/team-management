-- Harden the task workflow in the database (the UI checks are not a security boundary):
--   1. URLs saved on tasks/projects must be real http(s) links; pull requests must be github.com PR links.
--   2. Members can only move a task along the allowed path; "changes" and "done" stay leader-only.
--   3. Re-assigning a task requires an active member of the same team.
--   4. Every status change is recorded in task_events (history + data for success metrics).

-- ---------------------------------------------------------------------------
-- 1. URL validation
-- ---------------------------------------------------------------------------
create or replace function public.is_http_url(p text)
returns boolean language sql immutable set search_path = '' as $$
  select p = '' or p ~* '^https?://[^[:space:]]+$';
$$;

create or replace function public.is_github_pr_url(p text)
returns boolean language sql immutable set search_path = '' as $$
  select p = '' or p ~* '^https://github\.com/[^/[:space:]]+/[^/[:space:]]+/pull/[0-9]+([/?#][^[:space:]]*)?$';
$$;

-- NOT VALID: new and updated rows are checked; old rows are left alone.
alter table public.tasks drop constraint if exists tasks_pull_request_url_github;
alter table public.tasks add constraint tasks_pull_request_url_github
  check (public.is_github_pr_url(pull_request_url)) not valid;
alter table public.tasks drop constraint if exists tasks_learning_url_http;
alter table public.tasks add constraint tasks_learning_url_http
  check (public.is_http_url(learning_url)) not valid;
alter table public.tasks drop constraint if exists tasks_repository_url_http;
alter table public.tasks add constraint tasks_repository_url_http
  check (public.is_http_url(repository_url)) not valid;
alter table public.projects drop constraint if exists projects_repository_url_http;
alter table public.projects add constraint projects_repository_url_http
  check (public.is_http_url(repository_url)) not valid;

-- ---------------------------------------------------------------------------
-- 2. Strict member workflow
--    todo|blocked -> doing         (start)
--    doing|changes|blocked -> review (needs branch + valid GitHub PR link)
-- ---------------------------------------------------------------------------
create or replace function public.submit_task(
  p_task_id uuid, p_status text, p_branch_name text default '', p_pull_request_url text default ''
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_current text;
  v_branch text := btrim(coalesce(p_branch_name, ''));
  v_pr text := btrim(coalesce(p_pull_request_url, ''));
begin
  if p_status not in ('doing', 'review') then raise exception 'حالة المهمة غير مسموحة'; end if;

  select t.status into v_current from public.tasks t
  where t.id = p_task_id and t.assignee_id = auth.uid() and t.team_id = public.my_team_id()
  for update;
  if v_current is null then raise exception 'المهمة غير موجودة ضمن مهامك'; end if;
  if v_current = 'done' then raise exception 'المهمة مكتملة بالفعل'; end if;

  if p_status = 'doing' then
    if v_current not in ('todo', 'blocked') then
      raise exception 'يمكن بدء المهمة وهي في حالة «لم تبدأ» فقط';
    end if;
  else
    if v_current = 'review' then raise exception 'المهمة بانتظار المراجعة بالفعل'; end if;
    if v_current = 'todo' then raise exception 'ابدأ المهمة أولًا قبل إرسالها للمراجعة'; end if;
    if v_branch = '' then raise exception 'اكتب اسم الفرع قبل الإرسال للمراجعة'; end if;
    if v_pr = '' or not public.is_github_pr_url(v_pr) then
      raise exception 'أضف رابط Pull Request صحيح من GitHub، مثل https://github.com/org/repo/pull/12';
    end if;
  end if;

  update public.tasks
  set status = p_status,
      branch_name = case when p_status = 'review' then v_branch else coalesce(nullif(v_branch, ''), branch_name) end,
      pull_request_url = case when p_status = 'review' then v_pr else coalesce(nullif(v_pr, ''), pull_request_url) end,
      updated_at = now()
  where id = p_task_id;
end;
$$;

-- Requesting changes needs a concrete note.
create or replace function public.review_task(p_task_id uuid, p_accepted boolean, p_feedback text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare v_feedback text := btrim(coalesce(p_feedback, ''));
begin
  if not public.is_team_leader(public.my_team_id()) then raise exception 'هذه العملية لقائد الفريق فقط'; end if;
  if not p_accepted and v_feedback = '' then
    raise exception 'اكتب ملاحظة واضحة للعضو عند طلب التعديل';
  end if;
  update public.tasks
  set status = case when p_accepted then 'done' else 'changes' end,
      review_feedback = v_feedback, updated_at = now()
  where id = p_task_id and team_id = public.my_team_id() and status = 'review';
  if not found then raise exception 'لا توجد مهمة بانتظار المراجعة بهذا المعرف'; end if;
end;
$$;

revoke all on function public.submit_task(uuid,text,text,text) from public;
revoke all on function public.review_task(uuid,boolean,text) from public;
grant execute on function public.submit_task(uuid,text,text,text) to authenticated;
grant execute on function public.review_task(uuid,boolean,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Re-assignment must target an active member of the same team
-- ---------------------------------------------------------------------------
create or replace function public.tasks_validate_assignee()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee_id is distinct from old.assignee_id and not exists (
    select 1 from public.profiles a
    where a.id = new.assignee_id and a.team_id = new.team_id and a.role = 'member' and a.is_active
  ) then
    raise exception 'يمكن إسناد المهمة لعضو نشط في الفريق فقط';
  end if;
  return new;
end;
$$;
drop trigger if exists tasks_validate_assignee on public.tasks;
create trigger tasks_validate_assignee before update on public.tasks
for each row execute function public.tasks_validate_assignee();

-- ---------------------------------------------------------------------------
-- 4. Task history
-- ---------------------------------------------------------------------------
create table if not exists public.task_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  team_id uuid not null references public.teams(id),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text not null default '',
  event text not null check (event in ('created', 'status_changed', 'reassigned')),
  from_status text,
  to_status text,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists task_events_task_idx on public.task_events(task_id, created_at);
create index if not exists task_events_team_idx on public.task_events(team_id, created_at desc);

alter table public.task_events enable row level security;
drop policy if exists "leader and assignee read task history" on public.task_events;
create policy "leader and assignee read task history" on public.task_events
for select to authenticated
using (
  team_id = public.my_team_id()
  and (
    public.is_team_leader(team_id)
    or exists (select 1 from public.tasks t where t.id = task_events.task_id and t.assignee_id = auth.uid())
  )
);
revoke all on public.task_events from anon, authenticated;
grant select on public.task_events to authenticated;

create or replace function public.log_task_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  select p.display_name into v_name from public.profiles p where p.id = auth.uid();
  if tg_op = 'INSERT' then
    insert into public.task_events(task_id, team_id, actor_id, actor_name, event, to_status)
    values (new.id, new.team_id, auth.uid(), coalesce(v_name, ''), 'created', new.status);
  else
    if new.status is distinct from old.status then
      insert into public.task_events(task_id, team_id, actor_id, actor_name, event, from_status, to_status, note)
      values (new.id, new.team_id, auth.uid(), coalesce(v_name, ''), 'status_changed', old.status, new.status,
              case when new.status in ('changes', 'done') then coalesce(new.review_feedback, '') else '' end);
    end if;
    if new.assignee_id is distinct from old.assignee_id then
      insert into public.task_events(task_id, team_id, actor_id, actor_name, event)
      values (new.id, new.team_id, auth.uid(), coalesce(v_name, ''), 'reassigned');
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists tasks_log_event on public.tasks;
create trigger tasks_log_event after insert or update on public.tasks
for each row execute function public.log_task_event();

-- Start the history of existing tasks with a "created" entry.
insert into public.task_events(task_id, team_id, actor_id, actor_name, event, to_status, created_at)
select t.id, t.team_id, t.created_by, coalesce(p.display_name, ''), 'created', t.status, t.created_at
from public.tasks t
left join public.profiles p on p.id = t.created_by
where not exists (select 1 from public.task_events e where e.task_id = t.id and e.event = 'created');
