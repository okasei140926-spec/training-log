create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

alter table public.notification_events enable row level security;

drop policy if exists "notification_events_select_own" on public.notification_events;
create policy "notification_events_select_own"
on public.notification_events
for select
to authenticated
using (auth.uid() = user_id);

-- NOTE:
-- dedupe_key は通知の種類ごとに再利用されるため、全体 unique ではなく
-- user_id + dedupe_key の複合 unique にしています。
-- これにより friend_workout / big3_overtake / inactivity / workout_like を
-- 受信者単位で重複防止できます。
