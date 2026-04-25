import { calc1RM } from "../utils/helpers";
import {
    copySetDownHelper,
    copyRepDownHelper,
} from "../utils/workoutHelpers";

export const useWorkout = ({ history, sessionHistory, setLogData, getExSets, getExUnit, KG_TO_LBS }) => {
    const getPrev = (name) => {
        const r = (sessionHistory || history)[name];
        return r ? r[r.length - 1] : null;
    };

    const getPR = (name) => {
        const recs = history?.[name]; // sessionHistoryを使わない
        if (!recs || !recs.length) return null;

        let best = null;
        let bestRM = 0;

        recs.forEach((r) => {
            const validSets = (r.sets || []).filter(s => {
                const w = Number(s.weight);
                const reps = Number(s.reps);
                return Number.isFinite(w) && Number.isFinite(reps) && w > 0 && reps > 0;
            })

            const rm = calc1RM(validSets);

            if (rm > bestRM) {
                bestRM = rm;
                best = { ...r, sets: validSets, rm: Math.round(rm) };
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