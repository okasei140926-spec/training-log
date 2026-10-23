import { useEffect, useRef } from "react";
import { supabase } from "../utils/supabase";
import { trackRestoreAttempt, getRestoreLoopSuppressionRemainingSec, getRestoreAttempts } from "../utils/writeTrace";
import {
    fetchWorkoutRowFromWorkoutsData as fetchWorkoutRowForDateFromRepository,
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
    loadPersistentDeletedDates,
    logRecordFetchError,
    normalizeDraftDateKey,
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
    persistHistoryForUser,
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
    clearDraftForDate,
    setHistory,
    setHistoryLoadError,
    getCurrentHistoryDeleteMarkers,
    getHistoryDeleteMarkerDebugInfo = null,
    bodyWeightKg = null,
}) {
    // bodyWeightKg is intentionally read via a ref so changes to body weight
    // do not re-trigger the Supabase date-refresh effect (see ■1 comment below).
    const _bodyWeightKgRef = useRef(bodyWeightKg);
    _bodyWeightKgRef.current = bodyWeightKg;

    // Tracks the last timestamp at which a phantom draft was cleared per date,
    // so we can suppress duplicate log entries and avoid clearing the same date
    // twice within a short window even if the effect fires multiple times rapidly.
    const lastPhantomClearedRef = useRef({});

    // ■1: Latest-callback refs — updated every render so the effect body always
    // calls the current implementation without those functions appearing in the
    // dep array. Removing them from deps stops the 1-second loop where:
    //   setInterval(syncElapsed,1000) → setWorkoutElapsedSec (state)
    //   → re-render → applyCurrentLogDraft new ref (deps: todayLabels/logData/…)
    //   → useLogDateRefresh effect re-fires → Supabase fetch → loop.
    const _applyCurrentLogDraftRef            = useRef(applyCurrentLogDraft);
    const _buildSavedWorkoutDraftForDateRef   = useRef(buildSavedWorkoutDraftForDate);
    const _getExUnitRef                       = useRef(getExUnit);
    const _applyTrustedWorkoutRowsSnapshotRef = useRef(applyTrustedWorkoutRowsSnapshot);
    const _applyTrustedSessionRowsSnapshotRef = useRef(applyTrustedSessionRowsSnapshot);
    const _applyWorkoutsDataHistorySnapshotRef= useRef(applyWorkoutsDataHistorySnapshot);
    const _applyLocalHistoryDatesRef          = useRef(applyLocalHistoryDates);
    const _clearDraftForDateRef               = useRef(clearDraftForDate);
    const _loadDraftForDateRef                = useRef(loadDraftForDate);
    const _markWorkoutContentChangedRef       = useRef(markWorkoutContentChanged);
    const _setHistoryLoadErrorRef             = useRef(setHistoryLoadError);
    // Keep refs current on every render (ref updates never trigger re-renders):
    _applyCurrentLogDraftRef.current            = applyCurrentLogDraft;
    _buildSavedWorkoutDraftForDateRef.current   = buildSavedWorkoutDraftForDate;
    _getExUnitRef.current                       = getExUnit;
    _applyTrustedWorkoutRowsSnapshotRef.current = applyTrustedWorkoutRowsSnapshot;
    _applyTrustedSessionRowsSnapshotRef.current = applyTrustedSessionRowsSnapshot;
    _applyWorkoutsDataHistorySnapshotRef.current= applyWorkoutsDataHistorySnapshot;
    _applyLocalHistoryDatesRef.current          = applyLocalHistoryDates;
    _clearDraftForDateRef.current               = clearDraftForDate;
    _loadDraftForDateRef.current                = loadDraftForDate;
    _markWorkoutContentChangedRef.current       = markWorkoutContentChanged;
    _setHistoryLoadErrorRef.current             = setHistoryLoadError;

    // ■2: Refs for effect-fired log — tracks previous dep values to name changed dep(s).
    const _dateRefreshPrevDepsRef  = useRef({ logDate: null, userId: null, historySyncReady: null, screen: null });
    const _dateRefreshLastFiredRef = useRef(0);

    useEffect(() => {
        // ■2: Log every invocation so 1-second looping is immediately visible.
        {
            const _now = Date.now();
            const _prev = _dateRefreshPrevDepsRef.current;
            const _changed = [];
            if (_prev.logDate !== logDate) _changed.push("logDate");
            if (_prev.userId !== user?.id) _changed.push("userId");
            if (_prev.historySyncReady !== historySyncReady) _changed.push("historySyncReady");
            if (_prev.screen !== screen) _changed.push("screen");
            const _elapsedMs = _dateRefreshLastFiredRef.current ? _now - _dateRefreshLastFiredRef.current : null;
            _dateRefreshPrevDepsRef.current = { logDate, userId: user?.id, historySyncReady, screen };
            _dateRefreshLastFiredRef.current = _now;
            console.log("[WP] dateRefresh:effect-fired", {
                date: String(logDate || "").slice(0, 10),
                changedDeps: _changed,
                elapsedMs: _elapsedMs,
            });
        }

        // ■1: Read latest callbacks from refs so the effect always uses current
        // implementations without re-firing on every reference change.
        const applyCurrentLogDraft           = _applyCurrentLogDraftRef.current;
        const buildSavedWorkoutDraftForDate  = _buildSavedWorkoutDraftForDateRef.current;
        const getExUnit                      = _getExUnitRef.current;
        const applyTrustedWorkoutRowsSnapshot= _applyTrustedWorkoutRowsSnapshotRef.current;
        const applyTrustedSessionRowsSnapshot= _applyTrustedSessionRowsSnapshotRef.current;
        const applyWorkoutsDataHistorySnapshot= _applyWorkoutsDataHistorySnapshotRef.current;
        const applyLocalHistoryDates         = _applyLocalHistoryDatesRef.current;
        const clearDraftForDate              = _clearDraftForDateRef.current;
        const loadDraftForDate               = _loadDraftForDateRef.current;
        const markWorkoutContentChanged      = _markWorkoutContentChangedRef.current;
        const setHistoryLoadError            = _setHistoryLoadErrorRef.current;
        // history is accessed via latestHistoryRef.current (ref param, always current).
        const history                        = latestHistoryRef.current || {};

        if (screen !== "log" || !user?.id || !historySyncReady || !logDate) return;
        const normalizedDate = String(logDate || "").slice(0, 10);
        if (!normalizedDate) return;
        if (pendingWorkoutContentChangeDatesRef.current.has(normalizedDate)) {
            const pendingChange = pendingWorkoutContentChangeDatesRef.current.get(normalizedDate);
            // When an explicit delete is pending, localStorage still holds the pre-delete
            // draft (A-1 hasn't fired yet). Applying that stale draft would restore the
            // deleted exercise and race with the correct in-flight save.
            if (!pendingChange?.explicitDelete) {
                // Supabase fetch はスキップするが、ローカルドラフトを必ず適用する。
                // handleLogForDate 内の applyLogDraftState は stale closure でブロックされるため、
                // この effect が唯一の適用ルートになる。return だけだと画面が前の日付のデータを
                // 表示し続けるバグが発生する（今日の記録が消えたように見える）。
                const localDraft = loadDraftForDate(normalizedDate);
                const draftDate = normalizeDraftDateKey(localDraft?.meta?.date || localDraft?.meta?.keyDate || "");
                const draftDateMatches = !draftDate || draftDate === normalizedDate;
                const hasContent = draftDateMatches && (
                    localDraft?.sessionEx !== null ||
                    Object.keys(localDraft?.logData || {}).length > 0 ||
                    Object.keys(localDraft?.exerciseUnits || {}).length > 0 ||
                    (localDraft?.todayLabels || []).length > 0
                );
                if (hasContent) {
                    // persist:false — the draft is already in localStorage; re-saving via
                    // applyCurrentLogDraft(persist=true) would let a stale regression-guard
                    // return value overwrite the new date's key with old content.
                    // forDate: ensures the stale-closure guard fires if logDate has changed.
                    applyCurrentLogDraft(withDraftDateMeta(normalizedDate, localDraft, {
                        source: localDraft?.meta?.source || "pending_draft_restore",
                        hasUnsavedChanges: localDraft?.meta?.hasUnsavedChanges ?? true,
                    }), { persist: false, forDate: normalizedDate });
                } else {
                    // No valid draft for this date — force clear any stale display
                    applyCurrentLogDraft(withDraftDateMeta(normalizedDate, {
                        todayLabels: [], sessionEx: null, logData: {}, exerciseUnits: {},
                    }, { source: "explicit_date_nav", hasUnsavedChanges: false }), { persist: false, forDate: normalizedDate });
                }
            }
            return;
        }

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

                // ■1/■2 FIX: Check delete markers BEFORE processing any remote data.
                // Race condition: stale pre-delete Supabase fetch can complete after the
                // queue is cleared (queueSizeAfter:0) but before React cleanup sets
                // cancelled=true. In that scenario hasWorkout=true (stale data), so the
                // !remoteMetrics.hasWorkout gated check is never reached. We must intercept
                // here, regardless of what Supabase returned, using persisted markers.
                {
                    const _pendingDeleteChange = pendingWorkoutContentChangeDatesRef.current.get(normalizedDate);
                    const _isExplicitDeletePending = Boolean(_pendingDeleteChange?.explicitDelete);
                    const _isExplicitDeleteMarked = Boolean(
                        typeof getCurrentHistoryDeleteMarkers === "function" &&
                        getCurrentHistoryDeleteMarkers().dates?.includes(normalizedDate)
                    );
                    const _dbg = getHistoryDeleteMarkerDebugInfo?.(normalizedDate) || { deletedAt: null, ageSeconds: null, isPending: _isExplicitDeletePending };
                    if (_isExplicitDeletePending || _isExplicitDeleteMarked) {
                        const _emptyForDelete = withDraftDateMeta(normalizedDate, {
                            todayLabels: [],
                            sessionEx: null,
                            logData: {},
                            exerciseUnits: {},
                        }, { source: "explicit_date_nav", hasUnsavedChanges: false });
                        clearDraftForDate(normalizedDate);
                        console.log("[restore] delete marker intercepted stale remote — skipping restore", {
                            env: getRuntimeEnvironmentLabel(),
                            user_id: user?.id,
                            date: normalizedDate,
                            _isExplicitDeletePending,
                            _isExplicitDeleteMarked,
                            deletedAt: _dbg.deletedAt,
                            ageSeconds: _dbg.ageSeconds,
                            isPending: _dbg.isPending,
                            decision: "intercepted",
                        });
                        applyCurrentLogDraft(_emptyForDelete, { persist: false, forDate: normalizedDate });
                        return;
                    }
                    // Marker absent or expired — proceed with restore
                    console.log("[restore] delete marker allowed — proceeding with restore", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user?.id,
                        date: normalizedDate,
                        _isExplicitDeletePending,
                        _isExplicitDeleteMarked,
                        deletedAt: _dbg.deletedAt,
                        ageSeconds: _dbg.ageSeconds,
                        isPending: _dbg.isPending,
                        decision: _isExplicitDeleteMarked ? "allowed-expired" : "allowed-not-pending",
                    });
                }

                // Gate A: block content restoration for persistently deleted dates.
                // Note: pendingWorkoutContentChangeDatesRef early-return at line 219 already
                // handles all pending-change dates; Gate A is only reached when there is none.
                // Exception: if the localStorage draft is an unsaved user edit, preserve it.
                {
                    const _persistentDeleted = loadPersistentDeletedDates(user?.id);
                    if (_persistentDeleted[normalizedDate]) {
                        const _localDraft = _loadDraftForDateRef.current(normalizedDate);
                        const _hasUnsavedUserDraft = isUnsavedUserWorkoutDraft(_localDraft);
                        if (_hasUnsavedUserDraft) {
                            console.log("[WP] restore:persistentDeleteSkipped", {
                                date: normalizedDate,
                                caller: "useLogDateRefresh",
                                reason: "unsaved-user-draft",
                                draftSource: _localDraft?.meta?.source,
                            });
                        } else {
                            const _emptyForDelete = withDraftDateMeta(normalizedDate, {
                                todayLabels: [],
                                sessionEx: null,
                                logData: {},
                                exerciseUnits: {},
                            }, { source: "explicit_date_nav", hasUnsavedChanges: false });
                            console.log("[WP] restore:blockedByPersistentDelete", {
                                date: normalizedDate,
                                caller: "useLogDateRefresh",
                                source: "remote_supabase",
                                deletedAt: _persistentDeleted[normalizedDate],
                            });
                            clearDraftForDate(normalizedDate);
                            applyCurrentLogDraft(_emptyForDelete, { persist: false, forDate: normalizedDate });
                            return;
                        }
                    }
                }

                // ■5: If restore loop suppression is active for this date, skip the entire
                // remote restore to prevent repeated state updates that drive the 1-second cycle.
                // Suppression is activated by useDraftStore after ≥3 remote_supabase attempts
                // within 15s, and auto-expires after 10s.
                {
                    const _suppressRemainingSec = getRestoreLoopSuppressionRemainingSec(normalizedDate);
                    if (_suppressRemainingSec > 0) {
                        console.log("[WP] restoreLoop:suppressed", {
                            date: normalizedDate,
                            remainingSec: _suppressRemainingSec,
                            attemptCount: getRestoreAttempts(normalizedDate)?.count ?? 0,
                        });
                        return;
                    }
                }

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
                    bodyWeightKg: _bodyWeightKgRef.current,
                });
                const localDraft = loadDraftForDate(normalizedDate);
                const localMetrics = getDraftMetricsForDate({
                    exercises: localDraft.sessionEx || [],
                    logData: localDraft.logData || {},
                    getExUnit: (name) => localDraft.exerciseUnits?.[name] || getExUnit(name),
                    workoutDate: normalizedDate,
                    bodyWeightKg: _bodyWeightKgRef.current,
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
                        localDraft: localMetrics,
                    });
                    const localHasUnsavedChanges = Boolean(localDraft?.meta?.hasUnsavedChanges);
                    // A "zombie draft" claims hasUnsavedChanges:true but was NOT written by a real
                    // user edit (useWorkoutLog:* source). Sources like "autosave_draft",
                    // "active_local_recording_restore", "pending_draft_restore" are not genuine
                    // user edits and should be treated like phantoms when Supabase is empty.
                    const isZombieDraft = localHasUnsavedChanges && !isUnsavedUserWorkoutDraft(localDraft);
                    const emptyDraft = withDraftDateMeta(normalizedDate, {
                        todayLabels: [],
                        sessionEx: null,
                        logData: {},
                        exerciseUnits: {},
                    }, { source: "explicit_date_nav", hasUnsavedChanges: false });

                    // If this date was explicitly deleted (in-flight queue or persisted marker),
                    // treat empty remote as authoritative and clear any stale local state.
                    const pendingDeleteChange = pendingWorkoutContentChangeDatesRef.current.get(normalizedDate);
                    const isExplicitDeletePending = Boolean(pendingDeleteChange?.explicitDelete);
                    const isExplicitDeleteMarked = Boolean(
                        typeof getCurrentHistoryDeleteMarkers === "function" &&
                        getCurrentHistoryDeleteMarkers().dates?.includes(normalizedDate)
                    );
                    const _dbg2 = getHistoryDeleteMarkerDebugInfo?.(normalizedDate) || { deletedAt: null, ageSeconds: null, isPending: isExplicitDeletePending };
                    if (isExplicitDeletePending || isExplicitDeleteMarked) {
                        if (localMetrics.hasWorkout) {
                            clearDraftForDate(normalizedDate);
                            console.log("[restore] explicit delete confirmed — clearing stale local draft", {
                                env: getRuntimeEnvironmentLabel(),
                                user_id: user.id,
                                date: normalizedDate,
                                localSetCount: localMetrics.setCount,
                                isExplicitDeletePending,
                                isExplicitDeleteMarked,
                                deletedAt: _dbg2.deletedAt,
                                ageSeconds: _dbg2.ageSeconds,
                                isPending: _dbg2.isPending,
                                decision: "intercepted",
                            });
                        }
                        applyCurrentLogDraft(emptyDraft, { persist: false, forDate: normalizedDate });
                        return;
                    }
                    console.log("[restore] delete marker allowed (empty-remote path) — proceeding", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        date: normalizedDate,
                        isExplicitDeletePending,
                        isExplicitDeleteMarked,
                        deletedAt: _dbg2.deletedAt,
                        ageSeconds: _dbg2.ageSeconds,
                        isPending: _dbg2.isPending,
                        decision: isExplicitDeleteMarked ? "allowed-expired" : "allowed-not-pending",
                    });

                    if (!localMetrics.hasWorkout || (localMetrics.hasWorkout && (!localHasUnsavedChanges || isZombieDraft))) {
                        // Remote is empty and local has no workout, a phantom (no unsaved flag),
                        // or a zombie (unsaved flag but not from real user editing).
                        // Clear storage and show empty screen.
                        if (localMetrics.hasWorkout) {
                            const now = Date.now();
                            const lastCleared = lastPhantomClearedRef.current[normalizedDate] || 0;
                            const alreadyClearedRecently = now - lastCleared < 10_000;
                            if (!alreadyClearedRecently) {
                                lastPhantomClearedRef.current = {
                                    ...lastPhantomClearedRef.current,
                                    [normalizedDate]: now,
                                };
                                // Remove keys entirely (not just overwrite) so loadDraftForDate
                                // cannot fall through to a stale legacy key.
                                clearDraftForDate(normalizedDate);
                                console.log(isZombieDraft
                                    ? "[restore] zombie draft cleared from storage (date-refresh)"
                                    : "[restore] phantom draft cleared from storage (date-refresh)", {
                                    env: getRuntimeEnvironmentLabel(),
                                    user_id: user.id,
                                    date: normalizedDate,
                                    source: localDraft?.meta?.source || null,
                                    localSetCount: localMetrics.setCount,
                                    isZombieDraft,
                                });
                            }
                        }
                        applyCurrentLogDraft(emptyDraft, { persist: false, forDate: normalizedDate });
                    }
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
                        contentOrigin: localDraft?.meta?.contentOrigin || "local_draft",
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
                    applyCurrentLogDraft(datedLocalDraft, { forDate: normalizedDate });
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
                    // Do NOT call markWorkoutContentChanged here — local_draft_richer_restore
                    // set explicitEdit:true which bypassed G2 guards and caused delete undos.
                    // The original pending change already carries the correct flags.
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
                    // Do NOT call markWorkoutContentChanged here — local_draft_richer_restore
                    // set explicitEdit:true which bypassed G2 guards and caused delete undos.
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
                    // Do NOT call markWorkoutContentChanged here — local_draft_richer_restore
                    // bypassed G2 guards and caused delete undos.
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
                        contentDate: normalizedDate,
                    }
                );
                const cleanSavedDraftForDate = withDraftDateMeta(normalizedDate, savedDraftForDate, {
                    source: "remote_supabase",
                    remoteVerifiedAt,
                    hasUnsavedChanges: false,
                    contentOrigin: "remote",
                    contentDate: normalizedDate,
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
                    persistHistoryForUser(user.id, nextHistory, { source: "useLogDateRefresh:refresh" });
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
                // ■4: Track successful apply. Attempt/blocked counts are tracked in
                // useDraftStore.saveDraftForDate and workoutDraftStore valve respectively.
                trackRestoreAttempt(normalizedDate, "applied");
                applyCurrentLogDraft(cleanSavedDraftForDate, { forDate: normalizedDate });
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
        // ■1: Only deps that should genuinely re-trigger the fetch:
        //   logDate          — user navigated to a different date
        //   user?.id         — auth state changed
        //   historySyncReady — initial remote data became available
        //   screen           — user entered/left the log screen
        //
        // All callback props (applyCurrentLogDraft, buildSavedWorkoutDraftForDate,
        // getExUnit, applyTrustedWorkoutRowsSnapshot, applyTrustedSessionRowsSnapshot,
        // applyWorkoutsDataHistorySnapshot, applyLocalHistoryDates, clearDraftForDate,
        // loadDraftForDate, markWorkoutContentChanged, saveDraftForDate,
        // setHistoryLoadError) are read via latest-callback refs and excluded from
        // this array — their reference changes must NOT re-trigger the Supabase fetch.
        // history is read via latestHistoryRef.current (always current, no re-fire needed).
        logDate,
        historySyncReady,
        screen,
        user?.id,
    ]);
}
