import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeExerciseName } from "../../utils/exerciseName";
import {
  getWorkoutDraftSnapshotHash,
  loadWorkoutDraft,
  saveWorkoutDraft,
  withWorkoutDraftMeta,
} from "./workoutDraftStore";

const normalizeDateKey = (value) => String(value || "").slice(0, 10);

const normalizeWeightMode = (value) => {
  const unit = String(value || "kg").toLowerCase();
  if (unit === "lbs" || unit === "lb" || unit === "pound" || unit === "pounds") return "lbs";
  if (unit === "bw" || unit === "bodyweight" || unit === "自重") return "BW";
  return "kg";
};

const getDisplayUnitForMode = (mode) => {
  const normalized = normalizeWeightMode(mode);
  if (normalized === "lbs") return "lb";
  return normalized;
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

const withWeightMode = (set, mode) => {
  const normalizedMode = normalizeWeightMode(mode);
  return {
    ...set,
    weightMode: normalizedMode,
    weightType: normalizedMode,
    unit: normalizedMode,
    displayUnit: getDisplayUnitForMode(normalizedMode),
    weightUnit: normalizedMode,
    weight_unit: normalizedMode,
  };
};

const formatWeightValue = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "";
  const rounded = Math.round(num * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
};

const makeSet = (set = {}, fallbackUnit = "kg") => {
  const mode = getSetWeightMode(set, fallbackUnit);
  const hasWeight = Object.prototype.hasOwnProperty.call(set || {}, "weight");
  const weight = mode === "BW"
    ? (hasWeight && set.weight !== "" ? set.weight : "BW")
    : (hasWeight ? set.weight : "");
  const reps = Object.prototype.hasOwnProperty.call(set || {}, "reps") ? set.reps : "";

  return withWeightMode({
    ...set,
    weight,
    reps,
    done: Boolean(set?.done),
  }, mode);
};

const makeDefaultSets = (fallbackUnit = "kg") => ([
  makeSet({}, fallbackUnit),
  makeSet({}, fallbackUnit),
  makeSet({}, fallbackUnit),
]);

const makeExercise = (exercise = {}, {
  logData = {},
  exerciseUnits = {},
  fallbackLabel = "その他",
} = {}) => {
  const name = String(exercise.name || exercise.exerciseName || "").trim();
  const bodyPart = String(
    exercise.bodyPart
    || exercise.body_part
    || exercise.label
    || fallbackLabel
    || ""
  ).trim();
  const fallbackUnit = exerciseUnits[name] || "kg";
  const setsSource = Array.isArray(exercise.sets) && exercise.sets.length
    ? exercise.sets
    : (Array.isArray(logData[name]) && logData[name].length ? logData[name] : null);

  return {
    ...exercise,
    id: exercise.id || name || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    label: exercise.label || bodyPart || fallbackLabel,
    bodyPart: bodyPart || exercise.label || fallbackLabel,
    sets: setsSource ? setsSource.map((set) => makeSet(set, fallbackUnit)) : makeDefaultSets(fallbackUnit),
  };
};

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

const hasDraftContent = (draft = {}) => (
  (draft.exercises || []).length > 0
  || (draft.sessionEx || []).length > 0
  || Object.keys(draft.logData || {}).length > 0
);

const buildExercisesFromDraft = (initialDraft = {}) => {
  const logData = initialDraft.logData || {};
  const exerciseUnits = initialDraft.exerciseUnits || {};
  const labels = Array.isArray(initialDraft.todayLabels) ? initialDraft.todayLabels : [];
  const fallbackLabel = labels[0] || "その他";
  const sourceExercises = Array.isArray(initialDraft.exercises) && initialDraft.exercises.length
    ? initialDraft.exercises
    : (Array.isArray(initialDraft.sessionEx) ? initialDraft.sessionEx : []);
  const merged = [];
  const seen = new Set();

  sourceExercises.forEach((exercise) => {
    const nextExercise = makeExercise(exercise, { logData, exerciseUnits, fallbackLabel });
    const normalized = normalizeExerciseName(nextExercise.name);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    merged.push(nextExercise);
  });

  Object.keys(logData || {}).forEach((exerciseName) => {
    const normalized = normalizeExerciseName(exerciseName);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    merged.push(makeExercise({
      id: exerciseName,
      name: exerciseName,
      label: fallbackLabel,
      bodyPart: fallbackLabel,
    }, { logData, exerciseUnits, fallbackLabel }));
  });

  return merged;
};

const splitExercisesForApp = (exercises = [], previousExerciseUnits = {}) => {
  const logData = {};
  const sessionEx = [];
  const exerciseUnits = { ...(previousExerciseUnits || {}) };

  (exercises || []).forEach((exercise) => {
    const name = String(exercise?.name || "").trim();
    if (!name) return;
    const sets = (exercise.sets || []).map((set) => makeSet(set, exerciseUnits[name] || "kg"));
    logData[name] = sets;
    const firstSetUnit = sets[0]
      ? getSetWeightMode(sets[0], exerciseUnits[name] || "kg")
      : exerciseUnits[name];
    if (firstSetUnit) exerciseUnits[name] = firstSetUnit;
    sessionEx.push({
      ...exercise,
      sets: undefined,
    });
  });

  return { logData, sessionEx, exerciseUnits };
};

const createInitialDraft = (date, initialDraft = {}) => {
  const normalizedDate = normalizeDateKey(date);
  const exercises = buildExercisesFromDraft(initialDraft);
  const split = splitExercisesForApp(exercises, initialDraft.exerciseUnits || {});

  return withWorkoutDraftMeta(normalizedDate, {
    todayLabels: initialDraft.todayLabels || [],
    exercises,
    logData: split.logData,
    sessionEx: split.sessionEx,
    exerciseUnits: split.exerciseUnits,
  }, {
    source: initialDraft.meta?.source || "initial",
    hasUnsavedChanges: Boolean(initialDraft.meta?.hasUnsavedChanges),
    remoteVerifiedAt: initialDraft.meta?.remoteVerifiedAt || "",
  });
};

const updateSetForWeightMode = (set, nextMode, currentMode) => {
  const target = set || { weight: "", reps: "", done: false };
  const normalizedNextMode = normalizeWeightMode(nextMode);
  let nextSet = { ...target };

  if (normalizedNextMode === "BW") {
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
  } else if (normalizeWeightMode(currentMode) === "BW") {
    nextSet = {
      ...nextSet,
      weight: "",
    };
  } else {
    const displayWeight = String(target.weight ?? "").trim();
    nextSet = {
      ...nextSet,
      weight: displayWeight || "",
      lastWeightedValue: displayWeight || target.lastWeightedValue,
      lastWeightedUnit: displayWeight ? normalizedNextMode : target.lastWeightedUnit,
    };
  }

  nextSet = withWeightMode(nextSet, normalizedNextMode);
  if (nextSet.weight === "BW") {
    nextSet.done = Boolean(nextSet.reps);
  } else if (nextSet.weight || nextSet.reps) {
    nextSet.done = Boolean(nextSet.weight && nextSet.reps);
  }
  return nextSet;
};

export function useWorkoutLog({
  date,
  initialDraft = null,
  storage,
  logger = console,
  debug = false,
  debounceMs = 350,
  onDraftChange,
  onDraftPersist,
} = {}) {
  const normalizedDate = normalizeDateKey(date);
  const externalDraft = useMemo(() => {
    const normalizedInitialDraft = createInitialDraft(normalizedDate, initialDraft || {});
    if (hasDraftContent(normalizedInitialDraft)) return normalizedInitialDraft;
    const storedDraft = loadWorkoutDraft(normalizedDate, { storage, logger });
    return createInitialDraft(normalizedDate, storedDraft || {});
  }, [initialDraft, logger, normalizedDate, storage]);

  const [draft, setDraft] = useState(() => externalDraft);
  const lastMutationRef = useRef(null);
  const lastNotifiedHashRef = useRef("");
  const lastSavedHashRef = useRef("");

  useEffect(() => {
    const externalHash = getWorkoutDraftSnapshotHash(externalDraft);
    setDraft((prevDraft) => {
      const prevDate = normalizeDateKey(prevDraft?.date || prevDraft?.meta?.date);
      const prevHash = getWorkoutDraftSnapshotHash(prevDraft);
      if (prevDate === normalizedDate && prevHash === externalHash) return prevDraft;
      if (prevDate === normalizedDate && prevDraft?.meta?.hasUnsavedChanges) return prevDraft;
      lastMutationRef.current = null;
      return externalDraft;
    });
  }, [externalDraft, normalizedDate]);

  const draftHash = useMemo(() => getWorkoutDraftSnapshotHash(draft), [draft]);
  const splitDraft = useMemo(
    () => splitExercisesForApp(draft.exercises || [], draft.exerciseUnits || {}),
    [draft.exercises, draft.exerciseUnits]
  );

  useEffect(() => {
    const mutation = lastMutationRef.current;
    if (!mutation) return;
    if (lastNotifiedHashRef.current === draftHash) return;
    lastNotifiedHashRef.current = draftHash;

    onDraftChange?.({
      ...draft,
      ...splitDraft,
    }, mutation);
    lastMutationRef.current = null;
  }, [draft, draftHash, onDraftChange, splitDraft]);

  useEffect(() => {
    if (!draft?.meta?.hasUnsavedChanges) return undefined;
    if (lastSavedHashRef.current === draftHash) return undefined;

    const timeoutId = window.setTimeout(() => {
      const split = splitExercisesForApp(draft.exercises || [], draft.exerciseUnits || {});
      const draftToPersist = {
        ...draft,
        ...split,
      };
      saveWorkoutDraft(normalizedDate, draftToPersist, { storage, logger });
      onDraftPersist?.(draftToPersist, {
        source: "useWorkoutLog",
        hash: draftHash,
      });
      lastSavedHashRef.current = draftHash;
    }, debounceMs);

    return () => window.clearTimeout(timeoutId);
  }, [debounceMs, draft, draftHash, logger, normalizedDate, onDraftPersist, storage]);

  const persistMutation = useCallback((prevDraft, nextExercises, reason) => {
    const split = splitExercisesForApp(nextExercises, prevDraft.exerciseUnits || {});
    return withWorkoutDraftMeta(normalizedDate, {
      ...prevDraft,
      exercises: nextExercises,
      ...split,
    }, {
      source: reason,
      hasUnsavedChanges: true,
    });
  }, [normalizedDate]);

  const mutateExercises = useCallback((reason, updater, mutation = {}) => {
    setDraft((prevDraft) => {
      const beforeExercises = prevDraft.exercises || [];
      const afterExercises = updater(beforeExercises).map((exercise) =>
        makeExercise(exercise, {
          logData: prevDraft.logData || {},
          exerciseUnits: prevDraft.exerciseUnits || {},
          fallbackLabel: prevDraft.todayLabels?.[0] || "その他",
        })
      );
      const removedExerciseNames = getRemovedExerciseNames(beforeExercises, afterExercises);
      const beforeSetCount = getTotalSetCount(beforeExercises);
      const afterSetCount = getTotalSetCount(afterExercises);
      const explicitDelete = Boolean(mutation.explicitDelete || reason === "exercise_remove" || reason === "set_remove");

      if (!explicitDelete && (removedExerciseNames.length || afterSetCount < beforeSetCount)) {
        logger?.warn?.("[workout log] blocked non-delete regression", {
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

      const nextDraft = persistMutation(prevDraft, afterExercises, reason);
      lastMutationRef.current = {
        reason,
        explicitDelete,
        explicitEdit: !explicitDelete,
        details: mutation.details || null,
      };
      return nextDraft;
    });
  }, [logger, normalizedDate, persistMutation]);

  const addExercise = useCallback((exerciseInput, labelOverride, options = {}) => {
    const name = String(
      typeof exerciseInput === "string"
        ? exerciseInput
        : (exerciseInput?.name || exerciseInput?.exerciseName || "")
    ).trim();
    if (!name) return null;

    const label = labelOverride
      || (typeof exerciseInput === "object" ? (exerciseInput.bodyPart || exerciseInput.label) : "")
      || "その他";
    const nextExercise = makeExercise({
      ...(typeof exerciseInput === "object" ? exerciseInput : {}),
      id: (typeof exerciseInput === "object" && exerciseInput.id) || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name,
      label,
      bodyPart: label,
    }, {
      exerciseUnits: {},
      fallbackLabel: label,
    });

    mutateExercises(options.reason || "exercise_add", (exercises) => {
      const duplicate = exercises.some((existing) =>
        normalizeExerciseName(existing.name) === normalizeExerciseName(nextExercise.name)
      );
      if (debug) {
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
      }
      if (duplicate) return exercises;
      return [...exercises, nextExercise];
    }, {
      details: {
        exerciseName: name,
        bodyPart: label,
      },
    });

    return nextExercise;
  }, [debug, logger, mutateExercises, normalizedDate]);

  const removeExercise = useCallback((idOrName, maybeName) => {
    const isNameOnly = maybeName === undefined;
    const targetId = isNameOnly ? null : idOrName;
    const targetName = isNameOnly ? idOrName : maybeName;
    mutateExercises("exercise_delete", (exercises) =>
      exercises.filter((exercise) => {
        if (targetId !== null && exercise.id === targetId) return false;
        return normalizeExerciseName(exercise.name) !== normalizeExerciseName(targetName);
      }), {
        explicitDelete: true,
        details: { exerciseName: targetName },
      }
    );
  }, [mutateExercises]);

  const addSet = useCallback((exerciseInput) => {
    const exerciseName = String(exerciseInput?.name || exerciseInput || "").trim();
    if (!exerciseName) return;

    mutateExercises("set_add", (exercises) =>
      exercises.map((exercise) => {
        if (normalizeExerciseName(exercise.name) !== normalizeExerciseName(exerciseName)) return exercise;
        const currentSets = exercise.sets || [];
        const defaultUnit = currentSets.length
          ? getSetWeightMode(currentSets[0], "kg")
          : "kg";
        return {
          ...exercise,
          sets: [...currentSets, makeSet({}, defaultUnit)],
        };
      }), {
        details: { exerciseName },
      }
    );
  }, [mutateExercises]);

  const setField = useCallback((exerciseInput, setIndex, field, value) => {
    const exerciseName = String(exerciseInput?.name || exerciseInput || "").trim();
    if (!exerciseName) return;

    mutateExercises(field === "weight" ? "weight_change" : field === "reps" ? "reps_change" : "set_input_change", (exercises) =>
      exercises.map((exercise) => {
        if (normalizeExerciseName(exercise.name) !== normalizeExerciseName(exerciseName)) return exercise;
        const currentSets = exercise.sets || [];
        const beforeSet = currentSets[setIndex] || makeSet();
        const currentMode = getSetWeightMode(beforeSet, "kg");
        const nextSet = withWeightMode({
          ...beforeSet,
          [field]: value,
        }, currentMode);
        if (field !== "done") {
          nextSet.done = nextSet.weight === "BW"
            ? Boolean(nextSet.reps)
            : Boolean(nextSet.weight && nextSet.reps);
        }

        const nextSets = currentSets.map((set, index) => (index === setIndex ? nextSet : set));
        lastMutationRef.current = {
          reason: field === "weight" ? "weight_change" : field === "reps" ? "reps_change" : "set_input_change",
          explicitDelete: false,
          explicitEdit: true,
          details: {
            exerciseName,
            setIndex,
            beforeSet,
            afterSet: nextSet,
          },
        };
        return { ...exercise, sets: nextSets };
      }), {
        details: {
          exerciseName,
          setIndex,
        },
      }
    );
  }, [mutateExercises]);

  const setWeightMode = useCallback((exerciseInput, setIndex, requestedMode) => {
    const exerciseName = String(exerciseInput?.name || exerciseInput || "").trim();
    if (!exerciseName) return;

    mutateExercises("unit_change", (exercises) =>
      exercises.map((exercise) => {
        if (normalizeExerciseName(exercise.name) !== normalizeExerciseName(exerciseName)) return exercise;

        const currentSets = exercise.sets || [];
        const target = currentSets[setIndex] || makeSet();
        const currentMode = getSetWeightMode(target, "kg");
        const nextMode = requestedMode
          ? normalizeWeightMode(requestedMode)
          : ({ kg: "lbs", lbs: "BW", BW: "kg" }[currentMode] || "kg");
        const beforeSet = { ...target };
        const beforeUnits = currentSets.map((set) => getDisplayUnitForMode(getSetWeightMode(set, "kg")));
        const propagatedToSetIndexes = [];
        const skippedManualSetIndexes = [];
        const nextSets = currentSets.map((set, index) => {
          if (index === setIndex) {
            return {
              ...updateSetForWeightMode(set, nextMode, currentMode),
              unitManuallyChanged: true,
            };
          }
          if (setIndex !== 0) return set;
          if (set?.unitManuallyChanged) {
            skippedManualSetIndexes.push(index);
            return set;
          }
          propagatedToSetIndexes.push(index);
          return {
            ...updateSetForWeightMode(set, nextMode, getSetWeightMode(set, "kg")),
            unitManuallyChanged: false,
          };
        });
        const nextSet = nextSets[setIndex] || updateSetForWeightMode(target, nextMode, currentMode);

        if (debug) {
          logger?.log?.("[workout log] unit change propagation", {
            action: "unit_change_propagation",
            exerciseName,
            changedSetIndex: setIndex,
            changedUnit: getDisplayUnitForMode(nextMode),
            propagatedToSetIndexes,
            skippedManualSetIndexes,
            beforeUnits,
            afterUnits: nextSets.map((set) => getDisplayUnitForMode(getSetWeightMode(set, "kg"))),
          });
        }

        lastMutationRef.current = {
          reason: "unit_change",
          explicitDelete: false,
          explicitEdit: true,
          details: {
            exerciseName,
            setIndex,
            beforeSet,
            afterSet: nextSet,
          },
        };
        return { ...exercise, sets: nextSets };
      }), {
        details: {
          exerciseName,
          setIndex,
        },
      }
    );
  }, [debug, logger, mutateExercises]);

  const reorderExercise = useCallback((fromIdx, toIdx) => {
    mutateExercises("exercise_reorder", (exercises) => {
      const next = [...exercises];
      const [moved] = next.splice(fromIdx, 1);
      if (!moved) return exercises;
      next.splice(toIdx, 0, moved);
      return next;
    });
  }, [mutateExercises]);

  const renameExercise = useCallback((id, newName) => {
    const trimmed = String(newName || "").trim();
    if (!trimmed) return;
    mutateExercises("exercise_rename", (exercises) =>
      exercises.map((exercise) =>
        exercise.id === id ? { ...exercise, name: trimmed } : exercise
      ), {
        details: { afterName: trimmed },
      }
    );
  }, [mutateExercises]);

  const api = useMemo(() => ({
    date: normalizedDate,
    draft,
    exercises: draft.exercises || [],
    logData: splitDraft.logData,
    sessionEx: splitDraft.sessionEx,
    exerciseUnits: splitDraft.exerciseUnits,
    addExercise,
    removeExercise,
    addSet,
    setField,
    setWeightMode,
    reorderExercise,
    renameExercise,
  }), [
    addExercise,
    addSet,
    draft,
    normalizedDate,
    removeExercise,
    renameExercise,
    reorderExercise,
    setField,
    setWeightMode,
    splitDraft,
  ]);

  return api;
}

export default useWorkoutLog;
