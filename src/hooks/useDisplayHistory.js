import { useMemo } from "react";
import { useWorkoutHistory } from "../features/workout/useWorkoutHistory";
import { computeWorkoutDisplayElapsedSec } from "../utils/workoutTimer";

/**
 * Manages displayHistory (draft-overlaid history for the log screen)
 * and canonicalDisplayHistory (trusted history from useWorkoutHistory).
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
    pendingWorkoutContentChangeDatesRef,
    workoutTimerStateRef,

    // Module-level helpers from App.jsx (pure functions, no state)
    buildDraftHistoryForDate,
    getCurrentWeekRangeForHomeSummary,
    shouldLogPerfDebug,
}) {
    const displayHistory = useMemo(() => {
        if (!logDate) return history;
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
        calledFrom: "canonicalDisplayHistory",
        log: shouldLogPerfDebug(),
    });

    const canonicalDisplayHistory = workoutHistoryView.trustedHistory;

    return {
        displayHistory,
        workoutHistoryView,
        canonicalDisplayHistory,
    };
}
