export const getRoutineKey = (labels) => [...labels].sort().join("|");

export const buildBaseExercises = ({
    todayLabels,
    muscleEx,
    routineOrder,
}) => {
    const routineKey = getRoutineKey(todayLabels);

    const baseExercisesRaw = todayLabels.flatMap((label) =>
        (muscleEx[label] || []).map((ex) => ({ ...ex, label }))
    );

    const savedOrder = routineOrder[routineKey] || [];
    if (!savedOrder.length) return baseExercisesRaw;

    return savedOrder
        .map((name) => baseExercisesRaw.find((ex) => ex.name === name))
        .filter(Boolean)
        .concat(
            baseExercisesRaw.filter((ex) => !savedOrder.includes(ex.name))
        );
};

export const copySetDownHelper = ({ currentSets, idx }) => {
    if (idx >= currentSets.length - 1) return currentSets;

    const next = [...currentSets];
    next[idx + 1] = {
        ...next[idx + 1],
        weight: next[idx].weight,
    };
    return next;
};

export const copyRepDownHelper = ({ currentSets, idx }) => {
    if (idx >= currentSets.length - 1) return currentSets;

    const next = [...currentSets];
    next[idx + 1] = {
        ...next[idx + 1],
        reps: next[idx].reps,
    };
    return next;
};