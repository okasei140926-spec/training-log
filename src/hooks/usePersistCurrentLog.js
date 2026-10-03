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
    persistHistoryForUser,
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
        });
        const existingMetrics = getHistoryMetricsForDate(latestHistoryRef.current || {}, normalizedLogDate);
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
            source: pendingChange.reason || saveDraftSnapshot.meta?.source || "local_auto_persist",
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
        if (pendingSavePayloadsRef) {
            const directPayloadForDate = buildDraftHistoryForDate({
                baseHistory: latestHistoryRef.current || {},
                workoutDate: normalizedLogDate,
                exercises: saveExercises,
                logData: saveLogData,
                getExUnit: getSaveExUnit,
                labels: saveLabels,
                durationSec,
                replaceDate: Boolean(pendingChange.explicitDelete),
            });
            pendingSavePayloadsRef.current.set(normalizedLogDate, directPayloadForDate);
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
            const nextHistory = buildDraftHistoryForDate({
                baseHistory: prev,
                workoutDate: normalizedLogDate,
                exercises: saveExercises,
                logData: saveLogData,
                getExUnit: getSaveExUnit,
                labels: saveLabels,
                durationSec,
                replaceDate: Boolean(pendingChange.explicitDelete),
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
            persistHistoryForUser(user?.id, nextHistory);
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
    }, [applyWorkoutsDataHistorySnapshot, exerciseUnits, exercises, getDraftKey, getExUnit, getTodayKey, hasDraftContent, historyRevisionRef, logData, pendingSavePayloadsRef, queueWorkoutSessionSync, saveDraftForDate, savedWorkoutDurationSecByDate, todayLabels, user?.id, workoutStartedForDate, workoutTimerStateRef]);

    return { persistCurrentLog };
}
