import {
  buildHistoryFromWorkoutRowsWithScopes,
  getValidWorkoutDatesFromHistory,
  mergeHistoryMaps,
  sanitizeHistoryRecord,
  sanitizeWorkoutSets,
} from "./helpers";
import { normalizeExerciseName } from "./exerciseName";

const normalizeDateKey = (value) => String(value || "").slice(0, 10);

const uniqueDates = (dates = []) => (
  [...new Set((dates || []).map(normalizeDateKey).filter(Boolean))]
);

const roundMetric = (value) => Math.round(Number(value || 0) * 10) / 10;

const getEmptyHistoryMetrics = () => ({
  hasWorkout: false,
  exerciseCount: 0,
  setCount: 0,
  volume: 0,
  exerciseNames: [],
});

export const getHistoryMetricsForDate = (historyMap, targetDate) => {
  const normalizedDate = normalizeDateKey(targetDate);
  if (!normalizedDate) return getEmptyHistoryMetrics();

  const exerciseNames = [];
  let setCount = 0;
  let volume = 0;

  Object.entries(historyMap || {}).forEach(([exerciseName, records]) => {
    (records || []).forEach((record) => {
      const sanitized = sanitizeHistoryRecord(record, { allowBodyweight: true });
      if (!sanitized || sanitized.date !== normalizedDate) return;

      const sets = sanitized?.sets || [];
      if (!sets.length) return;

      exerciseNames.push(exerciseName);
      setCount += sets.length;
      volume += sets.reduce((sum, set) => {
        const weight = Number(set?.weight);
        const reps = Number(set?.reps);
        if (!Number.isFinite(weight) || !Number.isFinite(reps)) return sum;
        return sum + (weight > 0 && reps > 0 ? weight * reps : 0);
      }, 0);
    });
  });

  const uniqueExerciseNames = [...new Set(exerciseNames)];

  return {
    hasWorkout: uniqueExerciseNames.length > 0 && setCount > 0,
    exerciseCount: uniqueExerciseNames.length,
    setCount,
    volume: roundMetric(volume),
    exerciseNames: uniqueExerciseNames,
  };
};

export const removeHistoryDateFromMap = (historyMap, targetDate) => {
  const normalizedDate = normalizeDateKey(targetDate);
  if (!normalizedDate) return historyMap || {};

  const next = {};
  Object.entries(historyMap || {}).forEach(([exerciseName, records]) => {
    const keptRecords = (records || []).filter((record) => (
      normalizeDateKey(record?.date || record?.workoutDate || record?.workout_date) !== normalizedDate
    ));
    if (keptRecords.length > 0) next[exerciseName] = keptRecords;
  });

  return next;
};

export const applyPreferredHistoryDates = (baseHistory, preferredHistory, dates = []) => {
  let nextHistory = mergeHistoryMaps(baseHistory || {});

  uniqueDates(dates).forEach((date) => {
    nextHistory = removeHistoryDateFromMap(nextHistory, date);
    const dateRecords = {};

    Object.entries(preferredHistory || {}).forEach(([exerciseName, records]) => {
      const filtered = (records || []).filter((record) => (
        normalizeDateKey(record?.date || record?.workoutDate || record?.workout_date) === date
      ));
      if (filtered.length > 0) dateRecords[exerciseName] = filtered;
    });

    nextHistory = mergeHistoryMaps(nextHistory, dateRecords);
  });

  return nextHistory;
};

const getRemovedExerciseNames = (baseMetrics, candidateMetrics) => {
  const candidateNames = new Set(
    (candidateMetrics.exerciseNames || [])
      .map((name) => normalizeExerciseName(name))
      .filter(Boolean)
  );

  return (baseMetrics.exerciseNames || [])
    .map((name) => normalizeExerciseName(name))
    .filter((name) => name && !candidateNames.has(name));
};

export const shouldPreferHistoryForDate = (baseHistory, candidateHistory, date) => {
  const baseMetrics = getHistoryMetricsForDate(baseHistory, date);
  const candidateMetrics = getHistoryMetricsForDate(candidateHistory, date);
  if (!candidateMetrics.hasWorkout) return false;
  if (!baseMetrics.hasWorkout) return true;

  if (getRemovedExerciseNames(baseMetrics, candidateMetrics).length > 0) return false;
  if (candidateMetrics.exerciseCount < baseMetrics.exerciseCount) return false;
  if (candidateMetrics.setCount < baseMetrics.setCount) return false;

  return true;
};

