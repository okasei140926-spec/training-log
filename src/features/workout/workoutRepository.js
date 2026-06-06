import { supabase as defaultSupabase } from "../../utils/supabase";
import { pickHistoryForDate } from "./buildTrustedHistory";
import { assertNoUnexpectedWorkoutRegression } from "./workoutSaveGuards";

const normalizeDateKey = (value) => String(value || "").slice(0, 10);

const requireUserAndDate = (userId, date) => {
  const normalizedDate = normalizeDateKey(date);
  if (!userId) throw new Error("workoutRepository requires userId");
  if (!normalizedDate) throw new Error("workoutRepository requires date");
  return normalizedDate;
};

export async function fetchWorkoutRows({
  userId,
  fromDate = "",
  toDate = "",
  limit = 120,
  supabase = defaultSupabase,
} = {}) {
  if (!userId) return { rows: [], error: null };

  let query = supabase
    .from("workouts")
    .select("id,user_id,date,data,created_at,updated_at")
    .eq("user_id", userId)
    .order("date", { ascending: true });

  if (fromDate) query = query.gte("date", normalizeDateKey(fromDate));
  if (toDate) query = query.lte("date", normalizeDateKey(toDate));
  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  return { rows: data || [], error };
}

export async function fetchWorkoutRowForDate({
  userId,
  date,
  supabase = defaultSupabase,
} = {}) {
  const normalizedDate = requireUserAndDate(userId, date);
  const { data, error } = await supabase
    .from("workouts")
    .select("id,user_id,date,data,created_at,updated_at")
    .eq("user_id", userId)
    .eq("date", normalizedDate)
    .maybeSingle();

  return { row: data || null, error };
}

export async function saveWorkoutForDate({
  userId,
  date,
  history,
  remoteHistory = {},
  reason = "",
  explicitEdit = false,
  explicitDelete = false,
  supabase = defaultSupabase,
} = {}) {
  const normalizedDate = requireUserAndDate(userId, date);
  const dateScopedHistory = pickHistoryForDate(history || {}, normalizedDate);

  const guard = assertNoUnexpectedWorkoutRegression({
    localHistory: dateScopedHistory,
    remoteHistory,
    date: normalizedDate,
    reason,
    explicitEdit,
    explicitDelete,
  });

  const hasWorkout = guard.localMetrics.hasWorkout;
  const saveResponse = hasWorkout
    ? await supabase
        .from("workouts")
        .upsert({
          user_id: userId,
          date: normalizedDate,
          data: dateScopedHistory,
        }, { onConflict: "user_id,date" })
    : explicitDelete
      ? await supabase
          .from("workouts")
          .delete()
          .eq("user_id", userId)
          .eq("date", normalizedDate)
      : { error: new Error("Refusing to save empty workout without explicit delete") };

  if (saveResponse.error) {
    return {
      ok: false,
      error: saveResponse.error,
      guard,
      verifiedRow: null,
      savedHistory: dateScopedHistory,
    };
  }

  const verify = await fetchWorkoutRowForDate({
    userId,
    date: normalizedDate,
    supabase,
  });

  return {
    ok: !verify.error,
    error: verify.error || null,
    guard,
    verifiedRow: verify.row,
    savedHistory: dateScopedHistory,
  };
}

export async function deleteWorkoutForDate({
  userId,
  date,
  supabase = defaultSupabase,
} = {}) {
  const normalizedDate = requireUserAndDate(userId, date);
  const { error } = await supabase
    .from("workouts")
    .delete()
    .eq("user_id", userId)
    .eq("date", normalizedDate);

  return { ok: !error, error };
}
