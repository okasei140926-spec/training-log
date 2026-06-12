import { useCallback } from "react";
import {
    applyPreferredHistoryDates,
    buildWorkoutDraftForDateFromHistory,
    describeHistoryRecordsForDate,
    getEmptyWorkoutMetrics,
    getHistoryMetricsForDate,
    getRuntimeEnvironmentLabel,
    getWorkoutSaveGuardDecision,
    isExplicitWorkoutEditChange,
    persistHistoryForUser,
    withDraftMeta,
} from "../utils/appHelpers";
import { mergeHistoryMaps, hasValidWorkoutOnDate } from "../utils/helpers";

export function useRetrySyncCallback({
    user,
    history,
    syncRetrying,
    syncFailuresByDateRef,
    latestHistoryRef,
    workoutsDataHistoryRef,
    explicitWorkoutEditDatesRef,
    pendingWorkoutContentChangeDatesRef,
    pendingWorkoutSessionSyncDatesRef,
    buildLatestLocalHistoryForRetryDate,
    fetchRemoteWorkoutRowsForDates,
    hasRemoteWorkoutForDate,
    syncWorkoutRowsForDates,
    syncWorkoutSessionSnapshot,
    deleteRemoteWorkoutArtifactsForDate,
    applyWorkoutsDataHistorySnapshot,
    saveDraftForDate,
    savedWorkoutDurationSecByDate,
    clearSyncFailure,
    recordSyncFailure,
    refreshHistorySyncDiagnostic,
    setHistory,
    setSyncRetrying,
    setSyncFailuresByDate,
    setSessionSyncVersion,
}) {
    const retryFailedSync = useCallback(async () => {
        if (!user?.id || syncRetrying) return;

        const failedDates = Object.keys(syncFailuresByDateRef.current);
        if (!failedDates.length) return;

        setSyncRetrying(true);
        try {
            let currentHistory = mergeHistoryMaps(latestHistoryRef.current || history || {});
            for (const date of failedDates) {
                const retryHistory = buildLatestLocalHistoryForRetryDate(currentHistory, date);
                const hasWorkoutForDate = hasValidWorkoutOnDate(retryHistory, date);
                const previousFailure = syncFailuresByDateRef.current[date] || {};
                const isDeleteRetry = String(previousFailure.stage || "").startsWith("delete_");
                try {
                    if (hasWorkoutForDate) {
                        const remoteRows = await fetchRemoteWorkoutRowsForDates(user.id, [date]);
                        const remoteRow = remoteRows.find((row) => String(row?.date || "").slice(0, 10) === date);
                        const localMetrics = getHistoryMetricsForDate(retryHistory, date);
                        const remoteMetrics = remoteRow
                            ? getHistoryMetricsForDate(remoteRow.data || {}, date)
                            : getEmptyWorkoutMetrics();
                        const pendingChange = pendingWorkoutContentChangeDatesRef.current.get(date) || {};
                        const explicitEdit = isExplicitWorkoutEditChange(pendingChange);
                        const saveGuardDecision = getWorkoutSaveGuardDecision({
                            incomingMetrics: localMetrics,
                            remoteMetrics,
                            reason: pendingChange.reason,
                            explicitEdit,
                            explicitDelete: Boolean(pendingChange.explicitDelete),
                        });
                        const wouldDestructivelyOverwrite = saveGuardDecision.blocked;
                        const retryAllowed = !wouldDestructivelyOverwrite || Boolean(pendingChange.explicitDelete);

                        console.log("[sync retry] preflight", {
                            env: getRuntimeEnvironmentLabel(),
                            user_id: user.id,
                            unsyncedDate: date,
                            queueCreatedAt: previousFailure.createdAt || null,
                            queueUpdatedAt: previousFailure.updatedAt || null,
                            localExerciseCount: localMetrics.exerciseCount,
                            localSetCount: localMetrics.setCount,
                            remoteExerciseCount: remoteMetrics.exerciseCount,
                            remoteSetCount: remoteMetrics.setCount,
                            localVolume: localMetrics.volume,
                            remoteVolume: remoteMetrics.volume,
                            retryAllowed,
                            removedExerciseNames: saveGuardDecision.details.removedExerciseNames,
                            reason: pendingChange.reason || null,
                            explicitEdit,
                            explicitDelete: Boolean(pendingChange.explicitDelete),
                            blockedReason: retryAllowed ? null : saveGuardDecision.blockedReason,
                            allowedReason: retryAllowed ? saveGuardDecision.allowedReason : null,
                        });

                        if (!retryAllowed) {
                            throw new Error("[sync retry] blocked destructive overwrite");
                        }

                        const rowSyncResults = await syncWorkoutRowsForDates(
                            user.id,
                            retryHistory,
                            [date],
                            savedWorkoutDurationSecByDate
                        );
                        if (rowSyncResults.failedDates.includes(date)) {
                            const remoteAlreadyHasWorkout = await hasRemoteWorkoutForDate(user.id, date);
                            if (!remoteAlreadyHasWorkout) {
                                throw new Error(`workouts sync failed for ${date}`);
                            }
                        }
                        try {
                            await syncWorkoutSessionSnapshot(user.id, retryHistory, date);
                        } catch (sessionError) {
                            const remoteAlreadyHasWorkout = await hasRemoteWorkoutForDate(user.id, date);
                            console.error("[sync] workout session retry failed after workout row sync", {
                                date,
                                userId: user.id,
                                records: describeHistoryRecordsForDate(retryHistory, date),
                                error: sessionError,
                                message: sessionError?.message,
                                code: sessionError?.code,
                                details: sessionError?.details,
                                hint: sessionError?.hint,
                            });
                            if (!remoteAlreadyHasWorkout) throw sessionError;
                        }
                        currentHistory = applyPreferredHistoryDates(currentHistory, retryHistory, [date]);
                        latestHistoryRef.current = currentHistory;
                        setHistory(currentHistory);
                        const retryWorkoutsDataHistory = applyPreferredHistoryDates(
                            workoutsDataHistoryRef.current || {},
                            retryHistory,
                            [date]
                        );
                        applyWorkoutsDataHistorySnapshot(retryWorkoutsDataHistory, {
                            allowRegression: true,
                            source: "workouts.data",
                            reason: "manual sync retry",
                            requestId: "sync-retry",
                            workoutsHistory: retryHistory,
                        });
                        persistHistoryForUser(user.id, currentHistory);
                        const retryVerifiedAt = new Date().toISOString();
                        const savedDraft = withDraftMeta(buildWorkoutDraftForDateFromHistory(date, currentHistory), {
                            source: "save_verified",
                            remoteVerifiedAt: retryVerifiedAt,
                            hasUnsavedChanges: false,
                        });
                        if (savedDraft.hasSavedWorkout) saveDraftForDate(date, savedDraft);
                        explicitWorkoutEditDatesRef.current.delete(date);
                        pendingWorkoutContentChangeDatesRef.current.delete(date);
                    } else if (!isDeleteRetry) {
                        const remoteAlreadyHasWorkout = await hasRemoteWorkoutForDate(user.id, date);
                        if (!remoteAlreadyHasWorkout) {
                            console.error("[sync] retry skipped stale failure without local or remote workout", {
                                date,
                                userId: user.id,
                                previousFailure,
                            });
                        }
                    } else {
                        await deleteRemoteWorkoutArtifactsForDate(user.id, date, retryHistory);
                    }
                    pendingWorkoutSessionSyncDatesRef.current.delete(date);
                    clearSyncFailure(date);
                } catch (error) {
                    if (!syncFailuresByDateRef.current[date]) {
                        recordSyncFailure(
                            date,
                            error,
                            hasWorkoutForDate
                                ? "workout_sessions_retry"
                                : isDeleteRetry
                                    ? "delete_workout_artifacts_retry"
                                    : "stale_sync_failure_retry"
                        );
                    }
                    console.error("[sync] retry failed for workout date", {
                        date,
                        userId: user.id,
                        hasWorkoutForDate,
                        isDeleteRetry,
                        previousFailure,
                        records: describeHistoryRecordsForDate(retryHistory, date),
                        error,
                        message: error?.message,
                        code: error?.code,
                        details: error?.details,
                        hint: error?.hint,
                    });
                }
            }

            await refreshHistorySyncDiagnostic(user.id, currentHistory, {
                prefix: failedDates[0]?.slice(0, 7) || "",
            });
            setSessionSyncVersion((prev) => prev + 1);
            if (Object.keys(syncFailuresByDateRef.current).length === 0) {
                setSyncFailuresByDate({});
            }
        } finally {
            setSyncRetrying(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        applyWorkoutsDataHistorySnapshot,
        buildLatestLocalHistoryForRetryDate,
        clearSyncFailure,
        deleteRemoteWorkoutArtifactsForDate,
        fetchRemoteWorkoutRowsForDates,
        hasRemoteWorkoutForDate,
        history,
        pendingWorkoutSessionSyncDatesRef,
        recordSyncFailure,
        refreshHistorySyncDiagnostic,
        saveDraftForDate,
        savedWorkoutDurationSecByDate,
        syncFailuresByDateRef,
        syncRetrying,
        syncWorkoutRowsForDates,
        syncWorkoutSessionSnapshot,
        user?.id,
    ]);

    return { retryFailedSync };
}
