import { useCallback, useMemo, useRef } from "react";
import { buildTrustedHistory } from "./buildTrustedHistory";
import {
  selectAnalyticsSummary,
  selectCalendarSummaries,
  selectHomeWeeklySummary,
  selectRecentRecords,
} from "./workoutSelectors";

const EMPTY_HISTORY = Object.freeze({});

const getPerfNow = () => (
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now()
);

const normalizeDateKey = (value) => String(value || "").slice(0, 10);

const hashRows = (rows = [], dateField = "date") => JSON.stringify(
  [...(rows || [])]
    .map((row) => ({
      date: normalizeDateKey(row?.[dateField] || row?.date || row?.workout_date || row?.workoutDate),
      data: row?.data ?? row?.summary_json ?? row,
      duration_sec: row?.duration_sec ?? null,
      total_volume: row?.total_volume ?? null,
      updated_at: row?.updated_at ?? null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
);

const hashHistory = (history = {}) => JSON.stringify(
  Object.keys(history || {})
    .sort()
    .map((exerciseName) => [
      exerciseName,
      (history?.[exerciseName] || []).map((record) => ({
        date: normalizeDateKey(record?.date || record?.workoutDate || record?.workout_date),
        sets: record?.sets || [],
        bodyPart: record?.bodyPart || record?.body_part || null,
      })),
    ])
);

const hashOptions = (options = {}) => JSON.stringify(options || {});

export function useWorkoutHistory({
  workoutRows = [],
  sessionRows = [],
  existingHistory = {},
  workoutsDataHistory = {},
  summaryHistory = null,
  cacheHistory = {},
  allowCacheFallback = false,
  calledFrom = "useWorkoutHistory",
  log = false,
} = {}) {
  const renderCountRef = useRef(0);
  const cacheRef = useRef(null);
  renderCountRef.current += 1;

  const workoutRowsHash = useMemo(() => hashRows(workoutRows, "date"), [workoutRows]);
  const sessionRowsHash = useMemo(() => hashRows(sessionRows, "workout_date"), [sessionRows]);
  const hasRemoteWorkoutRows = (workoutRows || []).length > 0;
  const fallbackExistingHistory = hasRemoteWorkoutRows ? EMPTY_HISTORY : (existingHistory || EMPTY_HISTORY);
  const fallbackWorkoutsDataHistory = hasRemoteWorkoutRows ? EMPTY_HISTORY : (workoutsDataHistory || EMPTY_HISTORY);
  const fallbackSummaryHistory = hasRemoteWorkoutRows ? EMPTY_HISTORY : (summaryHistory || EMPTY_HISTORY);
  const fallbackCacheHistory = hasRemoteWorkoutRows || !allowCacheFallback ? EMPTY_HISTORY : (cacheHistory || EMPTY_HISTORY);
  const existingHistoryHash = useMemo(() => hashHistory(fallbackExistingHistory), [fallbackExistingHistory]);
  const workoutsDataHistoryHash = useMemo(() => hashHistory(fallbackWorkoutsDataHistory), [fallbackWorkoutsDataHistory]);
  const summaryHistoryHash = useMemo(() => hashHistory(fallbackSummaryHistory), [fallbackSummaryHistory]);
  const cacheHistoryHash = useMemo(() => hashHistory(fallbackCacheHistory), [fallbackCacheHistory]);
  const inputHash = [
    workoutRowsHash,
    sessionRowsHash,
    existingHistoryHash,
    workoutsDataHistoryHash,
    summaryHistoryHash,
    cacheHistoryHash,
    allowCacheFallback && !hasRemoteWorkoutRows ? "cache" : "no-cache",
    calledFrom,
  ].join("|");

  const trustedHistoryResult = useMemo(() => {
    const startedAt = getPerfNow();
    const previous = cacheRef.current;
    if (previous?.inputHash === inputHash) {
      if (log) {
        console.log("[workout] use workout history perf", {
          action: "use_workout_history_perf",
          renderCount: renderCountRef.current,
          calledFrom,
          rowsHash: inputHash,
          previousRowsHash: previous.inputHash,
          trustedHistoryHash: previous.trustedHistoryHash,
          previousTrustedHistoryHash: previous.trustedHistoryHash,
          skippedSameRows: true,
          durationMs: Math.round((getPerfNow() - startedAt) * 10) / 10,
        });
      }
      return previous.result;
    }

    const result = buildTrustedHistory({
      workoutRows,
      sessionRows,
      existingHistory: fallbackExistingHistory,
      workoutsDataHistory: fallbackWorkoutsDataHistory,
      summaryHistory: fallbackSummaryHistory,
      cacheHistory: fallbackCacheHistory,
      allowCacheFallback: allowCacheFallback && !hasRemoteWorkoutRows,
      calledFrom,
      log,
    });
    const trustedHistoryHash = hashHistory(result.history);
    if (log) {
      console.log("[workout] use workout history perf", {
        action: "use_workout_history_perf",
        renderCount: renderCountRef.current,
        calledFrom,
        rowsHash: inputHash,
        previousRowsHash: previous?.inputHash || null,
        trustedHistoryHash,
        previousTrustedHistoryHash: previous?.trustedHistoryHash || null,
        skippedSameRows: false,
        durationMs: Math.round((getPerfNow() - startedAt) * 10) / 10,
      });
      console.log("[workout] build trusted history perf", {
        action: "build_trusted_history_perf",
        inputRowsCount: (workoutRows || []).length,
        outputDatesCount: result.finalTrustedDates?.length || 0,
        rowsHash: inputHash,
        skippedByMemo: false,
        durationMs: Math.round((getPerfNow() - startedAt) * 10) / 10,
      });
    }
    cacheRef.current = {
      inputHash,
      result,
      trustedHistoryHash,
    };
    return result;
  }, [
    allowCacheFallback,
    calledFrom,
    fallbackCacheHistory,
    fallbackExistingHistory,
    fallbackSummaryHistory,
    fallbackWorkoutsDataHistory,
    hasRemoteWorkoutRows,
    inputHash,
    log,
    sessionRows,
    workoutRows,
  ]);

  const trustedHistory = trustedHistoryResult.history;
  const trustedHistoryHash = cacheRef.current?.trustedHistoryHash || hashHistory(trustedHistory);

  const selectorCacheRef = useRef(new Map());
  const runSelector = useCallback((selectorName, selector, options = {}) => {
    const startedAt = getPerfNow();
    const cacheKey = `${selectorName}:${trustedHistoryHash}:${hashOptions(options)}`;
    if (selectorCacheRef.current.has(cacheKey)) {
      const cached = selectorCacheRef.current.get(cacheKey);
      if (log) {
        console.log("[workout] selector perf", {
          action: "workout_selector_perf",
          selectorName,
          historyHash: trustedHistoryHash,
          skippedByMemo: true,
          durationMs: Math.round((getPerfNow() - startedAt) * 10) / 10,
        });
      }
      return cached;
    }
    const result = selector(trustedHistory, options);
    selectorCacheRef.current.set(cacheKey, result);
    if (selectorCacheRef.current.size > 20) {
      const firstKey = selectorCacheRef.current.keys().next().value;
      selectorCacheRef.current.delete(firstKey);
    }
    if (log) {
      console.log("[workout] selector perf", {
        action: "workout_selector_perf",
        selectorName,
        historyHash: trustedHistoryHash,
        skippedByMemo: false,
        durationMs: Math.round((getPerfNow() - startedAt) * 10) / 10,
      });
    }
    return result;
  }, [log, trustedHistory, trustedHistoryHash]);

  return {
    trustedHistory,
    trustedHistoryResult,
    selectRecentRecords: (options) => runSelector("selectRecentRecords", selectRecentRecords, options),
    selectHomeWeeklySummary: (options) => runSelector("selectHomeWeeklySummary", selectHomeWeeklySummary, options),
    selectCalendarSummaries: (options) => runSelector("selectCalendarSummaries", selectCalendarSummaries, options),
    selectAnalyticsSummary: (options) => runSelector("selectAnalyticsSummary", selectAnalyticsSummary, options),
  };
}

export default useWorkoutHistory;
