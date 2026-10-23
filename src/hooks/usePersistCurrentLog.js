import { useCallback } from "react";
import { logWriteTrace, wpCountExercises, wpCountSetsFromLogData } from "../utils/writeTrace";
import {
    buildDraftHistoryForDate,
    getDraftInputDebugSummary,
    getDraftMetricsForDate,
    getHistoryDebugDiffForDate,
    getHistoryDebugSummaryForDate,
    getHistoryMetricsForDate,
    getHomeWeeklySummaryDebug,
    getRuntimeEnvironmentLabel,
    getWorkoutDraftSignature,
    getWorkoutSaveGuardDecision,
    isExplicitWorkoutEditChange,
    logWorkoutPersistenceDecision,
    normalizeDraftDateKey,
    normalizeLogDraftState,
    serializeHistoryMap,
    shouldLogPerfDebug,
    withDraftDateMeta,
} from "../utils/appHelpers";
import { computeWorkoutDisplayElapsedSec, getWorkoutTimerPersistence } from "../utils/workoutTimer";

export function usePersistCurrentLog({
    logDate,
    logDateRef,
    exercises,
    logData,
    todayLabels,
    exerciseUnits,
    history,
    user,
    persistHistoryForUser,
    workoutStartedForDate,
    savedWorkoutDurationSecByDate,
    pendingWorkoutContentChangeDatesRef,
    latestLogDraftRef,
    pendingWorkoutNotificationRef,
    workoutTimerStateRef,
    latestHistoryRef,
    historyRevisionRef,
    lastAutosavedDraftSignatureRef,
    hasDraftContent,
    applyWorkoutsDataHistorySnapshot,
    saveDraftForDate,
    queueWorkoutSessionSync,
    getExUnit,
    getTodayKey,
    getDraftKey,
    pendingSavePayloadsRef,
    setHistory,
    bodyWeightKg = null,
}) {
    const persistCurrentLog = useCallback(() => {
        // Use logDateRef.current (always the latest) to avoid stale-closure contamination.
        // If logDate in this closure is stale (i.e. logDate changed but persistCurrentLog
        // wasn't yet recreated), we must NOT write under the old date.
        const normalizedLogDate = String(logDateRef?.current || logDate || "").slice(0, 10);
        const pendingChange = pendingWorkoutContentChangeDatesRef.current.get(normalizedLogDate);
        if (!pendingChange) return;

        logWriteTrace("persistCurrentLog", {
            date: normalizedLogDate,
            decision: "pass",
            reason: pendingChange.reason || null,
            flags: { explicitEdit: Boolean(pendingChange.explicitEdit), explicitDelete: Boolean(pendingChange.explicitDelete), source: pendingChange.reason },
            exerciseCount: null,
            setCount: null,
        });

        const latestDraftCandidate = latestLogDraftRef.current || null;
        const latestDraftDate = normalizeDraftDateKey(
            latestDraftCandidate?.date
            || latestDraftCandidate?.meta?.date
        );
        // If the latest draft ref belongs to a different date, it is a stale closure remnant.
        // Do not fall back to normalizedLogDate — that would silently cross-contaminate dates.
        if (latestDraftDate && latestDraftDate !== normalizedLogDate) {
            logWriteTrace("G6:stale-closure", {
                date: normalizedLogDate,
                decision: "block",
                reason: "latestDraftRef.date does not match normalizedLogDate",
                flags: { explicitEdit: Boolean(pendingChange.explicitEdit), explicitDelete: Boolean(pendingChange.explicitDelete), source: latestDraftCandidate?.meta?.source },
                exerciseCount: wpCountExercises(latestDraftCandidate?.sessionEx ?? latestDraftCandidate?.exercises),
                setCount: wpCountSetsFromLogData(latestDraftCandidate?.logData),
                extra: { latestDraftDate, normalizedLogDate },
            });
            console.warn("[persistCurrentLog] blocked stale-closure persist", {
                action: "stale_closure_write_blocked",
                latestDraftDate,
                normalizedLogDate,
                source: latestDraftCandidate?.meta?.source || null,
            });
            return;
        }
        logWriteTrace("G6:stale-closure", {
            date: normalizedLogDate,
            decision: "pass",
            reason: null,
            flags: { explicitEdit: Boolean(pendingChange.explicitEdit), explicitDelete: Boolean(pendingChange.explicitDelete), source: latestDraftCandidate?.meta?.source },
            exerciseCount: wpCountExercises(latestDraftCandidate?.sessionEx ?? latestDraftCandidate?.exercises),
            setCount: wpCountSetsFromLogData(latestDraftCandidate?.logData),
            extra: { latestDraftDate, normalizedLogDate },
        });
        // latestLogDraftRef is updated synchronously in handleWorkoutLogDraftChange —
        // before setSessionEx — so it always reflects the current intent regardless of
        // explicitDelete. Use it whenever the date matches.
        const useLatestDraft = latestDraftDate === normalizedLogDate;

        // ■2/■3: Block writes where the latest draft originated from a remote restore
        // (source:"remote_supabase") and no explicit user action is pending.
        // Writing remote-origin data back to Supabase is at best a no-op and at worst
        // a destructive write-back of stale normalized-table data.
        if (
            useLatestDraft &&
            latestDraftCandidate?.meta?.source === "remote_supabase" &&
            !pendingChange.explicitEdit &&
            !pendingChange.explicitDelete
        ) {
            logWriteTrace("G6:remote-source-blocked", {
                date: normalizedLogDate,
                decision: "block",
                reason: "latestDraftCandidate.source is remote_supabase with no explicit user action",
                flags: { explicitEdit: false, explicitDelete: false, source: "remote_supabase" },
                exerciseCount: wpCountExercises(latestDraftCandidate?.sessionEx),
                setCount: wpCountSetsFromLogData(latestDraftCandidate?.logData),
            });
            console.warn("[persistCurrentLog] blocked remote_supabase write-back (no user action)", {
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                date: normalizedLogDate,
                reason: pendingChange.reason || null,
                exerciseCount: wpCountExercises(latestDraftCandidate?.sessionEx),
            });
            return;
        }

        // When useLatestDraft is true, treat latestDraftCandidate.sessionEx as the
        // single authoritative exercise list. Do NOT call normalizeLogDraftState here
        // because it internally calls mergeDraftExercisesWithLogData, which adds back
        // any exercise whose key still exists in logData — silently un-deleting exercises.
        // Instead, build the snapshot directly and filter logData to only the keys that
        // are present in sessionEx so the two sources stay consistent.
        let saveDraftSnapshot;
        if (useLatestDraft) {
            const authSessionEx = latestDraftCandidate.sessionEx || [];
            const authNameSet = new Set(
                authSessionEx.map((ex) => String(ex?.name || "").trim()).filter(Boolean)
            );
            const filteredLogData = Object.fromEntries(
                Object.entries(latestDraftCandidate.logData || {}).filter(([name]) =>
                    authNameSet.has(String(name || "").trim())
                )
            );
            saveDraftSnapshot = {
                todayLabels: latestDraftCandidate.todayLabels || todayLabels || [],
                sessionEx: authSessionEx,
                logData: filteredLogData,
                exerciseUnits: latestDraftCandidate.exerciseUnits || exerciseUnits || {},
                meta: latestDraftCandidate.meta,
            };
        } else {
            saveDraftSnapshot = normalizeLogDraftState({
                todayLabels,
                logData,
                sessionEx: exercises,
                exerciseUnits,
            });
        }
        const saveLabels = saveDraftSnapshot.todayLabels?.length
            ? saveDraftSnapshot.todayLabels
            : todayLabels;
        const saveLogData = saveDraftSnapshot.logData || {};
        const saveExercises = saveDraftSnapshot.sessionEx || [];
        const saveExerciseUnits = saveDraftSnapshot.exerciseUnits || {};
        const getSaveExUnit = (name) => saveExerciseUnits?.[name] || getExUnit(name);

        const timerPersistence =
            workoutStartedForDate === logDate
                ? getWorkoutTimerPersistence(workoutTimerStateRef.current, Date.now())
                : null;
        const timerDurationSec =
            workoutStartedForDate === logDate
                ? Math.max(
                    Math.floor(Number(timerPersistence?.durationSec) || 0),
                    computeWorkoutDisplayElapsedSec(workoutTimerStateRef.current)
                )
                : 0;
        const durationSec = Math.max(
            0,
            timerDurationSec,
            Math.floor(Number(savedWorkoutDurationSecByDate[normalizedLogDate]) || 0)
        );
        const incomingMetrics = getDraftMetricsForDate({
            exercises: saveExercises,
            logData: saveLogData,
            getExUnit: getSaveExUnit,
            workoutDate: normalizedLogDate,
            bodyWeightKg,
        });
        const existingMetrics = getHistoryMetricsForDate(latestHistoryRef.current || {}, normalizedLogDate);
        logWriteTrace("remoteSnapshot:update", {
            date: normalizedLogDate,
            decision: "pass",
            reason: "existingMetrics read from latestHistoryRef.current (local state, NOT Supabase)",
            extra: {
                remoteExerciseCount: existingMetrics.exerciseCount ?? null,
                remoteSetCount: existingMetrics.setCount ?? null,
                source: "latestHistoryRef.current",
            },
        });
        const explicitEdit = isExplicitWorkoutEditChange(pendingChange);
        const saveGuardDecision = getWorkoutSaveGuardDecision({
            incomingMetrics,
            remoteMetrics: existingMetrics,
            reason: pendingChange.reason,
            explicitEdit,
            explicitDelete: Boolean(pendingChange.explicitDelete),
        });
        const wouldDestructivelyOverwrite = saveGuardDecision.blocked;
        logWriteTrace("G1:local", {
            date: normalizedLogDate,
            decision: wouldDestructivelyOverwrite && !pendingChange.explicitDelete ? "block" : "pass",
            reason: wouldDestructivelyOverwrite && !pendingChange.explicitDelete
                ? saveGuardDecision.blockedReason || null
                : saveGuardDecision.allowedReason || null,
            flags: { explicitEdit, explicitDelete: Boolean(pendingChange.explicitDelete), source: pendingChange.reason },
            exerciseCount: incomingMetrics.exerciseCount ?? saveExercises.length,
            setCount: incomingMetrics.setCount ?? null,
            extra: {
                remoteExerciseCount: existingMetrics.exerciseCount,
                remoteSetCount: existingMetrics.setCount,
                removedExerciseNames: saveGuardDecision.details?.removedExerciseNames,
            },
        });

        logWorkoutPersistenceDecision({
            action: "local_auto_persist_check",
            userId: user?.id,
            date: logDate,
            localMetrics: incomingMetrics,
            remoteMetrics: existingMetrics,
            reason: wouldDestructivelyOverwrite
                ? `blocked: ${saveGuardDecision.blockedReason || `pending guarded save: ${pendingChange.reason}`}`
                : saveGuardDecision.allowedReason,
        });
        console[wouldDestructivelyOverwrite && !pendingChange.explicitDelete ? "warn" : "log"]("[workout-save-guard] explicit guard detail", {
            env: getRuntimeEnvironmentLabel(),
            action: "workout_save_guard",
            user_id: user?.id || null,
            date: normalizedLogDate,
            reason: pendingChange.reason || null,
            explicitEdit,
            explicitDelete: Boolean(pendingChange.explicitDelete),
            localExerciseNames: incomingMetrics.exerciseNames,
            remoteExerciseNames: existingMetrics.exerciseNames,
            removedExerciseNames: saveGuardDecision.details.removedExerciseNames,
            localSetCount: incomingMetrics.setCount,
            remoteSetCount: existingMetrics.setCount,
            localVolume: incomingMetrics.volume,
            remoteVolume: existingMetrics.volume,
            blockedReason: wouldDestructivelyOverwrite && !pendingChange.explicitDelete ? saveGuardDecision.blockedReason : null,
            allowedReason: wouldDestructivelyOverwrite && !pendingChange.explicitDelete ? null : saveGuardDecision.allowedReason,
            source: "local_auto_persist",
        });
        if (explicitEdit && !wouldDestructivelyOverwrite && saveGuardDecision.details.volumeReduced) {
            console.log("[workout-save-guard] explicit edit allowed despite metric difference", {
                env: getRuntimeEnvironmentLabel(),
                action: "workout_save_guard",
                user_id: user?.id || null,
                date: normalizedLogDate,
                reason: pendingChange.reason || null,
                explicitEdit,
                localVolume: incomingMetrics.volume,
                remoteVolume: existingMetrics.volume,
                localSetCount: incomingMetrics.setCount,
                remoteSetCount: existingMetrics.setCount,
                removedExerciseNames: saveGuardDecision.details.removedExerciseNames,
                allowedReason: saveGuardDecision.allowedReason,
                source: "local_auto_persist",
            });
        }
        if (shouldLogPerfDebug() && explicitEdit && normalizedLogDate !== getTodayKey()) {
            console.log("[workout edit] past workout edit debug", {
                action: "past_workout_edit_debug",
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                selectedDate: logDate,
                saveTargetDate: normalizedLogDate,
                exerciseName: pendingChange.details?.exerciseName || null,
                setIndex: pendingChange.details?.setIndex ?? null,
                field: pendingChange.details?.field || null,
                beforeValue: pendingChange.details?.beforeValue ?? null,
                afterValue: pendingChange.details?.afterValue ?? null,
                draftKey: getDraftKey("draft_logData", normalizedLogDate),
                draftHash: getWorkoutDraftSignature(saveDraftSnapshot),
                previousDraftHash: lastAutosavedDraftSignatureRef.current || null,
                saveReason: pendingChange.reason || null,
                explicitEdit,
                saveBlocked: Boolean(wouldDestructivelyOverwrite && !pendingChange.explicitDelete),
                blockReason: wouldDestructivelyOverwrite && !pendingChange.explicitDelete
                    ? saveGuardDecision.blockedReason || null
                    : null,
                repositorySaved: false,
                remoteVerified: false,
                restoredAfterSave: false,
                restoredSource: null,
                rolledBackAfterInput: false,
                usedLatestDraft: useLatestDraft,
            });
        }

        console[wouldDestructivelyOverwrite && !pendingChange.explicitDelete ? "warn" : "log"]("[set mutation]", {
            action: "workout_autosave",
            env: getRuntimeEnvironmentLabel(),
            date: normalizedLogDate,
            user_id: user?.id || null,
            exerciseName: pendingChange.details?.exerciseName || null,
            beforeSetCount: existingMetrics.setCount,
            afterSetCount: incomingMetrics.setCount,
            beforeSets: null,
            afterSets: getDraftInputDebugSummary({
                exercises: saveExercises,
                logData: saveLogData,
                labels: saveLabels,
            }).setsByExercise,
            dirty: true,
            source: "autosave",
            allowed: !(wouldDestructivelyOverwrite && !pendingChange.explicitDelete),
            blockedReason: wouldDestructivelyOverwrite && !pendingChange.explicitDelete
                ? saveGuardDecision.blockedReason || `pending guarded save: ${pendingChange.reason}`
                : null,
            overwrittenByRestore: false,
        });

        if (wouldDestructivelyOverwrite && !pendingChange.explicitDelete) {
            console.warn("[save guard] blocked destructive local draft apply", {
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                date: normalizedLogDate,
                reason: pendingChange.reason || "unknown",
                localMetrics: incomingMetrics,
                remoteMetrics: existingMetrics,
                explicitEdit,
                explicitDelete: Boolean(pendingChange.explicitDelete),
                removedExerciseNames: saveGuardDecision.details.removedExerciseNames,
                localSetCount: incomingMetrics.setCount,
                remoteSetCount: existingMetrics.setCount,
                localVolume: incomingMetrics.volume,
                remoteVolume: existingMetrics.volume,
                blockedReason: saveGuardDecision.blockedReason,
            });
            return;
        }

        const dirtyDraftForPersistence = withDraftDateMeta(normalizedLogDate, saveDraftSnapshot, {
            // Never propagate a system source (e.g. "remote_supabase") as the intent of
            // a user-triggered persist.  pendingChange.reason is always a user-action string
            // (set by markWorkoutContentChanged) or "local_auto_persist" as fallback.
            source: pendingChange.reason || "local_auto_persist",
            hasUnsavedChanges: true,
            updatedAt: pendingChange.updatedAt || saveDraftSnapshot.meta?.updatedAt || new Date().toISOString(),
            remoteVerifiedAt: saveDraftSnapshot.meta?.remoteVerifiedAt || null,
            // Stamp intent so saveWorkoutDraft's empty-overwrite guard lets explicit deletes through.
            // Without this, deleting all exercises produces an empty draft that is blocked by
            // "blocked empty-content overwrite of non-empty draft" since the guard doesn't know
            // the empty content is intentional.
            ...(pendingChange.explicitDelete ? { explicitDelete: true } : {}),
        });
        logWriteTrace("A-2:saveDraftForDate-call", {
            date: normalizedLogDate,
            decision: "executed",
            reason: null,
            flags: { explicitEdit: Boolean(dirtyDraftForPersistence?.meta?.explicitEdit), explicitDelete: Boolean(dirtyDraftForPersistence?.meta?.explicitDelete), source: dirtyDraftForPersistence?.meta?.source },
            exerciseCount: wpCountExercises(dirtyDraftForPersistence?.sessionEx ?? dirtyDraftForPersistence?.exercises),
            setCount: wpCountSetsFromLogData(dirtyDraftForPersistence?.logData),
        });
        // A-1 (useWorkoutLog 350ms debounce) already wrote the correct draft to
        // localStorage. Do not overwrite it here — A-2 fires 50ms later and would
        // clobber A-1's write with a potentially different snapshot.
        latestLogDraftRef.current = dirtyDraftForPersistence;
        // Store the fully-built history directly in pendingSavePayloadsRef.
        // setHistory(updater) is async — the updater (which sets latestHistoryRef.current)
        // only runs during React's render phase, which happens AFTER the Supabase reconcile
        // fetch in useHistoryAutoSave resolves. By writing here synchronously we guarantee
        // that syncWorkoutRowsForDates always sees the correct payload regardless of timing.
        //
        // Both pendingSavePayloadsRef and setHistory use buildDraftHistoryForDate with the same
        // args. The ONLY intentional difference is baseHistory:
        //   - pendingSavePayloadsRef: latestHistoryRef.current (synchronous ref, readable now)
        //   - setHistory:             prev (React updater arg, reflects batched state at render time)
        // All other args, including replaceDate, must stay identical. They are declared once here
        // so that a change to one cannot silently diverge from the other.
        const draftHistoryArgs = {
            workoutDate: normalizedLogDate,
            exercises: saveExercises,
            logData: saveLogData,
            getExUnit: getSaveExUnit,
            labels: saveLabels,
            durationSec,
            replaceDate: Boolean(pendingChange.explicitDelete),
        };
        if (pendingSavePayloadsRef) {
            // 日付全体の削除が保留中のとき stale payload の書き込みをスキップする。
            // deleteAllHistoryForDate は pendingSavePayloadsRef をクリアするが、
            // その直後に 400ms debounce が解消して削除前の内容を再書き込みする競合を防ぐ。
            // deleteScope === "partial" の部分削除（種目・セット単位）はスキップしない。
            if (pendingChange.explicitDelete && pendingChange.deleteScope === "date") {
                console.log("[WP] persistCurrentLog:payloadSkipped", {
                    date: normalizedLogDate,
                    reason: "explicit-delete-pending",
                });
            } else {
                // pendingSavePayloadsRef は Supabase の reconcile fetch より先に同期的に書く必要があるため
                // updater の外で latestHistoryRef.current を baseHistory に使う（L380-384 参照）。
                const directPayloadForDate = buildDraftHistoryForDate({
                    ...draftHistoryArgs,
                    baseHistory: latestHistoryRef.current || {},
                });
                pendingSavePayloadsRef.current.set(normalizedLogDate, directPayloadForDate);
            }
        }
        if (shouldLogPerfDebug() && explicitEdit && normalizedLogDate !== getTodayKey()) {
            console.log("[workout edit] past edit persistence debug", {
                action: "past_edit_persistence_debug",
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                selectedDate: normalizedLogDate,
                field: pendingChange.details?.field || null,
                beforeValue: pendingChange.details?.beforeValue ?? null,
                afterValue: pendingChange.details?.afterValue ?? null,
                localStateUpdated: true,
                draftSavedToLocalStorage: false, // A-1 path owns localStorage; A-2 no longer writes draft
                pendingSaveQueued: true,
                repositorySaveStarted: false,
                repositorySaveCompleted: false,
                remoteVerified: false,
                saveVerifiedDraftPersisted: false,
                appBackgroundFlushTriggered: false,
                initialLoadSourceAfterRestart: null,
                valueAfterRestart: null,
                lostAfterRestart: false,
            });
        }

        pendingWorkoutNotificationRef.current = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            userId: user?.id || null,
            logDate: normalizedLogDate,
        };
        queueWorkoutSessionSync(normalizedLogDate);

        logWriteTrace("setHistory:local", {
            date: normalizedLogDate,
            decision: "executed",
            reason: pendingChange.reason || null,
            flags: { explicitEdit, explicitDelete: Boolean(pendingChange.explicitDelete), source: pendingChange.reason },
            exerciseCount: saveExercises.length,
            setCount: wpCountSetsFromLogData(saveLogData),
        });
        setHistory((prev) => {
            // setHistory は React の updater 契約により prev を使う。
            // setHistory(() => next) にすると並行してバッチされた他の日付への更新が失われる。
            const nextHistory = buildDraftHistoryForDate({
                ...draftHistoryArgs,
                baseHistory: prev,
            });

            if (shouldLogPerfDebug()) {
                console.log("[save] local draft applied to history", {
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user?.id || null,
                    date: normalizedLogDate,
                    reason: pendingChange.reason,
                    explicitDelete: Boolean(pendingChange.explicitDelete),
                    draftInput: getDraftInputDebugSummary({
                        exercises: saveExercises,
                        logData: saveLogData,
                        labels: saveLabels,
                    }),
                    saving: getHistoryDebugSummaryForDate(nextHistory, normalizedLogDate),
                    previous: getHistoryDebugSummaryForDate(prev, normalizedLogDate),
                    diffPreviousToSaving: getHistoryDebugDiffForDate(prev, nextHistory, normalizedLogDate),
                    usedLatestDraft: useLatestDraft,
                });
            }

            if (serializeHistoryMap(nextHistory) === serializeHistoryMap(prev)) return prev;
            latestHistoryRef.current = nextHistory;
            historyRevisionRef.current += 1;
            applyWorkoutsDataHistorySnapshot(nextHistory, {
                allowRegression: true,
                source: "workouts.data",
                reason: "local draft flush to workouts.data canonical",
                requestId: "local-draft-flush",
                workoutsHistory: nextHistory,
            });
            persistHistoryForUser(user?.id, nextHistory, { source: "usePersistCurrentLog:saveLog" });
            if (shouldLogPerfDebug()) {
                console.log("[home weekly summary] apply", {
                    source: "workouts.data",
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user?.id || null,
                    requestId: "local-draft-flush",
                    applied: true,
                    reason: "local draft flush to workouts.data canonical",
                    ...getHomeWeeklySummaryDebug(nextHistory),
                });
            }
            return nextHistory;
        });
    // `history` is intentionally excluded from deps — it's read via `latestHistoryRef.current`
    // (kept in sync by App.jsx's useEffect). Including `history` would recreate `persistCurrentLog`
    // on every setHistory call, which re-fires the auto-save useEffect and causes a write loop.
    // `logDate` is intentionally excluded — we read it via `logDateRef.current` to prevent
    // stale-closure contamination where exercises from date A are saved under date B's key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [applyWorkoutsDataHistorySnapshot, bodyWeightKg, exerciseUnits, exercises, getDraftKey, getExUnit, getTodayKey, hasDraftContent, historyRevisionRef, logData, pendingSavePayloadsRef, queueWorkoutSessionSync, saveDraftForDate, savedWorkoutDurationSecByDate, todayLabels, user?.id, workoutStartedForDate, workoutTimerStateRef]);

    return { persistCurrentLog };
}
