create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  dedupe_key text not null,
  payload jsonb,
  sent_at timestamptz,
  created_at timestamptz default now(),
  unique (user_id, dedupe_key)
);

alter table public.notification_events enable row level security;

drop policy if exists "notification_events_select_own" on public.notification_events;
create policy "notification_events_select_own"
on public.notification_events
for select
to authenticated
using (auth.uid() = user_id);
