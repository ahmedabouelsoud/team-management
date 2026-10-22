-- The leader decides per task whether the member must submit GitHub links.
alter table public.tasks
  add column if not exists requires_submission_link boolean not null default false;

-- Keep the current behaviour for existing tasks that already have a task-specific repository link.
update public.tasks
set requires_submission_link = true
where nullif(btrim(repository_url), '') is not null;

create or replace function public.submit_task(
  p_task_id uuid,
  p_status text,
  p_branch_name text default '',
  p_pull_request_url text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
  needs_submission_link boolean;
begin
  if p_status not in ('doing','review','changes','blocked') then
    raise exception 'حالة المهمة غير مسموحة';
  end if;

  select t.status, t.requires_submission_link
  into current_status, needs_submission_link
  from public.tasks t
  where t.id = p_task_id and t.assignee_id = auth.uid() and t.team_id = public.my_team_id()
  for update;

  if current_status is null then raise exception 'المهمة غير موجودة ضمن مهامك'; end if;
  if current_status = 'done' then raise exception 'المهمة مكتملة بالفعل'; end if;
  if p_status = 'review' and needs_submission_link and coalesce(p_branch_name, '') = '' then
    raise exception 'أضف اسم الفرع قبل إرسال المهمة للمراجعة';
  end if;
  if p_status = 'review' and needs_submission_link and coalesce(p_pull_request_url, '') = '' then
    raise exception 'أضف رابط Pull Request قبل إرسال المهمة للمراجعة';
  end if;

  update public.tasks
  set status = p_status,
      branch_name = case when needs_submission_link then coalesce(p_branch_name, '') else '' end,
      pull_request_url = case when needs_submission_link then coalesce(p_pull_request_url, '') else '' end,
      updated_at = now()
  where id = p_task_id;
end;
$$;

revoke all on function public.submit_task(uuid,text,text,text) from public;
grant execute on function public.submit_task(uuid,text,text,text) to authenticated;
