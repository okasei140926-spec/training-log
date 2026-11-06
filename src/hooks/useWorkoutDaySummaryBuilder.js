import { useCallback } from "react";
import { supabase } from "../utils/supabase";
import {
    countValidSets,
    resolveEffectiveWeightKg,
    sanitizeWorkoutSets,
} from "../utils/helpers";
import { buildWorkoutSessionPayloadFromDraft } from "../utils/workoutSessions";
import {
    attachWorkoutDurationToHistoryDate,
    getExerciseRecordBodyPart,
    getSetDisplayUnit,
    storeSetWeightForUnit,
} from "../utils/appHelpers";
import {
    buildWorkoutDaySummary,
    buildWorkoutDaySummaryPrKey,
} from "../utils/workoutDaySummary";
import { calcPrEntries } from "../utils/prCalculation";

export function useWorkoutDaySummaryBuilder({
    logDate,
    exercises,
    logData,
    todayLabels,
    unit,
    user,
    persistHistoryForUser,
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
    bodyWeightKg = null,
}) {
    const buildDraftWorkoutDaySummary = useCallback(async (targetDate, options = {}) => {
        const normalizedDate = String(targetDate || "").trim();
        if (!normalizedDate) return null;

        const entries = exercises
            .map((exercise, index) => {
                const exerciseName = String(exercise?.name || "").trim();
                if (!exerciseName) return null;

                const exUnit = typeof getExUnit === "function" ? getExUnit(exerciseName) : unit;
                const rawSets = (logData[exerciseName] || []).map((set) => ({
                    ...set,
                    weight: storeSetWeightForUnit(set, exUnit),
                    displayWeight: set.weight,
                    displayUnit: getSetDisplayUnit(set, exUnit),
                }));
                const validSetCount = countValidSets(rawSets);
                if (validSetCount === 0) return null;

                const sets = sanitizeWorkoutSets(rawSets, { allowBodyweight: true });

                const bodyPart = getExerciseRecordBodyPart(exercise, todayLabels[0] || null);
                const volume = sets.reduce((sum, set) => {
                    const weight = resolveEffectiveWeightKg(set, bodyWeightKg);
                    if (weight == null) return sum;
                    const reps = Number(set?.reps);
                    if (!Number.isFinite(reps) || reps <= 0) return sum;
                    return sum + weight * reps;
                }, 0);

                return {
                    id: `${exerciseName}-${normalizedDate}-${index}`,
                    name: exerciseName,
                    bodyPart,
                    sets,
                    setCount: validSetCount,
                    volume,
                };
            })
            .filter(Boolean);

        const prEntryItems = calcPrEntries(
            entries.map((entry) => ({
                exerciseName: entry.name,
                bodyPart: entry.bodyPart,
                sets: entry.sets,
            })),
            getPreviousPR || getPR
                ? (exerciseObj, opts) => {
                    const ex = exercises.find((e) => e.name === exerciseObj.name) || exerciseObj;
                    return getPreviousPR
                        ? getPreviousPR(ex, opts)
                        : (getPR ? getPR(ex) : null);
                }
                : null,
            normalizedDate,
            { bodyWeightKg }
        );

        const prKeys = prEntryItems.map((e) =>
            buildWorkoutDaySummaryPrKey(e.bodyPart, e.exerciseName)
        );

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
            bodyWeightKg,
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
    }, [bodyWeightKg, exercises, getExUnit, getPR, getPreviousPR, logData, savedWorkoutDurationSecByDate, todayLabels, unit, user?.id, workoutTimerStateRef]);

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
                persistHistoryForUser(user?.id, next, { source: "useWorkoutDaySummaryBuilder:finishTimer" });
                return next;
            });
            queueWorkoutSessionSync(logDate);
        }
        setSummary(nextSummary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [buildDraftWorkoutDaySummary, finishWorkoutTimer, historyRevisionRef, logDate, queueWorkoutSessionSync, setSavedWorkoutDurationSecByDate, user?.id]);

    return { buildDraftWorkoutDaySummary, handleFinishWorkoutTimerAndShowSummary };
}
