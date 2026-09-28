import { useEffect, useRef } from "react";
import { supabase } from "../utils/supabase";
import { fetchWorkoutRows as fetchWorkoutRowsFromRepository } from "../features/workout/workoutRepository";
import { makeVerifiedWorkoutDraft as makeStoredVerifiedWorkoutDraft } from "../features/workout/workoutDraftStore";
import {
    getValidWorkoutDatesFromHistory,
    hasValidWorkoutOnDate,
    mergeHistoryMaps,
} from "../utils/helpers";
import { formatDateKey } from "../utils/helpers";
import {
    applyHistoryDeleteMarkers,
    applyPreferredHistoryDates,
    buildRemoteHistoryWithWorkoutRowsPriority,
    buildWorkoutDraftForDateFromHistory,
    describeHistoryRecordsForDate,
    getDateDaysAgoKey,
    getHistoryMetricsForDate,
    getHomeWeeklySummaryDebug,
    getRawDraftSetMetrics,
    getRuntimeEnvironmentLabel,
    logRecordFetchError,
    persistHistoryForUser,
    serializeHistoryMap,
    shouldLogPerfDebug,
    shouldPreserveRawDraftOverIncoming,
    getTimestampMs,
} from "../utils/appHelpers";
import {
    REMOTE_HISTORY_SESSION_LOOKBACK_DAYS,
    REMOTE_HISTORY_SESSION_LIMIT,
} from "./useHistorySync";
import { getWorkoutTimerPersistence } from "../utils/workoutTimer";

