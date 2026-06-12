import { useCallback } from "react";
import { supabase } from "../utils/supabase";
import {
    calc1RM,
    hasMeaningfulPRIncrease,
    PR_UPDATE_TOLERANCE_KG,
    sanitizeWorkoutSets,
} from "../utils/helpers";
import { buildWorkoutSessionPayloadFromDraft } from "../utils/workoutSessions";
import {
    attachWorkoutDurationToHistoryDate,
    getExerciseRecordBodyPart,
    getSetDisplayUnit,
    persistHistoryForUser,
    storeSetWeightForUnit,
} from "../utils/appHelpers";
import {
    buildWorkoutDaySummary,
    buildWorkoutDaySummaryPrKey,
} from "../utils/workoutDaySummary";

export function useWorkoutDaySummaryBuilder({
    logDate,
    exercises,
    logData,
    todayLabels,
    unit,
    user,
    savedWorkoutDurationSecByDate,
    workoutTimerStateRef,
    latestHistoryRef,
    historyRevisionRef,
    getExUnit,
    getPR,
    getPreviousPR,
    finishWorkoutTimer,
    queueWorkoutSessionSync,
    setSavedWorkoutDurationSecByDate,
    setSummary,
    setHistory,
}) {
    const buildDraftWorkoutDaySummary = useCallback(async (targetDate, options = {}) => {
        const normalizedDate = String(targetDate || "").trim();
        if (!normalizedDate) return null;

        const entries = exercises
            .map((exercise, index) => {
                const exerciseName = String(exercise?.name || "").trim();
                if (!exerciseName) return null;

                const exUnit = typeof getExUnit === "function" ? getExUnit(exerciseName) : unit;
                const sets = sanitizeWorkoutSets(
                    (logData[exerciseName] || []).map((set) => ({
                        ...set,
                        weight: storeSetWeightForUnit(set, exUnit),
                        displayWeight: set.weight,
                        displayUnit: getSetDisplayUnit(set, exUnit),
                    })),
                    { allowBodyweight: true }
                );

                if (!sets.length) return null;

                const bodyPart = getExerciseRecordBodyPart(exercise, todayLabels[0] || null);
                const volume = sets.reduce((sum, set) => {
                    const weight = Number(set?.weight);
                    const reps = Number(set?.reps);
                    if (!Number.isFinite(weight) || weight <= 0) return sum;
                    if (!Number.isFinite(reps) || reps <= 0) return sum;
                    return sum + weight * reps;
                }, 0);

                const validNumericSets = sets.filter((set) => {
                    const weight = Number(set?.weight);
                    const reps = Number(set?.reps);
                    return Number.isFinite(weight) && weight > 0 && Number.isFinite(reps) && reps > 0;
                });

                const previousPr = getPreviousPR
                    ? getPreviousPR(exercise, { excludeDate: normalizedDate })
                    : (getPR ? getPR(exercise) : null);
                const previousSets = previousPr?.sets || [];
                const previousRm = previousPr?.rm ?? calc1RM(previousSets);
                const isPr = Boolean(
                    validNumericSets.length
                    && hasMeaningfulPRIncrease(
                        validNumericSets,
                        previousSets,
                        previousRm,
                        PR_UPDATE_TOLERANCE_KG
                    )
                );

                return {
                    id: `${exerciseName}-${normalizedDate}-${index}`,
                    name: exerciseName,
                    bodyPart,
                    sets,
                    setCount: sets.length,
                    volume,
                    isPr,
                };
            })
            .filter(Boolean);

        const prKeys = entries
            .filter((entry) => entry.isPr)
            .map((entry) => buildWorkoutDaySummaryPrKey(entry.bodyPart, entry.name));

        const currentTimerState = workoutTimerStateRef.current;
        const timerEndedAt =
            options.endedAt
            || currentTimerState.finishedAt
            || currentTimerState.lastActivityAt
            || Date.now();
        const durationSec =
            currentTimerState.startedForDate === normalizedDate && currentTimerState.startedAt
                ? Math.max(0, Math.floor((timerEndedAt - currentTimerState.startedAt) / 1000))
                : (savedWorkoutDurationSecByDate[normalizedDate] || 0);

        const sessionPayload = buildWorkoutSessionPayloadFromDraft({
            exercises,
            logData,
            getExUnit,
            workoutDate: normalizedDate,
            durationSec,
        });

        let isShared = false;
        if (user?.id) {
            try {
                const { data } = await supabase
                    .from("workout_sessions")
                    .select("id")
                    .eq("user_id", user.id)
                    .eq("workout_date", normalizedDate)
                    .maybeSingle();
                isShared = Boolean(data?.id);
            } catch (error) {
                console.error("workout day summary shared state fetch failed", error);
            }
        }

        return buildWorkoutDaySummary({
            title: options.title || "今日のワークアウト完了",
            date: normalizedDate,
            entries,
            getExUnit,
            fallbackUnit: unit,
            prKeys,
            durationSec,
            isShared,
            shareTarget: sessionPayload
                ? {
                    workoutDate: normalizedDate,
                    sessionPayload: {
                        ...sessionPayload,
                        durationSec,
                        session: {
                            ...sessionPayload.session,
                            durationSec,
                            duration_sec: durationSec,
                        },
                    },
                }
                : null,
        });
    }, [exercises, getExUnit, getPR, getPreviousPR, logData, savedWorkoutDurationSecByDate, todayLabels, unit, user?.id, workoutTimerStateRef]);

    const handleFinishWorkoutTimerAndShowSummary = useCallback(async () => {
        const endedAt = Date.now();
        finishWorkoutTimer(endedAt);
        const nextSummary = await buildDraftWorkoutDaySummary(logDate, {
            title: "今日のワークアウト完了",
            endedAt,
        });
        const durationSec = Math.max(0, Math.floor(Number(nextSummary?.durationSec) || 0));
        if (durationSec > 0) {
            setSavedWorkoutDurationSecByDate((prev) => ({
                ...prev,
                [logDate]: Math.max(prev[logDate] || 0, durationSec),
            }));
            setHistory((prev) => {
                const next = attachWorkoutDurationToHistoryDate(prev, logDate, durationSec);
                latestHistoryRef.current = next;
                historyRevisionRef.current += 1;
                persistHistoryForUser(user?.id, next);
                return next;
            });
            queueWorkoutSessionSync(logDate);
        }
        setSummary(nextSummary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [buildDraftWorkoutDaySummary, finishWorkoutTimer, historyRevisionRef, logDate, queueWorkoutSessionSync, setSavedWorkoutDurationSecByDate, user?.id]);

    return { buildDraftWorkoutDaySummary, handleFinishWorkoutTimerAndShowSummary };
}
