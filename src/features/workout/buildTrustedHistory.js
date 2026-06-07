import {
  buildTrustedHistory as buildLegacyTrustedHistory,
  getHistoryMetricsForDate,
} from "../../utils/workoutHistory";
import {
  getValidWorkoutDatesFromHistory,
  mergeHistoryMaps,
  sanitizeHistoryRecord,
} from "../../utils/helpers";

const normalizeDateKey = (value) => String(value || "").slice(0, 10);

const getPerfNow = () => (
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now()
);

const uniqueDates = (dates = []) => (
  [...new Set((dates || []).map(normalizeDateKey).filter(Boolean))]
);

const getHistoryDateSet = (historyMap) =>
  new Set(getValidWorkoutDatesFromHistory(historyMap || {}));

export const getTrustedHistoryMetricsForDate = (trustedHistory, date) =>
  getHistoryMetricsForDate(trustedHistory || {}, date);

export const pickHistoryForDate = (historyMap, date) => {
  const normalizedDate = normalizeDateKey(date);
  if (!normalizedDate) return {};

  const next = {};
  Object.entries(historyMap || {}).forEach(([exerciseName, records]) => {
    const dateRecords = (records || []).filter((record) => (
      normalizeDateKey(record?.date || record?.workoutDate || record?.workout_date) === normalizedDate
    ));
    if (dateRecords.length) next[exerciseName] = dateRecords;
  });
  return next;
};

export const validateTrustedHistoryDateScopes = (historyMap) => {
  const rejected = [];
  const accepted = {};

  Object.entries(historyMap || {}).forEach(([exerciseName, records]) => {
    (records || []).forEach((record) => {
      const sanitized = sanitizeHistoryRecord(record, { allowBodyweight: true });
      const date = normalizeDateKey(sanitized?.date);
      if (!date) {
        rejected.push({ exerciseName, reason: "missing date" });
        return;
      }

      if (!accepted[exerciseName]) accepted[exerciseName] = [];
      accepted[exerciseName].push({
        ...sanitized,
        date,
        workoutDate: date,
        workout_date: date,
      });
    });
  });

  return {
    history: mergeHistoryMaps(accepted),
    rejectedDateMismatchCount: rejected.length,
    rejected,
  };
};

export function buildTrustedHistory({
  workoutRows = [],
  sessionRows = [],
  existingHistory = {},
  workoutsDataHistory = {},
  summaryHistory = null,
  cacheHistory = {},
  allowCacheFallback = false,
  calledFrom = "features/workout",
  source = "",
  logger = console,
  log = false,
} = {}) {
  const startedAt = getPerfNow();
  const buildSource = source || calledFrom;
  const result = buildLegacyTrustedHistory({
    workoutRows,
    sessionRows,
    existingHistory,
    workoutsDataHistory,
    summaryHistory,
    cacheHistory,
    allowCacheFallback,
    source: buildSource,
    logger,
    log,
  });

  const validated = validateTrustedHistoryDateScopes(result.history);
  const history = validated.history;
  const finalTrustedDates = getValidWorkoutDatesFromHistory(history);
  const exactDateSet = new Set(result.exactDates || []);
  const sourceByDate = { ...(result.sourceByDate || {}) };

  finalTrustedDates.forEach((date) => {
    if (!sourceByDate[date]) {
      sourceByDate[date] = exactDateSet.has(date)
        ? "workouts.data exactHistory"
        : "trustedHistory";
    }
  });

  const finalSetCountsByDate = finalTrustedDates.reduce((acc, date) => {
    acc[date] = getHistoryMetricsForDate(history, date).setCount;
    return acc;
  }, {});

  if (log && logger?.log) {
    const exactDates = uniqueDates(result.exactDates || []);
    const legacyFallbackDates = uniqueDates(result.legacyFallbackDates || []);
    const summaryJsonFallbackDates = uniqueDates(result.summaryJsonFallbackDates || []);
    logger.log("[workout] build trusted history", {
      action: "build_trusted_history",
      calledFrom: buildSource,
      inputWorkoutsRowsCount: (workoutRows || []).length,
      exactDates,
      legacyFallbackDates,
      summaryJsonFallbackDates,
      cacheFallbackDates: allowCacheFallback ? Array.from(getHistoryDateSet(cacheHistory)) : [],
      rejectedDateMismatchCount:
        Number(result.rejectedDateMismatchCount || 0) + Number(validated.rejectedDateMismatchCount || 0),
      rejectedStaleSnapshotCount: result.rejectedStaleSnapshotCount || 0,
      finalTrustedDates,
      finalSetCountsByDate,
      sourceChosenByDate: sourceByDate,
      durationMs: Math.round((getPerfNow() - startedAt) * 10) / 10,
    });
  }

  return {
    ...result,
    history,
    sourceByDate,
    finalTrustedDates,
    finalSetCountsByDate,
    rejectedDateMismatchCount:
      Number(result.rejectedDateMismatchCount || 0) + Number(validated.rejectedDateMismatchCount || 0),
  };
}

export default buildTrustedHistory;
