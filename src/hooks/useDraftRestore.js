import { useEffect, useCallback } from "react";
import {
    getDraftMetricsForDate,
    getRuntimeEnvironmentLabel,
    getWorkoutDraftSignature,
    isCleanPersistedDraft,
    isDestructiveWorkoutRegression,
    isUnsavedUserWorkoutDraft,
    loadPersistentDeletedDates,
    normalizeDraftDateKey,
    shouldLogPerfDebug,
    shouldPreserveRawDraftOverIncoming,
    withDraftDateMeta,
    getWorkoutEditReasonFromSource,
    loadPendingOps,
    hasOutboxEntryForDate,
} from "../utils/appHelpers";

export function useDraftRestore({
    screen,
    historySyncReady,
    logDate,
    user,
    pendingWorkoutContentChangeDatesRef,
    explicitWorkoutEditDatesRef,
    latestLogDraftRef,
    trustedHistory,
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
            buildSavedWorkoutDraftForDate(normalizedLogDate, trustedHistory),
            {
                source: "canonical_display_history",
                hasUnsavedChanges: false,
                contentOrigin: "remote",
            }
        );
        if (!savedDraftForDate.hasSavedWorkout) return;

        // Gate A: block content restoration for persistently deleted dates.
        // Note: pendingWorkoutContentChangeDatesRef early-return at line 79 already handles
        // all pending-change dates; Gate A is only reached when there is no pending change.
        // Exception: if the localStorage draft is an unsaved user edit, preserve it.
        {
            const _persistentDeleted = loadPersistentDeletedDates(user?.id);
            if (_persistentDeleted[normalizedLogDate]) {
                // Load local draft here (normally done later) to check for unsaved user content.
                const _localDraft = loadDraftForDate(normalizedLogDate);
                const _hasUnsavedUserDraft = isUnsavedUserWorkoutDraft(_localDraft);
                if (_hasUnsavedUserDraft) {
                    console.log("[WP] restore:persistentDeleteSkipped", {
                        date: normalizedLogDate,
                        caller: "useDraftRestore",
                        reason: "unsaved-user-draft",
                        draftSource: _localDraft?.meta?.source,
                    });
                } else {
                    console.log("[WP] restore:blockedByPersistentDelete", {
                        date: normalizedLogDate,
                        caller: "useDraftRestore",
                        source: "canonical_display_history",
                        exerciseCount: (savedDraftForDate?.sessionEx ?? []).length,
                        deletedAt: _persistentDeleted[normalizedLogDate],
                    });
                    return;
                }
            }
        }

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

        // Current draft has unsaved in-memory changes that haven't flushed to localStorage yet
        // (useWorkoutLog debounce is 350ms). Preserve the in-memory state.
        if (
            hasDraftContent(currentDraft) &&
            Boolean(currentDraft.meta?.hasUnsavedChanges) &&
            currentDraftSignature !== getWorkoutDraftSignature(localDraft)
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
        // zombie draft: hasUnsavedChanges === true but NOT from a real user edit (e.g. source: "date_delete").
        // Must not be adopted — treat as if it has no override right.
        const isZombieDraft = localDraftHasUnsavedChanges && !isUnsavedUserWorkoutDraft(localDraft);
        const localDraftCanOverrideSaved = Boolean(
            hasDraftContent(localDraft) &&
            !localDraftIsCleanPersisted &&
            !isZombieDraft &&
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
                isZombieDraft,
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
                contentOrigin: localDraft?.meta?.contentOrigin || "local_draft",
            });
            applyCurrentLogDraft(datedLocalDraft, { forDate: normalizedLogDate });
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
                contentOrigin: localDraft?.meta?.contentOrigin || "local_draft",
            });
            applyCurrentLogDraft(datedLocalDraft, { forDate: normalizedLogDate });
            logRestoreDecision(normalizedLogDate, savedDraftForDate, datedLocalDraft, datedLocalDraft, "local_draft_richer_than_saved");
            return;
        }

        const cleanSavedDraft = withDraftDateMeta(normalizedLogDate, savedDraftForDate, {
            source: "remote_supabase",
            remoteVerifiedAt: new Date().toISOString(),
            hasUnsavedChanges: false,
            contentOrigin: "remote",
            // contentDate declares where the live state content actually came from.
            // trustedHistory is built from live React state (workoutLogExercises),
            // which may still hold a previous date's data during the transition render.
            // latestLogDraftRef.current?.meta?.date is the date that state was loaded from.
            contentDate: normalizeDraftDateKey(latestLogDraftRef.current?.meta?.date) || null,
        });
        // F-2: If the outbox has a pending op for this date, don't let remote overwrite local
        // hasOutboxEntryForDate includes stalled entries — stalled = retry-next-session, NOT complete
        const _pendingOps = loadPendingOps(user?.id);
        if (hasOutboxEntryForDate(_pendingOps, normalizedLogDate)) {
            // There is an unconfirmed pending operation — preserve local state
            if (hasDraftContent(localDraft)) {
                const datedLocalDraft = withDraftDateMeta(normalizedLogDate, localDraft, {
                    source: localDraft?.meta?.source || "outbox_pending",
                    hasUnsavedChanges: true,
                    contentOrigin: localDraft?.meta?.contentOrigin || "local_draft",
                });
                applyCurrentLogDraft(datedLocalDraft, { forDate: normalizedLogDate });
            }
            return;
        }
        applyCurrentLogDraft(cleanSavedDraft, { forDate: normalizedLogDate });
        logRestoreDecision(normalizedLogDate, cleanSavedDraft, localDraft, cleanSavedDraft, "supabase_saved_workout_refresh");
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        buildSavedWorkoutDraftForDate,
        applyCurrentLogDraft,
        trustedHistory,
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
