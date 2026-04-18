export const useWorkout = (history) => {

    const getPrev = (name) => {
        const r = history[name];
        return r ? r[r.length - 1] : null;
    };

    const getPR = (name, calc1RM) => {
        const recs = history[name];
        if (!recs || !recs.length) return null;

        let best = null;
        let bestRM = 0;

        recs.forEach(r => {
            const rm = calc1RM(r.sets);
            if (rm > bestRM) {
                bestRM = rm;
                best = { ...r, rm: Math.round(rm) };
            }
        });

        return best;
    };

    return {
        getPrev,
        getPR,
    };
};