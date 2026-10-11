import { useCallback } from "react";
import { load, save } from "../utils/helpers";
import { logWriteTrace, wpCountExercises, wpCountSetsFromLogData, trackRestoreAttempt, suppressRestoreLoop, getRestoreLoopSuppressionRemainingSec, getRestoreAttempts } from "../utils/writeTrace";
import {
    clearWorkoutDraft as clearStoredWorkoutDraft,
    loadWorkoutDraft as loadStoredWorkoutDraft,
    saveWorkoutDraft as saveStoredWorkoutDraft,
} from "../features/workout/workoutDraftStore";
import {
    getDraftDateValidation,
    getWorkoutEditReasonFromSource,
    loadPersistentDeletedDates,
    logDraftRestoreDateCheck,
    makeDraftMeta,
    mergeDraftExercisesWithLogData,
    normalizeDraftDateKey,
    resolveContentOrigin,
    shouldLogPerfDebug,
    withDraftDateMeta,
} from "../utils/appHelpers";

export function useDraftStore({ userIdRef } = {}) {
    const getDraftKey = useCallback((baseKey, dateStr) => `${baseKey}_${dateStr}`, []);

    const loadDraftForDate = useCallback((dateStr) => {
        const normalizedDate = normalizeDraftDateKey(dateStr);
        const emptyDraft = withDraftDateMeta(normalizedDate, {
            todayLabels: [],
            logData: {},
            sessionEx: null,
            exerciseUnits: {},
        }, {
            source: "empty_draft",
            hasUnsavedChanges: false,
            contentOrigin: "empty",
        });
        if (!normalizedDate) return emptyDraft;

        const hasDraftPayloadContent = (draft) => (
            draft.sessionEx !== null ||
            Object.keys(draft.logData || {}).length > 0 ||
            Object.keys(draft.exerciseUnits || {}).length > 0 ||
            (draft.todayLabels || []).length > 0
        );

        const normalizeDraftForLoad = (draft, source) => {
            const validation = getDraftDateValidation(normalizedDate, draft, normalizedDate);
            const accepted = validation.accepted;
            const logPayload = {
                action: "draft_restore_date_check",
                source,
                keyDate: validation.keyDate,
                payloadDate: validation.payloadDate || null,
                selectedDate: validation.selectedDate,
                accepted,
                rejectedReason: validation.rejectedReason || null,
            };
            if (!accepted) {
                logDraftRestoreDateCheck(logPayload);
                return null;
            }
            logDraftRestoreDateCheck(logPayload);
            return withDraftDateMeta(normalizedDate, draft, {
                source: draft?.meta?.source || source,
                hasUnsavedChanges: draft?.meta?.hasUnsavedChanges ?? true,
                remoteVerifiedAt: draft?.meta?.remoteVerifiedAt ?? null,
                contentOrigin: resolveContentOrigin(draft?.meta || {}),
            });
        };

        const storedWorkoutDraft = loadStoredWorkoutDraft(normalizedDate, {
            logger: console,
            log: false,
        });
        const acceptedStoredWorkoutDraft = storedWorkoutDraft
            ? normalizeDraftForLoad(storedWorkoutDraft, storedWorkoutDraft?.meta?.source || "workoutDraftStore")
            : null;
        if (acceptedStoredWorkoutDraft && hasDraftPayloadContent(acceptedStoredWorkoutDraft)) {
            return acceptedStoredWorkoutDraft;
        }

        const datedLogData = load(getDraftKey("draft_logData", normalizedDate), null);
        const datedTodayLabels = load(getDraftKey("draft_todayLabels", normalizedDate), []);
        const datedRawSessionEx = load(getDraftKey("draft_sessionEx", normalizedDate), null);
        const datedExerciseUnits = load(getDraftKey("draft_exerciseUnits", normalizedDate), {});
        const datedMeta = load(getDraftKey("draft_meta", normalizedDate), null);
        const datedSessionEx = datedRawSessionEx === null && !Object.keys(datedLogData || {}).length
            ? null
            : mergeDraftExercisesWithLogData(datedRawSessionEx || [], datedLogData || {}, datedTodayLabels);
        const datedDraft = {
            todayLabels: datedTodayLabels,
            logData: datedLogData || {},
            sessionEx: datedSessionEx,
            exerciseUnits: datedExerciseUnits,
            meta: datedMeta,
        };
        const datedDraftHasPayload = datedLogData !== null ||
            datedRawSessionEx !== null ||
            Object.keys(datedExerciseUnits || {}).length > 0 ||
            datedTodayLabels.length > 0 ||
            Boolean(datedMeta);
        const acceptedDatedDraft = datedDraftHasPayload
            ? normalizeDraftForLoad(datedDraft, "date_scoped_draft")
            : null;
        if (acceptedDatedDraft && hasDraftPayloadContent(acceptedDatedDraft)) {
            return acceptedDatedDraft;
        }

        const legacyDraftDate = normalizeDraftDateKey(load("draft_logDate", ""));
        const useLegacyFallback = legacyDraftDate === normalizedDate;
        const legacyMeta = useLegacyFallback
            ? (load("draft_meta", null) || { date: legacyDraftDate, keyDate: legacyDraftDate })
            : null;
        const legacyLogData = useLegacyFallback ? load("draft_logData", {}) : {};
        const legacyTodayLabels = useLegacyFallback ? load("draft_todayLabels", []) : [];
        const legacyRawSessionEx = useLegacyFallback ? load("draft_sessionEx", null) : null;
        const legacyExerciseUnits = useLegacyFallback ? load("draft_exerciseUnits", {}) : {};
        const legacySessionEx = legacyRawSessionEx === null && !Object.keys(legacyLogData || {}).length
            ? null
            : mergeDraftExercisesWithLogData(legacyRawSessionEx || [], legacyLogData || {}, legacyTodayLabels);
        const legacyDraft = {
            todayLabels: legacyTodayLabels,
            logData: legacyLogData || {},
            sessionEx: legacySessionEx,
            exerciseUnits: legacyExerciseUnits,
            meta: legacyMeta,
        };
        const acceptedLegacyDraft = useLegacyFallback
            ? normalizeDraftForLoad(legacyDraft, "legacy_draft")
            : null;

        return acceptedLegacyDraft && hasDraftPayloadContent(acceptedLegacyDraft)
            ? acceptedLegacyDraft
            : emptyDraft;
    }, [getDraftKey]);

    const hasDraftContent = useCallback((draft) => (
        draft.sessionEx !== null ||
        Object.keys(draft.logData || {}).length > 0 ||
        Object.keys(draft.exerciseUnits || {}).length > 0 ||
        (draft.todayLabels || []).length > 0
    ), []);

    const makeDefaultDraftSets = useCallback(() => ([
        { weight: "", reps: "", done: false },
        { weight: "", reps: "", done: false },
        { weight: "", reps: "", done: false },
    ]), []);

    const saveDraftForDate = useCallback((dateStr, draft) => {
        const normalizedDate = normalizeDraftDateKey(dateStr);
        if (!normalizedDate) return false;

        // ■2: Extra diagnostic fields for payload tracing.
        const _exerciseNames = (draft?.sessionEx ?? draft?.exercises ?? []).slice(0, 10).map((ex) => String(ex?.name || "")).filter(Boolean);
        const _payloadDateField = draft?.meta?.date || draft?.meta?.draftDate || draft?.meta?.workoutDate || null;
        const _payloadOrigin = draft?.meta?.payloadOrigin || null;
        const _contentOrigin = draft?.meta?.contentOrigin || null;

        // ■3: Count source:"remote_supabase" attempts for loop detection.
        // Moved from apply-time (useLogDateRefresh) to attempt-time so valve-blocked
        // iterations are also counted.
        // ■5: Suppress further attempts for 10s after loop is detected (≥3 in 15s).
        let _restoreAttempts = null;
        if (draft?.meta?.source === "remote_supabase") {
            const _remainingSec = getRestoreLoopSuppressionRemainingSec(normalizedDate);
            if (_remainingSec > 0) {
                logWriteTrace("restoreLoop:suppressed", {
                    date: normalizedDate,
                    decision: "suppressed",
                    reason: "restore loop suppression active — skipping saveDraftForDate",
                    extra: {
                        remainingSec: _remainingSec,
                        attemptCount: getRestoreAttempts(normalizedDate)?.count ?? 0,
                    },
                });
                return false;
            }
            _restoreAttempts = trackRestoreAttempt(normalizedDate, "attempt");
            if (_restoreAttempts.count >= 3) {
                logWriteTrace("restoreLoop:detected", {
                    date: normalizedDate,
                    decision: "detected",
                    reason: "remote_supabase saveDraftForDate called ≥3 times within 15s window",
                    extra: {
                        attemptCount: _restoreAttempts.count,
                        blockedCount: _restoreAttempts.blocked,
                        appliedCount: _restoreAttempts.applied,
                        lastAppliedSource: "remote_supabase",
                    },
                });
                suppressRestoreLoop(normalizedDate, 10_000);
            }
        }

        logWriteTrace("saveDraftForDate", {
            date: normalizedDate,
            decision: "pass",
            reason: null,
            flags: { explicitEdit: draft?.meta?.explicitEdit, explicitDelete: draft?.meta?.explicitDelete, source: draft?.meta?.source },
            exerciseCount: wpCountExercises(draft?.sessionEx ?? draft?.exercises),
            setCount: wpCountSetsFromLogData(draft?.logData),
            extra: { exerciseNames: _exerciseNames, payloadDateField: _payloadDateField, payloadOrigin: _payloadOrigin, contentOrigin: _contentOrigin },
        });
        // Capture the original payload date BEFORE any overwrite for a clean second-line defence.
        // applyCurrentLogDraft's forDate guard is the first line; this catches any direct caller
        // that passes mismatched data (e.g. wrong date stamped on the draft by another path).
        // contentDate: preserved by withDraftDateMeta through label rewrites — detects cross-date
        // content injection that G5's label check cannot see (G5 only checks the rewritten labels).
        const _contentDate = draft?.meta?.contentDate ?? null;
        const _contentDateMismatch = _contentDate !== null && _contentDate !== normalizedDate;
        const validation = getDraftDateValidation(normalizedDate, draft, normalizedDate);
        if (!validation.accepted) {
            logWriteTrace("G5:date-validation", {
                date: normalizedDate,
                decision: "block",
                reason: validation.rejectedReason || "payload date does not match key date",
                flags: { explicitEdit: draft?.meta?.explicitEdit, explicitDelete: draft?.meta?.explicitDelete, source: draft?.meta?.source },
                exerciseCount: wpCountExercises(draft?.sessionEx ?? draft?.exercises),
                setCount: wpCountSetsFromLogData(draft?.logData),
                extra: { keyDate: validation.keyDate, payloadDate: validation.payloadDate, exerciseNames: _exerciseNames, payloadDateField: _payloadDateField, payloadOrigin: _payloadOrigin, contentDate: _contentDate, contentDateMismatch: _contentDateMismatch },
            });
            console.warn("[save] blocked stale-closure draft write", {
                action: "stale_closure_write_blocked",
                keyDate: validation.keyDate,
                payloadDate: validation.payloadDate || null,
                selectedDate: validation.selectedDate,
                accepted: false,
                rejectedReason: validation.rejectedReason,
                source: draft?.meta?.source || null,
            });
            return false;
        }
        logWriteTrace("G5:date-validation", {
            date: normalizedDate,
            decision: "pass",
            reason: null,
            flags: { explicitEdit: draft?.meta?.explicitEdit, explicitDelete: draft?.meta?.explicitDelete, source: draft?.meta?.source },
            exerciseCount: wpCountExercises(draft?.sessionEx ?? draft?.exercises),
            setCount: wpCountSetsFromLogData(draft?.logData),
            extra: { keyDate: validation.keyDate, payloadDate: validation.payloadDate, exerciseNames: _exerciseNames, payloadDateField: _payloadDateField, payloadOrigin: _payloadOrigin, contentDate: _contentDate, contentDateMismatch: _contentDateMismatch },
        });
        // G14: zombie-draft-write detection — deletion-source draft with actual content.
        // Decision is always "pass" (informational only); blocks are handled upstream.
        const _g14SetCount = wpCountSetsFromLogData(draft?.logData);
        const _g14Source = draft?.meta?.source;
        if (_g14SetCount > 0 && _g14Source && !getWorkoutEditReasonFromSource(_g14Source)) {
            logWriteTrace("G14:zombie-draft-write", {
                date: normalizedDate,
                decision: "pass",
                reason: null,
                flags: { source: _g14Source, explicitDelete: draft?.meta?.explicitDelete, explicitEdit: draft?.meta?.explicitEdit },
                exerciseCount: wpCountExercises(draft?.sessionEx ?? draft?.exercises),
                setCount: _g14SetCount,
                extra: { exerciseNames: _exerciseNames, caller: "saveDraftForDate", contentOrigin: _contentOrigin },
            });
        }

        // Gate B: block content writes for persistently deleted dates when source is not
        // a genuine user edit and the draft carries exercises.
        {
            const _userId = userIdRef?.current;
            const _source = draft?.meta?.source || null;
            const _exerciseCount = wpCountExercises(draft?.sessionEx ?? draft?.exercises);
            if (_userId && _exerciseCount > 0 && !getWorkoutEditReasonFromSource(_source)) {
                const _persistentDeleted = loadPersistentDeletedDates(_userId);
                if (_persistentDeleted[normalizedDate]) {
                    logWriteTrace("GateB:persistentDelete:blocked", {
                        date: normalizedDate,
                        decision: "block",
                        reason: "date is in persistent deleted list and source is not a genuine user edit",
                        flags: { source: _source, explicitDelete: draft?.meta?.explicitDelete, explicitEdit: draft?.meta?.explicitEdit },
                        exerciseCount: _exerciseCount,
                        setCount: wpCountSetsFromLogData(draft?.logData),
                        extra: { exerciseNames: _exerciseNames, payloadOrigin: _payloadOrigin, deletedAt: _persistentDeleted[normalizedDate] },
                    });
                    console.warn("[WP] saveDraftForDate:blockedByPersistentDelete", {
                        date: normalizedDate,
                        source: _source,
                        exerciseCount: _exerciseCount,
                        exerciseNames: _exerciseNames,
                        deletedAt: _persistentDeleted[normalizedDate],
                    });
                    return false;
                }
            }
        }

        if (_contentDateMismatch) {
            console.warn("[WP] G5:content-date-mismatch", {
                date: normalizedDate,
                keyDate: normalizedDate,
                contentDate: _contentDate,
                exerciseCount: wpCountExercises(draft?.sessionEx ?? draft?.exercises),
                setCount: wpCountSetsFromLogData(draft?.logData),
                exerciseNames: _exerciseNames,
                source: draft?.meta?.source || null,
            });
        }
        const logData = draft.logData || {};
        const todayLabels = draft.todayLabels || [];
        const sessionEx = draft.sessionEx === null && !Object.keys(logData).length
            ? null
            : mergeDraftExercisesWithLogData(draft.sessionEx || [], logData, todayLabels);
        const meta = makeDraftMeta(draft.meta || {}, {
            date: normalizedDate,
            keyDate: normalizedDate,
            draftDate: normalizedDate,
            workoutDate: normalizedDate,
            exerciseNames: (sessionEx || []).map((exercise) => exercise.name),
            logDataNames: Object.keys(logData),
        });
        const nextStoredDraft = withDraftDateMeta(normalizedDate, {
            ...draft,
            todayLabels,
            logData,
            sessionEx,
            exerciseUnits: draft.exerciseUnits || {},
            meta,
        }, meta);

        saveStoredWorkoutDraft(normalizedDate, nextStoredDraft, {
            logger: console,
            log: shouldLogPerfDebug(),
        });

        save(getDraftKey("draft_todayLabels", normalizedDate), todayLabels);
        save(getDraftKey("draft_logData", normalizedDate), logData);
        save(getDraftKey("draft_sessionEx", normalizedDate), sessionEx);
        save(getDraftKey("draft_exerciseUnits", normalizedDate), draft.exerciseUnits || {});
        save(getDraftKey("draft_meta", normalizedDate), meta);

        // NOTE: global legacy keys (draft_logData, draft_sessionEx, etc.) are intentionally
        // NOT written here.  Writing unscoped global keys caused date contamination: editing
        // date A would overwrite the global draft_logData, which could then be loaded as
        // date B's draft if the reader fell through to the legacy fallback.
        // The legacy fallback in loadDraftForDate is kept for reading old drafts written
        // before this change, but no new writes go there.
        return true;
    // userIdRef is a ref — intentionally excluded from deps (stable, no re-render needed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [getDraftKey]);

    const clearDraftForDate = useCallback((dateStr) => {
        if (!dateStr) return;
        clearStoredWorkoutDraft(dateStr);

        [
            getDraftKey("draft_todayLabels", dateStr),
            getDraftKey("draft_logData", dateStr),
            getDraftKey("draft_sessionEx", dateStr),
            getDraftKey("draft_exerciseUnits", dateStr),
            getDraftKey("draft_exercises", dateStr),
            getDraftKey("draft_meta", dateStr),
        ].forEach((key) => {
            try {
                localStorage.removeItem(key);
            } catch { }
        });

        if (load("draft_logDate", "") === dateStr) {
            save("draft_todayLabels", []);
            save("draft_logData", {});
            save("draft_sessionEx", null);
            save("draft_exerciseUnits", {});
            save("draft_meta", null);
            save("draft_logDate", "");
        }
    }, [getDraftKey]);

    return {
        getDraftKey,
        loadDraftForDate,
        hasDraftContent,
        makeDefaultDraftSets,
        saveDraftForDate,
        clearDraftForDate,
    };
}
