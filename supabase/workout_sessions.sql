create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  workout_date text not null,
  started_at timestamptz,
  ended_at timestamptz,
  duration_sec integer not null default 0,
  total_volume numeric not null default 0,
  exercise_count integer not null default 0,
  summary_json jsonb not null default '{}'::jsonb,
  photo_id uuid,
  visibility text not null default 'friends' check (visibility in ('private', 'friends')),
  photo_visibility text not null default 'hidden' check (photo_visibility in ('hidden', 'friends')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, workout_date)
);

create table if not exists public.workout_session_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  exercise_name text not null,
  body_part text,
  set_count integer not null default 0,
  max_weight numeric not null default 0,
  volume numeric not null default 0,
  best_set_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (session_id, exercise_name, body_part)
);

create or replace function public.set_workout_sessions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_workout_sessions_updated_at on public.workout_sessions;
create trigger trg_workout_sessions_updated_at
before update on public.workout_sessions
for each row
execute function public.set_workout_sessions_updated_at();

alter table public.workout_sessions enable row level security;
alter table public.workout_session_exercises enable row level security;

drop policy if exists "workout_sessions_select_own_or_friends" on public.workout_sessions;
create policy "workout_sessions_select_own_or_friends"
on public.workout_sessions
for select
to authenticated
using (
  auth.uid() = user_id
  or (
    exists (
      select 1
      from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.receiver_id = workout_sessions.user_id)
          or (f.receiver_id = auth.uid() and f.requester_id = workout_sessions.user_id)
        )
    )
  )
);

drop policy if exists "workout_sessions_insert_own" on public.workout_sessions;
create policy "workout_sessions_insert_own"
on public.workout_sessions
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "workout_sessions_update_own" on public.workout_sessions;
create policy "workout_sessions_update_own"
on public.workout_sessions
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "workout_sessions_delete_own" on public.workout_sessions;
create policy "workout_sessions_delete_own"
on public.workout_sessions
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "workout_session_exercises_select_parent_session" on public.workout_session_exercises;
create policy "workout_session_exercises_select_parent_session"
on public.workout_session_exercises
for select
to authenticated
using (
  exists (
    select 1
    from public.workout_sessions ws
    where ws.id = workout_session_exercises.session_id
      and (
        auth.uid() = ws.user_id
        or (
          exists (
            select 1
            from public.friendships f
            where f.status = 'accepted'
              and (
                (f.requester_id = auth.uid() and f.receiver_id = ws.user_id)
                or (f.receiver_id = auth.uid() and f.requester_id = ws.user_id)
              )
          )
        )
      )
  )
);

update public.workout_sessions
set visibility = 'friends'
where visibility <> 'friends';

drop policy if exists "workout_session_exercises_insert_own_parent" on public.workout_session_exercises;
create policy "workout_session_exercises_insert_own_parent"
on public.workout_session_exercises
for insert
to authenticated
with check (
  exists (
    select 1
    from public.workout_sessions ws
    where ws.id = workout_session_exercises.session_id
      and ws.user_id = auth.uid()
  )
);

drop policy if exists "workout_session_exercises_update_own_parent" on public.workout_session_exercises;
create policy "workout_session_exercises_update_own_parent"
on public.workout_session_exercises
for update
to authenticated
using (
  exists (
    select 1
    from public.workout_sessions ws
    where ws.id = workout_session_exercises.session_id
      and ws.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workout_sessions ws
    where ws.id = workout_session_exercises.session_id
      and ws.user_id = auth.uid()
  )
);

drop policy if exists "workout_session_exercises_delete_own_parent" on public.workout_session_exercises;
create policy "workout_session_exercises_delete_own_parent"
on public.workout_session_exercises
for delete
to authenticated
using (
  exists (
    select 1
    from public.workout_sessions ws
    where ws.id = workout_session_exercises.session_id
      and ws.user_id = auth.uid()
  )
);
