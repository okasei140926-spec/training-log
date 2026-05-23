create extension if not exists pgcrypto with schema extensions;

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'AI相談',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  workout_plan jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_conversations_user_updated_idx
  on public.ai_conversations (user_id, updated_at desc);

create index if not exists ai_messages_conversation_created_idx
  on public.ai_messages (conversation_id, created_at asc);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_conversations'
      and policyname = 'ai_conversations_select_own'
  ) then
    create policy ai_conversations_select_own
      on public.ai_conversations
      for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_conversations'
      and policyname = 'ai_conversations_insert_own'
  ) then
    create policy ai_conversations_insert_own
      on public.ai_conversations
      for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_conversations'
      and policyname = 'ai_conversations_update_own'
  ) then
    create policy ai_conversations_update_own
      on public.ai_conversations
      for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_conversations'
      and policyname = 'ai_conversations_delete_own'
  ) then
    create policy ai_conversations_delete_own
      on public.ai_conversations
      for delete
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_messages'
      and policyname = 'ai_messages_select_own'
  ) then
    create policy ai_messages_select_own
      on public.ai_messages
      for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_messages'
      and policyname = 'ai_messages_insert_own'
  ) then
    create policy ai_messages_insert_own
      on public.ai_messages
      for insert
      with check (
        auth.uid() = user_id
        and exists (
          select 1
          from public.ai_conversations
          where id = conversation_id
            and user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_messages'
      and policyname = 'ai_messages_delete_own'
  ) then
    create policy ai_messages_delete_own
      on public.ai_messages
      for delete
      using (auth.uid() = user_id);
  end if;
end
$$;
