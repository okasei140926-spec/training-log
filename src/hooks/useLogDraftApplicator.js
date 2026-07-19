import { useCallback } from "react";
import {
    EXPLICIT_SET_EDIT_REASONS,
    getRawDraftSetMetrics,
    getRemovedRawDraftExerciseNames,
    getRuntimeEnvironmentLabel,
    getWorkoutDraftSignature,
    makeDraftMeta,
    mergeDraftExercisesWithLogData,
    normalizeDraftDateKey,
    normalizeLogDraftState,
    shouldLogPerfDebug,
    withDraftDateMeta,
} from "../utils/appHelpers";

export function useLogDraftApplicator({
    logDate,
    screen,
    exerciseUnits,
    logData,
    sessionEx,
    todayLabels,
    user,
    latestLogDraftRef,
    pendingWorkoutContentChangeDatesRef,
    lastAppliedLogDataHashRef,
    lastAutosavedDraftSignatureRef,
    hasDraftContent,
    saveDraftForDate,
    getCurrentLogDraftSnapshot,
    setTodayLabels,
    setLogData,
    setSessionEx,
    setExerciseUnits,
}) {
    const applyLogDraftState = useCallback((draft) => {
        const normalizedDraft = normalizeLogDraftState(draft);
        const currentDate = normalizeDraftDateKey(logDate);
        const incomingDate = normalizeDraftDateKey(
            normalizedDraft?.meta?.date ||
            normalizedDraft?.meta?.keyDate ||
            normalizedDraft?.meta?.draftDate ||
            normalizedDraft?.meta?.workoutDate ||
            currentDate
        );
        const previousDraft = normalizeLogDraftState(latestLogDraftRef.current || {
            todayLabels,
            logData,
            sessionEx,
            exerciseUnits,
        });
        const previousDraftSignature = getWorkoutDraftSignature(previousDraft);
        const normalizedDraftSignature = getWorkoutDraftSignature(normalizedDraft);
        const pendingChange = currentDate
            ? pendingWorkoutContentChangeDatesRef.current.get(currentDate) || {}
            : {};
        const previousMetrics = getRawDraftSetMetrics(previousDraft);
        const restoredMetrics = getRawDraftSetMetrics(normalizedDraft);
        const lostExerciseNames = getRemovedRawDraftExerciseNames(previousDraft, normalizedDraft);
        const previousDisplayedExerciseNames = previousMetrics.exerciseNames;
        const restoredExerciseNames = restoredMetrics.exerciseNames;
        const incomingSource = normalizedDraft?.meta?.source || "unknown";
        // explicit_date_nav: intentional user navigation between log dates — bypasses all guards
        const isExplicitDateNav = incomingSource === "explicit_date_nav";
        const dateMismatch = !isExplicitDateNav && Boolean(screen === "log" && currentDate && incomingDate && incomingDate !== currentDate);
        const regressionDetected = (
            lostExerciseNames.length > 0 ||
            restoredMetrics.exerciseCount < previousMetrics.exerciseCount ||
            restoredMetrics.setCount < previousMetrics.setCount
        );
        const protectsCurrentLog = !isExplicitDateNav && screen === "log" && currentDate && (!incomingDate || incomingDate === currentDate);
        const userMutationSource = new Set([
            "current_log_draft",
            "user_edit",
            "exercise_add",
            "manual_exercise_add",
            "exercise_remove",
            "exercise_delete",
            "exercise_rename",
            "exercise_reorder",
            "set_add",
            "set_input_change",
            "weight_change",
            "reps_change",
            "unit_change",
            "explicit_set_edit",
        ]);
        const explicitDelete = Boolean(pendingChange.explicitDelete);
        const explicitUserEdit = Boolean(userMutationSource.has(incomingSource));
        const previousHasContent = hasDraftContent(previousDraft);
        const shouldBlockRegression = (
            dateMismatch ||
            (
                protectsCurrentLog &&
                previousHasContent &&
                regressionDetected &&
                !explicitDelete &&
                !explicitUserEdit
            )
        );

        if (shouldBlockRegression) {
            console.warn("[restore] workout_restore_integrity_check", {
                env: getRuntimeEnvironmentLabel(),
                action: "workout_restore_integrity_check",
                date: currentDate,
                user_id: user?.id || null,
                previousDisplayedExerciseNames,
                restoredExerciseNames,
                lostExerciseNames,
                previousSetCount: previousMetrics.setCount,
                restoredSetCount: restoredMetrics.setCount,
                appliedSource: null,
                rejectedSource: incomingSource,
                reason: dateMismatch
                    ? "draft date does not match current log date"
                    : "restore would remove current draft exercises or sets",
                dateMismatch,
                incomingDate,
                currentDate,
                explicitDelete,
                explicitUserEdit,
                pendingExplicitEdit: Boolean(pendingChange.explicitEdit),
                overwrittenByRestore: false,
            });
            return previousDraft;
        }

        if (previousDraftSignature === normalizedDraftSignature) {
            latestLogDraftRef.current = normalizedDraft;
            const skipSignature = `${currentDate || incomingDate || "unknown"}:${normalizedDraftSignature}`;
            if (shouldLogPerfDebug() && lastAppliedLogDataHashRef.current !== skipSignature) {
                lastAppliedLogDataHashRef.current = skipSignature;
                console.log("[restore] restore_skip_same_snapshot", {
                    env: getRuntimeEnvironmentLabel(),
                    action: "restore_skip_same_snapshot",
                    selectedDate: currentDate || incomingDate || null,
                    draftHash: normalizedDraftSignature,
                    previousDraftHash: previousDraftSignature,
                    logDataHash: normalizedDraftSignature,
                    previousLogDataHash: previousDraftSignature,
                    skipped: true,
                    reason: "same_snapshot",
                });
            }
            return normalizedDraft;
        }

        if (shouldLogPerfDebug() || regressionDetected) {
            console.log("[restore] workout_restore_integrity_check", {
                env: getRuntimeEnvironmentLabel(),
                action: "workout_restore_integrity_check",
                date: currentDate || incomingDate || null,
                user_id: user?.id || null,
                previousDisplayedExerciseNames,
                restoredExerciseNames,
                lostExerciseNames,
                previousSetCount: previousMetrics.setCount,
                restoredSetCount: restoredMetrics.setCount,
                appliedSource: incomingSource,
                rejectedSource: null,
                reason: regressionDetected
                    ? (explicitDelete ? "explicit delete restore applied" : "user mutation restore applied")
                    : "restore applied",
                dateMismatch: false,
                incomingDate,
                currentDate,
                explicitDelete,
                explicitUserEdit,
                pendingExplicitEdit: Boolean(pendingChange.explicitEdit),
                overwrittenByRestore: regressionDetected,
            });
        }

        latestLogDraftRef.current = normalizedDraft;
        setTodayLabels(normalizedDraft.todayLabels);
        setLogData(normalizedDraft.logData);
        setSessionEx(normalizedDraft.sessionEx);
        setExerciseUnits(normalizedDraft.exerciseUnits);
        return normalizedDraft;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [exerciseUnits, hasDraftContent, logData, logDate, screen, sessionEx, todayLabels, user?.id]);

    const applyCurrentLogDraft = useCallback((draft, { persist = true } = {}) => {
        const datedDraft = withDraftDateMeta(logDate, draft, {
            source: draft?.meta?.source || "current_log_draft",
            hasUnsavedChanges: draft?.meta?.hasUnsavedChanges ?? true,
            remoteVerifiedAt: draft?.meta?.remoteVerifiedAt ?? null,
        });
        const normalizedDraft = applyLogDraftState(datedDraft);
        if (persist) {
            const draftSignature = JSON.stringify({
                date: normalizeDraftDateKey(logDate),
                content: getWorkoutDraftSignature(normalizedDraft),
                metaSource: normalizedDraft.meta?.source || null,
                hasUnsavedChanges: normalizedDraft.meta?.hasUnsavedChanges ?? null,
                remoteVerifiedAt: normalizedDraft.meta?.remoteVerifiedAt || null,
            });
            if (lastAutosavedDraftSignatureRef.current !== draftSignature) {
                lastAutosavedDraftSignatureRef.current = draftSignature;
                saveDraftForDate(logDate, normalizedDraft);
            }
        }
        return normalizedDraft;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [applyLogDraftState, logDate, saveDraftForDate]);

    const setLogDataAndSaveDraft = useCallback((nextOrUpdater) => {
        setLogData((prev) => {
            const beforeDraft = getCurrentLogDraftSnapshot();
            const sourceLogData = beforeDraft.logData || prev || {};
            const next =
                typeof nextOrUpdater === "function"
                    ? nextOrUpdater(sourceLogData)
                    : nextOrUpdater;
            const normalizedDate = String(logDate || "").slice(0, 10);
            if (normalizedDate) {
                const previousChange = pendingWorkoutContentChangeDatesRef.current.get(normalizedDate) || {};
                pendingWorkoutContentChangeDatesRef.current.set(normalizedDate, {
                    ...previousChange,
                    reason: previousChange.explicitEdit || previousChange.explicitDelete
                        ? (previousChange.reason || "set_update")
                        : "set_update",
                    explicitDelete: Boolean(previousChange.explicitDelete),
                    explicitEdit: Boolean(previousChange.explicitEdit),
                    details: previousChange.details || null,
                    updatedAt: new Date().toISOString(),
                });
            }

            const beforeSessionSource = beforeDraft.sessionEx !== null
                ? beforeDraft.sessionEx
                : sessionEx;
            const nextSessionEx = mergeDraftExercisesWithLogData(
                [
                    ...(beforeSessionSource || []),
                    ...(sessionEx || []),
                ],
                next || {},
                beforeDraft.todayLabels?.length ? beforeDraft.todayLabels : todayLabels
            );
            const nextDraft = {
                todayLabels: beforeDraft.todayLabels?.length ? beforeDraft.todayLabels : todayLabels,
                logData: next || {},
                sessionEx: nextSessionEx,
                exerciseUnits: beforeDraft.exerciseUnits || exerciseUnits,
                meta: makeDraftMeta(beforeDraft.meta || {}, {
                    source: "user_edit",
                    hasUnsavedChanges: true,
                }),
            };
            const pendingChangeAfterUpdate = normalizedDate
                ? pendingWorkoutContentChangeDatesRef.current.get(normalizedDate) || {}
                : {};
            const beforeRawMetrics = getRawDraftSetMetrics(beforeDraft);
            const afterRawMetrics = getRawDraftSetMetrics(nextDraft);
            const removedExerciseNames = getRemovedRawDraftExerciseNames(beforeDraft, nextDraft);
            const isSetInputChange = EXPLICIT_SET_EDIT_REASONS.has(pendingChangeAfterUpdate.reason);
            const blockedReason = isSetInputChange && removedExerciseNames.length
                ? "set_input_change would remove exercises"
                : isSetInputChange && afterRawMetrics.setCount < beforeRawMetrics.setCount
                    ? "set_input_change would reduce total set count"
                    : null;

            if (isSetInputChange) {
                const isUnitChange = pendingChangeAfterUpdate.reason === "unit_change";
                console[blockedReason ? "warn" : "log"]("[set mutation]", {
                    action: isUnitChange ? "unit_change" : "set_input_change",
                    date: normalizedDate,
                    user_id: user?.id || null,
                    exerciseName: pendingChangeAfterUpdate.details?.exerciseName || null,
                    setIndex: pendingChangeAfterUpdate.details?.setIndex ?? null,
                    beforeExerciseNames: beforeRawMetrics.exerciseNames,
                    afterExerciseNames: afterRawMetrics.exerciseNames,
                    removedExerciseNames,
                    beforeSetCountTotal: beforeRawMetrics.setCount,
                    afterSetCountTotal: afterRawMetrics.setCount,
                    beforeTargetSet: pendingChangeAfterUpdate.details?.beforeSet || null,
                    afterTargetSet: pendingChangeAfterUpdate.details?.afterSet || null,
                    source: "user_input",
                    dirty: true,
                    explicitEdit: Boolean(pendingChangeAfterUpdate.explicitEdit),
                    allowed: !blockedReason,
                    blockedReason,
                    restoreApplied: false,
                    overwrittenByRestore: false,
                    saveReason: pendingChangeAfterUpdate.reason,
                    latestLogDraftRefUpdated: !blockedReason,
                    logDataUpdated: !blockedReason,
                    sessionExUpdated: !blockedReason,
                    workoutsDataUpdated: false,
                    summaryJsonUpdated: false,
                });
            }

            if (blockedReason) return prev;

            const datedNextDraft = withDraftDateMeta(logDate, nextDraft, {
                source: nextDraft?.meta?.source || "user_input",
                hasUnsavedChanges: nextDraft?.meta?.hasUnsavedChanges ?? true,
            });
            saveDraftForDate(logDate, datedNextDraft);
            latestLogDraftRef.current = datedNextDraft;

            return next;
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [exerciseUnits, getCurrentLogDraftSnapshot, logDate, saveDraftForDate, sessionEx, todayLabels, user?.id]);

    return { applyLogDraftState, applyCurrentLogDraft, setLogDataAndSaveDraft };
}
