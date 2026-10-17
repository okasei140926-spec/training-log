import { useMemo } from "react";
import { useWorkoutHistory } from "../features/workout/useWorkoutHistory";
import { computeWorkoutDisplayElapsedSec } from "../utils/workoutTimer";

/**
 * Manages displayHistory (draft-overlaid history for the log screen)
 * and trustedHistory (trusted history from useWorkoutHistory).
 *
 * workoutsDataHistory state/ref/applyWorkoutsDataHistorySnapshot stay in
 * App.jsx to avoid circular deps with useHistorySync.
 */
export function useDisplayHistory({
    // Core history state
    history,
    workoutsDataHistory,

    // Trusted rows from useHistorySync
    trustedWorkoutRows,
    trustedSessionRows,

    // Log screen state
    logDate,
    screen,
    workoutStartedForDate,
    savedWorkoutDurationSecByDate,
    todayLabels,
    workoutLogExercises,
    workoutLogData,
    getWorkoutLogExUnit,

    // Refs (passed by reference, not reactive)
    liveExercisesDateRef,
    pendingWorkoutContentChangeDatesRef,
    workoutTimerStateRef,

    // Module-level helpers from App.jsx (pure functions, no state)
    buildDraftHistoryForDate,
    getCurrentWeekRangeForHomeSummary,
    shouldLogPerfDebug,

    // 永続削除リスト: session fallback が削除済み日付を再注入しないよう buildTrustedHistory に渡す
    deletedDates = {},
}) {
    const displayHistory = useMemo(() => {
        if (!logDate) return history;

        // ■2: Skip overlay when workoutLogExercises belongs to a different date than logDate.
        // liveExercisesDateRef.current tracks the date that workoutLogExercises actually
        // belongs to (derived from workoutLog.draft.date, updated by useEffect in App.jsx).
        // - null/undefined → ref not yet initialized → overlay as before (safe default)
        // - matches logDate → exercises are current → overlay as before
        // - mismatches logDate → stale exercises from previous date → skip overlay to prevent
        //   cross-date contamination in trustedHistory
        const liveExercisesDate = liveExercisesDateRef?.current ?? null;
        const liveMatchesLogDate = liveExercisesDate === null || liveExercisesDate === logDate;
        if (!liveMatchesLogDate) {
            console.log("[WP] displayHistory:overlay-skipped", {
                logDate,
                liveExercisesDate,
                reason: "workoutLogExercises belongs to a different date than logDate",
            });
            return history;
        }

        const hasPendingDraftEdit = pendingWorkoutContentChangeDatesRef.current.has(String(logDate || "").slice(0, 10));
        const week = getCurrentWeekRangeForHomeSummary();
        const isLogDateThisWeek = logDate >= week.start && logDate <= week.end;
        const shouldOverlayDraft =
            screen === "log" ||
            workoutStartedForDate === logDate ||
            hasPendingDraftEdit ||
            (isLogDateThisWeek && workoutLogExercises.length > 0);
        if (!shouldOverlayDraft) return history;

        const durationSec = Math.max(
            0,
            workoutStartedForDate === logDate
                ? computeWorkoutDisplayElapsedSec(workoutTimerStateRef.current)
                : 0,
            Math.floor(Number(savedWorkoutDurationSecByDate[logDate]) || 0)
        );
        const pendingChange = pendingWorkoutContentChangeDatesRef.current.get(String(logDate || "").slice(0, 10)) || {};
        const nextHistory = buildDraftHistoryForDate({
            baseHistory: history,
            workoutDate: logDate,
            exercises: workoutLogExercises,
            logData: workoutLogData,
            getExUnit: getWorkoutLogExUnit,
            labels: todayLabels,
            durationSec,
            replaceDate: Boolean(pendingChange.explicitDelete),
        });

        return nextHistory;
    }, [
        history,
        logDate,
        savedWorkoutDurationSecByDate,
        screen,
        todayLabels,
        getWorkoutLogExUnit,
        workoutLogData,
        workoutLogExercises,
        workoutStartedForDate,
        // refs and module-level fns are stable; listed for completeness
        liveExercisesDateRef,
        pendingWorkoutContentChangeDatesRef,
        workoutTimerStateRef,
        buildDraftHistoryForDate,
        getCurrentWeekRangeForHomeSummary,
    ]);

    const workoutHistoryView = useWorkoutHistory({
        workoutRows: trustedWorkoutRows,
        sessionRows: trustedSessionRows,
        existingHistory: displayHistory,
        workoutsDataHistory,
        deletedDates,
        calledFrom: "trustedHistory",
        log: shouldLogPerfDebug(),
    });

    const trustedHistory = workoutHistoryView.trustedHistory;

    return {
        displayHistory,
        workoutHistoryView,
        trustedHistory,
    };
}
