import { getRoutineKey } from "../utils/workoutHelpers";
import { save } from "../utils/helpers";

const KG_TO_LBS = 2.20462;

const normalizeWeightMode = (value) => {
    const unit = String(value || "kg").toLowerCase();
    if (unit === "lbs" || unit === "lb" || unit === "pound" || unit === "pounds") return "lbs";
    if (unit === "bw" || unit === "bodyweight") return "BW";
    return "kg";
};

const getSetWeightMode = (set, fallbackUnit = "kg") =>
    normalizeWeightMode(
        set?.weightMode
        || set?.weightType
        || set?.displayUnit
        || set?.unit
        || set?.weightUnit
        || set?.weight_unit
        || fallbackUnit
    );

const formatWeightValue = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return "";
    const rounded = Math.round(num * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded);
};

const convertWeightDisplay = (value, fromUnit, toUnit) => {
    const rawValue = String(value ?? "").trim();
    if (!rawValue || rawValue.toUpperCase() === "BW") return "";

    const num = Number(rawValue);
    if (!Number.isFinite(num) || num <= 0) return "";

    const sourceUnit = normalizeWeightMode(fromUnit);
    const targetUnit = normalizeWeightMode(toUnit);
    if (sourceUnit === targetUnit) return formatWeightValue(num);
    if (sourceUnit === "kg" && targetUnit === "lbs") return formatWeightValue(num * KG_TO_LBS);
    if (sourceUnit === "lbs" && targetUnit === "kg") return formatWeightValue(num / KG_TO_LBS);
    return formatWeightValue(num);
};

const withWeightMode = (set, mode) => ({
    ...set,
    weightMode: mode,
    weightType: mode,
    unit: mode,
    displayUnit: mode === "lbs" ? "lb" : mode,
    weightUnit: mode,
    weight_unit: mode,
});

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
    getExUnit,
    onWorkoutContentChange,
}) {

    const addSet = (ex) => {
        setLogData((p) => {
            const key = ex.name;
            const defaultUnit = normalizeWeightMode(typeof getExUnit === "function" ? getExUnit(key) : "kg");
            const current = p[key]
                ? p[key].map((s) => ({ ...s }))
                : getExSets(ex);

            const next = {
                ...p,
                [key]: [
                    ...current,
                    withWeightMode({
                        weight: defaultUnit === "BW" ? "BW" : "",
                        reps: "",
                        done: false,
                    }, defaultUnit),
                ],
            };

            save("draft_logData", next);
            save("draft_logDate", logDate);
            return next;
        });
    };

    const setField = (ex, idx, field, value) => {
        const key = ex.name;

        setLogData((p) => {
            const current = p[key]
                ? p[key].map((s) => ({ ...s }))
                : getExSets(ex);

            const fallbackUnit = typeof getExUnit === "function" ? getExUnit(key) : "kg";
            const beforeSet = { ...(current[idx] || {}) };
            const updated = withWeightMode(
                { ...current[idx], [field]: value },
                getSetWeightMode(current[idx], fallbackUnit)
            );

            if (field !== "done") {
                const isDone =
                    (updated.weight || updated.weight === "BW") && updated.reps;
                updated.done = isDone;
            }

            current[idx] = updated;
            if (field === "weight" || field === "reps") {
                onWorkoutContentChange?.(field === "weight" ? "weight_change" : "reps_change", {
                    exerciseName: key,
                    setIndex: idx,
                    beforeSet,
                    afterSet: updated,
                    explicitEdit: true,
                });
            }

            const next = { ...p, [key]: current };

            save("draft_logData", next);
            return next;
        });
    };

    const setWeightMode = (ex, idx, requestedMode) => {
        const key = ex.name;

        setLogData((p) => {
            const current = p[key]
                ? p[key].map((s) => ({ ...s }))
                : getExSets(ex);

            const target = current[idx] || { weight: "", reps: "", done: false };
            const fallbackUnit = typeof getExUnit === "function" ? getExUnit(key) : "kg";
            const currentMode = getSetWeightMode(target, fallbackUnit);
            const nextMode = requestedMode
                ? normalizeWeightMode(requestedMode)
                : ({ kg: "lbs", lbs: "BW", BW: "kg" }[currentMode] || "kg");

            let nextSet = { ...target };

            if (nextMode === "BW") {
                const rawWeight = String(target.weight ?? "").trim();
                const numericWeight = Number(rawWeight);
                const hasWeightedValue =
                    rawWeight
                    && rawWeight.toUpperCase() !== "BW"
                    && Number.isFinite(numericWeight)
                    && numericWeight > 0;

                nextSet = {
                    ...nextSet,
                    weight: "BW",
                    lastWeightedValue: hasWeightedValue ? formatWeightValue(numericWeight) : target.lastWeightedValue,
                    lastWeightedUnit: hasWeightedValue ? currentMode : target.lastWeightedUnit || currentMode,
                };
            } else if (currentMode === "BW") {
                const restoredWeight = convertWeightDisplay(
                    target.lastWeightedValue,
                    target.lastWeightedUnit || nextMode,
                    nextMode
                );

                nextSet = {
                    ...nextSet,
                    weight: restoredWeight,
                    lastWeightedValue: restoredWeight || target.lastWeightedValue,
                    lastWeightedUnit: restoredWeight ? nextMode : target.lastWeightedUnit,
                };
            } else {
                const displayWeight = String(target.weight ?? "").trim();

                nextSet = {
                    ...nextSet,
                    weight: displayWeight || "",
                    lastWeightedValue: displayWeight || target.lastWeightedValue,
                    lastWeightedUnit: displayWeight ? nextMode : target.lastWeightedUnit,
                };
            }

            nextSet = withWeightMode(nextSet, nextMode);

            if (nextSet.weight === "BW") {
                nextSet.done = Boolean(nextSet.reps);
            } else if (nextSet.weight || nextSet.reps) {
                nextSet.done = Boolean(nextSet.weight && nextSet.reps);
            }

            const beforeSet = { ...target };
            current[idx] = nextSet;
            onWorkoutContentChange?.("unit_change", {
                exerciseName: key,
                setIndex: idx,
                beforeSet,
                afterSet: nextSet,
                explicitEdit: true,
            });

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
        setField,
        setWeightMode,
        saveLog,
    };
}
