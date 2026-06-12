import { useCallback } from "react";
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
    setHistory,
}) {
    const persistCurrentLog = useCallback(() => {
        const normalizedLogDate = String(logDate || "").slice(0, 10);
        const pendingChange = pendingWorkoutContentChangeDatesRef.current.get(normalizedLogDate);
        if (!pendingChange) return;

        const latestDraftCandidate = latestLogDraftRef.current || null;
        const latestDraftDate = normalizeDraftDateKey(
            latestDraftCandidate?.date
            || latestDraftCandidate?.meta?.date
            || normalizedLogDate
        );
        const useLatestDraft =
            latestDraftDate === normalizedLogDate
            && hasDraftContent(latestDraftCandidate);
        const saveDraftSnapshot = normalizeLogDraftState(useLatestDraft
            ? latestDraftCandidate
            : {
                todayLabels,
                logData,
                sessionEx: exercises,
                exerciseUnits,
            });
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
        const existingMetrics = getHistoryMetricsForDate(latestHistoryRef.current || history || {}, normalizedLogDate);
        const explicitEdit = isExplicitWorkoutEditChange(pendingChange);
        const saveGuardDecision = getWorkoutSaveGuardDecision({
            incomingMetrics,
            remoteMetrics: existingMetrics,
            reason: pendingChange.reason,
            explicitEdit,
            explicitDelete: Boolean(pendingChange.explicitDelete),
        });
        const wouldDestructivelyOverwrite = saveGuardDecision.blocked;

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
        });
        const draftSavedToLocalStorage = saveDraftForDate(normalizedLogDate, dirtyDraftForPersistence);
        latestLogDraftRef.current = dirtyDraftForPersistence;
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
                draftSavedToLocalStorage,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [applyWorkoutsDataHistorySnapshot, exerciseUnits, exercises, getDraftKey, getExUnit, getTodayKey, hasDraftContent, historyRevisionRef, history, logData, logDate, queueWorkoutSessionSync, saveDraftForDate, savedWorkoutDurationSecByDate, todayLabels, user?.id, workoutStartedForDate, workoutTimerStateRef]);

    return { persistCurrentLog };
}
