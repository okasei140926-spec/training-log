import { useCallback } from "react";
import { load, save } from "../utils/helpers";
import {
    clearWorkoutDraft as clearStoredWorkoutDraft,
    loadWorkoutDraft as loadStoredWorkoutDraft,
    saveWorkoutDraft as saveStoredWorkoutDraft,
} from "../features/workout/workoutDraftStore";
import {
    getDraftDateValidation,
    logDraftRestoreDateCheck,
    makeDraftMeta,
    mergeDraftExercisesWithLogData,
    normalizeDraftDateKey,
    shouldLogPerfDebug,
    withDraftDateMeta,
} from "../utils/appHelpers";

export function useDraftStore() {
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
        const validation = getDraftDateValidation(normalizedDate, draft, normalizedDate);
        if (!validation.accepted) {
            console.warn("[save] blocked date-mismatched draft persistence", {
                action: "draft_restore_date_check",
                keyDate: validation.keyDate,
                payloadDate: validation.payloadDate || null,
                selectedDate: validation.selectedDate,
                accepted: false,
                rejectedReason: validation.rejectedReason,
            });
            return false;
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

        save("draft_todayLabels", todayLabels);
        save("draft_logData", logData);
        save("draft_sessionEx", sessionEx);
        save("draft_exerciseUnits", draft.exerciseUnits || {});
        save("draft_meta", meta);
        save("draft_logDate", normalizedDate);
        return true;
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
