import { useCallback } from "react";
import { save } from "../utils/helpers";

const PUSH_PROMPT_LATER_KEY = "pushPromptLaterDate";

export function useUIHandlers({
    // Workout day summary / share
    setSummary,
    setWorkoutDayShareTarget,
    // Sync failure
    syncFailuresByDateRef,
    dismissedSyncFailureSignaturesRef,
    setSyncFailuresByDate,
    // Pending delete undo
    pendingDeleteUndoRef,
    setPendingDeleteUndo,
    // Push prompt
    setShowPushPrompt,
    setPushPromptMessage,
    // Log set input focus
    setFocusedLogSetInputId,
    setIsLogKeyboardOpen,
    // Log exercise focus
    setLogExerciseFocusRequest,
    // Last active log exercise
    logDate,
    setLastActiveLogExerciseByDate,
    // AI input focus
    setFocusedAiChatInput,
}) {
    // ── Workout Day Summary ───────────────────────────────
    const closeWorkoutDaySummary = useCallback(() => {
        setSummary(null);
    }, [setSummary]);

    // ── Workout Day Share Modal ───────────────────────────
    const closeWorkoutDayShareModal = useCallback(() => {
        setWorkoutDayShareTarget(null);
    }, [setWorkoutDayShareTarget]);

    const openWorkoutDayShareModal = useCallback((target) => {
        if (!target?.workoutDate || !target?.sessionPayload) return;
        setWorkoutDayShareTarget(target);
    }, [setWorkoutDayShareTarget]);

    // ── Sync Failure Banner ───────────────────────────────
    const getSyncFailureSignature = useCallback((failures) => (
        Object.entries(failures || {})
            .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
            .map(([date, failure]) => [
                date,
                failure?.stage || "",
                failure?.code || "",
                failure?.message || "",
            ].join(":"))
            .join("|")
    ), []);

    const dismissSyncFailureBanner = useCallback(() => {
        const signature = getSyncFailureSignature(syncFailuresByDateRef.current);
        if (signature) dismissedSyncFailureSignaturesRef.current.add(signature);
        setSyncFailuresByDate({ ...syncFailuresByDateRef.current });
    }, [getSyncFailureSignature, syncFailuresByDateRef, dismissedSyncFailureSignaturesRef, setSyncFailuresByDate]);

    // ── Pending Delete Undo ───────────────────────────────
    const dismissPendingDeleteUndo = useCallback(() => {
        const pending = pendingDeleteUndoRef.current;
        if (pending?.timeoutId) window.clearTimeout(pending.timeoutId);
        pendingDeleteUndoRef.current = null;
        setPendingDeleteUndo(null);
    }, [pendingDeleteUndoRef, setPendingDeleteUndo]);

    // ── Push Prompt ───────────────────────────────────────
    const dismissPushPromptForToday = useCallback(() => {
        const todayStr = new Date().toISOString().split("T")[0];
        save(PUSH_PROMPT_LATER_KEY, todayStr);
        setShowPushPrompt(false);
        setPushPromptMessage("");
    }, [setShowPushPrompt, setPushPromptMessage]);

    // ── Log Set Input Focus ───────────────────────────────
    const handleLogSetInputFocusChange = useCallback((inputId) => {
        if (inputId && typeof document !== "undefined") {
            document.body?.setAttribute("data-log-set-input-active", "true");
        }
        setFocusedLogSetInputId(inputId || null);
    }, [setFocusedLogSetInputId]);

    const markLogSetInputActive = useCallback((setInput, shouldScroll = true) => {
        if (!(setInput instanceof HTMLElement)) return;
        document.body?.setAttribute("data-log-set-input-active", "true");
        setFocusedLogSetInputId(setInput.getAttribute("data-log-set-input-id") || "__log_set_input__");
        if (!shouldScroll) return;
        window.setTimeout(() => {
            setInput.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "smooth" });
        }, 120);
    }, [setFocusedLogSetInputId]);

    const clearLogSetInputActiveIfClosed = useCallback(() => {
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement && activeElement.closest("[data-log-set-input='true']")) {
            markLogSetInputActive(activeElement);
            return;
        }
        const viewport = window.visualViewport;
        const keyboardInset = viewport
            ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
            : 0;
        if (keyboardInset > 80) {
            document.body?.setAttribute("data-log-set-input-active", "true");
            setIsLogKeyboardOpen(true);
            return;
        }
        document.body?.removeAttribute("data-log-set-input-active");
        setFocusedLogSetInputId(null);
        setIsLogKeyboardOpen(false);
    }, [markLogSetInputActive, setIsLogKeyboardOpen, setFocusedLogSetInputId]);

    const handleLogScreenFocusCapture = useCallback((event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const setInput = target.closest("[data-log-set-input='true']");
        if (!setInput) return;
        markLogSetInputActive(setInput);
    }, [markLogSetInputActive]);

    const handleLogScreenInputPointerDownCapture = useCallback((event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const setInput = target.closest("[data-log-set-input='true']");
        if (!setInput) return;
        markLogSetInputActive(setInput);
    }, [markLogSetInputActive]);

    const handleLogScreenBlurCapture = useCallback(() => {
        window.setTimeout(clearLogSetInputActiveIfClosed, 360);
    }, [clearLogSetInputActiveIfClosed]);

    // ── Log Exercise Focus ────────────────────────────────
    const requestLogExerciseFocus = useCallback((exercise) => {
        if (!exercise?.id && !exercise?.name) return;
        setLogExerciseFocusRequest({
            id: exercise.id,
            name: exercise.name,
            nonce: Date.now() + Math.random(),
        });
    }, [setLogExerciseFocusRequest]);

    const handleLogExerciseActiveChange = useCallback((exercise) => {
        if (!exercise?.id && !exercise?.name) return;
        setLastActiveLogExerciseByDate((prev) => ({
            ...(prev || {}),
            [logDate]: {
                id: exercise.id,
                name: exercise.name,
                updatedAt: Date.now(),
            },
        }));
    }, [logDate, setLastActiveLogExerciseByDate]);

    // ── AI Input Focus ────────────────────────────────────
    const handleAiInputFocusChange = useCallback((isFocused) => {
        setFocusedAiChatInput(Boolean(isFocused));
    }, [setFocusedAiChatInput]);

    return {
        closeWorkoutDaySummary,
        closeWorkoutDayShareModal,
        openWorkoutDayShareModal,
        getSyncFailureSignature,
        dismissSyncFailureBanner,
        dismissPendingDeleteUndo,
        dismissPushPromptForToday,
        handleLogSetInputFocusChange,
        markLogSetInputActive,
        clearLogSetInputActiveIfClosed,
        handleLogScreenFocusCapture,
        handleLogScreenInputPointerDownCapture,
        handleLogScreenBlurCapture,
        requestLogExerciseFocus,
        handleLogExerciseActiveChange,
        handleAiInputFocusChange,
    };
}
