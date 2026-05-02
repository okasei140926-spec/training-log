import { calc1RM, getRecordSourceSets, sanitizeWorkoutSets } from "../utils/helpers";
import { normalizeExerciseName } from "../utils/exerciseName";
import { buildBodyPartExerciseKey, resolveRecordBodyPartLabel } from "../utils/bodyPartClassification";
import {
    copySetDownHelper,
    copyRepDownHelper,
} from "../utils/workoutHelpers";

export const useWorkout = ({
    history,
    manualBests = [],
    sessionHistory,
    setLogData,
    getExSets,
    getExUnit,
    KG_TO_LBS,
    muscleEx = {},
    exerciseBodyPartOverrides = {},
}) => {
    const buildValidSets = (record) => {
        return sanitizeWorkoutSets(getRecordSourceSets(record), { allowBodyweight: false });
    };

    const getTargetInfo = (target) => {
        if (typeof target === "string") {
            return {
                name: target,
                normalizedName: normalizeExerciseName(target),
                bodyPart: null,
            };
        }

        return {
            name: target?.name || "",
            normalizedName: normalizeExerciseName(target?.name),
            bodyPart: String(target?.bodyPart || target?.label || "").trim() || null,
        };
    };

    const buildRecordKey = (historyName, record, targetInfo) => {
        const bodyPart = resolveRecordBodyPartLabel(record, historyName, {
            muscleEx,
            exerciseBodyPartOverrides,
        });
        if (!bodyPart) return null;
        return buildBodyPartExerciseKey(bodyPart, targetInfo?.normalizedName || historyName);
    };

    const buildManualEntryKey = (entry) => {
        const bodyPart = resolveRecordBodyPartLabel(
            { bodyPart: entry?.body_part },
            entry?.exercise_name,
            { muscleEx, exerciseBodyPartOverrides }
        );
        if (!bodyPart) return null;
        return buildBodyPartExerciseKey(bodyPart, entry?.exercise_name);
    };

    const isTargetMatch = (key, targetInfo) => {
        if (!key || !targetInfo?.normalizedName) return false;
        if (!targetInfo.bodyPart) return key.endsWith(`::${targetInfo.normalizedName}`) || key === buildBodyPartExerciseKey("", targetInfo.normalizedName);
        return key === buildBodyPartExerciseKey(targetInfo.bodyPart, targetInfo.normalizedName);
    };

    const getPrev = (target) => {
        const targetInfo = getTargetInfo(target);
        const records = (sessionHistory || history)[targetInfo.name];
        if (!records?.length) return null;

        const filtered = records.filter((record) => {
            const key = buildRecordKey(targetInfo.name, record, targetInfo);
            return isTargetMatch(key, targetInfo);
        });

        return filtered.length ? filtered[filtered.length - 1] : null;
    };

    const getPR = (target) => {
        const targetInfo = getTargetInfo(target);
        let best = null;
        let bestRM = 0;

        Object.entries(history || {}).forEach(([historyName, recs]) => {
            if (normalizeExerciseName(historyName) !== targetInfo.normalizedName) return;

            (recs || []).forEach((r) => {
                const key = buildRecordKey(historyName, r, targetInfo);
                if (!isTargetMatch(key, targetInfo)) return;

                const validSets = buildValidSets(r);
                const rm = calc1RM(validSets);

                if (rm > bestRM && validSets.length) {
                    bestRM = rm;
                    best = { ...r, sets: validSets, rm };
                }
            });
        });

        manualBests
            .filter((entry) => normalizeExerciseName(entry?.exercise_name) === targetInfo.normalizedName)
            .forEach((entry) => {
                const key = buildManualEntryKey(entry);
                if (!isTargetMatch(key, targetInfo)) return;

                const validSets = buildValidSets({
                    weight: entry.weight,
                    reps: entry.reps,
                });
                const rm = calc1RM(validSets);

                if (rm > bestRM && validSets.length) {
                    bestRM = rm;
                    best = {
                        date: entry.best_date || null,
                        weight: Number(entry.weight),
                        reps: Number(entry.reps),
                        sets: validSets,
                        rm,
                        isManualBest: true,
                        id: entry.id,
                    };
                }
            });

        return best;
    };

    const getPreviousPR = (target, { excludeDate } = {}) => {
        const targetInfo = getTargetInfo(target);
        let best = null;
        let bestRM = 0;

        Object.entries(history || {}).forEach(([historyName, recs]) => {
            if (normalizeExerciseName(historyName) !== targetInfo.normalizedName) return;

            (recs || []).forEach((r) => {
                if (excludeDate && r?.date === excludeDate) return;
                const key = buildRecordKey(historyName, r, targetInfo);
                if (!isTargetMatch(key, targetInfo)) return;

                const validSets = buildValidSets(r);
                const rm = calc1RM(validSets);

                if (rm > bestRM && validSets.length) {
                    bestRM = rm;
                    best = { ...r, sets: validSets, rm };
                }
            });
        });

        manualBests
            .filter((entry) => normalizeExerciseName(entry?.exercise_name) === targetInfo.normalizedName)
            .forEach((entry) => {
                const key = buildManualEntryKey(entry);
                if (!isTargetMatch(key, targetInfo)) return;

                const validSets = buildValidSets({
                    weight: entry.weight,
                    reps: entry.reps,
                });
                const rm = calc1RM(validSets);

                if (rm > bestRM && validSets.length) {
                    bestRM = rm;
                    best = {
                        date: entry.best_date || null,
                        weight: Number(entry.weight),
                        reps: Number(entry.reps),
                        sets: validSets,
                        rm,
                        isManualBest: true,
                        id: entry.id,
                    };
                }
            });

        return best;
    };

    const copySetDown = (name, idx) => {
        setLogData((p) => {
            const base = getExSets({ name });
            const current = [...(p[name] || base)];

            return {
                ...p,
                [name]: copySetDownHelper({ currentSets: current, idx }),
            };
        });
    };

    const copyRepDown = (name, idx) => {
        setLogData((p) => {
            const base = getExSets({ name });
            const current = [...(p[name] || base)];

            return {
                ...p,
                [name]: copyRepDownHelper({ currentSets: current, idx }),
            };
        });
    };

    return {
        getPrev,
        getPR,
        getPreviousPR,
        copySetDown,
        copyRepDown,
    };
};
