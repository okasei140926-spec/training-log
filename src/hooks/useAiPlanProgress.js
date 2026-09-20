import { useCallback, useEffect, useState } from "react";
import { supabase } from "../utils/supabase";
import { load, save } from "../utils/helpers";
import {
    buildPlanDaySequence,
    getSplitTypeFromPreference,
    getNextPlanDayIndex,
    determineSplitType,
} from "../utils/generateOnboardingPlan";

const PROGRESS_KEY = "aiPlanProgress";
const SELF_MADE_KEY = "selfMadeConsecutiveCount";
const ENABLED_KEY   = "aiPlanEnabled";

/**
 * Manages sequential AI plan progression.
 *
 * localStorage keys:
 *   aiPlanProgress          – { splitType, sequence, completedDates }
 *   selfMadeConsecutiveCount – number (reset when AI plan accepted)
 *   aiPlanEnabled            – boolean (default true)
 */
export function useAiPlanProgress({ user }) {
    // ── State ──────────────────────────────────────────────────────────────

    const [progress, setProgress] = useState(() => load(PROGRESS_KEY, null));
    const [selfMadeCount, setSelfMadeCount] = useState(() => load(SELF_MADE_KEY, 0));
    const [aiPlanEnabled, setAiPlanEnabledState] = useState(() => {
        const stored = load(ENABLED_KEY, null);
        return stored === null ? true : Boolean(stored);
    });

    // ── Initialise plan from onboarding answers (runs once) ────────────────

    useEffect(() => {
        if (progress) return;
        const answers = load("onboardingAnswers", null);
        if (!answers?.level) return;
        const splitType = getSplitTypeFromPreference(answers.preferredSplit ?? null, answers.frequency);
        const sequence  = buildPlanDaySequence(splitType);
        const newProgress = { splitType, sequence, completedDates: {} };
        save(PROGRESS_KEY, newProgress);
        setProgress(newProgress);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Sync ai_plan_enabled from Supabase (on mount / user change) ────────

    useEffect(() => {
        if (!user?.id) return;
        supabase
            .from("profiles")
            .select("ai_plan_enabled")
            .eq("id", user.id)
            .maybeSingle()
            .then(({ data }) => {
                if (!data) return;
                const remote = data.ai_plan_enabled;
                if (remote !== null && remote !== undefined) {
                    setAiPlanEnabledState(Boolean(remote));
                    save(ENABLED_KEY, Boolean(remote));
                }
            })
            .catch(() => {});
    }, [user?.id]);

    // ── Derived: next plan day ─────────────────────────────────────────────

    const getNextPlanDay = useCallback(() => {
        if (!progress?.sequence?.length) return null;
        const { sequence, completedDates = {} } = progress;
        const idx = getNextPlanDayIndex(completedDates, sequence);
        return { ...sequence[idx], index: idx };
    }, [progress]);

    /**
     * Returns plan day info for a given log date:
     * – if already completed on that date: { ...day, completed: true }
     * – otherwise: the next upcoming day { ...day, completed: false }
     */
    const getPlanDayForDate = useCallback((date) => {
        if (!progress?.sequence?.length) return null;
        const { sequence, completedDates = {} } = progress;
        if (completedDates[date] !== undefined) {
            return { ...sequence[completedDates[date]], index: completedDates[date], completed: true };
        }
        const idx = getNextPlanDayIndex(completedDates, sequence);
        return { ...sequence[idx], index: idx, completed: false };
    }, [progress]);

    // ── Mutations ──────────────────────────────────────────────────────────

    const markPlanDayCompleted = useCallback((date) => {
        setProgress(prev => {
            if (!prev) return prev;
            const { sequence, completedDates = {} } = prev;
            if (completedDates[date] !== undefined) return prev; // already recorded
            const idx = getNextPlanDayIndex(completedDates, sequence);
            const updated = { ...prev, completedDates: { ...completedDates, [date]: idx } };
            save(PROGRESS_KEY, updated);
            return updated;
        });
    }, []);

    const unmarkPlanDayCompleted = useCallback((date) => {
        setProgress(prev => {
            if (!prev) return prev;
            const { completedDates = {} } = prev;
            if (completedDates[date] === undefined) return prev; // not recorded
            const nextCompletedDates = { ...completedDates };
            delete nextCompletedDates[date];
            const updated = { ...prev, completedDates: nextCompletedDates };
            save(PROGRESS_KEY, updated);
            return updated;
        });
    }, []);

    /**
     * Mark a plan day as completed at a specific sequence index (for first-completion inference).
     * Unlike markPlanDayCompleted, this uses the provided index instead of getNextPlanDayIndex.
     */
    const markPlanDayCompletedAtIndex = useCallback((date, index) => {
        setProgress(prev => {
            if (!prev) return prev;
            const { completedDates = {} } = prev;
            if (completedDates[date] !== undefined) return prev; // already recorded
            const updated = { ...prev, completedDates: { ...completedDates, [date]: index } };
            save(PROGRESS_KEY, updated);
            return updated;
        });
    }, []);

    const handleSelfMade = useCallback(() => {
        setSelfMadeCount(prev => {
            const next = prev + 1;
            save(SELF_MADE_KEY, next);
            return next;
        });
    }, []);

    const handlePlanAccepted = useCallback(() => {
        setSelfMadeCount(0);
        save(SELF_MADE_KEY, 0);
    }, []);

    /**
     * Reset plan progress when plan-affecting fields change (level, frequency, location, etc.)
     * Rebuilds the sequence from the new answers and clears completedDates.
     */
    /**
     * @param {object} newAnswers - Updated onboarding answers
     * @param {Array|null} customSequence - For preferredSplit="custom", the user-defined sequence
     */
    const resetPlanProgress = useCallback((newAnswers, customSequence = null) => {
        const splitType = getSplitTypeFromPreference(
            newAnswers?.preferredSplit ?? null,
            newAnswers?.frequency
        );
        let sequence;
        if (splitType === "custom" && !customSequence?.length) {
            // カスタム未定義 → 週頻度ベースのフォールバックシーケンスで動作させる
            const fallbackType = determineSplitType(newAnswers?.frequency);
            sequence = buildPlanDaySequence(fallbackType);
        } else {
            sequence = buildPlanDaySequence(splitType, customSequence);
        }
        const newProgress = { splitType, sequence, completedDates: {} };
        save(PROGRESS_KEY, newProgress);
        setProgress(newProgress);
    }, []);

    const setAiPlanEnabled = useCallback(async (value) => {
        const boolVal = Boolean(value);
        setAiPlanEnabledState(boolVal);
        save(ENABLED_KEY, boolVal);
        if (user?.id) {
            try {
                await supabase.from("profiles").upsert(
                    { id: user.id, ai_plan_enabled: boolVal },
                    { onConflict: "id" }
                );
            } catch (err) {
                console.warn("[aiPlan] Supabase sync failed:", err?.message);
            }
        }
    }, [user?.id]);

    return {
        progress,
        getNextPlanDay,
        getPlanDayForDate,
        markPlanDayCompleted,
        markPlanDayCompletedAtIndex,
        unmarkPlanDayCompleted,
        resetPlanProgress,
        selfMadeCount,
        handleSelfMade,
        handlePlanAccepted,
        aiPlanEnabled,
        setAiPlanEnabled,
    };
}
