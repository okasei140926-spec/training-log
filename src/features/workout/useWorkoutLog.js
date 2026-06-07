import { useCallback, useMemo, useState } from "react";
import { normalizeExerciseName } from "../../utils/exerciseName";
import {
  loadWorkoutDraft,
  saveWorkoutDraft,
  withWorkoutDraftMeta,
} from "./workoutDraftStore";

const normalizeDateKey = (value) => String(value || "").slice(0, 10);

const makeSet = (set = {}) => ({
  weight: set.weight ?? 0,
  reps: set.reps ?? 0,
  unit: set.unit || set.displayUnit || set.weightUnit || "kg",
  displayUnit: set.displayUnit || set.unit || set.weightUnit || "kg",
  done: Boolean(set.done),
  ...set,
});

const makeDefaultSets = () => ([
  makeSet(),
  makeSet(),
  makeSet(),
]);

const makeExercise = (exercise = {}) => ({
  id: exercise.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  name: String(exercise.name || exercise.exerciseName || "").trim(),
  bodyPart: String(exercise.bodyPart || exercise.body_part || "").trim(),
  sets: Array.isArray(exercise.sets) && exercise.sets.length
    ? exercise.sets.map(makeSet)
    : makeDefaultSets(),
  ...exercise,
});

const getExerciseNames = (exercises = []) => exercises.map((exercise) => exercise.name).filter(Boolean);

const getTotalSetCount = (exercises = []) =>
  (exercises || []).reduce((sum, exercise) => sum + (exercise?.sets || []).length, 0);

const getRemovedExerciseNames = (before = [], after = []) => {
  const afterNames = new Set(after.map((exercise) => normalizeExerciseName(exercise.name)).filter(Boolean));
  return before
    .map((exercise) => exercise.name)
    .filter((name) => {
      const normalized = normalizeExerciseName(name);
      return normalized && !afterNames.has(normalized);
    });
};

const createInitialDraft = (date, initialDraft = {}) => withWorkoutDraftMeta(date, {
  exercises: (initialDraft.exercises || initialDraft.sessionEx || []).map(makeExercise),
  logData: initialDraft.logData || {},
  exerciseUnits: initialDraft.exerciseUnits || {},
}, {
  source: initialDraft.meta?.source || "initial",
  hasUnsavedChanges: Boolean(initialDraft.meta?.hasUnsavedChanges),
});

