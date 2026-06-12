import { useEffect, useCallback } from "react";
import {
    getDraftMetricsForDate,
    getRuntimeEnvironmentLabel,
    getWorkoutDraftSignature,
    isCleanPersistedDraft,
    isDestructiveWorkoutRegression,
    isUnsavedUserWorkoutDraft,
    normalizeDraftDateKey,
    shouldLogPerfDebug,
    shouldPreserveRawDraftOverIncoming,
    withDraftDateMeta,
    getWorkoutEditReasonFromSource,
} from "../utils/appHelpers";

export function useDraftRestore({
    screen,
    historySyncReady,
    logDate,
    user,
    pendingWorkoutContentChangeDatesRef,
    explicitWorkoutEditDatesRef,
    latestLogDraftRef,
    canonicalDisplayHistory,
    exerciseUnits,
    logData,
    sessionEx,
    todayLabels,
    buildSavedWorkoutDraftForDate,
    getCurrentLogDraftSnapshot,
    loadDraftForDate,
    hasDraftContent,
    getExUnit,
    applyCurrentLogDraft,
    markWorkoutContentChanged,
    saveDraftForDate,
}) {
    const logRestoreDecision = useCallback((dateStr, savedDraft, localDraft, finalDraft, source) => {
        if (!shouldLogPerfDebug()) return;
        const metricGetExUnit = (name) =>
            finalDraft?.exerciseUnits?.[name] ||
            localDraft?.exerciseUnits?.[name] ||
            savedDraft?.exerciseUnits?.[name] ||
            getExUnit(name);
        console.log("[restore] environment", {
            env: getRuntimeEnvironmentLabel(),
            origin: typeof window !== "undefined" ? window.location?.origin : "",
            protocol: typeof window !== "undefined" ? window.location?.protocol : "",
            user_id: user?.id || null,
            date: dateStr,
            source,
            savedMetrics: getDraftMetricsForDate({
                exercises: savedDraft?.sessionEx || [],
                logData: savedDraft?.logData || {},
                getExUnit: metricGetExUnit,
                workoutDate: dateStr,
            }),
            localMetrics: getDraftMetricsForDate({
                exercises: localDraft?.sessionEx || [],
                logData: localDraft?.logData || {},
                getExUnit: metricGetExUnit,
                workoutDate: dateStr,
            }),
            finalMetrics: getDraftMetricsForDate({
                exercises: finalDraft?.sessionEx || [],
                logData: finalDraft?.logData || {},
                getExUnit: metricGetExUnit,
                workoutDate: dateStr,
            }),
        });
        console.log("[restore] supabase exercises", (savedDraft?.sessionEx || []).map((ex) => ex.name));
        console.log("[restore] local draft exercises", (localDraft?.sessionEx || []).map((ex) => ex.name));
        console.log("[restore] final exercises", (finalDraft?.sessionEx || []).map((ex) => ex.name));
    }, [getExUnit, user?.id]);

    useEffect(() => {
        if (screen !== "log" || !historySyncReady || !logDate) return;
        if (pendingWorkoutContentChangeDatesRef.current.has(String(logDate || "").slice(0, 10))) return;

        const normalizedLogDate = normalizeDraftDateKey(logDate);
        const savedDraftForDate = withDraftDateMeta(
            normalizedLogDate,
            buildSavedWorkoutDraftForDate(normalizedLogDate, canonicalDisplayHistory),
            {
                source: "canonical_display_history",
                hasUnsavedChanges: false,
            }
        );
        if (!savedDraftForDate.hasSavedWorkout) return;

        const currentDraft = withDraftDateMeta(normalizedLogDate, getCurrentLogDraftSnapshot(), {
            source: latestLogDraftRef.current?.meta?.source || "current_log_snapshot",
            hasUnsavedChanges: latestLogDraftRef.current?.meta?.hasUnsavedChanges ?? true,
        });
        const currentDraftSignature = getWorkoutDraftSignature(currentDraft);
        const savedDraftSignature = getWorkoutDraftSignature(savedDraftForDate);
        if (currentDraftSignature === savedDraftSignature) {
            return;
        }

        const localDraft = loadDraftForDate(normalizedLogDate);
        if (
            hasDraftContent(currentDraft) &&
            currentDraftSignature === getWorkoutDraftSignature(localDraft)
        ) {
            return;
        }

        const savedMetrics = getDraftMetricsForDate({
            exercises: savedDraftForDate.sessionEx,
            logData: savedDraftForDate.logData,
            getExUnit,
            workoutDate: normalizedLogDate,
        });
        const localMetrics = getDraftMetricsForDate({
            exercises: localDraft.sessionEx || [],
            logData: localDraft.logData || {},
            getExUnit: (name) => localDraft.exerciseUnits?.[name] || getExUnit(name),
            workoutDate: normalizedLogDate,
        });
        const explicitLocalEdit = Boolean(explicitWorkoutEditDatesRef.current.has(normalizedLogDate));
        const localDraftIsCleanPersisted = isCleanPersistedDraft(localDraft);
        const localDraftEditReason = getWorkoutEditReasonFromSource(localDraft?.meta?.source);
        const localDraftIsUnsavedUserEdit = isUnsavedUserWorkoutDraft(localDraft);
        const localDraftHasUnsavedChanges = Boolean(localDraft?.meta?.hasUnsavedChanges === true || explicitLocalEdit);
        const localDraftCanOverrideSaved = Boolean(
            hasDraftContent(localDraft) &&
            !localDraftIsCleanPersisted &&
            (localDraftHasUnsavedChanges || localDraftIsUnsavedUserEdit)
        );
        const {
            preserve: preserveRawLocalDraft,
            localRawMetrics,
            incomingRawMetrics: savedRawMetrics,
            removedExerciseNames,
        } = shouldPreserveRawDraftOverIncoming(localDraft, savedDraftForDate);

        if (shouldLogPerfDebug()) {
            console.log("[restore] restore_decision", {
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                action: "restore_decision",
                date: normalizedLogDate,
                localDraftSource: localDraft?.meta?.source || null,
                localDraftUpdatedAt: localDraft?.meta?.updatedAt || null,
                localDraftRemoteVerifiedAt: localDraft?.meta?.remoteVerifiedAt || null,
                localDraftHasUnsavedChanges: localDraft?.meta?.hasUnsavedChanges ?? null,
                remoteUpdatedAt: null,
                localSetCount: localMetrics.setCount,
                remoteSetCount: savedMetrics.setCount,
                localIsNewerUnsavedDraft: localDraftCanOverrideSaved,
                appliedSource: localDraftCanOverrideSaved && (isDestructiveWorkoutRegression(savedMetrics, localMetrics) || preserveRawLocalDraft)
                    ? "localDraft"
                    : "remoteSupabase",
                rejectedSource: localDraftCanOverrideSaved && (isDestructiveWorkoutRegression(savedMetrics, localMetrics) || preserveRawLocalDraft)
                    ? "remoteSupabase"
                    : "localDraft",
                reason: localDraftIsCleanPersisted
                    ? "local draft is already clean persisted data"
                    : localDraftCanOverrideSaved
                        ? "local draft has unsaved changes"
                        : "local draft is not unsaved; remote can refresh",
            });
        }

        if (
            localDraftCanOverrideSaved &&
            localDraftIsUnsavedUserEdit &&
            (localMetrics.hasWorkout || localRawMetrics.exerciseCount > 0 || localRawMetrics.setCount > 0)
        ) {
            console.warn("[restore] kept unsaved user draft instead of saved workout", {
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                date: normalizedLogDate,
                local: localMetrics,
                saved: savedMetrics,
                localRawMetrics,
                savedRawMetrics,
                removedExerciseNames,
                explicitLocalEdit,
                source: localDraft?.meta?.source || null,
                reason: "local draft has unsaved user edit source",
                restoreApplied: false,
                overwrittenByRestore: false,
            });
            const datedLocalDraft = withDraftDateMeta(normalizedLogDate, localDraft, {
                source: localDraft?.meta?.source || "draft_restore",
                hasUnsavedChanges: true,
            });
            applyCurrentLogDraft(datedLocalDraft);
            markWorkoutContentChanged(normalizedLogDate, localDraftEditReason || "local_unsaved_draft_restore", { explicitEdit: true });
            logRestoreDecision(normalizedLogDate, savedDraftForDate, datedLocalDraft, datedLocalDraft, "local_unsaved_draft");
            return;
        }

        if (localDraftCanOverrideSaved && (isDestructiveWorkoutRegression(savedMetrics, localMetrics) || preserveRawLocalDraft)) {
            console.warn("[restore] kept richer local draft instead of smaller saved workout", {
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                date: normalizedLogDate,
                local: localMetrics,
                saved: savedMetrics,
                localRawMetrics,
                savedRawMetrics,
                removedExerciseNames,
                explicitLocalEdit,
                source: "draft_restore",
                restoreApplied: false,
                overwrittenByRestore: false,
            });
            const datedLocalDraft = withDraftDateMeta(normalizedLogDate, localDraft, {
                source: localDraft?.meta?.source || "draft_restore",
                hasUnsavedChanges: localDraft?.meta?.hasUnsavedChanges ?? true,
            });
            applyCurrentLogDraft(datedLocalDraft);
            logRestoreDecision(normalizedLogDate, savedDraftForDate, datedLocalDraft, datedLocalDraft, "local_draft_richer_than_saved");
            return;
        }

        const cleanSavedDraft = withDraftDateMeta(normalizedLogDate, savedDraftForDate, {
            source: "remote_supabase",
            remoteVerifiedAt: new Date().toISOString(),
            hasUnsavedChanges: false,
        });
        applyCurrentLogDraft(cleanSavedDraft);
        logRestoreDecision(normalizedLogDate, cleanSavedDraft, localDraft, cleanSavedDraft, "supabase_saved_workout_refresh");
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        buildSavedWorkoutDraftForDate,
        applyCurrentLogDraft,
        canonicalDisplayHistory,
        exerciseUnits,
        historySyncReady,
        hasDraftContent,
        getCurrentLogDraftSnapshot,
        loadDraftForDate,
        logData,
        logDate,
        logRestoreDecision,
        markWorkoutContentChanged,
        saveDraftForDate,
        screen,
        sessionEx,
        todayLabels,
        user?.id,
        getExUnit,
    ]);

    return { logRestoreDecision };
}
