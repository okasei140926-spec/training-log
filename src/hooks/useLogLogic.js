import { getRoutineKey } from "../utils/workoutHelpers";
import { save } from "../utils/helpers";

export function useLogLogic({
    logData,
    setLogData,
    history,
    setHistory,
    routineOrder,
    setRoutineOrder,
    todayLabels,
    sessionEx,
    getExSets,
    logDate,
}) {

    const addSet = (ex) => {
        setLogData((p) => {
            const key = ex.name;
            const current = [...addSet(p[key] || getExSets(ex))];
            const next = {
                ...p,
                [key]: [...current, { weight: "", reps: "", done: false }],
            };

            save("draft_logData", next);
            save("draft_logDate", logDate);
            return next;
        })
    };

    const removeSet = (ex, idx) => {
        // 今のコードそのまま
    };

    const setField = (ex, idx, field, value) => {
        const key = ex.name;

        setLogData((p) => {
            const current = p[key]
                ? p[key].map((s) => ({ ...s }))
                : getExSets(ex);

            const updated = { ...current[idx], [field]: value };

            if (field !== "done") {
                const isDone =
                    (updated.weight || updated.weight === "BW") && updated.reps;
                updated.done = isDone;
            }

            current[idx] = updated;

            const next = { ...p, [key]: current };

            save("draft_logData", next);
            return next;
        });
    };

    const saveLog = () => {
        const key = getRoutineKey(todayLabels);

        if (key && sessionEx && sessionEx.length > 0) {
            setRoutineOrder(prev => ({
                ...prev,
                [key]: sessionEx.map(ex => ex.name),
            }));
        }
    };

    return {
        addSet,
        removeSet,
        setField,
        saveLog,
    };
}