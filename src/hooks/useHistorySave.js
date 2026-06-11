import { useRef, useCallback } from "react";
import { supabase } from "../utils/supabase";
import {
    fetchWorkoutRowForDate as fetchWorkoutRowForDateFromRepository,
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
}) {
    // ─── Refs ─────────────────────────────────────────────────────────────────
    // pendingWorkoutContentChangeDatesRef and explicitWorkoutEditDatesRef are
    // declared in App.jsx and passed in as params (shared with non-extracted code)
    const historyRevisionRef = useRef(0);
    const historySaveQueueRef = useRef(Promise.resolve());
    const pendingWorkoutSessionSyncDatesRef = useRef(new Set());
    const syncFailuresByDateRef = useRef({});

    // ─── Callbacks ────────────────────────────────────────────────────────────

    const queueWorkoutSessionSync = useCallback((date) => {
        const normalizedDate = String(date || "").slice(0, 10);
        if (!normalizedDate) return;
        pendingWorkoutSessionSyncDatesRef.current.add(normalizedDate);
    }, []);

    const markWorkoutContentChanged = useCallback((date, reason = "content_change", options = {}) => {
        const normalizedDate = String(date || "").slice(0, 10);
        if (!normalizedDate) return;

        const previous = pendingWorkoutContentChangeDatesRef.current.get(normalizedDate) || {};
        const explicitEdit = Boolean(previous.explicitEdit || options.explicitEdit || EXPLICIT_WORKOUT_EDIT_REASONS.has(reason));
        pendingWorkoutContentChangeDatesRef.current.set(normalizedDate, {
            ...previous,
            reason,
            explicitDelete: Boolean(previous.explicitDelete || options.explicitDelete),
            explicitEdit,
            details: options.details || previous.details || null,
            updatedAt: new Date().toISOString(),
        });
        if (explicitEdit) {
            explicitWorkoutEditDatesRef.current.set(normalizedDate, {
                reason,
                updatedAt: Date.now(),
            });
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
            verifiedHistoryByDate: {},
        };

        if (!userId || !normalizedDates.length) return results;

        await Promise.all(
            normalizedDates.map(async (workoutDate) => {
                try {
                    const hasWorkoutForDate = hasValidWorkoutOnDate(normalizedHistoryMap, workoutDate);
                    const incomingMetrics = getHistoryMetricsForDate(normalizedHistoryMap, workoutDate);
                    const {
                        row: existingWorkoutRow,
                        error: existingWorkoutError,
                    } = await fetchWorkoutRowForDateFromRepository({
                        userId,
                        date: workoutDate,
                    });

                    if (existingWorkoutError) throw existingWorkoutError;

                    const remoteMetrics = existingWorkoutRow
                        ? getHistoryMetricsForDate(existingWorkoutRow.data || {}, workoutDate, {
                            updatedAt: null,
                        })
                        : getEmptyWorkoutMetrics();
                    const pendingChange = pendingWorkoutContentChangeDatesRef.current.get(workoutDate) || {};
                    const explicitEdit = isExplicitWorkoutEditChange(pendingChange);
                    if (!hasWorkoutForDate && !pendingChange.explicitDelete) {
                        console.warn("[save guard] skip empty workout delete without explicit delete intent", {
                            env: getRuntimeEnvironmentLabel(),
                            user_id: userId,
                            date: workoutDate,
                            localMetrics: incomingMetrics,
                            remoteMetrics,
                            reason: pendingChange.reason || "missing local workout data",
                            explicitDelete: false,
                            safety: "avoid deleting Supabase data when history failed to load",
                        });
                        results.skippedDates.push(workoutDate);
                        return;
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
                    const dateScopedHistoryForSave = applyPreferredHistoryDates({}, normalizedHistoryMap, [workoutDate]);

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

                    const repositorySaveResult = await saveWorkoutForDateInRepository({
                        userId,
                        date: workoutDate,
                        history: dateScopedHistoryForSave,
                        remoteHistory: existingWorkoutRow?.data || {},
                        reason: pendingChange.reason,
                        explicitEdit,
                        explicitDelete: Boolean(pendingChange.explicitDelete),
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
                            console.error("[save verify] workouts.data explicit set edit mismatch after save", {
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
                            throw new Error(`workouts.data explicit set edit verification failed for ${workoutDate}`);
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
