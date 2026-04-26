import { calc1RM } from "../utils/helpers";
import {
    copySetDownHelper,
    copyRepDownHelper,
} from "../utils/workoutHelpers";

export const useWorkout = ({ history, manualBests = [], sessionHistory, setLogData, getExSets, getExUnit, KG_TO_LBS }) => {
    const buildValidSets = (record) => {
        const sourceSets = Array.isArray(record?.sets) && record.sets.length > 0
            ? record.sets
            : [{ weight: record?.weight, reps: record?.reps }];

        return sourceSets.filter((s) => {
            const w = Number(s.weight);
            const reps = Number(s.reps);
            return Number.isFinite(w) && Number.isFinite(reps) && w > 0 && reps > 0;
        });
    };

    const getPrev = (name) => {
        const r = (sessionHistory || history)[name];
        return r ? r[r.length - 1] : null;
    };

    const getPR = (name) => {
        const recs = history?.[name]; // sessionHistoryを使わない
        let best = null;
        let bestRM = 0;

        (recs || []).forEach((r) => {
            const validSets = buildValidSets(r);
            const rm = calc1RM(validSets);

            if (rm > bestRM && validSets.length) {
                bestRM = rm;
                best = { ...r, sets: validSets, rm: Math.round(rm) };
            }
        });

        manualBests
            .filter((entry) => entry?.exercise_name === name)
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
        copySetDown,
        copyRepDown,
    };
};
