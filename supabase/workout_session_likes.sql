create table if not exists public.workout_session_likes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (session_id, user_id)
);

alter table public.workout_session_likes enable row level security;

drop policy if exists "workout_session_likes_select_visible_session" on public.workout_session_likes;
create policy "workout_session_likes_select_visible_session"
on public.workout_session_likes
for select
to authenticated
using (
  exists (
    select 1
    from public.workout_sessions ws
    where ws.id = workout_session_likes.session_id
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

drop policy if exists "workout_session_likes_insert_own_visible_friend_session" on public.workout_session_likes;
create policy "workout_session_likes_insert_own_visible_friend_session"
on public.workout_session_likes
for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.workout_sessions ws
    where ws.id = workout_session_likes.session_id
      and ws.user_id <> auth.uid()
      and exists (
        select 1
        from public.friendships f
        where f.status = 'accepted'
          and (
            (f.requester_id = auth.uid() and f.receiver_id = ws.user_id)
            or (f.receiver_id = auth.uid() and f.requester_id = ws.user_id)
          )
      )
  )
);

drop policy if exists "workout_session_likes_delete_own" on public.workout_session_likes;
create policy "workout_session_likes_delete_own"
on public.workout_session_likes
for delete
to authenticated
using (auth.uid() = user_id);
