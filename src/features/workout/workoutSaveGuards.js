import {
  getHistoryMetricsForDate,
  pickHistoryForDate,
} from "./buildTrustedHistory";
import { normalizeExerciseName } from "../../utils/exerciseName";

const EXPLICIT_EDIT_REASONS = new Set([
  "exercise_add",
  "manual_exercise_add",
  "set_add",
  "set_input_change",
  "explicit_set_edit",
  "weight_change",
  "reps_change",
  "unit_change",
  "weight_mode_change",
  "reorder",
]);

const EXPLICIT_DELETE_REASONS = new Set([
  "exercise_remove",
  "set_remove",
  "explicit_delete",
  "delete",
]);

const normalizeDateKey = (value) => String(value || "").slice(0, 10);

const normalizeNameList = (names = []) => (
  (names || []).map((name) => normalizeExerciseName(name)).filter(Boolean)
);

const getRemovedExerciseNames = (remoteMetrics, localMetrics) => {
  const localNames = new Set(normalizeNameList(localMetrics.exerciseNames));
  return (remoteMetrics.exerciseNames || []).filter((name) => {
    const normalized = normalizeExerciseName(name);
    return normalized && !localNames.has(normalized);
  });
};

export const isExplicitWorkoutEditReason = (reason) =>
  EXPLICIT_EDIT_REASONS.has(String(reason || ""));

export const isExplicitWorkoutDeleteReason = (reason) =>
  EXPLICIT_DELETE_REASONS.has(String(reason || ""));

export function getWorkoutSaveGuardDecision({
  localHistory = {},
  remoteHistory = {},
  date,
  reason = "",
  explicitEdit = isExplicitWorkoutEditReason(reason),
  explicitDelete = isExplicitWorkoutDeleteReason(reason),
} = {}) {
  const normalizedDate = normalizeDateKey(date);
  const localDateHistory = pickHistoryForDate(localHistory || {}, normalizedDate);
  const remoteDateHistory = pickHistoryForDate(remoteHistory || {}, normalizedDate);
  const localMetrics = getHistoryMetricsForDate(localDateHistory, normalizedDate);
  const remoteMetrics = getHistoryMetricsForDate(remoteDateHistory, normalizedDate);
  const removedExerciseNames = getRemovedExerciseNames(remoteMetrics, localMetrics);
  const exerciseCountReduced = localMetrics.exerciseCount < remoteMetrics.exerciseCount;
  const setCountReduced = localMetrics.setCount < remoteMetrics.setCount;
  const volumeReduced = localMetrics.volume < remoteMetrics.volume;

  if (explicitDelete) {
    return {
      allowed: true,
      blocked: false,
      allowedReason: "explicit delete",
      blockedReason: "",
      localMetrics,
      remoteMetrics,
      details: {
        removedExerciseNames,
        exerciseCountReduced,
        setCountReduced,
        volumeReduced,
      },
    };
  }

  if (removedExerciseNames.length || exerciseCountReduced || setCountReduced) {
    return {
      allowed: false,
      blocked: true,
      allowedReason: "",
      blockedReason: removedExerciseNames.length
        ? "non-delete save would remove exercises"
        : "non-delete save would reduce exercise/set count",
      localMetrics,
      remoteMetrics,
      details: {
        removedExerciseNames,
        exerciseCountReduced,
        setCountReduced,
        volumeReduced,
      },
    };
  }

  if (explicitEdit) {
    return {
      allowed: true,
      blocked: false,
      allowedReason: volumeReduced
        ? "explicit edit allowed despite volume difference"
        : "explicit edit allowed",
      blockedReason: "",
      localMetrics,
      remoteMetrics,
      details: {
        removedExerciseNames,
        exerciseCountReduced,
        setCountReduced,
        volumeReduced,
      },
    };
  }

  return {
    allowed: true,
    blocked: false,
    allowedReason: "non-destructive save",
    blockedReason: "",
    localMetrics,
    remoteMetrics,
    details: {
      removedExerciseNames,
      exerciseCountReduced,
      setCountReduced,
      volumeReduced,
    },
  };
}

export function assertNoUnexpectedWorkoutRegression(options) {
  const decision = getWorkoutSaveGuardDecision(options);
  if (decision.blocked) {
    const error = new Error(decision.blockedReason || "Workout save blocked by guard");
    error.workoutSaveGuard = decision;
    throw error;
  }
  return decision;
}
