import { useCallback } from "react";
import { normalizeExerciseName } from "../utils/exerciseName";
import { getPrimaryDefaultBodyPartLabel } from "../utils/bodyPartClassification";

export function useWorkoutHandlers({
    workoutLog,
    todayLabels,
    logDate,
    user,
    addTarget,
    setMuscleEx,
    setExerciseBodyPartOverrides,
    requestLogExerciseFocus,
    startWorkoutTimerIfNeeded,
    shouldLogPerfDebug,
    getRuntimeEnvironmentLabel,
    renameCustomExercise,
}) {
    const setExerciseOverrideForLabel = useCallback((exerciseName, label) => {
        const normalizedName = normalizeExerciseName(exerciseName);
        if (!normalizedName) return;

        const primaryDefaultLabel = getPrimaryDefaultBodyPartLabel(normalizedName);

        setExerciseBodyPartOverrides((prev) => {
            const next = { ...prev };

            if (!label || label === primaryDefaultLabel) {
                delete next[normalizedName];
                return next;
            }

            next[normalizedName] = label;
            return next;
        });
    }, [setExerciseBodyPartOverrides]);

    const clearExerciseOverrideForLabel = useCallback((exerciseName, label) => {
        const normalizedName = normalizeExerciseName(exerciseName);
        if (!normalizedName) return;

        setExerciseBodyPartOverrides((prev) => {
            if (prev[normalizedName] !== label) return prev;
            const next = { ...prev };
            delete next[normalizedName];
            return next;
        });
    }, [setExerciseBodyPartOverrides]);

    const removeEx = (idOrName, maybeName) => {
        const isNameOnly = maybeName === undefined;
        const targetName = isNameOnly ? idOrName : maybeName;
        workoutLog.removeExercise(idOrName, maybeName);
        clearExerciseOverrideForLabel(targetName, todayLabels[0]);
    };

    const addExToSession = (name, labelOverride, options = {}) => {
        const trimmed = String(name || "").trim();
        if (!trimmed) {
            console.error("[add-exercise] failed: empty exercise name", {
                labelOverride,
                logDate,
            });
            return;
        }

        const normalizedName = normalizeExerciseName(trimmed);
        const label = labelOverride || todayLabels[0] || getPrimaryDefaultBodyPartLabel(normalizedName) || "その他";
        if (!label) {
            console.error("[add-exercise] failed: missing body part label", {
                name: trimmed,
                labelOverride,
                todayLabels,
                logDate,
            });
            return;
        }
        const beforeExercises = workoutLog.exercises || [];
        const beforeNames = beforeExercises.map((e) => e.name);
        const existingExercise = beforeExercises.find(
            (e) => normalizeExerciseName(e.name) === normalizedName
        );
        const alreadyInSession = !!existingExercise;

        if (alreadyInSession) {
            if (shouldLogPerfDebug()) console.log("[add-exercise] duplicate ignored", {
                action: "exercise_add_attempt",
                env: getRuntimeEnvironmentLabel(),
                date: logDate,
                user_id: user?.id || null,
                name: trimmed,
                exerciseName: trimmed,
                bodyPart: label,
                label,
                before: beforeNames,
                beforeExerciseNames: beforeNames,
                afterExerciseNames: beforeNames,
                added: false,
                blocked: false,
                blockedReason: null,
                duplicateDetected: true,
                filteredOut: false,
                removedExerciseNames: [],
            });
            requestLogExerciseFocus(existingExercise);
            return;
        }

        const ex = {
            id: Date.now() + (Math.random() * 1000 | 0),
            name: trimmed,
            label,
            bodyPart: label,
        };
        const nextSessionForDraft = [...beforeExercises, ex];
        const afterNames = nextSessionForDraft.map((exercise) => exercise.name);
        const removedExerciseNames = beforeNames.filter((beforeName) => {
            const normalizedBefore = normalizeExerciseName(beforeName);
            return normalizedBefore && !afterNames.some((afterName) => normalizeExerciseName(afterName) === normalizedBefore);
        });
        const beforeSetCount = beforeExercises.reduce((sum, exercise) => sum + ((exercise.sets || []).length || 0), 0);
        const afterSetCount = nextSessionForDraft.reduce((sum, exercise) => sum + ((exercise.sets || []).length || 0), 0);
        const blockedReason = removedExerciseNames.length
            ? "exercise add would remove existing exercises"
            : afterNames.length < beforeNames.length
                ? "exercise add would reduce exercise count"
                : afterSetCount < beforeSetCount
                    ? "exercise add would reduce set count"
                    : null;

        const action = options.action || "exercise_add";

        if (shouldLogPerfDebug() || blockedReason) console[blockedReason ? "warn" : "log"]("[exercise mutation]", {
            action,
            env: getRuntimeEnvironmentLabel(),
            date: logDate,
            user_id: user?.id || null,
            addedExerciseName: trimmed,
            removedExerciseNames,
            beforeExerciseNames: beforeNames,
            afterExerciseNames: afterNames,
            beforeSetCount,
            afterSetCount,
            selectedBodyPartFilter: labelOverride || todayLabels[0] || null,
            explicitDelete: false,
            allowed: !blockedReason,
            blockedReason,
        });

        if (shouldLogPerfDebug() || blockedReason) console[blockedReason ? "warn" : "log"]("[exercise add]", {
            action: "exercise_add_attempt",
            env: getRuntimeEnvironmentLabel(),
            date: logDate,
            user_id: user?.id || null,
            exerciseName: trimmed,
            bodyPart: label,
            beforeExerciseNames: beforeNames,
            afterExerciseNames: afterNames,
            beforeSetCount,
            afterSetCount,
            added: !blockedReason,
            blocked: Boolean(blockedReason),
            blockedReason,
            duplicateDetected: false,
            filteredOut: false,
            removedExerciseNames,
            selectedBodyPartFilter: labelOverride || todayLabels[0] || null,
            explicitDelete: false,
        });

        if (blockedReason) return;

        if (shouldLogPerfDebug()) console.log("[add-exercise] adding exercise", {
            name: trimmed,
            label,
            before: beforeNames,
            after: afterNames,
        });

        workoutLog.addExercise(ex, label, { reason: "exercise_add" });

        const muscleExLabel = getPrimaryDefaultBodyPartLabel(normalizedName) || label;
        setMuscleEx((prev) => {
            const next = { ...prev };
            const list = next[muscleExLabel] || [];

            if (!list.find((e) => e.name === trimmed)) {
                next[muscleExLabel] = [...list, { id: Date.now(), name: trimmed }];
            }

            return next;
        });

        setExerciseOverrideForLabel(trimmed, label);

        if (!alreadyInSession) {
            requestLogExerciseFocus(ex);
            startWorkoutTimerIfNeeded(logDate, { markAsActivity: true });
        }
    };

    const reorderEx = (fromIdx, toIdx) => {
        workoutLog.reorderExercise(fromIdx, toIdx);
    };

    const renameEx = (id, newName) => {
        const trimmed = newName.trim();
        if (!trimmed) return;

        const oldEx = (workoutLog.exercises || []).find((e) => e.id === id);
        if (!oldEx || oldEx.name === trimmed) return;

        workoutLog.renameExercise(id, trimmed);

        // muscleExも更新
        setMuscleEx((p) => {
            const next = { ...p };
            Object.keys(next).forEach((label) => {
                next[label] = next[label].map((e) =>
                    e.name === oldEx.name ? { ...e, name: trimmed } : e
                );
            });
            return next;
        });

        setExerciseBodyPartOverrides((prev) => {
            const oldKey = normalizeExerciseName(oldEx.name);
            if (!prev[oldKey]) return prev;
            const next = { ...prev };
            next[normalizeExerciseName(trimmed)] = prev[oldKey];
            delete next[oldKey];
            return next;
        });

        renameCustomExercise?.(oldEx.name, trimmed);
    };

    const quickAdd = (name, remove, labelOverride, options = {}) => {
        if (remove) {
            removeEx(name);
            const tgts = labelOverride
                ? [labelOverride]
                : Array.isArray(addTarget)
                    ? addTarget
                    : (addTarget ? [addTarget] : []);
            tgts.forEach((label) => clearExerciseOverrideForLabel(name, label));
            return;
        }
        addExToSession(name, labelOverride, options);
    };

    const quickAddToSession = (name, remove, labelOverride, options) => {
        quickAdd(name, remove, labelOverride, options);
    };

    return {
        setExerciseOverrideForLabel,
        clearExerciseOverrideForLabel,
        removeEx,
        addExToSession,
        reorderEx,
        renameEx,
        quickAdd,
        quickAddToSession,
    };
}