export function useWorkoutLog({
  date,
  initialDraft = null,
  storage,
  logger = console,
} = {}) {
  const normalizedDate = normalizeDateKey(date);
  const [draft, setDraft] = useState(() => {
    const storedDraft = loadWorkoutDraft(normalizedDate, { storage, logger });
    return createInitialDraft(normalizedDate, storedDraft || initialDraft || {});
  });

  const persistDraft = useCallback((nextDraft, reason) => {
    const datedDraft = withWorkoutDraftMeta(normalizedDate, nextDraft, {
      source: reason,
      hasUnsavedChanges: true,
    });
    saveWorkoutDraft(normalizedDate, datedDraft, { storage, logger });
    return datedDraft;
  }, [logger, normalizedDate, storage]);

  const mutateExercises = useCallback((reason, updater) => {
    setDraft((prevDraft) => {
      const beforeExercises = prevDraft.exercises || [];
      const afterExercises = updater(beforeExercises).map(makeExercise);
      const removedExerciseNames = getRemovedExerciseNames(beforeExercises, afterExercises);
      const beforeSetCount = getTotalSetCount(beforeExercises);
      const afterSetCount = getTotalSetCount(afterExercises);
      const isDelete = reason === "exercise_remove" || reason === "set_remove";

      if (!isDelete && (removedExerciseNames.length || afterSetCount < beforeSetCount)) {
        logger?.warn?.("[workout log] blocked non-delete exercise regression", {
          action: "workout_restore_integrity_check",
          date: normalizedDate,
          previousDisplayedExerciseNames: getExerciseNames(beforeExercises),
          restoredExerciseNames: getExerciseNames(afterExercises),
          lostExerciseNames: removedExerciseNames,
          beforeSetCount,
          afterSetCount,
          appliedSource: null,
          rejectedSource: reason,
          reason: removedExerciseNames.length
            ? "non-delete mutation removed exercises"
            : "non-delete mutation reduced set count",
        });
        return prevDraft;
      }

      return persistDraft({
        ...prevDraft,
        exercises: afterExercises,
      }, reason);
    });
  }, [logger, normalizedDate, persistDraft]);

  const addExercise = useCallback((exercise) => {
    const nextExercise = makeExercise(exercise);
    if (!nextExercise.name) return;

    mutateExercises("exercise_add", (exercises) => {
      const duplicate = exercises.some((existing) =>
        normalizeExerciseName(existing.name) === normalizeExerciseName(nextExercise.name)
      );
      logger?.log?.("[workout log] exercise add attempt", {
        action: "exercise_add_attempt",
        date: normalizedDate,
        exerciseName: nextExercise.name,
        bodyPart: nextExercise.bodyPart,
        beforeExerciseNames: getExerciseNames(exercises),
        afterExerciseNames: duplicate ? getExerciseNames(exercises) : getExerciseNames([...exercises, nextExercise]),
        added: !duplicate,
        blocked: duplicate,
        blockedReason: duplicate ? "duplicate exercise" : "",
        duplicateDetected: duplicate,
        filteredOut: false,
        removedExerciseNames: [],
      });
      if (duplicate) return exercises;
      return [...exercises, nextExercise];
    });
  }, [logger, mutateExercises, normalizedDate]);

  const removeExercise = useCallback((exerciseName) => {
    mutateExercises("exercise_remove", (exercises) =>
      exercises.filter((exercise) =>
        normalizeExerciseName(exercise.name) !== normalizeExerciseName(exerciseName)
      )
    );
  }, [mutateExercises]);

  const addSet = useCallback((exerciseName) => {
    mutateExercises("set_add", (exercises) =>
      exercises.map((exercise) => {
        if (normalizeExerciseName(exercise.name) !== normalizeExerciseName(exerciseName)) return exercise;
        return {
          ...exercise,
          sets: [...(exercise.sets || []), makeSet()],
        };
      })
    );
  }, [mutateExercises]);

  const updateSet = useCallback((exerciseName, setIndex, patch) => {
    mutateExercises("set_input_change", (exercises) =>
      exercises.map((exercise) => {
        if (normalizeExerciseName(exercise.name) !== normalizeExerciseName(exerciseName)) return exercise;
        const nextUnit = patch?.unit || patch?.displayUnit || patch?.weightUnit || patch?.weight_unit || patch?.weightMode;
        const shouldPropagateUnit = setIndex === 0 && nextUnit;
        const beforeUnits = (exercise.sets || []).map((set) => set?.unit || set?.displayUnit || set?.weightUnit || "kg");
        const propagatedToSetIndexes = [];
        const skippedManualSetIndexes = [];
        const nextSets = (exercise.sets || []).map((set, index) => {
          if (index === setIndex) {
            return makeSet({
              ...set,
              ...patch,
              ...(nextUnit
                ? {
                    unit: nextUnit,
                    displayUnit: nextUnit === "lbs" ? "lb" : nextUnit,
                    unitManuallyChanged: true,
                  }
                : {}),
            });
          }
          if (shouldPropagateUnit) {
            if (set?.unitManuallyChanged) {
              skippedManualSetIndexes.push(index);
              return set;
            }
            propagatedToSetIndexes.push(index);
            return makeSet({
              ...set,
              unit: nextUnit,
              displayUnit: nextUnit === "lbs" ? "lb" : nextUnit,
            });
          }
          return set;
        });

        if (shouldPropagateUnit) {
          logger?.log?.("[workout log] unit change propagation", {
            action: "unit_change_propagation",
            exerciseName,
            changedSetIndex: setIndex,
            changedUnit: nextUnit,
            propagatedToSetIndexes,
            skippedManualSetIndexes,
            beforeUnits,
            afterUnits: nextSets.map((set) => set?.unit || set?.displayUnit || set?.weightUnit || "kg"),
          });
        }

        return {
          ...exercise,
          sets: nextSets,
        };
      })
    );
  }, [logger, mutateExercises]);

  const api = useMemo(() => ({
    date: normalizedDate,
    draft,
    exercises: draft.exercises || [],
    addExercise,
    removeExercise,
    addSet,
    updateSet,
  }), [addExercise, addSet, draft, normalizedDate, removeExercise, updateSet]);

  return api;
}

export default useWorkoutLog;
