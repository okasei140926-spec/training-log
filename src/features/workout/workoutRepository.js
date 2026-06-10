import { supabase as defaultSupabase } from "../../utils/supabase";
import {
  getTrustedHistoryMetricsForDate,
  pickHistoryForDate,
} from "./buildTrustedHistory";
import { getWorkoutSaveGuardDecision } from "./workoutSaveGuards";

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
    .select("id,user_id,date,data,created_at")
    .eq("user_id", userId)
    .order("date", { ascending: true });

  if (fromDate) query = query.gte("date", normalizeDateKey(fromDate));
  if (toDate) query = query.lte("date", normalizeDateKey(toDate));
  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  return { rows: data || [], error };
}

export async function fetchWorkoutRowsForDates({
  userId,
  dates = [],
  supabase = defaultSupabase,
} = {}) {
  const normalizedDates = [...new Set(
    (dates || []).map(normalizeDateKey).filter(Boolean)
  )];
  if (!userId || !normalizedDates.length) return { rows: [], error: null };

  const { data, error } = await supabase
    .from("workouts")
    .select("id,user_id,date,data,created_at")
    .eq("user_id", userId)
    .in("date", normalizedDates)
    .order("date", { ascending: true });

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
    .select("id,user_id,date,data,created_at")
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
  source = "workoutRepository",
  logger = console,
  supabase = defaultSupabase,
} = {}) {
  const startedAt = (
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now()
  );
  const normalizedDate = requireUserAndDate(userId, date);
  const dateScopedHistory = pickHistoryForDate(history || {}, normalizedDate);
  const remoteDateScopedHistory = pickHistoryForDate(remoteHistory || {}, normalizedDate);

  const guard = getWorkoutSaveGuardDecision({
    localHistory: dateScopedHistory,
    remoteHistory: remoteDateScopedHistory,
    date: normalizedDate,
    reason,
    explicitEdit,
    explicitDelete,
  });

  if (guard.blocked) {
    logger?.warn?.("[workout repository] save blocked by guard", {
      action: "workout_repository_save",
      date: normalizedDate,
      source,
      beforeExerciseNames: guard.localMetrics.exerciseNames,
      savedExerciseNames: guard.localMetrics.exerciseNames,
      remoteVerifiedExerciseNames: guard.remoteMetrics.exerciseNames,
      lostExerciseNames: guard.details.removedExerciseNames,
      blockedRegression: true,
      blockedReason: guard.blockedReason,
      durationMs: Math.round((
        (typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now()) - startedAt
      ) * 10) / 10,
    });
    return {
      ok: false,
      skipped: true,
      blocked: true,
      error: null,
      guard,
      verifiedRow: null,
      verifiedHistory: {},
      savedHistory: dateScopedHistory,
    };
  }

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
    logger?.warn?.("[workout repository] save failed", {
      action: "workout_repository_save",
      date: normalizedDate,
      source,
      beforeExerciseNames: guard.localMetrics.exerciseNames,
      savedExerciseNames: guard.localMetrics.exerciseNames,
      remoteVerifiedExerciseNames: guard.remoteMetrics.exerciseNames,
      lostExerciseNames: [],
      blockedRegression: false,
      error: saveResponse.error?.message || String(saveResponse.error),
      durationMs: Math.round((
        (typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now()) - startedAt
      ) * 10) / 10,
    });
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
  const verifiedHistory = verify.row?.data
    ? pickHistoryForDate(verify.row.data, normalizedDate)
    : {};
  const verifiedMetrics = getTrustedHistoryMetricsForDate(verifiedHistory, normalizedDate);
  const savedNameSet = new Set((guard.localMetrics.exerciseNames || []).map((name) => String(name || "").trim()).filter(Boolean));
  const verifiedNameSet = new Set((verifiedMetrics.exerciseNames || []).map((name) => String(name || "").trim()).filter(Boolean));
  const lostExerciseNames = [...savedNameSet].filter((name) => !verifiedNameSet.has(name));
  const verifyFailed = Boolean(
    verify.error ||
    (hasWorkout && (
      lostExerciseNames.length ||
      verifiedMetrics.setCount < guard.localMetrics.setCount
    ))
  );

  logger?.log?.("[workout repository] save verified", {
    action: "workout_repository_save",
    date: normalizedDate,
    source,
    beforeExerciseNames: guard.localMetrics.exerciseNames,
    savedExerciseNames: guard.localMetrics.exerciseNames,
    remoteVerifiedExerciseNames: verifiedMetrics.exerciseNames,
    lostExerciseNames,
    blockedRegression: verifyFailed,
    blockedReason: verifyFailed && !verify.error
      ? "remote verification did not match saved workout"
      : null,
    durationMs: Math.round((
      (typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now()) - startedAt
    ) * 10) / 10,
  });

  return {
    ok: !verifyFailed,
    error: verify.error || (verifyFailed ? new Error(`workouts.data verification failed for ${normalizedDate}`) : null),
    guard,
    verifiedRow: verify.row,
    verifiedHistory,
    verifiedMetrics,
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
