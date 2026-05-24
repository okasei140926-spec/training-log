create index if not exists idx_workouts_user_id_date
on public.workouts (user_id, date);

create index if not exists idx_workout_sessions_user_id_workout_date
on public.workout_sessions (user_id, workout_date);

create index if not exists idx_workout_sessions_user_id_created_at
on public.workout_sessions (user_id, created_at);
