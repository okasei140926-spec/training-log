import { useRef, useCallback } from "react";
import { supabase } from "../utils/supabase";
import { logWriteTrace, wpCountExercisesFromHistory, wpCountSetsFromHistory } from "../utils/writeTrace";
import { removePersistentDeletedDate, upsertPendingOp, buildDraftHistoryForDate } from "../utils/appHelpers";
import {
    fetchWorkoutRowForDate as fetchWorkoutRowForDateFromRepository,
    fetchWorkoutRowFromWorkoutsData,
    saveWorkoutForDate as saveWorkoutForDateInRepository,
} from "../features/workout/workoutRepository";
import { buildWorkoutSessionPayloadFromHistory } from "../utils/workoutSessions";

export function useHistorySave({
    // Refs declared in App.jsx (shared with other functions that stay in App.jsx)
    pendingWorkoutContentChangeDatesRef,
    explicitWorkoutEditDatesRef,
    // App component scope
    user,
    latestUserIdRef,
    applyTrustedWorkoutRowsSnapshot,
    setSyncFailuresByDate,
    getTodayKey,
    // module-level helpers from App.jsx passed as params
    getRuntimeEnvironmentLabel,
    EXPLICIT_SET_EDIT_REASONS,
    EXPLICIT_WORKOUT_EDIT_REASONS,
    isExplicitWorkoutEditChange,
    logRecordFetchError,
    logWorkoutPersistenceDecision,
    getWorkoutSaveGuardDecision,
    getHistoryMetricsForDate,
    getEmptyWorkoutMetrics,
    getWorkoutSummaryMetrics,
    getWorkoutPayloadMetrics,
    isMetricPersistenceMismatch,
    getHistoryDebugSummaryForDate,
    getHistoryDebugDiffForDate,
    applyPreferredHistoryDates,
    normalizeExerciseName,
    mergeHistoryMaps,
    hasValidWorkoutOnDate,
    findEditedSetInHistory,
    isEditedSetPersisted,
    getSetEditSummary,
    getSetEditUnit,
    buildHistoryFromWorkoutSessionRows,
    describeHistoryRecordsForDate,
    clearHistoryDeleteMarkerForDate = null,
    pendingSavePayloadsRef = null,
    onPersistentDeleteChanged = null,
    loadDraftForDate = null,
    hasDraftContent = null,
    historyRemoteReady = true,
    historyDisplayFromCache = false,
}) {
    // ─── Refs ─────────────────────────────────────────────────────────────────
    // pendingWorkoutContentChangeDatesRef and explicitWorkoutEditDatesRef are
    // declared in App.jsx and passed in as params (shared with non-extracted code)
    const historyRevisionRef = useRef(0);
    const historySaveQueueRef = useRef(Promise.resolve());
    const pendingWorkoutSessionSyncDatesRef = useRef(new Set());
    const syncFailuresByDateRef = useRef({});
    // Write-rate limiter: stop runaway saves to the same date within a short window.
    // Limit: 10 writes per date per 60 s.  Fires recordSyncFailure on breach so the
    // "保存できませんでした" banner surfaces rather than hammering Supabase silently.
    const writeRateRef = useRef({});
    const WRITE_RATE_LIMIT = 10;
    const WRITE_RATE_WINDOW_MS = 60_000;

    // ─── Callbacks ────────────────────────────────────────────────────────────

    const queueWorkoutSessionSync = useCallback((date) => {
        const normalizedDate = String(date || "").slice(0, 10);
        if (!normalizedDate) return;
        pendingWorkoutSessionSyncDatesRef.current.add(normalizedDate);
    }, []);

    const markWorkoutContentChanged = useCallback((date, reason = "content_change", options = {}, { recordToOutbox = true } = {}) => {
        const normalizedDate = String(date || "").slice(0, 10);
        if (!normalizedDate) return;

        // Defensive guard: a null/undefined reason means no traceable user action.
        // G8a would block the write every time, causing an infinite retry loop.
        // If the caller didn't pass an explicit reason and this isn't an explicit
        // user operation, warn and bail out — nothing should be written to Supabase.
        if (!reason && !options.explicitEdit && !options.explicitDelete) {
            console.warn("[markWorkoutContentChanged] blocked null-reason entry (no user action)", {
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || latestUserIdRef.current || null,
                date: normalizedDate,
                reason,
                options,
                note: "reason is falsy without explicit user action — this call is a no-op to prevent G8a infinite loop",
            });
            logWriteTrace("markWorkoutContentChanged", {
                date: normalizedDate,
                decision: "block",
                reason: "null reason without explicit user action — noop",
                extra: { saveReason: reason, explicitEdit: Boolean(options.explicitEdit), explicitDelete: Boolean(options.explicitDelete) },
            });
            return;
        }

        const previous = pendingWorkoutContentChangeDatesRef.current.get(normalizedDate) || {};
        const explicitEdit = Boolean(previous.explicitEdit || options.explicitEdit || EXPLICIT_WORKOUT_EDIT_REASONS.has(reason));
        // explicitDelete: only true for the mutation that explicitly sets it.
        // Per-mutation: not inherited from previous queue entry, so a subsequent
        // non-delete call for the same date does not carry a stale delete flag.
        const explicitDelete = options.explicitDelete === false
            ? false
            : Boolean(options.explicitDelete);
        // deleteScope: "date" = full date deletion, "partial" = single exercise/set removal.
        // explicitEdit が来た時点でペイロードは「新しいユーザー操作の内容」になる。
        // 以前の "date" を継承したまま skip 条件を発火させると、
        // その新しいペイロードが pendingSavePayloadsRef に書かれず
        // latestHistoryRef へのフォールバック race が再発する。
        // explicitEdit === true のときは previous.deleteScope をリセットする。
        const deleteScope =
            options.deleteScope ??
            (options.explicitEdit ? null : previous.deleteScope) ??
            null;
        const _qbMwcc = pendingWorkoutContentChangeDatesRef.current.size;
        // Clear stalled flag when a new user intent arrives: explicitEdit means the
        // user just edited the date; explicitDelete+scope=date means the user deleted it.
        // Either way the previous stall is no longer relevant — sync must re-attempt.
        const _clearStalled = explicitEdit || (explicitDelete && deleteScope === "date");
        pendingWorkoutContentChangeDatesRef.current.set(normalizedDate, {
            ...previous,
            reason,
            explicitDelete,
            explicitEdit,
            deleteScope,
            details: options.details || previous.details || null,
            // recordToOutbox:false = system re-queue (startup rescue / outbox replay), not a new
            // user action. Never advance updatedAt: the sync-success clear condition
            // (updatedAt <= saveStartedAt) must remain intact so Bug #5 doesn't occur.
            ...(recordToOutbox !== false ? { updatedAt: new Date().toISOString() } : {}),
            // Same reason: a system re-queue must not un-stall hold_limit / guard_skip entries.
            // Only the user's own explicit action should clear those stalls.
            ...(_clearStalled && recordToOutbox !== false ? { stalled: false, stalledAt: null } : {}),
        });
        // F-1: Outbox — persist operation so it survives app restarts.
        // recordToOutbox: false is passed by system-generated callers (startup rescue,
        // outbox replay) that must NOT overwrite the stored user-intent entry.
        const _userId = user?.id || latestUserIdRef.current || null;
        if (_userId && recordToOutbox !== false) {
            upsertPendingOp(_userId, normalizedDate, {
                reason,
                explicitDelete,
                explicitEdit,
                deleteScope: deleteScope || null,
                at: Date.now(),
                attempts: 0,
                stalled: false,
            });
        }
        logWriteTrace("markWorkoutContentChanged", {
            date: normalizedDate,
            decision: "executed",
            reason,
            extra: { explicitEdit, explicitDelete, saveReason: reason },
        });
        logWriteTrace("syncQueue:add", {
            date: normalizedDate,
            decision: "executed",
            reason: "markWorkoutContentChanged",
            extra: {
                queueSizeBefore: _qbMwcc,
                queueSizeAfter: pendingWorkoutContentChangeDatesRef.current.size,
                queueDatesAfter: [...pendingWorkoutContentChangeDatesRef.current.keys()],
                saveReason: reason,
                explicitEdit,
                explicitDelete,
            },
        });
        if (explicitEdit) {
            explicitWorkoutEditDatesRef.current.set(normalizedDate, {
                reason,
                updatedAt: Date.now(),
            });
        }
        // 削除後に再入力されたとき、persistentDeletedDates から即座に解除する。
        // _datesToStrip が history を strip し続けると G8 hold → retry limit → syncQueue:delete になる。
        // 条件: explicitEdit=true かつ NOT(explicitDelete=true && deleteScope="date")
        if (explicitEdit && !(explicitDelete === true && deleteScope === "date")) {
            const _userId = user?.id || latestUserIdRef.current || null;
            if (_userId) {
                removePersistentDeletedDate(_userId, normalizedDate);
                onPersistentDeleteChanged?.();
                console.log("[WP] persistentDelete:clearedByUserEdit", {
                    date: normalizedDate,
                    reason,
                    deleteScope,
                });
            }
        }
        if (EXPLICIT_SET_EDIT_REASONS.has(reason)) {
            console.log("[workout edit] explicit set edit", {
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || latestUserIdRef.current || null,
                date: normalizedDate,
                exerciseName: options.details?.exerciseName || null,
                setIndex: options.details?.setIndex ?? null,
                before: options.details?.beforeSet || null,
                after: options.details?.afterSet || null,
                saveReason: reason,
                explicitEdit: true,
            });
        }
        queueWorkoutSessionSync(normalizedDate);
    }, [queueWorkoutSessionSync, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const recordSyncFailure = useCallback((workoutDate, error, stage) => {
        const normalizedDate = String(workoutDate || "").slice(0, 10);
        if (!normalizedDate) return;
        const normalizedStage = String(stage || "").trim() || "unknown";

        console.error("[sync] workout date sync failure tracked", {
            workoutDate: normalizedDate,
            stage: normalizedStage,
            error,
            message: error?.message || String(error || "unknown error"),
            code: error?.code || null,
            details: error?.details || null,
            hint: error?.hint || null,
        });

        syncFailuresByDateRef.current = {
            ...syncFailuresByDateRef.current,
            [normalizedDate]: {
                stage: normalizedStage,
                message: error?.message || String(error || "unknown error"),
                code: error?.code || null,
                details: error?.details || null,
                hint: error?.hint || null,
                createdAt: syncFailuresByDateRef.current[normalizedDate]?.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        };
        setSyncFailuresByDate(syncFailuresByDateRef.current);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const clearSyncFailure = useCallback((workoutDate) => {
        const normalizedDate = String(workoutDate || "").slice(0, 10);
        if (!normalizedDate || !syncFailuresByDateRef.current[normalizedDate]) return;
        const nextFailures = { ...syncFailuresByDateRef.current };
        delete nextFailures[normalizedDate];
        syncFailuresByDateRef.current = nextFailures;
        setSyncFailuresByDate(nextFailures);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const syncWorkoutRowsForDates = useCallback(async (userId, historyMap, dates = []) => {
        const normalizedDates = [...new Set((dates || []).map((date) => String(date || "").slice(0, 10)).filter(Boolean))];
        const normalizedHistoryMap = mergeHistoryMaps(historyMap || {});
        const results = {
            syncedDates: [],
            failedDates: [],
            skippedDates: [],
            // heldDates: Supabase write skipped because local history is currently
            // empty for an explicit-edit date. This happens when persistCurrentLog
            // (400 ms debounce) hasn't fired yet and the in-progress set data hasn't
            // been flushed to latestHistoryRef.current. Unlike skippedDates, held
            // dates must NOT trigger a local-history overwrite — the local draft is
            // the source of truth here, not the remote.  The pending change is kept
            // so the next useHistoryAutoSave run (triggered by persistCurrentLog
            // updating history) can retry with the complete local data.
            heldDates: [],
            // g15HeldDates: dates held specifically by G15 (history not yet loaded).
            // Tracked separately from heldDates so useHistoryAutoSave can use a higher
            // retry limit (50) and stall with stalledReason:"network_failure" (un-stalled
            // by online_resume) instead of the 3-retry "hold_limit" (not un-stalled).
            g15HeldDates: [],
            verifiedHistoryByDate: {},
        };

        if (!userId || !normalizedDates.length) return results;

        await Promise.all(
            normalizedDates.map(async (workoutDate) => {
                try {
                    // Prefer the direct payload written synchronously by persistCurrentLog
                    // over the async-updated normalizedHistoryMap (which comes from
                    // latestHistoryRef.current and may not yet reflect the latest setHistory call).
                    const directPayloadMap = pendingSavePayloadsRef?.current?.get(workoutDate) ?? null;
                    // Use directPayloadMap directly — do NOT spread-merge with normalizedHistoryMap.
                    // directPayloadMap is already built from latestHistoryRef.current as its base,
                    // so it is the complete, authoritative picture for workoutDate.
                    // Merging via { ...normalizedHistoryMap, ...directPayloadMap } cannot delete
                    // top-level exercise keys: if an exercise was removed locally, the spread
                    // leaves it in place from normalizedHistoryMap, causing deleted exercises to
                    // reappear in the save payload (the "ghost exercise" bug).
                    let effectiveHistoryForDate;
                    let payloadSource;
                    if (directPayloadMap !== null) {
                        effectiveHistoryForDate = directPayloadMap;
                        payloadSource = "direct_payload";
                    } else {
                        // loadDraftForDate goes through normalizeDraftForLoad → resolveContentOrigin,
                        // so the returned draft always has meta.contentOrigin set to one of:
                        //   "user_edit"  — explicit user action (exercise_add, exercise_delete, …)
                        //   "local_draft" — local-only edit (explicitDelete_bypass, draft_restore, …)
                        //   "remote"     — written from Supabase data; one-way valve blocks re-write
                        //   "empty"      — emptyDraft placeholder (no real draft for this date)
                        // null/undefined can appear from test mocks that bypass normalizeDraftForLoad;
                        // treat as "local_draft" (safe direction — not explicitly remote).
                        const draftForDate = loadDraftForDate?.(workoutDate) ?? null;
                        const draftContentOrigin = draftForDate?.meta?.contentOrigin ?? null;

                        if (draftForDate !== null && draftContentOrigin === "remote") {
                            // Remote-origin draft: do NOT use as payload and do NOT fall back to history.
                            // Falling back would risk upsert-ing cache/history data over a user delete.
                            // Hold for retry — the next batch will have either a real local draft or
                            // historyRemoteReady=true so the correct action can be determined.
                            logWriteTrace("remote-draft-hold", {
                                date: workoutDate,
                                decision: "hold",
                                reason: "draft has contentOrigin=remote — cannot use as save payload",
                                flags: { explicitEdit: Boolean(pendingWorkoutContentChangeDatesRef.current.get(workoutDate)?.explicitEdit), explicitDelete: Boolean(pendingWorkoutContentChangeDatesRef.current.get(workoutDate)?.explicitDelete), source: pendingWorkoutContentChangeDatesRef.current.get(workoutDate)?.reason },
                                exerciseCount: null,
                                setCount: null,
                                extra: { draftContentOrigin, historyRemoteReady },
                            });
                            console.warn("[save guard] remote-draft-hold: draft is remote-origin, holding for retry", {
                                env: getRuntimeEnvironmentLabel(),
                                user_id: userId,
                                date: workoutDate,
                                draftContentOrigin,
                            });
                            results.heldDates.push(workoutDate);
                            return;
                        }

                        // "empty" contentOrigin = emptyDraft placeholder (no real draft).
                        // Use the draft only when it is user/local content.
                        // null/undefined = old localStorage or test mock without contentOrigin → adopt (safe).
                        const draftIsUsable = draftForDate !== null
                            && draftContentOrigin !== "empty";
                        if (draftIsUsable) {
                            effectiveHistoryForDate = buildDraftHistoryForDate({
                                baseHistory: {},
                                workoutDate,
                                exercises: draftForDate.sessionEx || [],
                                logData: draftForDate.logData || {},
                                getExUnit: (name) => draftForDate.exerciseUnits?.[name] || "kg",
                                labels: draftForDate.todayLabels || [],
                                durationSec: 0,
                                replaceDate: true,
                            });
                            payloadSource = "draft";
                        } else {
                            effectiveHistoryForDate = normalizedHistoryMap;
                            // Distinguish cache-backed history from remote-verified history.
                            // Both are held by G15 (history_cache is as untrustworthy as history
                            // when historyRemoteReady=false — it is a pre-delete snapshot).
                            payloadSource = historyDisplayFromCache ? "history_cache" : "history";
                        }
                    }
                    const hasWorkoutForDate = hasValidWorkoutOnDate(effectiveHistoryForDate, workoutDate);
                    const incomingMetrics = getHistoryMetricsForDate(effectiveHistoryForDate, workoutDate);
                    logWriteTrace("syncWorkoutRows", {
                        date: workoutDate,
                        decision: "pass",
                        reason: null,
                        flags: { explicitEdit: null, explicitDelete: null, source: "syncWorkoutRows:entry" },
                        exerciseCount: wpCountExercisesFromHistory(effectiveHistoryForDate, workoutDate),
                        setCount: wpCountSetsFromHistory(effectiveHistoryForDate, workoutDate),
                        extra: {
                            hasWorkoutForDate,
                            usingDirectPayload: directPayloadMap != null,
                            payloadSource,
                            replaceDate: Boolean(pendingWorkoutContentChangeDatesRef.current.get(workoutDate)?.explicitDelete),
                        },
                    });
                    const {
                        row: existingWorkoutRow,
                        error: existingWorkoutError,
                    } = await fetchWorkoutRowForDateFromRepository({
                        userId,
                        date: workoutDate,
                    });

                    if (existingWorkoutError) throw existingWorkoutError;

                    // Fetch directly from workouts.data for guard comparisons.
                    // fetchWorkoutRowForDate goes through normalized tables which may be
                    // stale (deletes in workouts.data are not propagated to workout_exercises),
                    // causing G2 to see deleted exercises as still present and block saves.
                    const { row: remoteWorkoutsDataRow } = await fetchWorkoutRowFromWorkoutsData({
                        userId,
                        date: workoutDate,
                    });

                    const remoteMetrics = remoteWorkoutsDataRow
                        ? getHistoryMetricsForDate(remoteWorkoutsDataRow.data || {}, workoutDate, {
                            updatedAt: null,
                        })
                        : getEmptyWorkoutMetrics();
                    const pendingChange = pendingWorkoutContentChangeDatesRef.current.get(workoutDate) || {};
                    const explicitEdit = isExplicitWorkoutEditChange(pendingChange);
                    if (!hasWorkoutForDate && !pendingChange.explicitDelete) {
                        if (explicitEdit) {
                            // Explicit edit (e.g. set_add, exercise_add) but the merged history
                            // for this date is still empty. This means persistCurrentLog hasn't
                            // flushed the in-progress draft to latestHistoryRef.current yet (the
                            // 400 ms debounce races the Supabase fetch). Hold the date for retry:
                            // the next useHistoryAutoSave run (triggered by persistCurrentLog
                            // completing) will see the correct data and save successfully.
                            // IMPORTANT: do NOT add to skippedDates — that would overwrite the
                            // local draft with empty remote data, destroying the user's input.
                            logWriteTrace("G8:empty-workout", {
                                date: workoutDate,
                                decision: "hold",
                                reason: "explicitEdit but history empty — draft not yet flushed",
                                flags: { explicitEdit: true, explicitDelete: false, source: pendingChange.reason },
                                exerciseCount: incomingMetrics.exerciseCount ?? 0,
                                setCount: incomingMetrics.setCount ?? 0,
                            });
                            console.warn("[save guard] hold empty workout for retry (explicit edit, draft not yet flushed)", {
                                env: getRuntimeEnvironmentLabel(),
                                user_id: userId,
                                date: workoutDate,
                                localMetrics: incomingMetrics,
                                remoteMetrics,
                                reason: pendingChange.reason || "in-progress draft not yet in latestHistoryRef",
                                explicitEdit,
                                explicitDelete: false,
                                safety: "keep pending change; next trigger will retry with flushed draft",
                            });
                            results.heldDates.push(workoutDate);
                            return;
                        }
                        // Non-explicit empty workout — no user edit intent, nothing to save.
                        // Clear any stale sync-failure banner for this date.
                        logWriteTrace("G8:empty-workout", {
                            date: workoutDate,
                            decision: "skip",
                            reason: "no local workout data and no explicit delete",
                            flags: { explicitEdit, explicitDelete: false, source: pendingChange.reason },
                            exerciseCount: incomingMetrics.exerciseCount ?? 0,
                            setCount: incomingMetrics.setCount ?? 0,
                        });
                        console.warn("[save guard] skip empty workout (no local data, no explicit delete)", {
                            env: getRuntimeEnvironmentLabel(),
                            user_id: userId,
                            date: workoutDate,
                            localMetrics: incomingMetrics,
                            remoteMetrics,
                            reason: pendingChange.reason || "missing local workout data",
                            explicitDelete: false,
                            explicitEdit,
                            safety: "avoid Supabase save error / sync-failure banner for empty local draft",
                        });
                        clearSyncFailure(workoutDate);
                        results.skippedDates.push(workoutDate);
                        return;
                    }
                    logWriteTrace("G8:empty-workout", {
                        date: workoutDate,
                        decision: "pass",
                        reason: null,
                        flags: { explicitEdit, explicitDelete: Boolean(pendingChange.explicitDelete), source: pendingChange.reason },
                        exerciseCount: incomingMetrics.exerciseCount ?? null,
                        setCount: incomingMetrics.setCount ?? null,
                    });

                    // ■3: Block writes whose pending change has no source.
                    // reason=null means a restore or refresh triggered the save path with
                    // no traceable user action. Allowing it risks overwriting correct
                    // remote data with a stale snapshot. Only block when !explicitEdit and
                    // !explicitDelete so legitimate user operations are never affected.
                    if (!pendingChange.reason && !explicitEdit && !Boolean(pendingChange.explicitDelete)) {
                        logWriteTrace("G8a:source-validation", {
                            date: workoutDate,
                            decision: "block",
                            reason: "pendingChange.reason is null — no user action behind this write",
                            flags: { explicitEdit, explicitDelete: false, source: null },
                            exerciseCount: incomingMetrics.exerciseCount ?? null,
                            setCount: incomingMetrics.setCount ?? null,
                        });
                        console.warn("[save guard] blocked write with null pending reason (no user action)", {
                            env: getRuntimeEnvironmentLabel(),
                            user_id: userId,
                            date: workoutDate,
                            incomingMetrics,
                            remoteMetrics,
                        });
                        results.skippedDates.push(workoutDate);
                        return;
                    }

                    // ■5: Skip startup writes when local and remote are identical.
                    // startup_unsynced_draft / startup_unsynced_local can fire even when
                    // the app has already successfully synced — avoid redundant round-trips.
                    const STARTUP_REASONS = new Set(["startup_unsynced_draft", "startup_unsynced_local"]);
                    if (STARTUP_REASONS.has(pendingChange.reason) && !explicitEdit && !Boolean(pendingChange.explicitDelete)) {
                        const incomingNames = new Set((incomingMetrics.exerciseNames || []).map((n) => String(n || "").trim()).filter(Boolean));
                        const remoteNames = new Set((remoteMetrics.exerciseNames || []).map((n) => String(n || "").trim()).filter(Boolean));
                        const namesMatch =
                            incomingNames.size === remoteNames.size &&
                            [...incomingNames].every((n) => remoteNames.has(n));
                        const metricsMatch =
                            namesMatch &&
                            incomingMetrics.exerciseCount === remoteMetrics.exerciseCount &&
                            incomingMetrics.setCount === remoteMetrics.setCount;
                        if (metricsMatch) {
                            logWriteTrace("G8b:startup-no-diff", {
                                date: workoutDate,
                                decision: "skip",
                                reason: `startup write skipped: local === remote (${pendingChange.reason})`,
                                flags: { explicitEdit, explicitDelete: false, source: pendingChange.reason },
                                exerciseCount: incomingMetrics.exerciseCount ?? null,
                                setCount: incomingMetrics.setCount ?? null,
                            });
                            console.log("[save guard] startup write skipped: local metrics match remote", {
                                env: getRuntimeEnvironmentLabel(),
                                user_id: userId,
                                date: workoutDate,
                                reason: pendingChange.reason,
                                exerciseCount: incomingMetrics.exerciseCount,
                                setCount: incomingMetrics.setCount,
                            });
                            clearSyncFailure(workoutDate);
                            results.skippedDates.push(workoutDate);
                            return;
                        }
                        logWriteTrace("G8b:startup-no-diff", {
                            date: workoutDate,
                            decision: "pass",
                            reason: `startup write allowed: local !== remote (${pendingChange.reason})`,
                            flags: { explicitEdit, explicitDelete: false, source: pendingChange.reason },
                            exerciseCount: incomingMetrics.exerciseCount ?? null,
                            setCount: incomingMetrics.setCount ?? null,
                            extra: {
                                incomingExerciseCount: incomingMetrics.exerciseCount,
                                remoteExerciseCount: remoteMetrics.exerciseCount,
                                incomingSetCount: incomingMetrics.setCount,
                                remoteSetCount: remoteMetrics.setCount,
                            },
                        });
                    }

                    // ■4: Resurrection guard — block writes that add exercises back when
                    // no explicit user action is present. All guards check for structural
                    // shrinkage (exercises lost); none check for exercise restoration.
                    // A non-explicit write that adds exercises not present in remote is
                    // always a stale-snapshot write-back, never a legitimate user action.
                    if (!explicitEdit && !Boolean(pendingChange.explicitDelete) && remoteMetrics.hasWorkout) {
                        const remoteNameSet = new Set((remoteMetrics.exerciseNames || []).map((n) => String(n || "").trim()).filter(Boolean));
                        const resurrectedNames = (incomingMetrics.exerciseNames || [])
                            .map((n) => String(n || "").trim())
                            .filter((n) => n && !remoteNameSet.has(n));
                        if (resurrectedNames.length > 0) {
                            logWriteTrace("G8c:resurrection-guard", {
                                date: workoutDate,
                                decision: "block",
                                reason: "non-explicit write would resurrect deleted exercises",
                                flags: { explicitEdit, explicitDelete: false, source: pendingChange.reason },
                                exerciseCount: incomingMetrics.exerciseCount ?? null,
                                setCount: incomingMetrics.setCount ?? null,
                                extra: { resurrectedNames, remoteExerciseNames: remoteMetrics.exerciseNames },
                            });
                            console.warn("[save guard] blocked resurrection of deleted exercises (no explicit edit)", {
                                env: getRuntimeEnvironmentLabel(),
                                user_id: userId,
                                date: workoutDate,
                                resurrectedNames,
                                reason: pendingChange.reason,
                                explicitEdit,
                                incomingExerciseNames: incomingMetrics.exerciseNames,
                                remoteExerciseNames: remoteMetrics.exerciseNames,
                            });
                            results.skippedDates.push(workoutDate);
                            return;
                        }
                    }

                    const saveGuardDecision = getWorkoutSaveGuardDecision({
                        incomingMetrics,
                        remoteMetrics,
                        reason: pendingChange.reason,
                        explicitEdit,
                        explicitDelete: Boolean(pendingChange.explicitDelete),
                    });
                    const wouldDestructivelyOverwrite = saveGuardDecision.blocked;
                    const allowDestructiveSave = Boolean(pendingChange.explicitDelete);
                    logWriteTrace("G1:supabase", {
                        date: workoutDate,
                        decision: wouldDestructivelyOverwrite && !allowDestructiveSave ? "block" : "pass",
                        reason: wouldDestructivelyOverwrite && !allowDestructiveSave
                            ? saveGuardDecision.blockedReason || null
                            : saveGuardDecision.allowedReason || null,
                        flags: { explicitEdit, explicitDelete: allowDestructiveSave, source: pendingChange.reason },
                        exerciseCount: incomingMetrics.exerciseCount ?? null,
                        setCount: incomingMetrics.setCount ?? null,
                        extra: {
                            remoteExerciseCount: remoteMetrics.exerciseCount,
                            remoteSetCount: remoteMetrics.setCount,
                            removedExerciseNames: saveGuardDecision.details?.removedExerciseNames,
                        },
                    });

                    logWorkoutPersistenceDecision({
                        action: "workouts_sync_check",
                        userId,
                        date: workoutDate,
                        localMetrics: incomingMetrics,
                        remoteMetrics,
                        reason: wouldDestructivelyOverwrite
                            ? `blocked: ${saveGuardDecision.blockedReason || "local workout is smaller than remote"}`
                            : saveGuardDecision.allowedReason,
                        level: wouldDestructivelyOverwrite && !allowDestructiveSave ? "warn" : "log",
                    });
                    console[wouldDestructivelyOverwrite && !allowDestructiveSave ? "warn" : "log"]("[workout-save-guard] explicit guard detail", {
                        env: getRuntimeEnvironmentLabel(),
                        action: "workout_save_guard",
                        user_id: userId,
                        date: workoutDate,
                        reason: pendingChange.reason || null,
                        explicitEdit,
                        explicitDelete: Boolean(pendingChange.explicitDelete),
                        localExerciseNames: incomingMetrics.exerciseNames,
                        remoteExerciseNames: remoteMetrics.exerciseNames,
                        removedExerciseNames: saveGuardDecision.details.removedExerciseNames,
                        localSetCount: incomingMetrics.setCount,
                        remoteSetCount: remoteMetrics.setCount,
                        localVolume: incomingMetrics.volume,
                        remoteVolume: remoteMetrics.volume,
                        blockedReason: wouldDestructivelyOverwrite && !allowDestructiveSave ? saveGuardDecision.blockedReason : null,
                        allowedReason: wouldDestructivelyOverwrite && !allowDestructiveSave ? null : saveGuardDecision.allowedReason,
                    });
                    if (explicitEdit && !wouldDestructivelyOverwrite && saveGuardDecision.details.volumeReduced) {
                        console.log("[workout-save-guard] explicit edit allowed despite metric difference", {
                            env: getRuntimeEnvironmentLabel(),
                            action: "workout_save_guard",
                            user_id: userId,
                            date: workoutDate,
                            reason: pendingChange.reason || null,
                            explicitEdit,
                            localVolume: incomingMetrics.volume,
                            remoteVolume: remoteMetrics.volume,
                            localSetCount: incomingMetrics.setCount,
                            remoteSetCount: remoteMetrics.setCount,
                            removedExerciseNames: saveGuardDecision.details.removedExerciseNames,
                            allowedReason: saveGuardDecision.allowedReason,
                        });
                    }
                    const dateScopedHistoryForSave = applyPreferredHistoryDates({}, effectiveHistoryForDate, [workoutDate]);

                    console.log("[save] workouts.data before save", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: userId,
                        date: workoutDate,
                        saving: getHistoryDebugSummaryForDate(dateScopedHistoryForSave, workoutDate),
                        remote: existingWorkoutRow
                            ? getHistoryDebugSummaryForDate(existingWorkoutRow.data || {}, workoutDate)
                            : getHistoryDebugSummaryForDate({}, workoutDate),
                        diffFromRemote: getHistoryDebugDiffForDate(existingWorkoutRow?.data || {}, dateScopedHistoryForSave, workoutDate),
                    });

                    if (wouldDestructivelyOverwrite && !allowDestructiveSave) {
                        logWriteTrace("G9:supabase-write-guard", {
                            date: workoutDate,
                            decision: "skip",
                            reason: saveGuardDecision.blockedReason || "G1 blocked and no allowDestructiveSave",
                            flags: { explicitEdit, explicitDelete: allowDestructiveSave, source: pendingChange.reason },
                            exerciseCount: incomingMetrics.exerciseCount ?? null,
                            setCount: incomingMetrics.setCount ?? null,
                        });
                        console.warn("[save guard] local workout is smaller than remote. Skip overwrite.", {
                            env: getRuntimeEnvironmentLabel(),
                            user_id: userId,
                            date: workoutDate,
                            supabase: remoteMetrics,
                            localStorage: incomingMetrics,
                            savingExerciseNames: incomingMetrics.exerciseNames,
                            reason: pendingChange.reason || "unknown",
                            explicitEdit,
                            explicitDelete: Boolean(pendingChange.explicitDelete),
                            removedExerciseNames: saveGuardDecision.details.removedExerciseNames,
                            localSetCount: incomingMetrics.setCount,
                            remoteSetCount: remoteMetrics.setCount,
                            localVolume: incomingMetrics.volume,
                            remoteVolume: remoteMetrics.volume,
                            blockedReason: saveGuardDecision.blockedReason,
                        });
                        console.warn("[save] workout_save_integrity_check", {
                            env: getRuntimeEnvironmentLabel(),
                            action: "workout_save_integrity_check",
                            date: workoutDate,
                            user_id: userId,
                            beforeSaveExerciseNames: incomingMetrics.exerciseNames,
                            afterSaveExerciseNames: getHistoryMetricsForDate(dateScopedHistoryForSave, workoutDate).exerciseNames,
                            remoteVerifiedExerciseNames: remoteMetrics.exerciseNames,
                            lostExerciseNames: saveGuardDecision.details.removedExerciseNames,
                            sourceUsedForSave: "workouts.data_guard_blocked",
                            blockedRegression: true,
                            blockedReason: saveGuardDecision.blockedReason,
                            explicitEdit,
                            explicitDelete: Boolean(pendingChange.explicitDelete),
                        });
                        results.skippedDates.push(workoutDate);
                        return;
                    }
                    logWriteTrace("G9:supabase-write-guard", {
                        date: workoutDate,
                        decision: "pass",
                        reason: saveGuardDecision.allowedReason || null,
                        flags: { explicitEdit, explicitDelete: allowDestructiveSave, source: pendingChange.reason },
                        exerciseCount: incomingMetrics.exerciseCount ?? null,
                        setCount: incomingMetrics.setCount ?? null,
                    });
                    if (EXPLICIT_SET_EDIT_REASONS.has(pendingChange.reason)) {
                        console.log("[workout edit] workouts.data save decision", {
                            env: getRuntimeEnvironmentLabel(),
                            user_id: userId,
                            date: workoutDate,
                            exerciseName: pendingChange.details?.exerciseName || null,
                            setIndex: pendingChange.details?.setIndex ?? null,
                            before: pendingChange.details?.beforeSet || null,
                            after: pendingChange.details?.afterSet || null,
                            saveReason: pendingChange.reason,
                            explicitEdit: Boolean(pendingChange.explicitEdit),
                            allowed: true,
                            blockedReason: null,
                            workoutsDataUpdated: false,
                            summaryJsonUpdated: false,
                        });
                    }

                    // Write-rate guard: abort if this date has been written too many
                    // times in the last 60 s.  Prevents runaway loops from hammering
                    // Supabase indefinitely and surfaces a banner to the user.
                    const nowMs = Date.now();
                    const rateEntry = writeRateRef.current[workoutDate] || { count: 0, windowStart: nowMs };
                    if (nowMs - rateEntry.windowStart > WRITE_RATE_WINDOW_MS) {
                        rateEntry.count = 0;
                        rateEntry.windowStart = nowMs;
                    }
                    rateEntry.count += 1;
                    writeRateRef.current[workoutDate] = rateEntry;
                    if (rateEntry.count > WRITE_RATE_LIMIT) {
                        const rateError = new Error(`write rate limit exceeded: ${rateEntry.count} writes in 60s for ${workoutDate}`);
                        logWriteTrace("G10:write-rate-limiter", {
                            date: workoutDate,
                            decision: "block",
                            reason: `rate limit exceeded: ${rateEntry.count} writes in 60s`,
                            flags: { explicitEdit, explicitDelete: allowDestructiveSave, source: pendingChange.reason },
                            exerciseCount: incomingMetrics.exerciseCount ?? null,
                            setCount: incomingMetrics.setCount ?? null,
                            extra: { count: rateEntry.count, limit: WRITE_RATE_LIMIT, windowMs: WRITE_RATE_WINDOW_MS },
                        });
                        console.error("[save] write rate limit exceeded — stopping saves for this date", {
                            env: getRuntimeEnvironmentLabel(),
                            user_id: userId,
                            date: workoutDate,
                            count: rateEntry.count,
                            windowMs: WRITE_RATE_WINDOW_MS,
                        });
                        recordSyncFailure(workoutDate, rateError, "rate_limit");
                        results.failedDates.push(workoutDate);
                        return;
                    }
                    logWriteTrace("G10:write-rate-limiter", {
                        date: workoutDate,
                        decision: "pass",
                        reason: `rate: ${rateEntry.count}/${WRITE_RATE_LIMIT} in window`,
                        flags: { explicitEdit, explicitDelete: allowDestructiveSave, source: pendingChange.reason },
                        exerciseCount: incomingMetrics.exerciseCount ?? null,
                        setCount: incomingMetrics.setCount ?? null,
                        extra: { count: rateEntry.count, limit: WRITE_RATE_LIMIT, windowMs: WRITE_RATE_WINDOW_MS },
                    });

                    // G15: explicitDelete + history/history_cache payload — hold if remote history hasn't loaded.
                    // Prevents outbox replay from deleting Supabase data before history is available.
                    // "history_cache" is treated the same as "history": it is a pre-delete snapshot that
                    // must not be upserted when the true current state is unknown (remote not yet fetched).
                    // Defensive: if historyRemoteReady is not a boolean (wiring bug), fail-open and skip
                    // this guard — G15 must not silently block saves when misconfigured.
                    const g15HistorySource = payloadSource === "history" || payloadSource === "history_cache";
                    if (typeof historyRemoteReady !== "boolean") {
                        console.error("[save guard] G15: historyRemoteReady is not boolean — fail-open, guard skipped", {
                            env: getRuntimeEnvironmentLabel(),
                            user_id: userId,
                            date: workoutDate,
                            historyRemoteReady,
                            payloadSource,
                        });
                        logWriteTrace("G15:history-not-loaded-guard", {
                            date: workoutDate,
                            decision: "pass",
                            reason: "historyRemoteReady_not_wired — fail-open",
                            flags: { explicitEdit, explicitDelete: Boolean(pendingChange.explicitDelete), source: pendingChange.reason },
                            exerciseCount: incomingMetrics.exerciseCount ?? 0,
                            setCount: incomingMetrics.setCount ?? 0,
                            extra: { payloadSource, historyRemoteReady },
                        });
                    } else if (!hasWorkoutForDate && Boolean(pendingChange.explicitDelete) && g15HistorySource && !historyRemoteReady) {
                        logWriteTrace("G15:history-not-loaded-guard", {
                            date: workoutDate,
                            decision: "hold",
                            reason: "explicitDelete + history payload — remote history not yet loaded, holding for retry",
                            flags: { explicitEdit, explicitDelete: true, source: pendingChange.reason },
                            exerciseCount: incomingMetrics.exerciseCount ?? 0,
                            setCount: incomingMetrics.setCount ?? 0,
                            extra: { payloadSource, historyRemoteReady },
                        });
                        console.warn("[save guard] G15: holding explicitDelete + history payload — history not loaded yet", {
                            env: getRuntimeEnvironmentLabel(),
                            user_id: userId,
                            date: workoutDate,
                            payloadSource,
                            historyRemoteReady,
                            reason: pendingChange.reason,
                        });
                        results.g15HeldDates.push(workoutDate);
                        return;
                    }

                    const repositorySaveResult = await saveWorkoutForDateInRepository({
                        userId,
                        date: workoutDate,
                        history: dateScopedHistoryForSave,
                        // Use workouts.data directly — normalized tables may be stale for
                        // deleted exercises, causing G2 to block legitimate delete saves.
                        remoteHistory: remoteWorkoutsDataRow?.data || existingWorkoutRow?.data || {},
                        reason: pendingChange.reason,
                        explicitEdit,
                        explicitDelete: Boolean(pendingChange.explicitDelete),
                        deleteScope: pendingChange.deleteScope ?? null,
                        source: "syncWorkoutRowsForDates",
                        logger: console,
                    });

                    if (repositorySaveResult.blocked || repositorySaveResult.skipped) {
                        results.skippedDates.push(workoutDate);
                        return;
                    }

                    if (repositorySaveResult.error || !repositorySaveResult.ok) {
                        logRecordFetchError("workouts_post_save_verify", "workouts", repositorySaveResult.error, {
                            userId,
                            workoutDate,
                            query: "workoutRepository.saveWorkoutForDate",
                            responseData: repositorySaveResult.verifiedRow,
                        });
                        throw repositorySaveResult.error || new Error(`workouts.data verification failed for ${workoutDate}`);
                    }

                    const verifyWorkoutRow = repositorySaveResult.verifiedRow;

                    const verifiedMetrics = repositorySaveResult.verifiedMetrics || (
                        verifyWorkoutRow
                            ? getHistoryMetricsForDate(verifyWorkoutRow.data || {}, workoutDate, {
                                updatedAt: null,
                            })
                            : getEmptyWorkoutMetrics()
                    );
                    const verifiedNames = new Set(
                        (verifiedMetrics.exerciseNames || [])
                            .map((exerciseName) => normalizeExerciseName(exerciseName))
                            .filter(Boolean)
                    );
                    const lostExerciseNamesAfterVerify = (incomingMetrics.exerciseNames || []).filter((exerciseName) => {
                        const normalizedExerciseName = normalizeExerciseName(exerciseName);
                        return normalizedExerciseName && !verifiedNames.has(normalizedExerciseName);
                    });
                    console[lostExerciseNamesAfterVerify.length ? "error" : "log"]("[save] workout_save_integrity_check", {
                        env: getRuntimeEnvironmentLabel(),
                        action: "workout_save_integrity_check",
                        date: workoutDate,
                        user_id: userId,
                        beforeSaveExerciseNames: incomingMetrics.exerciseNames,
                        afterSaveExerciseNames: getHistoryMetricsForDate(dateScopedHistoryForSave, workoutDate).exerciseNames,
                        remoteVerifiedExerciseNames: verifiedMetrics.exerciseNames,
                        lostExerciseNames: lostExerciseNamesAfterVerify,
                        sourceUsedForSave: "workouts.data",
                        blockedRegression: lostExerciseNamesAfterVerify.length > 0,
                        blockedReason: lostExerciseNamesAfterVerify.length
                            ? "verified workouts.data lost exercises after save"
                            : null,
                        explicitEdit,
                        explicitDelete: Boolean(pendingChange.explicitDelete),
                    });
                    if (isMetricPersistenceMismatch(incomingMetrics, verifiedMetrics)) {
                        console.error("[save verify] workouts.data mismatch after save", {
                            env: getRuntimeEnvironmentLabel(),
                            user_id: userId,
                            date: workoutDate,
                            expected: incomingMetrics,
                            actual: verifiedMetrics,
                            savingExerciseNames: incomingMetrics.exerciseNames,
                        });
                        throw new Error(`workouts.data verification failed for ${workoutDate}`);
                    }
                    if (EXPLICIT_SET_EDIT_REASONS.has(pendingChange.reason)) {
                        const expectedSet = pendingChange.details?.afterSet || null;
                        const actualSet = findEditedSetInHistory(
                            verifyWorkoutRow?.data || {},
                            workoutDate,
                            pendingChange.details?.exerciseName,
                            pendingChange.details?.setIndex
                        );
                        const persisted = isEditedSetPersisted(expectedSet, actualSet);
                        if (!persisted) {
                            // Soft warning only — the overall metric check already passed.
                            // This mismatch can legitimately occur when the exercise list changed
                            // between the set-edit event and the final save (e.g. user deleted
                            // exercise A and added exercise B; the last recorded set-edit detail
                            // references A which no longer exists in Supabase). Throwing here
                            // would trigger recordSyncFailure and an infinite retry loop.
                            console.warn("[save verify] workouts.data explicit set edit mismatch after save", {
                                env: getRuntimeEnvironmentLabel(),
                                user_id: userId,
                                date: workoutDate,
                                exerciseName: pendingChange.details?.exerciseName || null,
                                setIndex: pendingChange.details?.setIndex ?? null,
                                saveReason: pendingChange.reason,
                                expected: getSetEditSummary(expectedSet),
                                actual: actualSet ? getSetEditSummary(actualSet, getSetEditUnit(expectedSet)) : null,
                                workoutsDataAfterSave: verifyWorkoutRow
                                    ? getHistoryDebugSummaryForDate(verifyWorkoutRow.data || {}, workoutDate)
                                    : getHistoryDebugSummaryForDate({}, workoutDate),
                            });
                        }
                    }
                    console.log("[save] workouts.data after save verified", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: userId,
                        date: workoutDate,
                        workoutsDataAfterSave: verifyWorkoutRow
                            ? getHistoryDebugSummaryForDate(verifyWorkoutRow.data || {}, workoutDate)
                            : getHistoryDebugSummaryForDate({}, workoutDate),
                        diffSavedVsVerified: getHistoryDebugDiffForDate(normalizedHistoryMap, verifyWorkoutRow?.data || {}, workoutDate),
                    });
                    results.verifiedHistoryByDate[workoutDate] = verifyWorkoutRow?.data
                        ? applyPreferredHistoryDates({}, verifyWorkoutRow.data, [workoutDate])
                        : {};
                    if (verifyWorkoutRow) {
                        applyTrustedWorkoutRowsSnapshot([verifyWorkoutRow], {
                            source: "workouts.data save verified",
                            skipPendingFilter: true,
                        });
                    }
                    if (EXPLICIT_SET_EDIT_REASONS.has(pendingChange.reason)) {
                        console.log("[workout edit] workouts.data after save", {
                            env: getRuntimeEnvironmentLabel(),
                            user_id: userId,
                            date: workoutDate,
                            exerciseName: pendingChange.details?.exerciseName || null,
                            setIndex: pendingChange.details?.setIndex ?? null,
                            saveReason: pendingChange.reason,
                            workoutsDataUpdated: true,
                            summaryJsonUpdated: false,
                            workoutsDataAfterSave: verifyWorkoutRow
                                ? getHistoryDebugSummaryForDate(verifyWorkoutRow.data || {}, workoutDate)
                                : getHistoryDebugSummaryForDate({}, workoutDate),
                        });
                    }

                    clearSyncFailure(workoutDate);
                    // Remove any delete marker ONLY when actual data was verified in Supabase.
                    // Guard: verified set count > 0.
                    // - Full date deletion: Supabase row is empty after delete → setCount = 0
                    //   → marker stays. The !_isExplicitDelete guard has been removed because
                    //   explicitDelete OR-merges and stays true even after the user re-enters
                    //   data on the same date, making the original guard permanently fail for
                    //   the "delete → re-input → save" path.
                    // - Re-input after delete: save writes real sets → setCount > 0 → cleared.
                    // - Partial delete: remaining exercises produce setCount > 0 → would call
                    //   removePersistentDeletedDate, which is a no-op (partial delete never
                    //   adds to the persistent delete list).
                    {
                        const _isExplicitDelete = Boolean(pendingChange.explicitDelete);
                        const _verifiedSetCount = verifiedMetrics?.setCount ?? 0;
                        const _shouldClearMarker = _verifiedSetCount > 0;
                        if (_shouldClearMarker) {
                            clearHistoryDeleteMarkerForDate?.(workoutDate);
                            // A real workout was saved for this date — it is no longer deleted.
                            // Remove from persistent deleted-dates list so startup reconcile
                            // treats it as a normal date again.
                            removePersistentDeletedDate(userId, workoutDate);
                            onPersistentDeleteChanged?.();
                            console.log("[WP] persistentDelete:cleared", {
                                date: workoutDate,
                                reason: "record-recreated",
                                explicitDelete: _isExplicitDelete,
                                verifiedSetCount: _verifiedSetCount,
                            });
                        } else {
                            console.log("[restore] delete marker kept", {
                                date: workoutDate,
                                reason: "empty-verified-row",
                                verifiedSetCount: _verifiedSetCount,
                                explicitDelete: _isExplicitDelete,
                            });
                        }
                    }
                    pendingSavePayloadsRef?.current?.delete(workoutDate);
                    results.syncedDates.push(workoutDate);
                } catch (error) {
                    recordSyncFailure(workoutDate, error, "workouts");
                    console.error("workout remote sync failed", {
                        error,
                        message: error?.message,
                        code: error?.code,
                        details: error?.details,
                        hint: error?.hint,
                        userId,
                        workoutDate,
                        records: describeHistoryRecordsForDate(normalizedHistoryMap, workoutDate),
                    });
                    results.failedDates.push(workoutDate);
                }
            })
        );

        return results;
    }, [applyTrustedWorkoutRowsSnapshot, clearSyncFailure, recordSyncFailure]); // eslint-disable-line react-hooks/exhaustive-deps

    const syncWorkoutSessionSnapshot = useCallback(async (userId, historyMap, workoutDate, timing = null) => {
        const normalizedDate = String(workoutDate || "").slice(0, 10);
        if (!userId || !normalizedDate) return;

        const payload = buildWorkoutSessionPayloadFromHistory(historyMap, normalizedDate);
        const { data: existingSession, error: existingSessionError } = await supabase
            .from("workout_sessions")
            .select("id, started_at, ended_at, duration_sec, total_volume, exercise_count, summary_json")
            .eq("user_id", userId)
            .eq("workout_date", normalizedDate)
            .maybeSingle();

        if (existingSessionError) throw existingSessionError;

        const incomingMetrics = getWorkoutPayloadMetrics(payload);
        const remoteMetrics = existingSession
            ? getWorkoutSummaryMetrics(existingSession.summary_json, {
                totalVolume: existingSession.total_volume,
                exerciseCount: existingSession.exercise_count,
                updatedAt: null,
            })
            : getEmptyWorkoutMetrics();
        const pendingChange = pendingWorkoutContentChangeDatesRef.current.get(normalizedDate) || {};
        const explicitEdit = isExplicitWorkoutEditChange(pendingChange);
        const saveGuardDecision = getWorkoutSaveGuardDecision({
            incomingMetrics,
            remoteMetrics,
            reason: pendingChange.reason,
            explicitEdit,
            explicitDelete: Boolean(pendingChange.explicitDelete),
        });
        const wouldDestructivelyOverwrite = saveGuardDecision.blocked;
        const allowDestructiveSave = Boolean(pendingChange.explicitDelete);

        logWorkoutPersistenceDecision({
            action: "workout_sessions_sync_check",
            userId,
            date: normalizedDate,
            localMetrics: incomingMetrics,
            remoteMetrics,
            reason: wouldDestructivelyOverwrite
                ? `blocked: ${saveGuardDecision.blockedReason || "local session is smaller than remote"}`
                : saveGuardDecision.allowedReason,
            level: wouldDestructivelyOverwrite && !allowDestructiveSave ? "warn" : "log",
        });
        console[wouldDestructivelyOverwrite && !allowDestructiveSave ? "warn" : "log"]("[workout-save-guard] explicit guard detail", {
            env: getRuntimeEnvironmentLabel(),
            action: "workout_save_guard",
            user_id: userId,
            date: normalizedDate,
            reason: pendingChange.reason || null,
            explicitEdit,
            explicitDelete: Boolean(pendingChange.explicitDelete),
            localExerciseNames: incomingMetrics.exerciseNames,
            remoteExerciseNames: remoteMetrics.exerciseNames,
            removedExerciseNames: saveGuardDecision.details.removedExerciseNames,
            localSetCount: incomingMetrics.setCount,
            remoteSetCount: remoteMetrics.setCount,
            localVolume: incomingMetrics.volume,
            remoteVolume: remoteMetrics.volume,
            blockedReason: wouldDestructivelyOverwrite && !allowDestructiveSave ? saveGuardDecision.blockedReason : null,
            allowedReason: wouldDestructivelyOverwrite && !allowDestructiveSave ? null : saveGuardDecision.allowedReason,
            table: "workout_sessions",
        });
        if (explicitEdit && !wouldDestructivelyOverwrite && saveGuardDecision.details.volumeReduced) {
            console.log("[workout-save-guard] explicit edit allowed despite metric difference", {
                env: getRuntimeEnvironmentLabel(),
                action: "workout_save_guard",
                user_id: userId,
                date: normalizedDate,
                reason: pendingChange.reason || null,
                explicitEdit,
                localVolume: incomingMetrics.volume,
                remoteVolume: remoteMetrics.volume,
                localSetCount: incomingMetrics.setCount,
                remoteSetCount: remoteMetrics.setCount,
                removedExerciseNames: saveGuardDecision.details.removedExerciseNames,
                allowedReason: saveGuardDecision.allowedReason,
                table: "workout_sessions",
            });
        }
        console.log("[save] workout_sessions.summary_json before save", {
            env: getRuntimeEnvironmentLabel(),
            user_id: userId,
            date: normalizedDate,
            savingExerciseNames: payload?.session?.summary_json?.items?.map((item) => item.exercise_name) || [],
            savingBodyPartNames: [...new Set((payload?.session?.summary_json?.items || []).map((item) => item.body_part).filter(Boolean))],
            savingSetCountByExercise: (payload?.session?.summary_json?.items || []).reduce((acc, item) => {
                acc[item.exercise_name] = item.set_count || 0;
                return acc;
            }, {}),
            savingMetrics: incomingMetrics,
            remoteMetrics,
        });

        if (wouldDestructivelyOverwrite && !allowDestructiveSave) {
            console.warn("[save guard] local workout is smaller than remote. Skip overwrite.", {
                env: getRuntimeEnvironmentLabel(),
                user_id: userId,
                date: normalizedDate,
                supabase: remoteMetrics,
                localStorage: incomingMetrics,
                savingExerciseNames: incomingMetrics.exerciseNames,
                reason: pendingChange.reason || "unknown",
                explicitEdit,
                explicitDelete: Boolean(pendingChange.explicitDelete),
                removedExerciseNames: saveGuardDecision.details.removedExerciseNames,
                localSetCount: incomingMetrics.setCount,
                remoteSetCount: remoteMetrics.setCount,
                localVolume: incomingMetrics.volume,
                remoteVolume: remoteMetrics.volume,
                blockedReason: saveGuardDecision.blockedReason,
            });
            return { skipped: true };
        }
        if (EXPLICIT_SET_EDIT_REASONS.has(pendingChange.reason)) {
            console.log("[workout edit] workout_sessions.summary_json save decision", {
                env: getRuntimeEnvironmentLabel(),
                user_id: userId,
                date: normalizedDate,
                exerciseName: pendingChange.details?.exerciseName || null,
                setIndex: pendingChange.details?.setIndex ?? null,
                before: pendingChange.details?.beforeSet || null,
                after: pendingChange.details?.afterSet || null,
                saveReason: pendingChange.reason,
                explicitEdit: Boolean(pendingChange.explicitEdit),
                allowed: true,
                blockedReason: null,
                workoutsDataUpdated: null,
                summaryJsonUpdated: false,
            });
        }

        if (!payload) {
            if (existingSession?.id) {
                const [deleteLikesResult, deleteCommentsResult] = await Promise.all([
                    supabase
                        .from("workout_session_likes")
                        .delete()
                        .eq("session_id", existingSession.id),
                    supabase
                        .from("workout_session_comments")
                        .delete()
                        .eq("session_id", existingSession.id),
                ]);
                if (deleteLikesResult.error) {
                    console.warn("[delete] workout_session_likes delete failed", deleteLikesResult.error);
                }
                if (deleteCommentsResult.error) {
                    console.warn("[delete] workout_session_comments delete failed", deleteCommentsResult.error);
                }

                const { error: deleteExercisesError } = await supabase
                    .from("workout_session_exercises")
                    .delete()
                    .eq("session_id", existingSession.id);
                if (deleteExercisesError) throw deleteExercisesError;

                const { error: deleteSessionError } = await supabase
                    .from("workout_sessions")
                    .delete()
                    .eq("id", existingSession.id);
                if (deleteSessionError) throw deleteSessionError;
            }
            return { deleted: true };
        }

        let latestPhotoId = null;
        try {
            const { data: latestPhotoRows } = await supabase
                .from("progress_photos")
                .select("id")
                .eq("user_id", userId)
                .eq("workout_date", normalizedDate)
                .order("created_at", { ascending: false })
                .limit(1);
            latestPhotoId = latestPhotoRows?.[0]?.id ?? null;
        } catch (error) {
            console.error("workout session latest photo fetch failed", error);
        }

        const shouldUpdateTiming = normalizedDate === getTodayKey() && timing;
        const startedAt = shouldUpdateTiming
            ? (timing.startedAtIso || existingSession?.started_at || new Date().toISOString())
            : (existingSession?.started_at || null);
        const endedAt = shouldUpdateTiming
            ? (timing.endedAtIso || existingSession?.ended_at || new Date().toISOString())
            : (existingSession?.ended_at || null);
        const existingDurationSec = Number.isFinite(Number(existingSession?.duration_sec)) && Number(existingSession?.duration_sec) > 0 && Number(existingSession?.duration_sec) < 86400
            ? Math.floor(Number(existingSession.duration_sec))
            : 0;
        const payloadDurationSec = Number.isFinite(Number(payload.session?.duration_sec)) && Number(payload.session.duration_sec) > 0 && Number(payload.session.duration_sec) < 86400
            ? Math.floor(Number(payload.session.duration_sec))
            : 0;
        const durationSec = shouldUpdateTiming && Number.isFinite(timing?.durationSec)
            ? Math.max(0, Math.floor(timing.durationSec))
            : (existingDurationSec || payloadDurationSec);

        const { data: upsertedSession, error: sessionUpsertError } = await supabase
            .from("workout_sessions")
            .upsert({
                user_id: userId,
                workout_date: normalizedDate,
                started_at: startedAt,
                ended_at: endedAt,
                duration_sec: durationSec,
                total_volume: payload.session.total_volume,
                exercise_count: payload.session.exercise_count,
                summary_json: payload.session.summary_json,
                photo_id: latestPhotoId,
                visibility: payload.session.visibility,
                photo_visibility: payload.session.photo_visibility,
            }, {
                onConflict: "user_id,workout_date",
            })
            .select("id")
            .single();

        if (sessionUpsertError) throw sessionUpsertError;

        const sessionId = upsertedSession?.id;
        if (!sessionId) throw new Error("workout session id is missing");

        const { error: deleteExercisesError } = await supabase
            .from("workout_session_exercises")
            .delete()
            .eq("session_id", sessionId);
        if (deleteExercisesError) throw deleteExercisesError;

        if (payload.exercises.length > 0) {
            const { error: insertExercisesError } = await supabase
                .from("workout_session_exercises")
                .insert(
                    payload.exercises.map((exercise) => ({
                        session_id: sessionId,
                        exercise_name: exercise.exercise_name,
                        body_part: exercise.body_part,
                        set_count: exercise.set_count,
                        max_weight: exercise.max_weight,
                        volume: exercise.volume,
                        best_set_json: exercise.best_set_json,
                    }))
                );

            if (insertExercisesError) throw insertExercisesError;
        }

        const { data: verifiedSession, error: verifySessionError } = await supabase
            .from("workout_sessions")
            .select("workout_date, duration_sec, total_volume, exercise_count, summary_json")
            .eq("user_id", userId)
            .eq("workout_date", normalizedDate)
            .maybeSingle();

        if (verifySessionError) {
            logRecordFetchError("workout_sessions_post_save_verify", "workout_sessions", verifySessionError, {
                userId,
                workoutDate: normalizedDate,
                query: "workout_sessions.select(workout_date,duration_sec,total_volume,exercise_count,summary_json).eq(user_id).eq(workout_date).maybeSingle",
                responseData: verifiedSession,
            });
            throw verifySessionError;
        }

        const verifiedMetrics = verifiedSession
            ? getWorkoutSummaryMetrics(verifiedSession.summary_json, {
                totalVolume: verifiedSession.total_volume,
                exerciseCount: verifiedSession.exercise_count,
                updatedAt: null,
            })
            : getEmptyWorkoutMetrics();
        if (isMetricPersistenceMismatch(incomingMetrics, verifiedMetrics)) {
            console.error("[save verify] workout_sessions.summary_json mismatch after save", {
                env: getRuntimeEnvironmentLabel(),
                user_id: userId,
                date: normalizedDate,
                expected: incomingMetrics,
                actual: verifiedMetrics,
                savingExerciseNames: incomingMetrics.exerciseNames,
            });
            throw new Error(`workout_sessions verification failed for ${normalizedDate}`);
        }
        // workout_sessions.summary_jsonはセット詳細を持たないため、セットレベルの検証はスキップ
        console.log("[save] workout_sessions.summary_json after save verified", {
            env: getRuntimeEnvironmentLabel(),
            user_id: userId,
            date: normalizedDate,
            summaryJsonAfterSaveExerciseNames: verifiedSession?.summary_json?.items?.map((item) => item.exercise_name) || [],
            summaryJsonAfterSaveBodyPartNames: [...new Set((verifiedSession?.summary_json?.items || []).map((item) => item.body_part).filter(Boolean))],
            summaryJsonAfterSaveSetCountByExercise: (verifiedSession?.summary_json?.items || []).reduce((acc, item) => {
                acc[item.exercise_name] = item.set_count || 0;
                return acc;
            }, {}),
            summaryJsonAfterSaveMetrics: verifiedMetrics,
            diffHistoryVsSummaryJson: getHistoryDebugDiffForDate(
                historyMap,
                buildHistoryFromWorkoutSessionRows(verifiedSession ? [verifiedSession] : []),
                normalizedDate
            ),
        });
        if (EXPLICIT_SET_EDIT_REASONS.has(pendingChange.reason)) {
            console.log("[workout edit] summary_json after save", {
                env: getRuntimeEnvironmentLabel(),
                user_id: userId,
                date: normalizedDate,
                exerciseName: pendingChange.details?.exerciseName || null,
                setIndex: pendingChange.details?.setIndex ?? null,
                saveReason: pendingChange.reason,
                workoutsDataUpdated: null,
                summaryJsonUpdated: true,
                summaryJsonAfterSave: verifiedSession?.summary_json || null,
            });
        }

        return { synced: true };
    }, [getTodayKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const cleanupWorkoutSessionsForHistory = useCallback(async (userId, historyMap) => {
        if (!userId) return;

        const activeDates = new Set(
            Object.values(historyMap || {})
                .flatMap((records) => (records || []).map((record) => String(record?.date || "").trim()))
                .filter(Boolean)
        );

        const { data: existingSessions, error } = await supabase
            .from("workout_sessions")
            .select("id, workout_date")
            .eq("user_id", userId);

        if (error) throw error;

        const staleSessionIds = (existingSessions || [])
            .filter((session) => !activeDates.has(String(session.workout_date || "").trim()))
            .map((session) => session.id)
            .filter(Boolean);

        if (!staleSessionIds.length) return;

        const { error: deleteError } = await supabase
            .from("workout_sessions")
            .delete()
            .in("id", staleSessionIds);

        if (deleteError) throw deleteError;
    }, []);

    return {
        // refs
        historyRevisionRef,
        historySaveQueueRef,
        pendingWorkoutSessionSyncDatesRef,
        syncFailuresByDateRef,
        // callbacks
        queueWorkoutSessionSync,
        markWorkoutContentChanged,
        recordSyncFailure,
        clearSyncFailure,
        syncWorkoutRowsForDates,
        syncWorkoutSessionSnapshot,
        cleanupWorkoutSessionsForHistory,
    };
}
