-- Only active team leaders can permanently delete tasks from their own team.
create policy "leader deletes task"
on public.tasks
for delete
to authenticated
using (
  team_id = public.my_team_id()
  and public.is_team_leader(team_id)
);
