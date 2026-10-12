import { useCallback } from "react";
import {
    getValidWorkoutDatesFromHistory,
    mergeHistoryMaps,
    sanitizeHistoryRecord,
    sanitizeWorkoutSets,
} from "../utils/helpers";
import { addPersistentDeletedDate, loadPersistentDeletedDates, removePersistentDeletedDate } from "../utils/appHelpers";
import { logWriteTrace } from "../utils/writeTrace";

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
    trustedWorkoutRowsRef,
    applyTrustedSessionRowsSnapshot,
    trustedSessionRows,
    onPersistentDeleteChanged = null,
    pendingSavePayloadsRef,
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
    trustedHistory,
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
    onDeleteDateClearCompletion,
    invalidateSupabaseFetchFreshByPrefix,
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
            buildSavedWorkoutDraftForDate(requestedDate, trustedHistory),
            {
                source: "canonical_display_history",
                hasUnsavedChanges: false,
                contentOrigin: "remote",
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
        const hasPendingDeleteIntent = Boolean(pendingChange?.explicitDelete);
        const shouldUseSavedWorkout = hasSavedWorkout && !shouldUseLocalDraft && !hasPendingDeleteIntent;
        const logCalendarOpen = (appliedSource, loadedDraft) => {
            const loadedHistoryDates = getValidWorkoutDatesFromHistory(trustedHistory)
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
            // Zombie check: a draft that claims hasUnsavedChanges:true but was NOT written
            // by an actual useWorkoutLog user-edit (source "useWorkoutLog:*") is a zombie —
            // stale restore labels ("autosave_draft", "active_local_recording_restore", …).
            // Exception: isActiveLocalRecording means the timer is running right now on this
            // exact date, so we must always preserve it.
            const isGenuineUnsaved = isActiveLocalRecording || isUnsavedUserWorkoutDraft(draftForDate);
            if (!isGenuineUnsaved) {
                clearDraftForDate(requestedDate);
                const zombieEmptyDraft = withDraftDateMeta(requestedDate, {
                    todayLabels: [], sessionEx: null, logData: {}, exerciseUnits: {},
                }, { source: "explicit_date_nav", hasUnsavedChanges: false });
                console.log("[restore] zombie draft cleared on calendar open", {
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user?.id || null,
                    date: requestedDate,
                    source: draftForDate?.meta?.source || null,
                    localSetCount: localMetrics.setCount,
                });
                logCalendarOpen("emptyDraft", zombieEmptyDraft);
                applyLogDraftState(zombieEmptyDraft);
                logRestoreDecision(requestedDate, savedDraftForDate, draftForDate, { sessionEx: [] }, "zombie_draft_cleared");
                setScreen("log");
                return;
            }

            const datedDraftForDate = withDraftDateMeta(requestedDate, draftForDate, {
                source: "explicit_date_nav",
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
            // Do NOT call markWorkoutContentChanged here.
            // local_draft_richer_restore / active_local_recording_restore are display-only
            // restores; marking them as pending writes (especially with explicitEdit:true)
            // causes the OR-merge in markWorkoutContentChanged to poison subsequent save
            // guards for the session — even after an explicit delete sets explicitEdit:false.
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

        // Gate A: block content restoration for persistently deleted dates.
        // Exceptions: skip the block if the user has a pending edit (re-creating the workout)
        // or an unsaved user draft in localStorage — wiping those would cause data loss.
        {
            const _persistentDeleted = loadPersistentDeletedDates(user?.id);
            if (_persistentDeleted[requestedDate]) {
                // (i) pendingChange exists AND is NOT an explicit full-date delete.
                // explicitDelete OR-merges and never drops back to false on its own, so we
                // use deleteScope (reset to null when explicitEdit=true fires) instead.
                // Same logic as useHistorySync._datesToStrip condition.
                const _hasPendingUserEdit = Boolean(
                    pendingChange &&
                    !(pendingChange.explicitDelete === true && pendingChange.deleteScope === "date")
                );
                // (ii) localStorage has an unsaved user-typed draft for this date
                const _hasUnsavedUserDraft = isUnsavedUserWorkoutDraft(draftForDate);
                if (_hasPendingUserEdit) {
                    console.log("[WP] restore:persistentDeleteSkipped", {
                        date: requestedDate,
                        caller: "handleLogForDate",
                        reason: "pending-user-edit",
                        explicitDelete: pendingChange.explicitDelete,
                        explicitEdit: pendingChange.explicitEdit,
                    });
                } else if (_hasUnsavedUserDraft) {
                    console.log("[WP] restore:persistentDeleteSkipped", {
                        date: requestedDate,
                        caller: "handleLogForDate",
                        reason: "unsaved-user-draft",
                        draftSource: draftForDate?.meta?.source,
                    });
                } else {
                    const _emptyDraft = withDraftDateMeta(requestedDate, {
                        todayLabels: [],
                        sessionEx: null,
                        logData: {},
                        exerciseUnits: {},
                    }, { source: "explicit_date_nav", hasUnsavedChanges: false });
                    console.log("[WP] restore:blockedByPersistentDelete", {
                        date: requestedDate,
                        caller: "handleLogForDate:shouldUseSavedWorkout",
                        source: "explicit_date_nav",
                        exerciseCount: (savedDraftForDate?.sessionEx ?? []).length,
                        deletedAt: _persistentDeleted[requestedDate],
                    });
                    applyLogDraftState(_emptyDraft);
                    setScreen("log");
                    return;
                }
            }
        }

        if (shouldUseSavedWorkout) {
            const cleanSavedDraft = withDraftDateMeta(requestedDate, savedDraftForDate, {
                source: "explicit_date_nav",
                contentOrigin: "remote",
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

        if (hasDraftContent(draftForDate) && localDraftHasUnsavedChanges) {
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
                source: "explicit_date_nav",
                hasUnsavedChanges: draftForDate?.meta?.hasUnsavedChanges ?? true,
            });
            logCalendarOpen("localDraft", datedDraftForDate);
            applyLogDraftState(datedDraftForDate);
            logRestoreDecision(requestedDate, savedDraftForDate, datedDraftForDate, datedDraftForDate, localDraftIsRicher && !hasSavedWorkout ? "local_draft_richer_than_saved" : "local_draft");
        } else {
            const emptyDraft = withDraftDateMeta(requestedDate, { todayLabels: [], sessionEx: null, logData: {}, exerciseUnits: {} }, {
                source: "explicit_date_nav",
                hasUnsavedChanges: false,
            });
            if (hasDraftContent(draftForDate) && !localDraftHasUnsavedChanges) {
                // Phantom draft: has content but no unsaved changes and no remote data.
                // Fully remove it from storage (keys deleted, not overwritten) so it
                // cannot resurface via loadDraftForDate on any subsequent visit.
                clearDraftForDate(requestedDate);
                console.log("[restore] phantom draft cleared from storage", {
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user?.id || null,
                    date: requestedDate,
                    source: draftForDate?.meta?.source || null,
                    localSetCount: localMetrics.setCount,
                });
            }
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
        persistHistoryForUser(user?.id, nextHistory, { source: "useHistoryHandlers:editRecord" });

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
                const _qbHistHandler = pendingWorkoutContentChangeDatesRef.current.size;
                pendingWorkoutContentChangeDatesRef.current.delete(editDate);
                logWriteTrace("syncQueue:delete", {
                    date: editDate,
                    decision: "executed",
                    reason: "history handler sync success",
                    extra: {
                        queueSizeBefore: _qbHistHandler,
                        queueSizeAfter: pendingWorkoutContentChangeDatesRef.current.size,
                        queueDatesAfter: [...pendingWorkoutContentChangeDatesRef.current.keys()],
                    },
                });
                pendingWorkoutSessionSyncDatesRef.current.delete(editDate);
                explicitWorkoutEditDatesRef.current.delete(editDate);
                clearSyncFailure(editDate);
                const savedDraft = withDraftMeta(buildWorkoutDraftForDateFromHistory(editDate, nextHistory), {
                    source: "save_verified",
                    remoteVerifiedAt: new Date().toISOString(),
                    hasUnsavedChanges: false,
                    contentOrigin: "remote",
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

    // trustedWorkoutRows と trustedSessionRows から指定日の行を除去する共通ヘルパー。
    // buildTrustedHistory の exactHistory 上書き（forceReplace:true）および
    // session fallback（onlyIfMissing:true）による再注入を防ぐ。
    // 日付のすべての exercise が消えた時点で呼ぶこと。部分削除（exercise が残る場合）には呼ばない。
    const _clearTrustedRowsForDate = (normalizedDate) => {
        if (!normalizedDate) return;

        const _wBefore = (trustedWorkoutRowsRef?.current || []).length;
        const _wFiltered = (trustedWorkoutRowsRef?.current || []).filter(
            (row) => String(row?.date || "").slice(0, 10) !== normalizedDate
        );
        const _wRemoved = _wBefore - _wFiltered.length;
        if (_wRemoved > 0) {
            applyTrustedWorkoutRowsSnapshot(_wFiltered, { replace: true, source: "date_empty", skipPendingFilter: true });
        }

        if (applyTrustedSessionRowsSnapshot) {
            const _sBefore = (trustedSessionRows || []).length;
            const _sFiltered = (trustedSessionRows || []).filter(
                (row) => String(row?.workout_date || row?.date || "").slice(0, 10) !== normalizedDate
            );
            const _sRemoved = _sBefore - _sFiltered.length;
            if (_sRemoved > 0) {
                applyTrustedSessionRowsSnapshot(_sFiltered, { replace: true, source: "date_empty" });
            }
            console.log("[WP] clearTrustedRowsForDate", {
                date: normalizedDate,
                workoutRowsRemoved: _wRemoved,
                sessionRowsRemoved: _sRemoved,
            });
        }
    };

    // 記録画面 × とカレンダー画面 × の共通削除処理。
    // C3（history）更新・削除マーカー・shouldClearDateArtifacts・アーティファクトクリアを行う。
    // markWorkoutContentChanged は呼び出し側が行うこと。
    const applyExerciseDeleteToHistory = (targetDate, exName) => {
        const normalizedDate = String(targetDate || "").slice(0, 10);
        if (!normalizedDate || !exName) return;

        let shouldClearDateArtifacts = false;

        setHistory(prev => {
            const recs = [...(prev[exName] || [])];
            const idx = recs.findIndex(r => r.date === normalizedDate);
            if (idx < 0) return prev;

            recs.splice(idx, 1);
            appendHistoryDeleteMarkers({
                records: [buildHistoryRecordDeleteKey(normalizedDate, exName)],
            });

            let next;
            if (!recs.length) {
                next = { ...prev };
                delete next[exName];
            } else {
                next = { ...prev, [exName]: recs };
            }

            shouldClearDateArtifacts = !Object.values(next).some((records) =>
                (records || []).some((record) => record?.date === normalizedDate)
            );
            return next;
        });

        // 部分削除でも trustedRows からこの日付の行を除去する。
        // buildTrustedHistory が forceReplace:true で exactHistory を上書きするため、
        // 行を残すと削除済みの exercise が復活する（zombie restore）。
        _clearTrustedRowsForDate(normalizedDate);

        if (shouldClearDateArtifacts) {
            appendHistoryDeleteMarkers({ dates: [normalizedDate] });
            clearDraftForDate(normalizedDate);
            setSavedWorkoutDurationSecByDate((prev) => {
                if (!prev[normalizedDate]) return prev;
                const next = { ...prev };
                delete next[normalizedDate];
                return next;
            });
            if (summary?.date === normalizedDate) setSummary(null);
            if (workoutDayShareTarget?.workoutDate === normalizedDate) setWorkoutDayShareTarget(null);
            if (workoutStartedForDate === normalizedDate) resetWorkoutElapsedTimer();
            if (user?.id) {
                deleteRemoteWorkoutArtifactsForDate(user.id, normalizedDate)
                    .then(() => {
                        clearSyncFailure(normalizedDate);
                        setSessionSyncVersion((prev) => prev + 1);
                    })
                    .catch((error) => {
                        recordSyncFailure(normalizedDate, error, "delete_workout_artifacts");
                        console.error("workout date artifact delete failed", {
                            error,
                            userId: user.id,
                            workoutDate: normalizedDate,
                        });
                    });
            }
        }
    };

    const handleDeleteHistory = (exName, historyIdx, recordDate, setIdx) => {
        markWorkoutContentChanged(recordDate, setIdx !== undefined ? "set_delete" : "history_record_delete", { explicitDelete: true, deleteScope: "partial" });

        if (setIdx !== undefined) {
            // セット単位削除: まずセット数を確認して更新する
            let exerciseBecameEmpty = false;
            let setRemovedDate = recordDate;

            setHistory(prev => {
                const recs = [...(prev[exName] || [])];
                const idx = historyIdx !== undefined
                    ? historyIdx
                    : recs.findIndex(r => r.date === recordDate);
                if (idx < 0 || idx >= recs.length) return prev;
                const targetDate = recordDate || recs[idx]?.date;
                setRemovedDate = targetDate;

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

                // セットが全部消えた → applyExerciseDeleteToHistory で種目ごと削除
                exerciseBecameEmpty = true;
                return prev;
            });

            if (exerciseBecameEmpty) {
                // 種目が空になった: 共通削除処理へ
                applyExerciseDeleteToHistory(setRemovedDate, exName);
            } else {
                // セットが残っている: trustedRows だけクリア（zombie restore 防止）
                _clearTrustedRowsForDate(String(setRemovedDate || "").slice(0, 10));
            }
        } else {
            // 記録単位削除: 共通削除処理
            applyExerciseDeleteToHistory(recordDate, exName);
        }

        queueWorkoutSessionSync(recordDate);

        // ===== draft側も更新する =====
        const dateDraft = loadDraftForDate(recordDate);
        if (!hasDraftContent(dateDraft)) return;

        const draftLog = dateDraft.logData || {};
        const draftSession = dateDraft.sessionEx;
        const draftUnits = dateDraft.exerciseUnits || {};

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
        markWorkoutContentChanged(normalizedTargetDate, "date_delete", { explicitDelete: true, deleteScope: "date" });

        const currentHistory = latestHistoryRef.current || history || {};
        const nextHistory = removeHistoryDate(currentHistory, normalizedTargetDate);

        const _beforeEntries = Object.entries(currentHistory || {}).filter(
            ([, recs]) => (recs || []).some((r) => String(r?.date || "").slice(0, 10) === normalizedTargetDate)
        );
        const _beforeExerciseCount = _beforeEntries.length;
        const _beforeSetCount = _beforeEntries.reduce((sum, [, recs]) => {
            const rec = recs.find((r) => String(r?.date || "").slice(0, 10) === normalizedTargetDate);
            return sum + (rec?.sets?.length || 0);
        }, 0);
        logWriteTrace("deleteAllHistory", {
            date: normalizedTargetDate,
            decision: "marked_for_queue_delete",
            reason: "date_delete",
            beforeExerciseCount: _beforeExerciseCount,
            beforeSetCount: _beforeSetCount,
            queueSizeAfter: pendingWorkoutContentChangeDatesRef.current.size,
        });
        const previousDraft = loadDraftForDate(normalizedTargetDate);
        const previousDurationSec = savedWorkoutDurationSecByDate[normalizedTargetDate] || 0;

        if (pendingDeleteUndoRef.current?.timeoutId) {
            window.clearTimeout(pendingDeleteUndoRef.current.timeoutId);
        }

        latestHistoryRef.current = nextHistory;
        historyRevisionRef.current += 1;
        persistHistoryForUser(user?.id, nextHistory, { source: "useHistoryHandlers:deleteRecord" });

        const recordMarkers = Object.entries(currentHistory || {})
            .filter(([, recs]) => (recs || []).some((record) => String(record?.date || "").slice(0, 10) === normalizedTargetDate))
            .map(([exName]) => buildHistoryRecordDeleteKey(normalizedTargetDate, exName));

        appendHistoryDeleteMarkers({
            dates: [normalizedTargetDate],
            records: recordMarkers,
        });

        // Record in the persistent deleted-dates list (survives restarts, 30-day TTL).
        // This is separate from the short-lived delete markers (120 s TTL) used for
        // in-flight race prevention. The persistent list prevents startup reconcile from
        // treating the deleted date as "unsynced local" and adding it back to mergedHistory.
        const _persistentDeleteList = addPersistentDeletedDate(user?.id, normalizedTargetDate);
        onPersistentDeleteChanged?.();
        console.log("[WP] deleteAllHistory:persistentDeleteRecorded", {
            date: normalizedTargetDate,
            listSize: Object.keys(_persistentDeleteList || {}).length,
        });

        setHistory(nextHistory);
        const nextWorkoutsDataHistory = applyLocalHistoryDates(
            workoutsDataHistoryRef.current || currentHistory,
            nextHistory,
            [normalizedTargetDate]
        );
        applyWorkoutsDataHistorySnapshot(nextWorkoutsDataHistory, {
            allowRegression: true,
            source: "workouts.data",
            reason: "date_delete",
            requestId: "delete-date",
            workoutsHistory: nextHistory,
        });

        // pendingSavePayloadsRef から削除対象日のエントリを消す。
        // persistCurrentLog（400ms debounce）が削除前の内容を書き込んでいた場合、
        // syncWorkoutRowsForDates がその stale payload を優先して upsert を実行してしまう。
        // Map.delete() でエントリを消すことで normalizedHistoryMap へのフォールバックを効かせる。
        const _hadPayload = pendingSavePayloadsRef?.current?.has(normalizedTargetDate) ?? false;
        const _stalePayload = _hadPayload ? pendingSavePayloadsRef.current.get(normalizedTargetDate) : null;
        const _clearedExerciseCount = _stalePayload
            ? Object.entries(_stalePayload || {}).filter(([, recs]) =>
                (recs || []).some((r) => String(r?.date || "").slice(0, 10) === normalizedTargetDate)
            ).length
            : 0;
        if (_hadPayload) {
            pendingSavePayloadsRef.current.delete(normalizedTargetDate);
        }
        console.log("[WP] deleteAllHistory:pendingPayloadCleared", {
            date: normalizedTargetDate,
            hadPayload: _hadPayload,
            clearedExerciseCount: _clearedExerciseCount,
        });

        queueWorkoutSessionSync(normalizedTargetDate);

        // trustedWorkoutRows と trustedSessionRows から削除対象日の行を取り除く。
        // 詳細は _clearTrustedRowsForDate のコメントを参照。
        _clearTrustedRowsForDate(normalizedTargetDate);

        // その日が今の編集中なら画面上の状態も消す。
        // meta.source を "explicit_date_nav" にすることで useWorkoutLog の
        // hasUnsavedChanges ガードを回避し、未保存編集中でも必ず exercises をクリアする。
        // （ガード条件: prevDraft.hasUnsavedChanges && source !== "explicit_date_nav"）
        const _latestLogDraftDate = normalizeDraftDateKey(
            latestLogDraftRef.current?.meta?.date || latestLogDraftRef.current?.date
        );
        const _clearedCurrentView = _latestLogDraftDate === normalizedTargetDate || logDate === normalizedTargetDate;
        if (_clearedCurrentView) {
            applyLogDraftState({
                todayLabels: [],
                logData: {},
                sessionEx: null,
                exerciseUnits: {},
                meta: { source: "explicit_date_nav", hasUnsavedChanges: false },
            });
        }
        console.log("[WP] deleteAllHistory:latestLogDraftCleared", {
            targetDate: normalizedTargetDate,
            refDate: _latestLogDraftDate,
            logDate,
            cleared: _clearedCurrentView,
        });
        console.log("[WP] deleteAllHistory:displayCleared", {
            date: normalizedTargetDate,
            clearedCurrentView: _clearedCurrentView,
            reason: _clearedCurrentView
                ? "deleted date matches current logDate or latestLogDraftRef — display state cleared synchronously"
                : "deleted date does not match current logDate — display unchanged",
        });

        // その日のdraftを空ドラフトで上書きする。
        // clearDraftForDate の代わりに空ドラフトを書き、削除の意図を記録する。
        // 再起動後に loadDraftForDate が contentOrigin:"empty" を返さなくなり、
        // payloadSource="draft" が選ばれて G15 を迂回せず削除が完了する。
        saveDraftForDate(normalizedTargetDate, {
            sessionEx: [],
            logData: {},
            exerciseUnits: {},
            todayLabels: [],
            meta: {
                source: "date_delete",
                hasUnsavedChanges: false,
                explicitDelete: true,
            },
        });

        // display_history 系 fetch の freshness キャッシュを無効化する。
        // 削除後に runDedupeSupabaseFetch が "fresh skip" で弾かれ、カレンダーや
        // 履歴画面の表示が更新されないままになるのを防ぐ。
        // 強制フェッチは行わず、「次の更新要求が来たときに skip されない」状態にするだけ。
        {
            const _screens = ["calendar", "log", "history"];
            const _invalidatedKeys = [];
            if (invalidateSupabaseFetchFreshByPrefix) {
                for (const _screen of _screens) {
                    const _prefix = `display_history:${_screen}:${user?.id}:`;
                    const _keys = invalidateSupabaseFetchFreshByPrefix(_prefix);
                    _invalidatedKeys.push(..._keys);
                }
            }
            console.log("[WP] deleteAllHistory:displayFreshnessInvalidated", {
                date: normalizedTargetDate,
                invalidatedKeys: _invalidatedKeys,
            });
        }

        setSavedWorkoutDurationSecByDate((prev) => {
            if (!prev[normalizedTargetDate]) return prev;
            const next = { ...prev };
            delete next[normalizedTargetDate];
            return next;
        });
        if (summary?.date === normalizedTargetDate) setSummary(null);
        if (workoutDayShareTarget?.workoutDate === normalizedTargetDate) setWorkoutDayShareTarget(null);
        if (workoutStartedForDate === normalizedTargetDate) resetWorkoutElapsedTimer();

        // 完了状態を解除（pump_completed_workout_dates + AIプラン completedDates）
        try {
            const COMPLETED_KEY = "pump_completed_workout_dates";
            const stored = JSON.parse(localStorage.getItem(COMPLETED_KEY) || "{}");
            if (stored[normalizedTargetDate]) {
                delete stored[normalizedTargetDate];
                localStorage.setItem(COMPLETED_KEY, JSON.stringify(stored));
            }
        } catch {}
        onDeleteDateClearCompletion?.(normalizedTargetDate);

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
        persistHistoryForUser(user?.id, latestHistoryRef.current, { source: "useHistoryHandlers:undoDelete" });
        setHistory(latestHistoryRef.current);
        commitHistoryDeleteMarkers({
            dates: (historyDeleteMarkersRef.current?.dates || []).filter((date) => date !== pending.date),
            records: (historyDeleteMarkersRef.current?.records || []).filter((key) => !String(key || "").startsWith(`${pending.date}::`)),
        });

        // Remove from persistent deleted-dates list so Gate A/Gate B no longer block this date.
        // Without this, navigating away and back would show an empty screen for the restored date.
        removePersistentDeletedDate(user?.id, pending.date);
        onPersistentDeleteChanged?.();
        // Restore the draft to its pre-delete state.
        // previousDraft is captured by loadDraftForDate before the delete fires.
        // If it is null (user never opened the date in this session), the draft did not
        // exist before the delete, so we delete the key rather than writing {} — an empty
        // object becomes a usable draft after Change B and would cause the undo-synced
        // payload to be empty, silently re-deleting the restored workout.
        if (pending.previousDraft) {
            saveDraftForDate(pending.date, pending.previousDraft);
        } else {
            clearDraftForDate(pending.date);
        }
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
        onPersistentDeleteChanged,
        pendingDeleteUndoRef,
        persistHistoryForUser,
        clearDraftForDate,
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
        applyExerciseDeleteToHistory,
    };
}