const applyCandidateHistoryDates = ({
  trustedHistory,
  candidateHistory,
  dates,
  sourceName,
  sourceByDate,
  exactDateSet,
  blockExactDates = false,
  onlyIfMissing = false,
}) => {
  let nextHistory = trustedHistory;
  let rejectedStaleSnapshotCount = 0;
  const appliedDates = [];
  const rejectedDates = [];

  uniqueDates(dates).forEach((date) => {
    if (blockExactDates && exactDateSet?.has(date)) {
      rejectedDates.push({ date, reason: "exactHistory already exists" });
      return;
    }

    const currentMetrics = getHistoryMetricsForDate(nextHistory, date);
    if (onlyIfMissing && currentMetrics.hasWorkout) {
      rejectedDates.push({ date, reason: "trusted history already has date" });
      return;
    }

    if (!shouldPreferHistoryForDate(nextHistory, candidateHistory, date)) {
      rejectedStaleSnapshotCount += 1;
      rejectedDates.push({ date, reason: "stale or smaller snapshot" });
      return;
    }

    nextHistory = applyPreferredHistoryDates(nextHistory, candidateHistory, [date]);
    sourceByDate[date] = sourceName;
    appliedDates.push(date);
  });

  return {
    history: nextHistory,
    appliedDates,
    rejectedDates,
    rejectedStaleSnapshotCount,
  };
};

const getSessionSummaryItems = (summaryJson) => {
  if (Array.isArray(summaryJson?.items)) return summaryJson.items;
  if (Array.isArray(summaryJson?.exercises)) return summaryJson.exercises;
  if (Array.isArray(summaryJson)) return summaryJson;
  return [];
};

export const buildHistoryFromWorkoutSessionRows = (sessionRows = []) => {
  const historyMap = {};
  let rejectedDateMismatchCount = 0;

  (sessionRows || []).forEach((session) => {
    const workoutDate = normalizeDateKey(session?.workout_date || session?.date);
    const durationSec = Math.floor(Number(session?.duration_sec) || 0);
    const summaryItems = getSessionSummaryItems(session?.summary_json);

    if (!workoutDate || !summaryItems.length) return;

    summaryItems.forEach((item, index) => {
      const itemDate = normalizeDateKey(item?.date || item?.workoutDate || item?.workout_date);
      if (itemDate && itemDate !== workoutDate) {
        rejectedDateMismatchCount += 1;
        return;
      }

      const exerciseName = String(item?.exercise_name || item?.exerciseName || item?.name || "").trim();
      if (!exerciseName) return;

      const sets = sanitizeWorkoutSets(item?.sets || [], { allowBodyweight: true });
      if (!sets.length) return;

      if (!historyMap[exerciseName]) historyMap[exerciseName] = [];

      const durationMinutes = durationSec > 0 && durationSec < 86400
        ? Math.max(1, Math.round(durationSec / 60))
        : 0;

      historyMap[exerciseName].push({
        date: workoutDate,
        bodyPart: String(item?.body_part || item?.bodyPart || "").trim(),
        order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index,
        sets,
        weight: sets[0]?.weight === "BW" ? "BW" : Number(sets[0]?.weight),
        reps: Number(sets[0]?.reps),
        source: "workout_session",
        ...(durationMinutes > 0
          ? {
              duration_sec: durationSec,
              durationSec,
              durationMinutes,
              elapsedMinutes: durationMinutes,
            }
          : {}),
      });
    });
  });

  return {
    history: historyMap,
    rejectedDateMismatchCount,
  };
};

const getWorkoutRowsDateMismatchCount = (workoutRows = []) => {
  let count = 0;

  (workoutRows || []).forEach((row) => {
    const rowDate = normalizeDateKey(row?.date || row?.workout_date || row?.workoutDate);
    const data = row?.data;
    const historyData = data?.history && typeof data.history === "object"
      ? data.history
      : data?.workouts && typeof data.workouts === "object"
        ? data.workouts
        : data;

    Object.values(historyData || {}).forEach((records) => {
      const recordList = Array.isArray(records)
        ? records
        : records && typeof records === "object"
          ? [records]
          : [];

      recordList.forEach((record) => {
        const recordDate = normalizeDateKey(record?.date || record?.workoutDate || record?.workout_date);
        if (rowDate && recordDate && rowDate !== recordDate) count += 1;
      });
    });
  });

  return count;
};

