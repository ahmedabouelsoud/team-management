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
  task_repository_url text;
begin
  if p_status not in ('doing','review','changes','blocked') then
    raise exception 'حالة المهمة غير مسموحة';
  end if;

  select t.status, nullif(btrim(t.repository_url), '')
  into current_status, task_repository_url
  from public.tasks t
  where t.id = p_task_id and t.assignee_id = auth.uid() and t.team_id = public.my_team_id()
  for update;

  if current_status is null then raise exception 'المهمة غير موجودة ضمن مهامك'; end if;
  if current_status = 'done' then raise exception 'المهمة مكتملة بالفعل'; end if;
  if p_status = 'review' and task_repository_url is not null and coalesce(p_pull_request_url, '') = '' then
    raise exception 'أضف رابط Pull Request قبل إرسال المهمة البرمجية للمراجعة';
  end if;

  update public.tasks
  set status = p_status,
      branch_name = case when task_repository_url is null then '' else coalesce(p_branch_name, '') end,
      pull_request_url = case when task_repository_url is null then '' else coalesce(p_pull_request_url, '') end,
      updated_at = now()
  where id = p_task_id;
end;
$$;
