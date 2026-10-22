create or replace function public.tasks_validate_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignee_id is distinct from old.assignee_id and not exists (
    select 1
    from public.profiles a
    where a.id = new.assignee_id
      and a.team_id = new.team_id
      and a.is_active
      and (
        a.role = 'member'
        or (a.role = 'leader' and a.id = (select auth.uid()) and public.is_team_leader(new.team_id))
      )
  ) then
    raise exception 'يمكن إسناد المهمة لعضو نشط أو للقائد نفسه فقط';
  end if;
  return new;
end;
$$;

drop policy if exists "leader creates task" on public.tasks;
create policy "leader creates task"
on public.tasks
for insert
to authenticated
with check (
  team_id = public.my_team_id()
  and public.is_team_leader(team_id)
  and created_by = (select auth.uid())
  and exists (
    select 1
    from public.profiles assignee
    where assignee.id = tasks.assignee_id
      and assignee.team_id = tasks.team_id
      and assignee.is_active
      and (
        assignee.role = 'member'
        or (assignee.role = 'leader' and assignee.id = (select auth.uid()))
      )
  )
  and exists (
    select 1 from public.projects project
    where project.id = tasks.project_id and project.team_id = tasks.team_id
  )
);
