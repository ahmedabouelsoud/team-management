drop policy if exists "leaders can view team profile photos" on storage.objects;
create policy "leaders can view team profile photos"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'profile-photos'
  and exists (
    select 1 from public.profiles owner
    where owner.id::text = (storage.foldername(name))[1]
      and public.is_team_leader(owner.team_id)
  )
);

revoke all on function public.handle_new_user() from public;
revoke all on function public.log_task_event() from public;
revoke all on function public.tasks_validate_assignee() from public;
revoke all on function public.prevent_profile_identity_changes() from public;
revoke all on function public.is_team_leader(uuid) from public;
revoke all on function public.my_team_id() from public;
grant execute on function public.is_team_leader(uuid) to authenticated;
grant execute on function public.my_team_id() to authenticated;