const getSetCountsByDate = (historyMap) => {
  const counts = {};
  getValidWorkoutDatesFromHistory(historyMap || {}).forEach((date) => {
    counts[date] = getHistoryMetricsForDate(historyMap, date).setCount;
  });
  return counts;
};

export const buildTrustedHistory = ({
  workoutRows = [],
  sessionRows = [],
  existingHistory = {},
  workoutsDataHistory = {},
  summaryHistory = null,
  cacheHistory = {},
  allowCacheFallback = false,
  source = "unknown",
  logger = console,
  log = true,
} = {}) => {
  const workoutScopes = buildHistoryFromWorkoutRowsWithScopes(workoutRows || []);
  const sessionFallback = summaryHistory
    ? { history: summaryHistory, rejectedDateMismatchCount: 0 }
    : buildHistoryFromWorkoutSessionRows(sessionRows || []);

  const exactDates = uniqueDates(workoutScopes.exactDates || []);
  const exactDateSet = new Set(exactDates);
  const legacyDates = uniqueDates(workoutScopes.legacyDates || []);
  const summaryDates = getValidWorkoutDatesFromHistory(sessionFallback.history || {});
  const cacheDates = getValidWorkoutDatesFromHistory(cacheHistory || {});

  let trustedHistory = mergeHistoryMaps(existingHistory || {});
  const sourceByDate = {};
  getValidWorkoutDatesFromHistory(trustedHistory).forEach((date) => {
    sourceByDate[date] = "existingHistory";
  });

  let rejectedStaleSnapshotCount = 0;
  const rejectedCandidates = [];
  const applyCandidate = (options) => {
    const result = applyCandidateHistoryDates({
      trustedHistory,
      sourceByDate,
      exactDateSet,
      ...options,
    });
    trustedHistory = result.history;
    rejectedStaleSnapshotCount += result.rejectedStaleSnapshotCount;
    rejectedCandidates.push(...result.rejectedDates.map((item) => ({
      ...item,
      source: options.sourceName,
    })));
    return result;
  };

  applyCandidate({
    candidateHistory: workoutsDataHistory,
    dates: getValidWorkoutDatesFromHistory(workoutsDataHistory || {}),
    sourceName: "workoutsDataHistory",
  });

  applyCandidate({
    candidateHistory: workoutScopes.exactHistory,
    dates: exactDates,
    sourceName: "workouts.data exactHistory",
  });

  applyCandidate({
    candidateHistory: workoutScopes.legacyHistory,
    dates: legacyDates,
    sourceName: "workouts.data legacyHistory",
    blockExactDates: true,
  });

  applyCandidate({
    candidateHistory: sessionFallback.history,
    dates: summaryDates,
    sourceName: "workout_sessions.summary_json",
    onlyIfMissing: true,
  });

  if (allowCacheFallback) {
    applyCandidate({
      candidateHistory: cacheHistory,
      dates: cacheDates,
      sourceName: "localStorage/history_cache",
      onlyIfMissing: true,
    });
  }

  const finalDates = getValidWorkoutDatesFromHistory(trustedHistory);
  const finalSetCountsByDate = getSetCountsByDate(trustedHistory);
  const rejectedDateMismatchCount = getWorkoutRowsDateMismatchCount(workoutRows)
    + Number(sessionFallback.rejectedDateMismatchCount || 0);

  if (log && logger?.log) {
    logger.log("[history] build trusted history", {
      action: "build_trusted_history",
      source,
      inputWorkoutsRowsCount: (workoutRows || []).length,
      inputWorkoutSessionsRowsCount: (sessionRows || []).length,
      exactDates,
      legacyFallbackDates: legacyDates,
      summaryJsonFallbackDates: summaryDates,
      cacheFallbackDates: allowCacheFallback ? cacheDates : [],
      rejectedDateMismatchCount,
      rejectedStaleSnapshotCount,
      rejectedCandidates,
      finalTrustedDates: finalDates,
      finalSetCountsByDate,
      sourceChosenByDate: sourceByDate,
    });
  }

  return {
    history: trustedHistory,
    sourceByDate,
    exactDates,
    legacyFallbackDates: legacyDates,
    summaryJsonFallbackDates: summaryDates,
    rejectedDateMismatchCount,
    rejectedStaleSnapshotCount,
    finalTrustedDates: finalDates,
    finalSetCountsByDate,
  };
};
