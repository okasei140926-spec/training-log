update public.workout_sessions
set visibility = 'friends'
where visibility <> 'friends';

drop policy if exists "workout_sessions_select_own_or_friends" on public.workout_sessions;
create policy "workout_sessions_select_own_or_friends"
on public.workout_sessions
for select
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and (
        (f.requester_id = auth.uid() and f.receiver_id = workout_sessions.user_id)
        or (f.receiver_id = auth.uid() and f.requester_id = workout_sessions.user_id)
      )
  )
);

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
        or exists (
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
);

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
        or exists (
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

drop policy if exists "workout_session_comments_select_visible_session" on public.workout_session_comments;
create policy "workout_session_comments_select_visible_session"
on public.workout_session_comments
for select
to authenticated
using (
  exists (
    select 1
    from public.workout_sessions ws
    where ws.id = workout_session_comments.session_id
      and (
        auth.uid() = ws.user_id
        or exists (
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
);

drop policy if exists "workout_session_comments_insert_own_visible_session" on public.workout_session_comments;
create policy "workout_session_comments_insert_own_visible_session"
on public.workout_session_comments
for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.workout_sessions ws
    where ws.id = workout_session_comments.session_id
      and (
        ws.user_id = auth.uid()
        or exists (
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
);
