create table if not exists public.ai_chat_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  usage_date date not null,
  usage_count integer not null default 0 check (usage_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

create table if not exists public.pump_pro_subscriptions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  active boolean not null default false,
  provider text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.ai_chat_usage enable row level security;
alter table public.pump_pro_subscriptions enable row level security;

create or replace function public.is_user_pump_pro(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pump_pro_subscriptions
    where user_id = p_user_id
      and active = true
      and (expires_at is null or expires_at > now())
  );
$$;

create or replace function public.reserve_ai_chat_usage(
  p_user_id uuid,
  p_usage_date date,
  p_daily_limit integer
)
returns table (
  allowed boolean,
  is_pro boolean,
  usage_count integer,
  remaining integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_pro boolean;
  v_usage_count integer;
begin
  v_is_pro := public.is_user_pump_pro(p_user_id);

  select coalesce(usage_count, 0)
    into v_usage_count
  from public.ai_chat_usage
  where user_id = p_user_id
    and usage_date = p_usage_date;

  v_usage_count := coalesce(v_usage_count, 0);

  if v_is_pro then
    return query select true, true, v_usage_count, null::integer;
    return;
  end if;

  insert into public.ai_chat_usage (user_id, usage_date, usage_count)
  values (p_user_id, p_usage_date, 0)
  on conflict (user_id, usage_date) do nothing;

  update public.ai_chat_usage
     set usage_count = usage_count + 1,
         updated_at = now()
   where user_id = p_user_id
     and usage_date = p_usage_date
     and usage_count < p_daily_limit
   returning usage_count into v_usage_count;

  if v_usage_count is null then
    select usage_count
      into v_usage_count
    from public.ai_chat_usage
    where user_id = p_user_id
      and usage_date = p_usage_date;

    return query select false, false, coalesce(v_usage_count, p_daily_limit), 0;
    return;
  end if;

  return query select true, false, v_usage_count, greatest(0, p_daily_limit - v_usage_count);
end;
$$;

create or replace function public.refund_ai_chat_usage(
  p_user_id uuid,
  p_usage_date date
)
returns table (
  usage_count integer,
  remaining integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daily_limit integer := 5;
  v_usage_count integer;
begin
  update public.ai_chat_usage
     set usage_count = greatest(0, usage_count - 1),
         updated_at = now()
   where user_id = p_user_id
     and usage_date = p_usage_date
     and usage_count > 0
   returning usage_count into v_usage_count;

  v_usage_count := coalesce(v_usage_count, 0);
  return query select v_usage_count, greatest(0, v_daily_limit - v_usage_count);
end;
$$;
