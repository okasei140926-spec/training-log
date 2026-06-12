import { useCallback } from "react";
import { useWorkoutLog } from "../features/workout/useWorkoutLog";
import {
    getRuntimeEnvironmentLabel,
    getWorkoutDraftSignature,
    isExplicitWorkoutEditChange,
    makeDraftMeta,
    normalizeDraftDateKey,
    normalizeLogDraftState,
    shouldLogPerfDebug,
    withDraftDateMeta,
} from "../utils/appHelpers";

export function useWorkoutLogBridge({
    logDate,
    workoutLogInitialDraft,
    todayLabels,
    user,
    latestLogDraftRef,
    lastAutosavedDraftSignatureRef,
    markWorkoutContentChanged,
    saveDraftForDate,
    getTodayKey,
    setTodayLabels,
    setLogData,
    setSessionEx,
    setExerciseUnits,
}) {
    const handleWorkoutLogDraftChange = useCallback((nextDraft, mutation = {}) => {
        const normalizedDate = normalizeDraftDateKey(nextDraft?.date || logDate);
        const currentDate = normalizeDraftDateKey(logDate);
        if (!normalizedDate || normalizedDate !== currentDate) {
            console.warn("[workout log] skipped date-mismatched draft sync", {
                action: "draft_restore_date_check",
                keyDate: currentDate,
                payloadDate: normalizedDate,
                selectedDate: currentDate,
                accepted: false,
                rejectedReason: "useWorkoutLog draft date does not match current log date",
            });
            return;
        }

        const source = `useWorkoutLog:${mutation.reason || nextDraft?.meta?.source || "draft_change"}`;
        const normalizedDraft = withDraftDateMeta(normalizedDate, normalizeLogDraftState({
            todayLabels: nextDraft?.todayLabels?.length ? nextDraft.todayLabels : todayLabels,
            logData: nextDraft?.logData || {},
            sessionEx: nextDraft?.sessionEx ?? nextDraft?.exercises ?? [],
            exerciseUnits: nextDraft?.exerciseUnits || {},
            meta: makeDraftMeta(nextDraft?.meta || {}, {
                source,
                hasUnsavedChanges: true,
            }),
        }), {
            source,
            hasUnsavedChanges: true,
        });

        latestLogDraftRef.current = normalizedDraft;
        setTodayLabels((prev) =>
            JSON.stringify(prev || []) === JSON.stringify(normalizedDraft.todayLabels || [])
                ? prev
                : normalizedDraft.todayLabels
        );
        setLogData((prev) =>
            JSON.stringify(prev || {}) === JSON.stringify(normalizedDraft.logData || {})
                ? prev
                : normalizedDraft.logData
        );
        setSessionEx((prev) =>
            JSON.stringify(prev) === JSON.stringify(normalizedDraft.sessionEx)
                ? prev
                : normalizedDraft.sessionEx
        );
        setExerciseUnits((prev) =>
            JSON.stringify(prev || {}) === JSON.stringify(normalizedDraft.exerciseUnits || {})
                ? prev
                : normalizedDraft.exerciseUnits
        );

        if (mutation.reason) {
            markWorkoutContentChanged(normalizedDate, mutation.reason, {
                explicitDelete: Boolean(mutation.explicitDelete),
                explicitEdit: Boolean(mutation.explicitEdit),
                details: mutation.details || null,
            });
        }

        const explicitEdit = isExplicitWorkoutEditChange({
            reason: mutation.reason,
            explicitEdit: mutation.explicitEdit,
        });
        const isPastDateEdit = normalizedDate !== getTodayKey();
        if (explicitEdit && isPastDateEdit) {
            const draftSavedToLocalStorage = saveDraftForDate(normalizedDate, normalizedDraft);
            if (draftSavedToLocalStorage) {
                lastAutosavedDraftSignatureRef.current = JSON.stringify({
                    date: normalizedDate,
                    content: getWorkoutDraftSignature(normalizedDraft),
                    metaSource: normalizedDraft.meta?.source || null,
                    hasUnsavedChanges: normalizedDraft.meta?.hasUnsavedChanges ?? null,
                    updatedAt: normalizedDraft.meta?.updatedAt || null,
                    remoteVerifiedAt: normalizedDraft.meta?.remoteVerifiedAt || null,
                });
            }
            if (shouldLogPerfDebug()) {
                console.log("[workout edit] past edit persistence debug", {
                    action: "past_edit_persistence_debug",
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user?.id || null,
                    selectedDate: normalizedDate,
                    field: mutation.details?.field || null,
                    beforeValue: mutation.details?.beforeValue ?? null,
                    afterValue: mutation.details?.afterValue ?? null,
                    localStateUpdated: true,
                    draftSavedToLocalStorage,
                    pendingSaveQueued: Boolean(mutation.reason),
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
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [getTodayKey, logDate, markWorkoutContentChanged, saveDraftForDate, todayLabels, user?.id]);

    const handleWorkoutLogDraftPersist = useCallback((nextDraft) => {
        const normalizedDate = normalizeDraftDateKey(nextDraft?.date || logDate);
        if (!normalizedDate) return;

        const source = `useWorkoutLog:${nextDraft?.meta?.source || "draft_persist"}`;
        const normalizedDraft = withDraftDateMeta(normalizedDate, normalizeLogDraftState({
            todayLabels: nextDraft?.todayLabels?.length ? nextDraft.todayLabels : todayLabels,
            logData: nextDraft?.logData || {},
            sessionEx: nextDraft?.sessionEx ?? nextDraft?.exercises ?? [],
            exerciseUnits: nextDraft?.exerciseUnits || {},
            meta: makeDraftMeta(nextDraft?.meta || {}, {
                source,
                hasUnsavedChanges: nextDraft?.meta?.hasUnsavedChanges ?? true,
            }),
        }), {
            source,
            hasUnsavedChanges: nextDraft?.meta?.hasUnsavedChanges ?? true,
            updatedAt: nextDraft?.meta?.updatedAt,
            remoteVerifiedAt: nextDraft?.meta?.remoteVerifiedAt,
        });

        const draftSignature = JSON.stringify({
            date: normalizedDate,
            content: getWorkoutDraftSignature(normalizedDraft),
            metaSource: normalizedDraft.meta?.source || null,
            hasUnsavedChanges: normalizedDraft.meta?.hasUnsavedChanges ?? null,
            updatedAt: normalizedDraft.meta?.updatedAt || null,
            remoteVerifiedAt: normalizedDraft.meta?.remoteVerifiedAt || null,
        });
        if (lastAutosavedDraftSignatureRef.current === draftSignature) return;
        lastAutosavedDraftSignatureRef.current = draftSignature;
        saveDraftForDate(normalizedDate, normalizedDraft);
        latestLogDraftRef.current = normalizedDraft;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [logDate, saveDraftForDate, todayLabels]);

    const workoutLog = useWorkoutLog({
        date: logDate,
        initialDraft: workoutLogInitialDraft,
        debug: shouldLogPerfDebug(),
        debounceMs: 350,
        onDraftChange: handleWorkoutLogDraftChange,
        onDraftPersist: handleWorkoutLogDraftPersist,
    });

    return {
        workoutLog,
        workoutLogExercises: workoutLog.exercises,
        workoutLogData: workoutLog.logData,
        workoutLogExerciseUnits: workoutLog.exerciseUnits,
        addSet: workoutLog.addSet,
        setField: workoutLog.setField,
        setWeightMode: workoutLog.setWeightMode,
    };
}
