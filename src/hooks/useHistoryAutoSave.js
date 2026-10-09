import { useEffect, useRef } from "react";
import { supabase } from "../utils/supabase";
import { logWriteTrace } from "../utils/writeTrace";
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

// Stalled queue entries are skipped by auto-save but kept in the queue so a
// subsequent user edit can re-activate them.  Entries older than this TTL are
// purged automatically when the syncDates list is next built.
const STALLED_ENTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function useHistoryAutoSave({
    history,
    user,
    historySyncReady,
    persistHistoryForUser,
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
    clearDraftForDate,
    clearLastActiveExerciseForDate,
    setHistory,
    setSessionSyncVersion,
    forceSyncVersion,
    invalidateSupabaseFetchFreshByPrefix,
}) {
    const heldRetryCountsRef = useRef({});
    useEffect(() => {
        if (!user || !historySyncReady) return;
        const currentUserId = user.id;
        const pendingWorkoutNotification = pendingWorkoutNotificationRef.current;
        const pendingContentDates = Array.from(pendingWorkoutContentChangeDatesRef.current.keys());
        if (pendingContentDates.length > 0) {
            pendingContentDates.forEach((date) => {
                const pendingChange = pendingWorkoutContentChangeDatesRef.current.get(date) || {};
                logWriteTrace("useHistoryAutoSave", {
                    date,
                    decision: "pass",
                    reason: pendingChange.reason || null,
                    flags: { explicitEdit: Boolean(pendingChange.explicitEdit), explicitDelete: Boolean(pendingChange.explicitDelete), source: pendingChange.reason },
                    exerciseCount: null,
                    setCount: null,
                });
            });
        }
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
                // Re-read the queue at async execution time (not from the closure snapshot).
                // pendingContentDates was captured synchronously at effect-start; by the time
                // this async callback runs, the queue may have grown (user added another date
                // while the Supabase fetch was in flight) or may have shrunk (a prior queued
                // callback already processed some dates). Always using the live queue ensures
                // every queued date gets at least one chance to be batched.
                const livePendingDates = [...pendingWorkoutContentChangeDatesRef.current.keys()];
                const _now = Date.now();
                const syncDates = [...new Set(
                    livePendingDates.filter((d) => {
                        const entry = pendingWorkoutContentChangeDatesRef.current.get(d);
                        if (!entry?.stalled) return true;
                        // TTL: stalled entry survived long enough — purge it silently.
                        if (_now - (entry.stalledAt || 0) > STALLED_ENTRY_TTL_MS) {
                            pendingWorkoutContentChangeDatesRef.current.delete(d);
                            logWriteTrace("syncQueue:delete", {
                                date: d,
                                decision: "executed",
                                reason: "stalled entry TTL expired",
                                extra: { stalledAt: entry.stalledAt, ttlMs: STALLED_ENTRY_TTL_MS },
                            });
                        }
                        return false; // skip stalled entries (whether TTL hit or not)
                    })
                )];
                // Capture before queue entries are cleared on success (line below syncDates.forEach).
                const explicitDeleteSyncDates = new Set(
                    syncDates.filter((d) => Boolean(pendingWorkoutContentChangeDatesRef.current.get(d)?.explicitDelete))
                );
                logWriteTrace("syncBatch:build", {
                    date: null,
                    decision: "executed",
                    reason: null,
                    extra: {
                        queueDates: livePendingDates,
                        batchDates: syncDates,
                        excludedDates: pendingContentDates.filter((d) => !syncDates.includes(d)),
                        excludedReason: pendingContentDates.some((d) => !syncDates.includes(d))
                            ? "date was in closure snapshot but no longer in live queue (already processed by a prior batch run)"
                            : null,
                        closureDates: pendingContentDates,
                        newSinceClosureDates: syncDates.filter((d) => !pendingContentDates.includes(d)),
                    },
                });
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
                        const _qbFailed = pendingWorkoutContentChangeDatesRef.current.size;
                        pendingWorkoutContentChangeDatesRef.current.delete(date);
                        logWriteTrace("syncQueue:delete", {
                            date,
                            decision: "executed",
                            reason: "failedDates cleanup",
                            extra: {
                                queueSizeBefore: _qbFailed,
                                queueSizeAfter: pendingWorkoutContentChangeDatesRef.current.size,
                                queueDatesAfter: [...pendingWorkoutContentChangeDatesRef.current.keys()],
                            },
                        });
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
                            // Keep the entry in the queue as "stalled" instead of deleting it.
                            // Auto-save skips stalled entries; the next user edit for this date
                            // overwrites the entry with a fresh one (no stalled flag), re-activating
                            // normal sync.  The entry is purged after STALLED_ENTRY_TTL_MS.
                            const _existingEntry = pendingWorkoutContentChangeDatesRef.current.get(date) || {};
                            pendingWorkoutContentChangeDatesRef.current.set(date, {
                                ..._existingEntry,
                                stalled: true,
                                stalledAt: Date.now(),
                            });
                            logWriteTrace("syncQueue:stall", {
                                date,
                                decision: "executed",
                                reason: "heldDates retry limit exceeded — entry marked stalled",
                                extra: {
                                    queueSize: pendingWorkoutContentChangeDatesRef.current.size,
                                    queueDates: [...pendingWorkoutContentChangeDatesRef.current.keys()],
                                    holdCount: count,
                                },
                            });
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

                persistHistoryForUser(currentUserId, mergedHistory, { source: "useHistoryAutoSave:postUpsert" });
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
                const _appliedSaveSync = applyWorkoutsDataHistorySnapshot(nextWorkoutsDataHistory, {
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
                        applied: _appliedSaveSync,
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
                        // Permanent rejection: the save guard blocked this write. Retrying
                        // with identical data would produce the same result — remove from the
                        // sync queue to prevent an infinite retry loop. If the user makes a
                        // new edit, markWorkoutContentChanged will re-add the date with a
                        // valid reason. Apply the same saveStartedAt safety check as the
                        // success path so a newer in-flight edit is never discarded.
                        const pendingAfterSkip = pendingWorkoutContentChangeDatesRef.current.get(date);
                        if (!pendingAfterSkip?.updatedAt || getTimestampMs(pendingAfterSkip.updatedAt) <= getTimestampMs(saveStartedAt)) {
                            logWriteTrace("guard:permanent-skip", {
                                date,
                                decision: "cleared",
                                reason: "save guard permanently rejected write — removed from sync queue to prevent infinite retry",
                                flags: {
                                    explicitEdit: Boolean(pendingAfterSkip?.explicitEdit),
                                    explicitDelete: Boolean(pendingAfterSkip?.explicitDelete),
                                    source: pendingAfterSkip?.reason ?? null,
                                },
                                exerciseCount: null,
                                setCount: null,
                            });
                            const _qbPermSkip = pendingWorkoutContentChangeDatesRef.current.size;
                            pendingWorkoutContentChangeDatesRef.current.delete(date);
                            logWriteTrace("syncQueue:delete", {
                                date,
                                decision: "executed",
                                reason: "guard:permanent-skip",
                                extra: {
                                    queueSizeBefore: _qbPermSkip,
                                    queueSizeAfter: pendingWorkoutContentChangeDatesRef.current.size,
                                    queueDatesAfter: [...pendingWorkoutContentChangeDatesRef.current.keys()],
                                },
                            });
                        }
                        return;
                    }
                    if (workoutSyncResults.heldDates?.includes(date)) {
                        // Keep the pending change so the next trigger retries with the flushed draft.
                        return;
                    }
                    const pendingAfterSave = pendingWorkoutContentChangeDatesRef.current.get(date);
                    if (!pendingAfterSave?.updatedAt || getTimestampMs(pendingAfterSave.updatedAt) <= getTimestampMs(saveStartedAt)) {
                        const _qbSuccess = pendingWorkoutContentChangeDatesRef.current.size;
                        pendingWorkoutContentChangeDatesRef.current.delete(date);
                        logWriteTrace("syncQueue:delete", {
                            date,
                            decision: "executed",
                            reason: "sync success",
                            extra: {
                                queueSizeBefore: _qbSuccess,
                                queueSizeAfter: pendingWorkoutContentChangeDatesRef.current.size,
                                queueDatesAfter: [...pendingWorkoutContentChangeDatesRef.current.keys()],
                            },
                        });
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
                    if (!savedDraft.hasSavedWorkout) {
                        if (explicitDeleteSyncDates.has(date)) {
                            // Supabase delete verified — clear all local copies of this date.
                            clearDraftForDate(date);
                            clearLastActiveExerciseForDate?.(date);
                            const afterClearDraft = loadDraftForDate(date);
                            const hasRemainingDraftContent = Boolean(
                                afterClearDraft?.sessionEx ||
                                Object.keys(afterClearDraft?.logData || {}).length > 0
                            );
                            const clearedInMemory = !hasValidWorkoutOnDate(latestHistoryRef.current || {}, date);
                            logWriteTrace("deleteAllHistory:localCleanup", {
                                date,
                                decision: "executed",
                                reason: "explicit delete verified by Supabase",
                                clearedKeys: [
                                    `workoutDraft:${date}`,
                                    `draft_meta_${date}`,
                                    `draft_logData_${date}`,
                                    `draft_sessionEx_${date}`,
                                    `draft_exerciseUnits_${date}`,
                                    `draft_todayLabels_${date}`,
                                    "lastActiveLogExerciseByDate",
                                ],
                                clearedInMemory,
                                remainingKeys: hasRemainingDraftContent ? [`draft content still loaded after clearDraftForDate for ${date}`] : [],
                            });
                            // 削除が Supabase で verify されたタイミングで freshness を再無効化する。
                            // 削除処理中の最初の invalidate（deleteAllHistoryForDate）は
                            // Supabase fetch より前に走る場合があるため、verify 後にもう一度無効化して
                            // 次のリフレッシュが確実に fresh skip されない状態にする。
                            if (invalidateSupabaseFetchFreshByPrefix) {
                                const _screens = ["calendar", "log", "history"];
                                const _invalidatedKeys = [];
                                for (const _screen of _screens) {
                                    const _prefix = `display_history:${_screen}:${currentUserId}:`;
                                    const _keys = invalidateSupabaseFetchFreshByPrefix(_prefix);
                                    _invalidatedKeys.push(..._keys);
                                }
                                console.log("[WP] deleteAllHistory:displayFreshnessInvalidatedAfterSync", {
                                    date,
                                    invalidatedKeys: _invalidatedKeys,
                                });
                            }
                        }
                        return;
                    }
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

                    const _saveDraftForDateResult = saveDraftForDate(date, savedDraft);
                    if (date === logDate) {
                        applyLogDraftState(savedDraft);
                    }
                    latestHistoryRef.current = verifiedHistorySnapshot;
                    setHistory(verifiedHistorySnapshot);
                    persistHistoryForUser(currentUserId, verifiedHistorySnapshot, { source: "useHistoryAutoSave:verify" });
                    const verifiedWorkoutsDataHistory = applyLocalHistoryDates(
                        workoutsDataHistoryRef.current || {},
                        verifiedHistoryForDate,
                        [date]
                    );
                    const _appliedSaveVerified = applyWorkoutsDataHistorySnapshot(verifiedWorkoutsDataHistory, {
                        allowRegression: true,
                        source: "workouts.data",
                        reason: "remote save verified",
                        requestId: "save-verified",
                        workoutsHistory: verifiedHistoryForDate,
                    });
                    explicitWorkoutEditDatesRef.current.delete(date);
                    const _qbVerified = pendingWorkoutContentChangeDatesRef.current.size;
                    pendingWorkoutContentChangeDatesRef.current.delete(date);
                    logWriteTrace("syncQueue:delete", {
                        date,
                        decision: "executed",
                        reason: "save verified",
                        extra: {
                            queueSizeBefore: _qbVerified,
                            queueSizeAfter: pendingWorkoutContentChangeDatesRef.current.size,
                            queueDatesAfter: [...pendingWorkoutContentChangeDatesRef.current.keys()],
                        },
                    });
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
                        saveDraftForDateUpdated: _saveDraftForDateResult,
                        latestLogDraftRefUpdated: date === logDate,
                        logDataSessionExUpdated: date === logDate,
                        historyWorkoutsDataHistoryUpdated: _appliedSaveVerified,
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
        clearDraftForDate,
        clearLastActiveExerciseForDate,
        workoutTimerStateRef,
        forceSyncVersion,
    ]);
}
