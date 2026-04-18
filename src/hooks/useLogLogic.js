import { getRoutineKey } from "../utils/workoutHelpers";

export function useLogLogic({
    logData,
    setLogData,
    history,
    setHistory,
    routineOrder,
    setRoutineOrder,
    todayLabels,
    sessionEx,
}) {

    const addSet = (ex) => {
        // 今のコードそのまま移動
    };

    const removeSet = (ex, idx) => {
        // 今のコードそのまま
    };

    const setField = (ex, idx, field, value) => {
        // そのまま
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