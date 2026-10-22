alter table public.profiles add column if not exists github_username text;
grant update (github_username) on public.profiles to authenticated;
grant select (github_username) on public.profiles to authenticated;
