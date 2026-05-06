create table if not exists public.workout_session_comments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  parent_id uuid references public.workout_session_comments(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.validate_workout_session_comment()
returns trigger
language plpgsql
as $$
declare
  trimmed_content text;
  parent_session_id uuid;
  parent_parent_id uuid;
begin
  trimmed_content := btrim(coalesce(new.content, ''));

  if trimmed_content = '' then
    raise exception 'comment_content_empty';
  end if;

  if char_length(trimmed_content) > 300 then
    raise exception 'comment_content_too_long';
  end if;

  new.content := trimmed_content;

  if new.parent_id is not null then
    select session_id, parent_id
      into parent_session_id, parent_parent_id
    from public.workout_session_comments
    where id = new.parent_id;

    if parent_session_id is null then
      raise exception 'parent_comment_not_found';
    end if;

    if parent_session_id <> new.session_id then
      raise exception 'parent_comment_wrong_session';
    end if;

    if parent_parent_id is not null then
      raise exception 'reply_depth_exceeded';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_workout_session_comment on public.workout_session_comments;
create trigger trg_validate_workout_session_comment
before insert or update on public.workout_session_comments
for each row
execute function public.validate_workout_session_comment();

alter table public.workout_session_comments enable row level security;

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

drop policy if exists "workout_session_comments_delete_own" on public.workout_session_comments;
create policy "workout_session_comments_delete_own"
on public.workout_session_comments
for delete
to authenticated
using (auth.uid() = user_id);
