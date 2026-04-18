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
}) {

    const addSet = (ex) => {
        // 今のコードそのまま移動
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