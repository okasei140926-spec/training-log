import { useEffect } from "react";
import { supabase } from "../utils/supabase";
import {
    fetchWorkoutRowForDate as fetchWorkoutRowForDateFromRepository,
} from "../features/workout/workoutRepository";
import { buildHistoryFromWorkoutRows, getValidWorkoutDatesFromHistory } from "../utils/helpers";
import {
    applyPreferredHistoryDates,
    buildRemoteHistoryWithWorkoutRowsPriority,
    getDraftMetricsForDate,
    getDraftDateValidation,
    getDraftPayloadDate,
    getHistoryMetricsForDate,
    getRuntimeEnvironmentLabel,
    isCleanPersistedDraft,
    isDestructiveWorkoutRegression,
    isDraftNewerThan,
    isUnsavedUserWorkoutDraft,
    logRecordFetchError,
    normalizeDraftDateKey,
    persistHistoryForUser,
    serializeHistoryMap,
    shouldLogPerfDebug,
    shouldPreserveRawDraftOverIncoming,
    withDraftDateMeta,
    getHomeWeeklySummaryDebug,
    getWorkoutEditReasonFromSource,
} from "../utils/appHelpers";

export function useLogDateRefresh({
    screen,
    user,
    historySyncReady,
    logDate,
    history,
    pendingWorkoutContentChangeDatesRef,
    explicitWorkoutEditDatesRef,
    latestHistoryRef,
    workoutsDataHistoryRef,
    applyTrustedSessionRowsSnapshot,
    applyTrustedWorkoutRowsSnapshot,
    applyWorkoutsDataHistorySnapshot,
    applyLocalHistoryDates,
    applyCurrentLogDraft,
    buildSavedWorkoutDraftForDate,
    getExUnit,
    loadDraftForDate,
    markWorkoutContentChanged,
    saveDraftForDate,
    setHistory,
    setHistoryLoadError,
}) {
    useEffect(() => {
        if (screen !== "log" || !user?.id || !historySyncReady || !logDate) return;
        const normalizedDate = String(logDate || "").slice(0, 10);
        if (!normalizedDate) return;
        if (pendingWorkoutContentChangeDatesRef.current.has(normalizedDate)) return;

        let cancelled = false;

        const refreshLogDateFromSupabase = async () => {
            try {
                const [workoutsRes, sessionRes] = await Promise.all([
                    fetchWorkoutRowForDateFromRepository({
                        userId: user.id,
                        date: normalizedDate,
                    }),
                    supabase
                        .from("workout_sessions")
                        .select("workout_date, duration_sec, summary_json")
                        .eq("user_id", user.id)
                        .eq("workout_date", normalizedDate)
                        .maybeSingle(),
                ]);

                if (workoutsRes.error) {
                    logRecordFetchError("log_date_refresh", "workouts", workoutsRes.error, {
                        userId: user.id,
                        workoutDate: normalizedDate,
                        query: "workoutRepository.fetchWorkoutRowForDate",
                        responseData: workoutsRes.row,
                    });
                    throw workoutsRes.error;
                }
                if (sessionRes.error) {
                    logRecordFetchError("log_date_refresh", "workout_sessions", sessionRes.error, {
                        userId: user.id,
                        workoutDate: normalizedDate,
                        query: "workout_sessions.select(workout_date,duration_sec,summary_json).eq(user_id).eq(workout_date).maybeSingle",
                        responseData: sessionRes.data,
                    });
                    console.warn("[restore] workout_sessions date refresh failed; using workouts.data", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        date: normalizedDate,
                        code: sessionRes.error?.code,
                        message: sessionRes.error?.message,
                        details: sessionRes.error?.details,
                        hint: sessionRes.error?.hint,
                        responseData: sessionRes.data,
                    });
                }
                if (cancelled) return;
                if (pendingWorkoutContentChangeDatesRef.current.has(normalizedDate)) return;

                const fetchedWorkoutRowsForDate = workoutsRes.row ? [workoutsRes.row] : [];
                const workoutRowsForDate = fetchedWorkoutRowsForDate.filter((row) => {
                    const rowDate = normalizeDraftDateKey(row?.date);
                    const accepted = rowDate === normalizedDate;
                    if (!accepted) {
                        console.warn("[restore] rejected date-mismatched workouts row", {
                            action: "refresh_log_date_result",
                            requestedDate: normalizedDate,
                            remoteRowDate: rowDate || null,
                            accepted: false,
                            rejectedReason: "workouts.row.date mismatch",
                        });
                    }
                    return accepted;
                });
                const sessionRowsForDate = sessionRes.error
                    ? []
                    : (sessionRes.data ? [sessionRes.data] : []).filter((row) => {
                        const rowDate = normalizeDraftDateKey(row?.workout_date || row?.date);
                        const accepted = rowDate === normalizedDate;
                        if (!accepted) {
                            console.warn("[restore] rejected date-mismatched workout_sessions row", {
                                action: "refresh_log_date_result",
                                requestedDate: normalizedDate,
                                remoteSessionDate: rowDate || null,
                                accepted: false,
                                rejectedReason: "workout_sessions.workout_date mismatch",
                            });
                        }
                        return accepted;
                    });
                applyTrustedWorkoutRowsSnapshot(workoutRowsForDate, {
                    source: "log_date_refresh",
                });
                applyTrustedSessionRowsSnapshot(sessionRowsForDate, {
                    source: "log_date_refresh",
                });
                const rawRemoteHistory = buildRemoteHistoryWithWorkoutRowsPriority(
                    workoutRowsForDate,
                    sessionRowsForDate
                );
                const remoteHistory = applyPreferredHistoryDates(
                    {},
                    rawRemoteHistory,
                    [normalizedDate]
                );
                const remoteMetrics = getHistoryMetricsForDate(remoteHistory, normalizedDate, {
                    updatedAt: null,
                });
                const localDraft = loadDraftForDate(normalizedDate);
                const localMetrics = getDraftMetricsForDate({
                    exercises: localDraft.sessionEx || [],
                    logData: localDraft.logData || {},
                    getExUnit: (name) => localDraft.exerciseUnits?.[name] || getExUnit(name),
                    workoutDate: normalizedDate,
                });
                const remoteDraftForDate = buildSavedWorkoutDraftForDate(normalizedDate, remoteHistory);
                const remoteDraftValidation = getDraftDateValidation(normalizedDate, remoteDraftForDate, normalizedDate);
                if (shouldLogPerfDebug()) {
                    console.log("[restore] refresh log date result", {
                        action: "refresh_log_date_result",
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        requestedDate: normalizedDate,
                        remoteRowDates: fetchedWorkoutRowsForDate.map((row) => normalizeDraftDateKey(row?.date)).filter(Boolean),
                        remoteDataDates: getValidWorkoutDatesFromHistory(rawRemoteHistory),
                        remoteSessionDates: sessionRowsForDate.map((row) => normalizeDraftDateKey(row?.workout_date || row?.date)).filter(Boolean),
                        restoredHistoryDates: getValidWorkoutDatesFromHistory(remoteHistory),
                        appliedLogDataDate: getDraftPayloadDate(remoteDraftForDate) || normalizedDate,
                        appliedSessionExDate: getDraftPayloadDate(remoteDraftForDate) || normalizedDate,
                        dateMismatch: !remoteDraftValidation.accepted,
                        rejectedReason: remoteDraftValidation.rejectedReason || null,
                    });
                }
                const {
                    preserve: preserveRawLocalDraft,
                    localRawMetrics,
                    incomingRawMetrics: remoteRawMetrics,
                    removedExerciseNames,
                } = shouldPreserveRawDraftOverIncoming(localDraft, remoteDraftForDate);
                const explicitLocalEdit = Boolean(explicitWorkoutEditDatesRef.current.has(normalizedDate));
                const remoteVerifiedAt = new Date().toISOString();
                const localDraftIsCleanPersisted = isCleanPersistedDraft(localDraft);
                const pendingLocalEdit = pendingWorkoutContentChangeDatesRef.current.get(normalizedDate) || null;
                const localDraftEditReason = getWorkoutEditReasonFromSource(localDraft?.meta?.source);
                const localDraftIsUnsavedUserEdit = isUnsavedUserWorkoutDraft(localDraft);
                const localDraftHasUnsavedChanges = Boolean(
                    localDraft?.meta?.hasUnsavedChanges === true ||
                    explicitLocalEdit ||
                    pendingLocalEdit ||
                    localDraftIsUnsavedUserEdit
                );
                const localDraftIsNewerUnsaved = Boolean(
                    localDraftHasUnsavedChanges &&
                    !localDraftIsCleanPersisted &&
                    (
                        !localDraft?.meta?.remoteVerifiedAt ||
                        isDraftNewerThan(localDraft, localDraft.meta.remoteVerifiedAt) ||
                        explicitLocalEdit ||
                        pendingLocalEdit
                    )
                );

                if (shouldLogPerfDebug()) {
                    console.log("[restore] restore_decision", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        action: "restore_decision",
                        date: normalizedDate,
                        localDraftSource: localDraft?.meta?.source || null,
                        localDraftUpdatedAt: localDraft?.meta?.updatedAt || null,
                        localDraftRemoteVerifiedAt: localDraft?.meta?.remoteVerifiedAt || null,
                        localDraftHasUnsavedChanges: localDraft?.meta?.hasUnsavedChanges ?? null,
                        remoteUpdatedAt: remoteVerifiedAt,
                        localSetCount: localMetrics.setCount,
                        remoteSetCount: remoteMetrics.setCount,
                        localIsNewerUnsavedDraft: localDraftIsNewerUnsaved,
                        appliedSource: localDraftIsNewerUnsaved && (preserveRawLocalDraft || isDestructiveWorkoutRegression(remoteMetrics, localMetrics))
                            ? "localDraft"
                            : "remoteSupabase",
                        rejectedSource: localDraftIsNewerUnsaved && (preserveRawLocalDraft || isDestructiveWorkoutRegression(remoteMetrics, localMetrics))
                            ? "remoteSupabase"
                            : "localDraft",
                        reason: localDraftIsCleanPersisted
                            ? "local draft is save verified/remote persisted"
                            : localDraftIsNewerUnsaved
                                ? "local draft has newer unsaved edits"
                                : "remote is allowed to refresh local draft",
                    });
                }

                if (!remoteMetrics.hasWorkout) {
                    console.log("[restore] Supabase date refresh skipped empty remote", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        date: normalizedDate,
                        supabase: remoteMetrics,
                        localStorage: localMetrics,
                    });
                    return;
                }

                if (
                    localDraftIsNewerUnsaved &&
                    localDraftIsUnsavedUserEdit &&
                    (localMetrics.hasWorkout || localRawMetrics.exerciseCount > 0 || localRawMetrics.setCount > 0)
                ) {
                    const datedLocalDraft = withDraftDateMeta(normalizedDate, localDraft, {
                        source: localDraft?.meta?.source || "draft_restore",
                        hasUnsavedChanges: true,
                    });
                    console.warn("[restore] skipped Supabase date refresh during unsaved user draft; keeping local draft", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        date: normalizedDate,
                        source: localDraft?.meta?.source || null,
                        dirty: true,
                        supabase: remoteMetrics,
                        localStorage: localMetrics,
                        remoteRawMetrics,
                        localRawMetrics,
                        removedExerciseNames,
                        overwrittenByRestore: false,
                        blockedReason: "local draft has unsaved user edit source",
                    });
                    applyCurrentLogDraft(datedLocalDraft);
                    markWorkoutContentChanged(normalizedDate, localDraftEditReason || "local_unsaved_draft_restore", { explicitEdit: true });
                    return;
                }

                if (localDraftIsNewerUnsaved && preserveRawLocalDraft && explicitLocalEdit) {
                    console.warn("[restore] skipped Supabase date refresh during dirty draft; keeping local draft", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        date: normalizedDate,
                        source: "supabase",
                        dirty: true,
                        supabase: remoteMetrics,
                        localStorage: localMetrics,
                        remoteRawMetrics,
                        localRawMetrics,
                        removedExerciseNames,
                        overwrittenByRestore: false,
                        blockedReason: "remote refresh would drop local draft sets",
                    });
                    markWorkoutContentChanged(normalizedDate, "local_draft_richer_restore", { explicitEdit: true });
                    return;
                }

                if (localDraftIsNewerUnsaved && explicitLocalEdit && (localMetrics.hasWorkout || localRawMetrics.exerciseCount > 0 || localRawMetrics.setCount > 0)) {
                    console.warn("[restore] skipped Supabase date refresh during explicit local edit; keeping local draft", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        date: normalizedDate,
                        supabase: remoteMetrics,
                        localStorage: localMetrics,
                        explicitEdit: explicitWorkoutEditDatesRef.current.get(normalizedDate) || null,
                    });
                    markWorkoutContentChanged(normalizedDate, "local_draft_richer_restore", { explicitEdit: true });
                    return;
                }

                if (localDraftIsNewerUnsaved && isDestructiveWorkoutRegression(remoteMetrics, localMetrics)) {
                    console.warn("[restore] skipped smaller Supabase date refresh; keeping local draft", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        date: normalizedDate,
                        supabase: remoteMetrics,
                        localStorage: localMetrics,
                        localExerciseNames: localMetrics.exerciseNames,
                        remoteExerciseNames: remoteMetrics.exerciseNames,
                    });
                    markWorkoutContentChanged(normalizedDate, "local_draft_richer_restore");
                    return;
                }

                const nextHistory = applyLocalHistoryDates(latestHistoryRef.current || history || {}, remoteHistory, [normalizedDate]);
                const remoteWorkoutsHistory = applyPreferredHistoryDates(
                    {},
                    buildHistoryFromWorkoutRows(workoutRowsForDate),
                    [normalizedDate]
                );
                const nextWorkoutsDataHistory = applyLocalHistoryDates(
                    workoutsDataHistoryRef.current || latestHistoryRef.current || history || {},
                    remoteWorkoutsHistory,
                    [normalizedDate]
                );
                const savedDraftForDate = withDraftDateMeta(
                    normalizedDate,
                    buildSavedWorkoutDraftForDate(normalizedDate, nextHistory),
                    {
                        source: "remote_supabase",
                        hasUnsavedChanges: false,
                    }
                );
                const cleanSavedDraftForDate = withDraftDateMeta(normalizedDate, savedDraftForDate, {
                    source: "remote_supabase",
                    remoteVerifiedAt,
                    hasUnsavedChanges: false,
                });

                if (shouldLogPerfDebug()) {
                    console.log("[restore] Supabase date refresh applied", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        date: normalizedDate,
                        supabase: remoteMetrics,
                        localStorage: localMetrics,
                        appliedExerciseNames: cleanSavedDraftForDate.sessionEx.map((ex) => ex.name),
                    });
                }

                if (serializeHistoryMap(nextHistory) !== serializeHistoryMap(latestHistoryRef.current || history || {})) {
                    setHistory(nextHistory);
                    persistHistoryForUser(user.id, nextHistory);
                }
                if (serializeHistoryMap(nextWorkoutsDataHistory) !== serializeHistoryMap(workoutsDataHistoryRef.current || {})) {
                    const logDateRefreshApplied = applyWorkoutsDataHistorySnapshot(nextWorkoutsDataHistory, {
                        source: "workouts.data",
                        reason: "log date workouts.data refresh",
                        requestId: "log-date-refresh",
                        workoutsHistory: remoteWorkoutsHistory,
                    });
                    if (shouldLogPerfDebug()) {
                        console.log("[home weekly summary] apply", {
                            source: "workouts.data",
                            env: getRuntimeEnvironmentLabel(),
                            user_id: user.id,
                            requestId: "log-date-refresh",
                            applied: logDateRefreshApplied,
                            reason: "log date workouts.data refresh",
                            ...getHomeWeeklySummaryDebug(nextWorkoutsDataHistory),
                        });
                    }
                }
                applyCurrentLogDraft(cleanSavedDraftForDate);
                setHistoryLoadError("");
            } catch (error) {
                console.warn("[restore] Supabase date refresh failed", {
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user.id,
                    date: normalizedDate,
                    error,
                    message: error?.message,
                });
            }
        };

        refreshLogDateFromSupabase();

        return () => {
            cancelled = true;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        applyTrustedSessionRowsSnapshot,
        applyTrustedWorkoutRowsSnapshot,
        applyWorkoutsDataHistorySnapshot,
        applyLocalHistoryDates,
        applyCurrentLogDraft,
        buildSavedWorkoutDraftForDate,
        getExUnit,
        history,
        historySyncReady,
        loadDraftForDate,
        logDate,
        markWorkoutContentChanged,
        saveDraftForDate,
        screen,
        setHistoryLoadError,
        user?.id,
    ]);
}
