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

// ─── Private: reads ONLY from workouts.data (no normalized tables) ────────────
async function fetchWorkoutRowForDateFromStorage(supabase, userId, date) {
  const { data, error } = await supabase
    .from("workouts")
    .select("id,user_id,date,data,created_at")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();
  return { row: data || null, error };
}

// ─── New helper: save to workout_exercises + workout_sets ─────────────────────
async function saveExercisesAndSets(supabase, workoutId, userId, date, historyForDate) {
  // historyForDate is like: { "Bench Press": [{date, bodyPart, order, sets:[...]}], ... }
  const exerciseEntries = Object.entries(historyForDate || {});

  for (let displayOrder = 0; displayOrder < exerciseEntries.length; displayOrder++) {
    const [exerciseName, records] = exerciseEntries[displayOrder];

    // Find the record for this date
    const record = (records || []).find(r => String(r?.date || "").slice(0, 10) === date)
      || records?.[0];
    if (!record || !Array.isArray(record.sets) || record.sets.length === 0) continue;

    // Upsert workout_exercises
    const { data: exRow, error: exErr } = await supabase
      .from("workout_exercises")
      .upsert({
        workout_id:    workoutId,
        exercise_name: exerciseName,
        body_part:     record.bodyPart || null,
        display_order: typeof record.order === "number" ? record.order : displayOrder,
      }, { onConflict: "workout_id,exercise_name" })
      .select("id")
      .single();

    if (exErr || !exRow?.id) continue;

    // Delete existing sets (replace strategy)
    await supabase
      .from("workout_sets")
      .delete()
      .eq("exercise_id", exRow.id);

    // Insert sets
    const setsToInsert = record.sets
      .filter(s => s && (Number(s.reps) > 0 || s.weight === "BW"))
      .map((s, idx) => ({
        exercise_id:    exRow.id,
        user_id:        userId,
        set_number:     idx + 1,
        weight:         s.weight === "BW" ? null : (Number(s.weight) || null),
        reps:           Number(s.reps) || 0,
        unit:           s.unit || s.weightUnit || (s.weight === "BW" ? "BW" : "kg"),
        display_weight: s.displayWeight != null ? Number(s.displayWeight) : (s.weight === "BW" ? null : Number(s.weight) || null),
        display_unit:   s.displayUnit || s.unit || "kg",
      }));

    if (setsToInsert.length > 0) {
      await supabase.from("workout_sets").insert(setsToInsert);
    }
  }
}

// ─── New helper: reconstruct data-compatible object from normalized rows ───────
function buildDataFromNormalizedRows(exercises, sets, date) {
  // exercises: [{id, workout_id, exercise_name, body_part, display_order}]
  // sets: [{id, exercise_id, set_number, weight, reps, unit, display_weight, display_unit}]
  // Returns: { "Bench Press": [{date, bodyPart, order, sets:[...]}], ... }

  const setsByExerciseId = {};
  (sets || []).forEach(s => {
    if (!setsByExerciseId[s.exercise_id]) setsByExerciseId[s.exercise_id] = [];
    setsByExerciseId[s.exercise_id].push(s);
  });

  const data = {};
  (exercises || [])
    .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
    .forEach(ex => {
      const exSets = (setsByExerciseId[ex.id] || [])
        .sort((a, b) => a.set_number - b.set_number)
        .map(s => ({
          weight:        s.weight != null ? s.weight : (s.unit === "BW" ? "BW" : 0),
          reps:          s.reps,
          unit:          s.unit || "kg",
          displayWeight: s.display_weight != null ? s.display_weight : s.weight,
          displayUnit:   s.display_unit || s.unit || "kg",
          done:          true,
        }));

      if (exSets.length === 0) return;

      data[ex.exercise_name] = [{
        date:        date,
        workoutDate: date,
        bodyPart:    ex.body_part || null,
        order:       ex.display_order || 0,
        sets:        exSets,
      }];
    });

  return data;
}

// ─── New helper: read from new tables, return row in workouts shape ───────────
async function fetchNormalizedWorkoutRow(supabase, userId, date) {
  // 1. Get the workout row
  const { data: workout, error: wErr } = await supabase
    .from("workouts")
    .select("id,user_id,date,created_at,duration_sec,updated_at")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();

  if (wErr || !workout) return { row: null, error: wErr };

  // 2. Get exercises
  const { data: exercises, error: exErr } = await supabase
    .from("workout_exercises")
    .select("id,workout_id,exercise_name,body_part,display_order")
    .eq("workout_id", workout.id);

  if (exErr) return { row: null, error: exErr };
  if (!exercises || exercises.length === 0) return { row: null, error: null }; // no normalized data yet

  // 3. Get sets
  const exerciseIds = exercises.map(e => e.id);
  const { data: sets, error: setErr } = await supabase
    .from("workout_sets")
    .select("id,exercise_id,set_number,weight,reps,unit,display_weight,display_unit")
    .in("exercise_id", exerciseIds);

  if (setErr) return { row: null, error: setErr };

  // 4. Reconstruct data field
  const data = buildDataFromNormalizedRows(exercises, sets || [], date);

  return {
    row: {
      id:           workout.id,
      user_id:      workout.user_id,
      date:         workout.date,
      data,
      created_at:   workout.created_at,
      duration_sec: workout.duration_sec,
      updated_at:   workout.updated_at,
    },
    error: null,
  };
}

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

  // Try normalized tables first
  const normalized = await fetchNormalizedWorkoutRow(supabase, userId, normalizedDate);
  if (normalized.error) return { row: null, error: normalized.error };
  if (normalized.row) return normalized;

  // Fall back to workouts.data
  return fetchWorkoutRowForDateFromStorage(supabase, userId, normalizedDate);
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

  // Dual-write to normalized tables (best-effort, non-fatal)
  if (hasWorkout) {
    try {
      // Fetch the workout id from storage (not via normalized path to avoid loop)
      const { row: storageRow } = await fetchWorkoutRowForDateFromStorage(supabase, userId, normalizedDate);
      if (storageRow?.id) {
        await saveExercisesAndSets(
          supabase,
          storageRow.id,
          userId,
          normalizedDate,
          dateScopedHistory
        );
      }
    } catch (normalizedError) {
      logger?.warn?.("[workout repository] normalized save failed (non-fatal)", {
        error: normalizedError?.message,
        date: normalizedDate,
      });
    }
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
