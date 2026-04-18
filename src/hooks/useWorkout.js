import { calc1RM } from "../utils/helpers";
import {
    copySetDownHelper,
    copyRepDownHelper,
} from "../utils/workoutHelpers";

export const useWorkout = ({ history, setLogData, getExSets }) => {
    const getPrev = (name) => {
        const r = history[name];
        return r ? r[r.length - 1] : null;
    };

    const getPR = (name) => {
        const recs = history[name];
        if (!recs || !recs.length) return null;

        let best = null;
        let bestRM = 0;

        recs.forEach((r) => {
            const rm = calc1RM(r.sets);
            if (rm > bestRM) {
                bestRM = rm;
                best = { ...r, rm: Math.round(rm) };
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