export function useHistoryAutoSave({
    history,
    user,
    historySyncReady,
    logDate,
    screen,
    clearSyncFailure,
    getCurrentHistoryDeleteMarkers,
    historyRevisionRef,
    historySaveQueueRef,
    latestUserIdRef,
    latestHistoryRef,
    latestLogDraftRef,
    pendingWorkoutContentChangeDatesRef,
    pendingWorkoutSessionSyncDatesRef,
    pendingWorkoutNotificationRef,
    explicitWorkoutEditDatesRef,
    workoutsDataHistoryRef,
    workoutTimerStateRef,
    historyRemoteLoadFailedRef,
    recordSyncFailure,
    refreshHistorySyncDiagnostic,
    hasRemoteWorkoutForDate,
    savedWorkoutDurationSecByDate,
    syncWorkoutSessionSnapshot,
    syncWorkoutRowsForDates,
    cleanupWorkoutSessionsForHistory,
    applyTrustedSessionRowsSnapshot,
    applyTrustedWorkoutRowsSnapshot,
    applyWorkoutsDataHistorySnapshot,
    workoutFinishedAt,
    workoutIsFinished,
    workoutLastActivityAt,
    workoutStartedAt,
    workoutStartedForDate,
    applyLocalHistoryDates,
    applyLogDraftState,
    loadDraftForDate,
    saveDraftForDate,
    setHistory,
    setSessionSyncVersion,
    forceSyncVersion,
}) {
    const heldRetryCountsRef = useRef({});
    useEffect(() => {
        if (!user || !historySyncReady) return;
        const currentUserId = user.id;
        const pendingWorkoutNotification = pendingWorkoutNotificationRef.current;
        const pendingContentDates = Array.from(pendingWorkoutContentChangeDatesRef.current.keys());
        if (historyRemoteLoadFailedRef.current) {
            console.warn("[save guard] skipped save because Supabase record load failed", {
                env: getRuntimeEnvironmentLabel(),
                user_id: currentUserId,
                dates: pendingContentDates,
                source: "localStorage / fallback after fetch error",
                allowed: false,
                blockedReason: "remote history load failed",
            });
            return;
        }
        if (!pendingContentDates.length) {
            if (pendingWorkoutSessionSyncDatesRef.current.size) {
                console.warn("[save guard] skipped pending session sync without user edit", {
                    env: getRuntimeEnvironmentLabel(),
                    user_id: currentUserId,
                    dates: Array.from(pendingWorkoutSessionSyncDatesRef.current),
                    source: "queue retry / timer restore / screen open",
                    allowed: false,
                    blockedReason: "no explicit workout content edit",
                });
                pendingWorkoutSessionSyncDatesRef.current = new Set();
            }
            return;
        }

        historySaveQueueRef.current = historySaveQueueRef.current
            .catch(() => { })
            .then(async () => {
                if (latestUserIdRef.current !== currentUserId) return;
                const saveStartedAt = new Date().toISOString();
                const saveRevision = historyRevisionRef.current;
                const baseLocalHistory = mergeHistoryMaps(latestHistoryRef.current);
                const effectiveDeleteMarkers = getCurrentHistoryDeleteMarkers();
                const localHistorySnapshot = applyHistoryDeleteMarkers(
                    baseLocalHistory,
                    effectiveDeleteMarkers
                );

                const sessionRangeStart = getDateDaysAgoKey(REMOTE_HISTORY_SESSION_LOOKBACK_DAYS);
                const [workoutsRes, sessionsRes] = await Promise.all([
                    fetchWorkoutRowsFromRepository({
                        userId: currentUserId,
                        fromDate: sessionRangeStart,
                        limit: REMOTE_HISTORY_SESSION_LIMIT,
                    }),
                    supabase
                        .from("workout_sessions")
                        .select("workout_date, duration_sec, summary_json")
                        .eq("user_id", currentUserId)
                        .gte("workout_date", sessionRangeStart)
                        .order("workout_date", { ascending: true })
                        .limit(REMOTE_HISTORY_SESSION_LIMIT),
                ]);

                if (workoutsRes.error) {
                    logRecordFetchError("history_save_reconcile", "workouts", workoutsRes.error, {
                        userId: currentUserId,
                        dateRange: { from: sessionRangeStart, limit: REMOTE_HISTORY_SESSION_LIMIT },
                        query: "workoutRepository.fetchWorkoutRows",
                        responseData: workoutsRes.rows,
                    });
                    throw workoutsRes.error;
                }
                if (sessionsRes.error) {
                    logRecordFetchError("history_save_reconcile", "workout_sessions", sessionsRes.error, {
                        userId: currentUserId,
                        dateRange: { from: sessionRangeStart, limit: REMOTE_HISTORY_SESSION_LIMIT },
                        query: "workout_sessions.select(workout_date,duration_sec,summary_json).eq(user_id).gte(workout_date).order(workout_date asc).limit",
                        responseData: sessionsRes.data,
                    });
                    console.warn("[save] workout_sessions reconcile failed; continuing with workouts.data as canonical", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: currentUserId,
                        code: sessionsRes.error?.code,
                        message: sessionsRes.error?.message,
                        details: sessionsRes.error?.details,
                        hint: sessionsRes.error?.hint,
                        responseData: sessionsRes.data,
                    });
                }
                if (latestUserIdRef.current !== currentUserId) return;

                const workoutRows = workoutsRes.rows || [];
                const remoteHistory = applyHistoryDeleteMarkers(
                    buildRemoteHistoryWithWorkoutRowsPriority(
                        workoutRows,
                        sessionsRes.error ? [] : (sessionsRes.data || [])
                    ),
                    effectiveDeleteMarkers
                );
                const syncDates = [...new Set(pendingContentDates)];
                // Re-read local history AFTER the async Supabase fetch.
                // The 400 ms auto-save debounce (persistCurrentLog) can fire while the
                // fetch is in progress and update latestHistoryRef.current.  Using a
                // stale pre-fetch snapshot here is the root cause of the
                // "[save guard] skip empty workout" false-positive: the user's just-
                // entered set data is already in latestHistoryRef.current but was not
                // captured in localHistorySnapshot (which was read before the fetch).
                const postFetchLocalHistory = applyHistoryDeleteMarkers(
                    mergeHistoryMaps(latestHistoryRef.current),
                    effectiveDeleteMarkers
                );
                let mergedHistory = applyHistoryDeleteMarkers(
                    applyLocalHistoryDates(remoteHistory, postFetchLocalHistory, syncDates),
                    effectiveDeleteMarkers
                );

                console.log("[save] Supabase reconcile before write", {
                    env: getRuntimeEnvironmentLabel(),
                    user_id: currentUserId,
                    dates: syncDates,
                    supabaseDates: getValidWorkoutDatesFromHistory(remoteHistory),
                    localStorageDates: getValidWorkoutDatesFromHistory(postFetchLocalHistory),
                    staleSnapshotDates: getValidWorkoutDatesFromHistory(localHistorySnapshot),
                    savingExerciseNames: syncDates.reduce((acc, date) => ({
                        ...acc,
                        [date]: getHistoryMetricsForDate(mergedHistory, date).exerciseNames,
                    }), {}),
                    reason: "pending content change only",
                });

                const workoutSyncResults = await syncWorkoutRowsForDates(currentUserId, mergedHistory, syncDates);
                if (workoutSyncResults.failedDates.length > 0) {
                    // Clear pending content changes for failed dates so auto-save doesn't
                    // retry them on every history change, causing an infinite loop.
                    workoutSyncResults.failedDates.forEach((date) => {
                        pendingWorkoutContentChangeDatesRef.current.delete(date);
                    });
                    throw new Error(`workouts sync failed for ${workoutSyncResults.failedDates.join(", ")}`);
                }
                if (workoutSyncResults.heldDates?.length > 0) {
                    workoutSyncResults.heldDates.forEach((date) => {
                        const count = (heldRetryCountsRef.current[date] || 0) + 1;
                        heldRetryCountsRef.current[date] = count;
                        if (count >= 3) {
                            // Draft never flushed to pendingSavePayloadsRef after 3 attempts.
                            // Surface as a save failure so the sync-failure banner appears.
                            console.error("[save] hold retry limit exceeded — surfacing as sync failure", {
                                env: getRuntimeEnvironmentLabel(),
                                user_id: currentUserId,
                                date,
                                count,
                            });
                            recordSyncFailure(date, new Error(`save stalled: draft not flushed after ${count} holds`), "hold_timeout");
                            pendingWorkoutContentChangeDatesRef.current.delete(date);
                            delete heldRetryCountsRef.current[date];
                        } else {
                            console.warn("[save] held date: pending change kept, local history preserved", {
                                env: getRuntimeEnvironmentLabel(),
                                user_id: currentUserId,
                                date,
                                holdCount: count,
                                note: "explicit-edit date had empty merged history — draft not yet flushed. Will retry on next persistCurrentLog trigger.",
                            });
                        }
                    });
                    // Reset counts for dates that resolved (no longer held)
                    Object.keys(heldRetryCountsRef.current).forEach((date) => {
                        if (!workoutSyncResults.heldDates.includes(date)) {
                            delete heldRetryCountsRef.current[date];
                        }
                    });
                }
                if (workoutSyncResults.skippedDates.length > 0) {
                    console.warn("[save] skipped dates: overwriting local history with remote data", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: currentUserId,
                        skippedDates: workoutSyncResults.skippedDates,
                        note: "save guard blocked Supabase write; local history for these dates is now replaced with remote data",
                        localMetricsByDate: workoutSyncResults.skippedDates.reduce((acc, date) => ({
                            ...acc,
                            [date]: getHistoryMetricsForDate(mergedHistory, date),
                        }), {}),
                        remoteMetricsByDate: workoutSyncResults.skippedDates.reduce((acc, date) => ({
                            ...acc,
                            [date]: getHistoryMetricsForDate(remoteHistory, date),
                        }), {}),
                    });
                    mergedHistory = applyHistoryDeleteMarkers(
                        applyLocalHistoryDates(mergedHistory, remoteHistory, workoutSyncResults.skippedDates),
                        effectiveDeleteMarkers
                    );
                }

                if (latestUserIdRef.current !== currentUserId) return;
                if (historyRevisionRef.current !== saveRevision) return;

                persistHistoryForUser(currentUserId, mergedHistory);
                setHistory((prev) => {
                    const reconciledHistory = applyHistoryDeleteMarkers(
                        applyLocalHistoryDates(prev, mergedHistory, syncDates),
                        effectiveDeleteMarkers
                    );
                    if (serializeHistoryMap(reconciledHistory) === serializeHistoryMap(prev)) return prev;
                    latestHistoryRef.current = reconciledHistory;
                    return reconciledHistory;
                });
                const nextWorkoutsDataHistory = applyHistoryDeleteMarkers(
                    applyLocalHistoryDates(
                        workoutsDataHistoryRef.current || latestHistoryRef.current || {},
                        mergedHistory,
                        syncDates
                    ),
                    effectiveDeleteMarkers
                );
                applyWorkoutsDataHistorySnapshot(nextWorkoutsDataHistory, {
                    allowRegression: true,
                    source: "workouts.data",
                    reason: "workouts.data save sync",
                    requestId: "save-sync",
                    workoutsHistory: mergedHistory,
                });
                if (shouldLogPerfDebug()) {
                    console.log("[home weekly summary] apply", {
                        source: "workouts.data",
                        env: getRuntimeEnvironmentLabel(),
                        user_id: currentUserId,
                        requestId: "save-sync",
                        applied: true,
                        reason: "workouts.data save sync",
                        ...getHomeWeeklySummaryDebug(nextWorkoutsDataHistory),
                    });
                }

                const sessionSyncDates = syncDates.filter(
                    (date) => !workoutSyncResults.skippedDates.includes(date)
                        && !workoutSyncResults.heldDates?.includes(date)
                );
                const failedSessionSyncDates = new Set();
                const skippedSessionSyncDates = new Set();

                if (sessionSyncDates.length > 0) {
                    await Promise.all(
                        sessionSyncDates.map(async (date) => {
                            try {
                                const hasValidWorkoutForDate = hasValidWorkoutOnDate(mergedHistory, date);
                                const shouldPersistWorkoutTiming =
                                    hasValidWorkoutForDate &&
                                    workoutStartedAt &&
                                    workoutStartedForDate === date;
                                const timing = shouldPersistWorkoutTiming
                                    ? getWorkoutTimerPersistence(workoutTimerStateRef.current, Date.now())
                                    : null;
                                const sessionResult = await syncWorkoutSessionSnapshot(currentUserId, mergedHistory, date, timing);
                                if (sessionResult?.skipped) {
                                    skippedSessionSyncDates.add(date);
                                    pendingWorkoutSessionSyncDatesRef.current.add(date);
                                    return;
                                }
                                clearSyncFailure(date);
                            } catch (error) {
                                console.error("workout session sync failed", {
                                    error,
                                    userId: currentUserId,
                                    date,
                                    records: describeHistoryRecordsForDate(mergedHistory, date),
                                });
                                recordSyncFailure(date, error, "workout_sessions");
                                failedSessionSyncDates.add(date);
                                pendingWorkoutSessionSyncDatesRef.current.add(date);
                            }
                        })
                    );
                }

                syncDates.forEach((date) => {
                    if (workoutSyncResults.skippedDates.includes(date)) {
                        return;
                    }
                    if (workoutSyncResults.heldDates?.includes(date)) {
                        // Keep the pending change so the next trigger retries with the flushed draft.
                        return;
                    }
                    const pendingAfterSave = pendingWorkoutContentChangeDatesRef.current.get(date);
                    if (!pendingAfterSave?.updatedAt || getTimestampMs(pendingAfterSave.updatedAt) <= getTimestampMs(saveStartedAt)) {
                        pendingWorkoutContentChangeDatesRef.current.delete(date);
                    }
                    if (!failedSessionSyncDates.has(date) && !skippedSessionSyncDates.has(date)) {
                        pendingWorkoutSessionSyncDatesRef.current.delete(date);
                    }
                });

                const savedDates = syncDates.filter((date) => (
                    !workoutSyncResults.skippedDates.includes(date)
                ));
                savedDates.forEach((date) => {
                    const sessionSynced = !failedSessionSyncDates.has(date) && !skippedSessionSyncDates.has(date);
                    const remoteVerifiedAt = new Date().toISOString();
                    const verifiedHistoryForDate = workoutSyncResults.verifiedHistoryByDate?.[date] || applyPreferredHistoryDates({}, mergedHistory, [date]);
                    const verifiedHistorySnapshot = applyLocalHistoryDates(mergedHistory, verifiedHistoryForDate, [date]);
                    const savedDraft = makeStoredVerifiedWorkoutDraft(
                        date,
                        buildWorkoutDraftForDateFromHistory(date, verifiedHistoryForDate),
                        { remoteVerifiedAt }
                    );
                    if (!savedDraft.hasSavedWorkout) return;
                    const localDraftForDate = date === logDate
                        ? latestLogDraftRef.current
                        : loadDraftForDate(date);
                    const pendingAfterSave = pendingWorkoutContentChangeDatesRef.current.get(date);
                    const hasNewerUnsavedEdit = Boolean(
                        pendingAfterSave?.updatedAt &&
                        getTimestampMs(pendingAfterSave.updatedAt) > getTimestampMs(saveStartedAt)
                    );
                    const {
                        preserve: preserveDirtyDraft,
                        localRawMetrics,
                        incomingRawMetrics: savedRawMetrics,
                        removedExerciseNames,
                    } = shouldPreserveRawDraftOverIncoming(localDraftForDate, savedDraft);

                    if (hasNewerUnsavedEdit) {
                        console.warn("[restore] preserve dirty draft after save verification", {
                            env: getRuntimeEnvironmentLabel(),
                            user_id: currentUserId,
                            date,
                            action: "workout_autosave",
                            source: "autosave",
                            dirty: true,
                            savedRawMetrics,
                            localRawMetrics,
                            removedExerciseNames,
                            overwrittenByRestore: false,
                            blockedReason: preserveDirtyDraft
                                ? "verified history would drop local draft sets"
                                : "newer unsaved edit happened after this save started",
                        });
                        saveDraftForDate(date, localDraftForDate);
                        return;
                    }

                    saveDraftForDate(date, savedDraft);
                    if (date === logDate) {
                        applyLogDraftState(savedDraft);
                    }
                    latestHistoryRef.current = verifiedHistorySnapshot;
                    setHistory(verifiedHistorySnapshot);
                    persistHistoryForUser(currentUserId, verifiedHistorySnapshot);
                    const verifiedWorkoutsDataHistory = applyLocalHistoryDates(
                        workoutsDataHistoryRef.current || {},
                        verifiedHistoryForDate,
                        [date]
                    );
                    applyWorkoutsDataHistorySnapshot(verifiedWorkoutsDataHistory, {
                        allowRegression: true,
                        source: "workouts.data",
                        reason: "remote save verified",
                        requestId: "save-verified",
                        workoutsHistory: verifiedHistoryForDate,
                    });
                    explicitWorkoutEditDatesRef.current.delete(date);
                    pendingWorkoutContentChangeDatesRef.current.delete(date);
                    if (sessionSynced) {
                        pendingWorkoutSessionSyncDatesRef.current.delete(date);
                        clearSyncFailure(date);
                    }
                    console.log("[save] draft refreshed from verified history", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: currentUserId,
                        date,
                        exerciseNames: savedDraft.sessionEx.map((exercise) => exercise.name),
                        logDataNames: Object.keys(savedDraft.logData || {}),
                        reason: "remote save verified",
                    });
                    console.log("[save] save_success_update_local_draft", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: currentUserId,
                        action: "save_success_update_local_draft",
                        date,
                        savedExerciseNames: savedDraft.sessionEx.map((exercise) => exercise.name),
                        savedSetCount: getRawDraftSetMetrics(savedDraft).setCount,
                        saveDraftForDateUpdated: true,
                        latestLogDraftRefUpdated: date === logDate,
                        logDataSessionExUpdated: date === logDate,
                        historyWorkoutsDataHistoryUpdated: true,
                        explicitWorkoutEditDatesRefCleared: !explicitWorkoutEditDatesRef.current.has(date),
                        pendingSyncCleared: !pendingWorkoutContentChangeDatesRef.current.has(date) && !pendingWorkoutSessionSyncDatesRef.current.has(date),
                        sessionSynced,
                        remoteVerifiedAt,
                        hasUnsavedChanges: false,
                    });
                });

                try {
                    await cleanupWorkoutSessionsForHistory(currentUserId, mergedHistory);
                    await refreshHistorySyncDiagnostic(currentUserId, mergedHistory, {
                        prefix: formatDateKey(new Date()).slice(0, 7),
                    });
                    setSessionSyncVersion((prev) => prev + 1);
                } catch (error) {
                    console.error("workout session cleanup failed", { error, userId: currentUserId });
                }

                const todayStr = formatDateKey(new Date());
                const shouldSendWorkoutNotification =
                    pendingWorkoutNotification &&
                    pendingWorkoutNotification.id === pendingWorkoutNotificationRef.current?.id &&
                    pendingWorkoutNotification.userId === currentUserId &&
                    pendingWorkoutNotification.logDate === logDate &&
                    logDate === todayStr &&
                    screen === "log";

                if (shouldSendWorkoutNotification) {
                    pendingWorkoutNotificationRef.current = null;

                    try {
                        const {
                            data: { session },
                        } = await supabase.auth.getSession();
                        const accessToken = session?.access_token;

                        if (accessToken) {
                            fetch("/api/push?action=notify-workout", {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                    Authorization: `Bearer ${accessToken}`,
                                },
                                body: JSON.stringify({ workoutDate: logDate }),
                            }).catch((error) => {
                                console.error("notify workout save request failed", error);
                            });
                        }
                    } catch (error) {
                        console.error("notify workout save setup failed", error);
                    }
                }
            })
            .catch((error) => {
                const failedPendingDates = Array.from(pendingWorkoutContentChangeDatesRef.current.keys());
                console.error("[save] history sync save failed", {
                    env: getRuntimeEnvironmentLabel(),
                    message: error?.message || String(error),
                    pendingDates: failedPendingDates,
                });
                // Surface the failure in the sync-failure banner so the user sees
                // "保存できませんでした" rather than a silent data loss.
                failedPendingDates.forEach((date) => {
                    recordSyncFailure(date, error, "history_sync");
                });
            });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        history,
        user,
        historySyncReady,
        logDate,
        screen,
        clearSyncFailure,
        getCurrentHistoryDeleteMarkers,
        historyRevisionRef,
        historySaveQueueRef,
        pendingWorkoutSessionSyncDatesRef,
        recordSyncFailure,
        refreshHistorySyncDiagnostic,
        hasRemoteWorkoutForDate,
        savedWorkoutDurationSecByDate,
        syncWorkoutSessionSnapshot,
        syncWorkoutRowsForDates,
        cleanupWorkoutSessionsForHistory,
        applyTrustedSessionRowsSnapshot,
        applyTrustedWorkoutRowsSnapshot,
        applyWorkoutsDataHistorySnapshot,
        historyRemoteLoadFailedRef,
        workoutFinishedAt,
        workoutIsFinished,
        workoutLastActivityAt,
        workoutStartedAt,
        workoutStartedForDate,
        applyLocalHistoryDates,
        applyLogDraftState,
        loadDraftForDate,
        saveDraftForDate,
        workoutTimerStateRef,
        forceSyncVersion,
    ]);
}
