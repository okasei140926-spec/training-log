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

export const makeBaseSets = () => ([
    { weight: "", reps: "", done: false },
    { weight: "", reps: "", done: false },
    { weight: "", reps: "", done: false },
]);

export const getExistingSets = ({ history, name, logDate }) => {
    const records = history[name];
    if (!records) return null;

    const existing = records.find((r) => r.date === logDate);
    if (!existing || !existing.sets) return null;

    return existing.sets.map((s) => ({ ...s, done: true }));
};

export const getExSetsHelper = ({
    logData,
    history,
    name,
    logDate,
}) => {
    if (logData[name]) {
        return logData[name].map((s) => ({ ...s }));
    }

    const existing = getExistingSets({ history, name, logDate });
    if (existing && existing.length > 0) {
        return existing.map((s) => ({ ...s }));
    }

    return makeBaseSets();
};