-- Telegram chat mappings and one-time account-link tokens are only accessed
-- by the Edge Function using the project's secret API key.
create table if not exists public.telegram_connections (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  chat_id text not null unique,
  telegram_username text,
  linked_at timestamptz not null default now()
);

create table if not exists public.telegram_link_tokens (
  token_hash text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists telegram_link_tokens_user_idx
  on public.telegram_link_tokens(user_id);

alter table public.telegram_connections enable row level security;
alter table public.telegram_link_tokens enable row level security;
revoke all on public.telegram_connections, public.telegram_link_tokens from anon, authenticated;
grant all on public.telegram_connections, public.telegram_link_tokens to service_role;

