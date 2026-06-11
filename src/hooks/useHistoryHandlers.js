import { useCallback } from "react";
import {
    getValidWorkoutDatesFromHistory,
    mergeHistoryMaps,
    sanitizeHistoryRecord,
    sanitizeWorkoutSets,
} from "../utils/helpers";

export function useHistoryHandlers({
    user,
    history,
    latestHistoryRef,
    historyRevisionRef,
    persistHistoryForUser,
    syncWorkoutRowsForDates,
    syncWorkoutSessionSnapshot,
    deleteRemoteWorkoutArtifactsForDate,
    appendHistoryDeleteMarkers,
    commitHistoryDeleteMarkers,
    historyDeleteMarkersRef,
    clearDraftForDate,
    saveDraftForDate,
    loadDraftForDate,
    applyLogDraftState,
    setHistory,
    logDate,
    setLogDate,
    setLogMode,
    setScreen,
    summary,
    setSummary,
    workoutDayShareTarget,
    setWorkoutDayShareTarget,
    workoutStartedForDate,
    resetWorkoutElapsedTimer,
    savedWorkoutDurationSecByDate,
    setSavedWorkoutDurationSecByDate,
    queueWorkoutSessionSync,
    pendingWorkoutContentChangeDatesRef,
    pendingWorkoutSessionSyncDatesRef,
    explicitWorkoutEditDatesRef,
    clearSyncFailure,
    recordSyncFailure,
    refreshHistorySyncDiagnostic,
    applyWorkoutsDataHistorySnapshot,
    workoutsDataHistoryRef,
    markWorkoutContentChanged,
    applyTrustedWorkoutRowsSnapshot,
    buildSavedWorkoutDraftForDate,
    setSessionSyncVersion,
    pendingDeleteUndoRef,
    setPendingDeleteUndo,
    hasDraftContent,
    // helpers used inside functions
    normalizeDraftDateKey,
    withDraftDateMeta,
    getCurrentLogDraftSnapshot,
    latestLogDraftRef,
    getTodayKey,
    canonicalDisplayHistory,
    getDraftMetricsForDate,
    getExUnit,
    isExplicitWorkoutEditChange,
    isCleanPersistedDraft,
    isDestructiveWorkoutRegression,
    shouldPreserveRawDraftOverIncoming,
    isUnsavedUserWorkoutDraft,
    logRestoreDecision,
    getDraftDateValidation,
    getDraftKey,
    getDraftPayloadDate,
    getRuntimeEnvironmentLabel,
    buildWorkoutDraftForDateFromHistory,
    withDraftMeta,
    applyLocalHistoryDates,
    buildHistoryRecordDeleteKey,
    removeHistoryDate,
}) {
    const handleLogForDate = (dateStr) => {
        const requestedDate = normalizeDraftDateKey(dateStr);
        const currentLogDate = normalizeDraftDateKey(logDate);
        const currentDraft = withDraftDateMeta(currentLogDate, getCurrentLogDraftSnapshot(), {
            source: latestLogDraftRef.current?.meta?.source || "current_log_snapshot",
            hasUnsavedChanges: latestLogDraftRef.current?.meta?.hasUnsavedChanges ?? true,
        });

        if (hasDraftContent(currentDraft)) {
            saveDraftForDate(currentLogDate, currentDraft);
        }

        setLogMode(requestedDate === getTodayKey() ? "today" : "past");
        setLogDate(requestedDate);

        const draftForDate = loadDraftForDate(requestedDate);
        const savedDraftForDate = withDraftDateMeta(
            requestedDate,
            buildSavedWorkoutDraftForDate(requestedDate, canonicalDisplayHistory),
            {
                source: "canonical_display_history",
                hasUnsavedChanges: false,
            }
        );
        const hasSavedWorkout = savedDraftForDate.hasSavedWorkout;
        const savedMetrics = getDraftMetricsForDate({
            exercises: savedDraftForDate.sessionEx,
            logData: savedDraftForDate.logData,
            getExUnit,
            workoutDate: requestedDate,
        });
        const localMetrics = getDraftMetricsForDate({
            exercises: draftForDate.sessionEx || [],
            logData: draftForDate.logData || {},
            getExUnit: (name) => draftForDate.exerciseUnits?.[name] || getExUnit(name),
            workoutDate: requestedDate,
        });
        const isActiveLocalRecording =
            requestedDate === currentLogDate &&
            workoutStartedForDate === requestedDate &&
            hasDraftContent(currentDraft);
        const pendingChange = pendingWorkoutContentChangeDatesRef.current.get(requestedDate) || {};
        const explicitLocalEdit = Boolean(
            isExplicitWorkoutEditChange(pendingChange) ||
            explicitWorkoutEditDatesRef.current.has(requestedDate)
        );
        const localDraftIsCleanPersisted = isCleanPersistedDraft(draftForDate);
        const localDraftHasUnsavedChanges = Boolean(
            draftForDate?.meta?.hasUnsavedChanges === true ||
            explicitLocalEdit ||
            isActiveLocalRecording
        );
        const localDraftIsRicher = isDestructiveWorkoutRegression(savedMetrics, localMetrics, {
            allowVolumeDecrease: explicitLocalEdit,
        });
        const {
            preserve: preserveRawLocalDraft,
            localRawMetrics,
            incomingRawMetrics: savedRawMetrics,
            removedExerciseNames,
        } = shouldPreserveRawDraftOverIncoming(draftForDate, savedDraftForDate);
        const localDraftCanOverrideSaved = hasDraftContent(draftForDate) &&
            !localDraftIsCleanPersisted &&
            localDraftHasUnsavedChanges;
        const shouldUseLocalDraft = localDraftCanOverrideSaved && (
            explicitLocalEdit ||
            isActiveLocalRecording ||
            localDraftIsRicher ||
            preserveRawLocalDraft ||
            isUnsavedUserWorkoutDraft(draftForDate)
        );
        const shouldUseSavedWorkout = hasSavedWorkout && !shouldUseLocalDraft;
        const logCalendarOpen = (appliedSource, loadedDraft) => {
            const loadedHistoryDates = getValidWorkoutDatesFromHistory(canonicalDisplayHistory)
                .filter((date) => date === requestedDate);
            const appliedValidation = getDraftDateValidation(requestedDate, loadedDraft || {}, requestedDate);
            console.log("[restore] calendar open log", {
                action: "calendar_open_log",
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                selectedDate: requestedDate,
                requestedDate,
                previousLogDate: currentLogDate,
                draftKey: getDraftKey("draft_logData", requestedDate),
                draftPayloadDate: getDraftPayloadDate(draftForDate) || null,
                loadedHistoryDates,
                loadedLogDataDate: getDraftPayloadDate(loadedDraft) || requestedDate,
                loadedSessionExDate: getDraftPayloadDate(loadedDraft) || requestedDate,
                appliedSource,
                dateMismatch: !appliedValidation.accepted,
                rejectedReason: appliedValidation.rejectedReason || null,
            });
        };

        console.log("[restore] restore_decision", {
            env: getRuntimeEnvironmentLabel(),
            user_id: user?.id || null,
            action: "restore_decision",
            date: requestedDate,
            localDraftSource: draftForDate?.meta?.source || null,
            localDraftUpdatedAt: draftForDate?.meta?.updatedAt || null,
            localDraftRemoteVerifiedAt: draftForDate?.meta?.remoteVerifiedAt || null,
            localDraftHasUnsavedChanges: draftForDate?.meta?.hasUnsavedChanges ?? null,
            remoteUpdatedAt: null,
            localSetCount: localMetrics.setCount,
            remoteSetCount: savedMetrics.setCount,
            localIsNewerUnsavedDraft: localDraftCanOverrideSaved,
            appliedSource: shouldUseLocalDraft ? "localDraft" : shouldUseSavedWorkout ? "remoteSupabase" : "emptyDraft",
            rejectedSource: shouldUseLocalDraft ? "remoteSupabase" : "localDraft",
            reason: localDraftIsCleanPersisted
                ? "local draft is clean persisted data"
                : localDraftCanOverrideSaved
                    ? "local draft has unsaved changes"
                    : "local draft is not unsaved; saved workout can be used",
        });

        if (shouldUseLocalDraft) {
            const datedDraftForDate = withDraftDateMeta(requestedDate, draftForDate, {
                source: draftForDate?.meta?.source || "draft_restore",
                hasUnsavedChanges: draftForDate?.meta?.hasUnsavedChanges ?? true,
            });
            console.warn("[restore] local draft selected for log date", {
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                date: requestedDate,
                action: "restore_apply",
                source: "draft_restore",
                dirty: Boolean(explicitLocalEdit || isActiveLocalRecording),
                explicitEdit: explicitLocalEdit,
                localDraftIsRicher,
                preserveRawLocalDraft,
                localRawMetrics,
                savedRawMetrics,
                removedExerciseNames,
                restoreApplied: true,
                overwrittenByRestore: false,
            });
            markWorkoutContentChanged(
                requestedDate,
                localDraftIsRicher || explicitLocalEdit ? "local_draft_richer_restore" : "active_local_recording_restore",
                { explicitEdit: explicitLocalEdit }
            );
            logCalendarOpen("localDraft", datedDraftForDate);
            applyLogDraftState(datedDraftForDate);
            logRestoreDecision(
                requestedDate,
                savedDraftForDate,
                datedDraftForDate,
                datedDraftForDate,
                localDraftIsRicher ? "local_draft_richer_than_saved" : "active_local_recording"
            );
            setScreen("log");
            return;
        }

        if (shouldUseSavedWorkout) {
            const cleanSavedDraft = withDraftDateMeta(requestedDate, savedDraftForDate, {
                source: "remote_supabase",
                remoteVerifiedAt: new Date().toISOString(),
                hasUnsavedChanges: false,
            });
            saveDraftForDate(requestedDate, cleanSavedDraft);
            logCalendarOpen("remoteSupabase", cleanSavedDraft);
            applyLogDraftState(cleanSavedDraft);
            logRestoreDecision(requestedDate, cleanSavedDraft, draftForDate, cleanSavedDraft, "supabase_saved_workout");
            setScreen("log");
            return;
        }

        if (hasDraftContent(draftForDate)) {
            if (localDraftIsRicher && !hasSavedWorkout) {
                console.warn("[restore] using richer local draft for date", {
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user?.id || null,
                    date: requestedDate,
                    local: localMetrics,
                    saved: savedMetrics,
                });
            }
            const datedDraftForDate = withDraftDateMeta(requestedDate, draftForDate, {
                source: draftForDate?.meta?.source || "local_draft",
                hasUnsavedChanges: draftForDate?.meta?.hasUnsavedChanges ?? true,
            });
            logCalendarOpen("localDraft", datedDraftForDate);
            applyLogDraftState(datedDraftForDate);
            logRestoreDecision(requestedDate, savedDraftForDate, datedDraftForDate, datedDraftForDate, localDraftIsRicher && !hasSavedWorkout ? "local_draft_richer_than_saved" : "local_draft");
        } else {
            const emptyDraft = withDraftDateMeta(requestedDate, { todayLabels: [], sessionEx: null, logData: {}, exerciseUnits: {} }, {
                source: "empty_draft",
                hasUnsavedChanges: false,
            });
            logCalendarOpen("emptyDraft", emptyDraft);
            applyLogDraftState(emptyDraft);
            logRestoreDecision(requestedDate, savedDraftForDate, draftForDate, { sessionEx: [] }, "empty");
        }

        setScreen("log");
    };


    // ② カレンダークリック用（分岐だけ）
    const handleCalendarDayOpen = (dateStr) => {
        handleLogForDate(dateStr);
    };

    const handleEditHistory = async (exName, updatedRecord, historyIdx) => {
        const editDate = String(updatedRecord?.date || "").slice(0, 10);
        markWorkoutContentChanged(editDate, "history_record_edit", { explicitEdit: true });

        const currentHistory = mergeHistoryMaps(latestHistoryRef.current || {});
        const recs = [...(currentHistory[exName] || [])];
        const idx = historyIdx !== undefined
            ? historyIdx
            : recs.findIndex(r => r.date === updatedRecord.date);
        const sanitizedRecord = sanitizeHistoryRecord(updatedRecord, { allowBodyweight: true });

        if (!sanitizedRecord) return;

        const recsWithoutSameDate = recs.filter((record, recordIndex) => {
            if (idx >= 0 && recordIndex === idx) return false;
            return String(record?.date || record?.workoutDate || record?.workout_date || "").slice(0, 10) !== editDate;
        });

        const nextHistory = {
            ...currentHistory,
            [exName]: [...recsWithoutSameDate, sanitizedRecord].sort((a, b) =>
                String(a?.date || "").localeCompare(String(b?.date || ""))
            ),
        };
        latestHistoryRef.current = nextHistory;
        setHistory(nextHistory);
        const nextWorkoutsDataHistory = applyLocalHistoryDates(
            workoutsDataHistoryRef.current || currentHistory,
            nextHistory,
            [editDate]
        );
        applyWorkoutsDataHistorySnapshot(nextWorkoutsDataHistory, {
            allowRegression: true,
            source: "workouts.data",
            reason: "history record edit",
            requestId: "history-record-edit",
            workoutsHistory: nextHistory,
        });
        persistHistoryForUser(user?.id, nextHistory);

        let directSyncSucceeded = false;
        if (user?.id && editDate) {
            try {
                const rowResult = await syncWorkoutRowsForDates(user.id, nextHistory, [editDate]);
                if (rowResult.failedDates.includes(editDate) || rowResult.skippedDates.includes(editDate)) {
                    throw new Error(`workouts sync did not apply ${editDate}`);
                }
                const sessionResult = await syncWorkoutSessionSnapshot(user.id, nextHistory, editDate);
                if (sessionResult?.skipped) {
                    throw new Error(`workout_sessions sync skipped ${editDate}`);
                }
                pendingWorkoutContentChangeDatesRef.current.delete(editDate);
                pendingWorkoutSessionSyncDatesRef.current.delete(editDate);
                explicitWorkoutEditDatesRef.current.delete(editDate);
                clearSyncFailure(editDate);
                const savedDraft = withDraftMeta(buildWorkoutDraftForDateFromHistory(editDate, nextHistory), {
                    source: "save_verified",
                    remoteVerifiedAt: new Date().toISOString(),
                    hasUnsavedChanges: false,
                });
                if (savedDraft.hasSavedWorkout) {
                    saveDraftForDate(editDate, savedDraft);
                    if (editDate === logDate) {
                        applyLogDraftState(savedDraft);
                    }
                }
                directSyncSucceeded = true;
            } catch (e) {
                recordSyncFailure(editDate, e, "history_edit");
                console.error("[handleEditHistory] direct sync failed", e);
            }
        }

        if (!directSyncSucceeded) queueWorkoutSessionSync(editDate);
    };

    const handleDeleteHistory = (exName, historyIdx, recordDate, setIdx) => {
        markWorkoutContentChanged(recordDate, setIdx !== undefined ? "set_delete" : "history_record_delete", { explicitDelete: true });
        let shouldClearDateArtifacts = false;
        let deletedTargetDate = recordDate;

        setHistory(prev => {
            const recs = [...(prev[exName] || [])];
            const idx = historyIdx !== undefined
                ? historyIdx
                : recs.findIndex(r => r.date === recordDate);

            if (idx < 0 || idx >= recs.length) return prev;
            const targetDate = recordDate || recs[idx]?.date;
            deletedTargetDate = targetDate;

            // セット単位削除
            if (setIdx !== undefined) {
                const target = recs[idx];
                const nextSets = sanitizeWorkoutSets(
                    (target.sets || []).filter((_, i) => i !== setIdx),
                    { allowBodyweight: true }
                );

                if (nextSets.length > 0) {
                    recs[idx] = {
                        ...target,
                        sets: nextSets,
                        weight: nextSets[0]?.weight === "BW" ? "BW" : Number(nextSets[0]?.weight || 0),
                        reps: Number(nextSets[0]?.reps || 0),
                    };
                    return { ...prev, [exName]: recs };
                }

                // セット全部消えたらその種目のその日記録ごと削除
                recs.splice(idx, 1);
                appendHistoryDeleteMarkers({
                    records: [buildHistoryRecordDeleteKey(targetDate, exName)],
                });

                if (!recs.length) {
                    const next = { ...prev };
                    delete next[exName];
                    shouldClearDateArtifacts = !Object.values(next).some((records) =>
                        (records || []).some((record) => record?.date === targetDate)
                    );
                    return next;
                }

                const next = { ...prev, [exName]: recs };
                shouldClearDateArtifacts = !Object.values(next).some((records) =>
                    (records || []).some((record) => record?.date === targetDate)
                );
                return next;
            }

            // 記録単位削除
            recs.splice(idx, 1);
            appendHistoryDeleteMarkers({
                records: [buildHistoryRecordDeleteKey(targetDate, exName)],
            });

            if (!recs.length) {
                const next = { ...prev };
                delete next[exName];
                shouldClearDateArtifacts = !Object.values(next).some((records) =>
                    (records || []).some((record) => record?.date === targetDate)
                );
                return next;
            }

            const next = { ...prev, [exName]: recs };
            shouldClearDateArtifacts = !Object.values(next).some((records) =>
                (records || []).some((record) => record?.date === targetDate)
            );
            return next;
        });

        if (shouldClearDateArtifacts && deletedTargetDate) {
            appendHistoryDeleteMarkers({ dates: [deletedTargetDate] });
            clearDraftForDate(deletedTargetDate);
            setSavedWorkoutDurationSecByDate((prev) => {
                if (!prev[deletedTargetDate]) return prev;
                const next = { ...prev };
                delete next[deletedTargetDate];
                return next;
            });
            if (summary?.date === deletedTargetDate) setSummary(null);
            if (workoutDayShareTarget?.workoutDate === deletedTargetDate) setWorkoutDayShareTarget(null);
            if (workoutStartedForDate === deletedTargetDate) resetWorkoutElapsedTimer();
            if (user?.id) {
                deleteRemoteWorkoutArtifactsForDate(user.id, deletedTargetDate)
                    .then(() => {
                        clearSyncFailure(deletedTargetDate);
                        setSessionSyncVersion((prev) => prev + 1);
                    })
                    .catch((error) => {
                        recordSyncFailure(deletedTargetDate, error, "delete_workout_artifacts");
                        console.error("workout date artifact delete failed", {
                            error,
                            userId: user.id,
                            workoutDate: deletedTargetDate,
                        });
                    });
            }
        }

        queueWorkoutSessionSync(recordDate);

        // ===== draft側も更新する =====
        const dateDraft = loadDraftForDate(recordDate);
        if (!hasDraftContent(dateDraft)) return;

        const draftLog = dateDraft.logData || {};
        const draftSession = dateDraft.sessionEx;
        const draftUnits = dateDraft.exerciseUnits || {};

        // その種目のdraftが無ければ終了
        if (!draftLog[exName]) return;

        let nextDraftLog = { ...draftLog };

        if (setIdx !== undefined) {
            const nextSets = (nextDraftLog[exName] || []).filter((_, i) => i !== setIdx);

            if (nextSets.length > 0) {
                nextDraftLog[exName] = nextSets;
            } else {
                delete nextDraftLog[exName];
            }
        } else {
            delete nextDraftLog[exName];
        }

        let nextDraftSession = draftSession;
        let nextDraftUnits = draftUnits;

        // その種目のセットが0になったら sessionEx / units からも消す
        if (!nextDraftLog[exName]) {
            if (Array.isArray(draftSession)) {
                nextDraftSession = draftSession.filter((ex) => ex.name !== exName);
            }

            if (draftUnits[exName] !== undefined) {
                nextDraftUnits = { ...draftUnits };
                delete nextDraftUnits[exName];
            }
        }

        saveDraftForDate(recordDate, {
            todayLabels: dateDraft.todayLabels,
            logData: nextDraftLog,
            sessionEx: nextDraftSession,
            exerciseUnits: nextDraftUnits,
        });

        // 今まさにその日を編集中なら画面状態にも反映
        if (logDate === recordDate) {
            applyLogDraftState({
                todayLabels: dateDraft.todayLabels,
                logData: nextDraftLog,
                sessionEx: nextDraftSession,
                exerciseUnits: nextDraftUnits,
            });
        }
    };

    const deleteAllHistoryForDate = (targetDate) => {
        const normalizedTargetDate = String(targetDate || "").trim();
        if (!normalizedTargetDate) return;
        markWorkoutContentChanged(normalizedTargetDate, "date_delete", { explicitDelete: true });

        const currentHistory = latestHistoryRef.current || history || {};
        const nextHistory = removeHistoryDate(currentHistory, normalizedTargetDate);
        const previousDraft = loadDraftForDate(normalizedTargetDate);
        const previousDurationSec = savedWorkoutDurationSecByDate[normalizedTargetDate] || 0;

        if (pendingDeleteUndoRef.current?.timeoutId) {
            window.clearTimeout(pendingDeleteUndoRef.current.timeoutId);
        }

        latestHistoryRef.current = nextHistory;
        historyRevisionRef.current += 1;
        persistHistoryForUser(user?.id, nextHistory);

        const recordMarkers = Object.entries(currentHistory || {})
            .filter(([, recs]) => (recs || []).some((record) => String(record?.date || "").slice(0, 10) === normalizedTargetDate))
            .map(([exName]) => buildHistoryRecordDeleteKey(normalizedTargetDate, exName));

        appendHistoryDeleteMarkers({
            dates: [normalizedTargetDate],
            records: recordMarkers,
        });

        setHistory(nextHistory);
        queueWorkoutSessionSync(normalizedTargetDate);
        pendingWorkoutSessionSyncDatesRef.current.delete(normalizedTargetDate);

        // その日が今の編集中なら画面上の状態も消す
        if (logDate === normalizedTargetDate) {
            applyLogDraftState({ todayLabels: [], logData: {}, sessionEx: null, exerciseUnits: {} });
        }

        // その日のdraftも消す
        clearDraftForDate(normalizedTargetDate);
        setSavedWorkoutDurationSecByDate((prev) => {
            if (!prev[normalizedTargetDate]) return prev;
            const next = { ...prev };
            delete next[normalizedTargetDate];
            return next;
        });
        if (summary?.date === normalizedTargetDate) setSummary(null);
        if (workoutDayShareTarget?.workoutDate === normalizedTargetDate) setWorkoutDayShareTarget(null);
        if (workoutStartedForDate === normalizedTargetDate) resetWorkoutElapsedTimer();

        const remoteDelete = () => {
            if (!user?.id) return;

            deleteRemoteWorkoutArtifactsForDate(user.id, normalizedTargetDate, nextHistory)
                .then(() => {
                    clearSyncFailure(normalizedTargetDate);
                    refreshHistorySyncDiagnostic(user.id, nextHistory, {
                        prefix: normalizedTargetDate.slice(0, 7),
                    });
                    setSessionSyncVersion((prev) => prev + 1);
                })
                .catch((error) => {
                    recordSyncFailure(normalizedTargetDate, error, "delete_workout_artifacts");
                    console.error("workout date artifact delete failed", {
                        error,
                        userId: user.id,
                        workoutDate: normalizedTargetDate,
                    });
                });
        };

        remoteDelete();
        const timeoutId = window.setTimeout(() => {
            pendingDeleteUndoRef.current = null;
            setPendingDeleteUndo(null);
        }, 6500);
        const undoState = {
            date: normalizedTargetDate,
            previousHistory: currentHistory,
            previousDraft,
            previousDurationSec,
            timeoutId,
        };
        pendingDeleteUndoRef.current = undoState;
        setPendingDeleteUndo({
            date: normalizedTargetDate,
        });
    };

    const undoDeleteAllHistoryForDate = useCallback(() => {
        const pending = pendingDeleteUndoRef.current;
        if (!pending?.date) return;

        if (pending.timeoutId) window.clearTimeout(pending.timeoutId);
        pendingDeleteUndoRef.current = null;
        setPendingDeleteUndo(null);

        latestHistoryRef.current = pending.previousHistory || {};
        historyRevisionRef.current += 1;
        persistHistoryForUser(user?.id, latestHistoryRef.current);
        setHistory(latestHistoryRef.current);
        commitHistoryDeleteMarkers({
            dates: (historyDeleteMarkersRef.current?.dates || []).filter((date) => date !== pending.date),
            records: (historyDeleteMarkersRef.current?.records || []).filter((key) => !String(key || "").startsWith(`${pending.date}::`)),
        });

        saveDraftForDate(pending.date, pending.previousDraft || {});
        if (logDate === pending.date) {
            applyLogDraftState(pending.previousDraft || {
                todayLabels: [],
                logData: {},
                sessionEx: null,
                exerciseUnits: {},
            });
        }

        if (pending.previousDurationSec > 0) {
            setSavedWorkoutDurationSecByDate((prev) => ({
                ...prev,
                [pending.date]: pending.previousDurationSec,
            }));
        }
        queueWorkoutSessionSync(pending.date);
        if (user?.id) {
            syncWorkoutRowsForDates(user.id, latestHistoryRef.current, [pending.date], {
                [pending.date]: pending.previousDurationSec,
            })
                .then(() => syncWorkoutSessionSnapshot(user.id, latestHistoryRef.current, pending.date))
                .then(() => clearSyncFailure(pending.date))
                .catch((error) => {
                    recordSyncFailure(pending.date, error, "undo_delete_restore");
                    console.error("undo delete restore sync failed", error);
                });
        }
    }, [
        applyLogDraftState,
        clearSyncFailure,
        commitHistoryDeleteMarkers,
        historyDeleteMarkersRef,
        historyRevisionRef,
        latestHistoryRef,
        logDate,
        pendingDeleteUndoRef,
        persistHistoryForUser,
        queueWorkoutSessionSync,
        recordSyncFailure,
        saveDraftForDate,
        setHistory,
        setPendingDeleteUndo,
        setSavedWorkoutDurationSecByDate,
        syncWorkoutRowsForDates,
        syncWorkoutSessionSnapshot,
        user?.id,
    ]);

    return {
        handleEditHistory,
        handleDeleteHistory,
        deleteAllHistoryForDate,
        handleCalendarDayOpen,
        handleLogForDate,
        undoDeleteAllHistoryForDate,
    };
}
