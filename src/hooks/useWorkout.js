import { calc1RM, getRecordSourceSets, sanitizeWorkoutSets } from "../utils/helpers";
import { normalizeExerciseName } from "../utils/exerciseName";
import {
    copySetDownHelper,
    copyRepDownHelper,
} from "../utils/workoutHelpers";

export const useWorkout = ({ history, manualBests = [], sessionHistory, setLogData, getExSets, getExUnit, KG_TO_LBS }) => {
    const buildValidSets = (record) => {
        return sanitizeWorkoutSets(getRecordSourceSets(record), { allowBodyweight: false });
    };

    const getPrev = (name) => {
        const r = (sessionHistory || history)[name];
        return r ? r[r.length - 1] : null;
    };

    const getPR = (name) => {
        const normalizedName = normalizeExerciseName(name);
        let best = null;
        let bestRM = 0;

        Object.entries(history || {}).forEach(([historyName, recs]) => {
            if (normalizeExerciseName(historyName) !== normalizedName) return;

            (recs || []).forEach((r) => {
                const validSets = buildValidSets(r);
                const rm = calc1RM(validSets);

                if (rm > bestRM && validSets.length) {
                    bestRM = rm;
                    best = { ...r, sets: validSets, rm: Math.round(rm) };
                }
            });
        });

        manualBests
            .filter((entry) => normalizeExerciseName(entry?.exercise_name) === normalizedName)
            .forEach((entry) => {
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
                        rm: Math.round(rm),
                        isManualBest: true,
                        id: entry.id,
                    };
                }
            });

        return best;
    };

    const getPreviousPR = (name, { excludeDate } = {}) => {
        const normalizedName = normalizeExerciseName(name);
        let best = null;
        let bestRM = 0;

        Object.entries(history || {}).forEach(([historyName, recs]) => {
            if (normalizeExerciseName(historyName) !== normalizedName) return;

            (recs || []).forEach((r) => {
                if (excludeDate && r?.date === excludeDate) return;

                const validSets = buildValidSets(r);
                const rm = calc1RM(validSets);

                if (rm > bestRM && validSets.length) {
                    bestRM = rm;
                    best = { ...r, sets: validSets, rm: Math.round(rm) };
                }
            });
        });

        manualBests
            .filter((entry) => normalizeExerciseName(entry?.exercise_name) === normalizedName)
            .forEach((entry) => {
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
                        rm: Math.round(rm),
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
