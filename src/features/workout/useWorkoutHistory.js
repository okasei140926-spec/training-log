import { useMemo } from "react";
import { buildTrustedHistory } from "./buildTrustedHistory";
import {
  selectAnalyticsSummary,
  selectCalendarSummaries,
  selectHomeWeeklySummary,
  selectRecentRecords,
} from "./workoutSelectors";

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
  const trustedHistoryResult = useMemo(() => buildTrustedHistory({
    workoutRows,
    sessionRows,
    existingHistory,
    workoutsDataHistory,
    summaryHistory,
    cacheHistory,
    allowCacheFallback,
    calledFrom,
    log,
  }), [
    workoutRows,
    sessionRows,
    existingHistory,
    workoutsDataHistory,
    summaryHistory,
    cacheHistory,
    allowCacheFallback,
    calledFrom,
    log,
  ]);

  const trustedHistory = trustedHistoryResult.history;

  return {
    trustedHistory,
    trustedHistoryResult,
    selectRecentRecords: (options) => selectRecentRecords(trustedHistory, options),
    selectHomeWeeklySummary: (options) => selectHomeWeeklySummary(trustedHistory, options),
    selectCalendarSummaries: (options) => selectCalendarSummaries(trustedHistory, options),
    selectAnalyticsSummary: (options) => selectAnalyticsSummary(trustedHistory, options),
  };
}

export default useWorkoutHistory;
