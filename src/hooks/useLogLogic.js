import { getRoutineKey } from "../utils/workoutHelpers";

export function useLogLogic({
    todayLabels,
    sessionEx,
    setRoutineOrder,
}) {
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
        saveLog,
    };
}
