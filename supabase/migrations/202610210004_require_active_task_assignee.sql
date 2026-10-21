-- Enforce active-member assignment in the database, not only in the UI.
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
      and assignee.role = 'member'
      and assignee.is_active
  )
  and exists (
    select 1
    from public.projects project
    where project.id = tasks.project_id
      and project.team_id = tasks.team_id
  )
);
