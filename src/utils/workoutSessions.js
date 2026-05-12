import {
  calc1RM,
  getRecordSourceSets,
  sanitizeWorkoutSets,
  storeW,
} from "./helpers";
import {
  getExerciseCountByBodyPart,
  getExerciseCountTotal,
} from "./exerciseCountByBodyPart";
import { getSetCountByBodyPart } from "./setCountByBodyPart";

const buildSessionExerciseKey = (exerciseName, bodyPart) =>
  `${String(bodyPart || "").trim()}::${String(exerciseName || "").trim()}`;

const sanitizeBodyPart = (value) => String(value || "").trim();

const roundNumeric = (value, digits = 1) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  const factor = 10 ** digits;
  return Math.round(num * factor) / factor;
};

const getBestNumericSet = (sets) => {
  const numericSets = sanitizeWorkoutSets(sets, { allowBodyweight: false });
  if (!numericSets.length) return null;

  return numericSets.reduce((best, set) => {
    const rm = calc1RM([set]);
    if (!best || rm > best.rm) {
      return {
        weight: Number(set.weight),
        reps: Number(set.reps),
        rm,
      };
    }
    return best;
  }, null);
};

export function buildWorkoutSessionEntriesFromHistory(history, workoutDate) {
  return Object.entries(history || {})
    .flatMap(([exerciseName, records]) =>
      (records || []).map((record) => {
        if (!record || record.date !== workoutDate) return null;

        const sets = sanitizeWorkoutSets(getRecordSourceSets(record), {
          allowBodyweight: true,
        });
        if (!sets.length) return null;

        const order = Number(record.order);
        const bodyPart = sanitizeBodyPart(record.bodyPart || record.body_part);

        return {
          exerciseName,
          bodyPart,
          order: Number.isFinite(order) ? order : 999,
          sets,
        };
      })
    )
    .filter(Boolean)
    .sort((a, b) => {
      const orderDiff = (a.order ?? 999) - (b.order ?? 999);
      if (orderDiff !== 0) return orderDiff;
      return a.exerciseName.localeCompare(b.exerciseName, "ja");
    });
}

export function buildWorkoutSessionEntriesFromDraft({
  exercises = [],
  logData = {},
  getExUnit,
  workoutDate,
}) {
  return (exercises || [])
    .map((exercise, index) => {
      const exerciseName = String(exercise?.name || "").trim();
      if (!exerciseName) return null;

      const exUnit = typeof getExUnit === "function" ? getExUnit(exerciseName) : "kg";
      const sets = sanitizeWorkoutSets(
        (logData[exerciseName] || []).map((set) => ({
          ...set,
          weight: storeW(set.weight, exUnit),
        })),
        { allowBodyweight: true }
      );

      if (!sets.length) return null;

      return {
        exerciseName,
        bodyPart: sanitizeBodyPart(exercise?.bodyPart || exercise?.label),
        order: index,
        date: workoutDate,
        sets,
      };
    })
    .filter(Boolean);
}

export function buildWorkoutSessionPayloadFromEntries(entries, workoutDate, options = {}) {
  const sortedEntries = [...(entries || [])].sort((a, b) => {
    const orderDiff = (a.order ?? 999) - (b.order ?? 999);
    if (orderDiff !== 0) return orderDiff;
    return String(a.exerciseName || "").localeCompare(String(b.exerciseName || ""), "ja");
  });

  if (!sortedEntries.length) return null;

  const grouped = new Map();
  let totalSetCount = 0;
  let totalVolume = 0;

  sortedEntries.forEach((entry) => {
    const key = buildSessionExerciseKey(entry.exerciseName, entry.bodyPart);
    const numericVolume = entry.sets.reduce((sum, set) => {
      const weightNum = Number(set.weight);
      const repsNum = Number(set.reps);
      if (!Number.isFinite(weightNum) || !Number.isFinite(repsNum)) return sum;
      return sum + (weightNum > 0 && repsNum > 0 ? weightNum * repsNum : 0);
    }, 0);
    const maxWeight = entry.sets.reduce((max, set) => {
      const weightNum = Number(set.weight);
      if (!Number.isFinite(weightNum) || weightNum <= 0) return max;
      return Math.max(max, weightNum);
    }, 0);
    const bestSet = getBestNumericSet(entry.sets);

    totalSetCount += entry.sets.length;
    totalVolume += numericVolume;

    if (!grouped.has(key)) {
      grouped.set(key, {
        exercise_name: entry.exerciseName,
        body_part: sanitizeBodyPart(entry.bodyPart),
        order: Number.isFinite(entry.order) ? entry.order : 999,
        set_count: 0,
        max_weight: 0,
        volume: 0,
        best_set_json: {},
      });
    }

    const aggregate = grouped.get(key);
    aggregate.set_count += entry.sets.length;
    aggregate.max_weight = Math.max(aggregate.max_weight, maxWeight);
    aggregate.volume += numericVolume;

    if (bestSet) {
      const currentBestRm = Number(aggregate.best_set_json?.rm || 0);
      if (bestSet.rm > currentBestRm) {
        aggregate.best_set_json = {
          weight: bestSet.weight,
          reps: bestSet.reps,
          rm: roundNumeric(bestSet.rm, 1),
        };
      }
    }
  });

  const exercises = Array.from(grouped.values())
    .sort((a, b) => {
      const orderDiff = (a.order ?? 999) - (b.order ?? 999);
      if (orderDiff !== 0) return orderDiff;
      return a.exercise_name.localeCompare(b.exercise_name, "ja");
    })
    .map((item) => ({
      exercise_name: item.exercise_name,
      body_part: item.body_part,
      set_count: item.set_count,
      max_weight: roundNumeric(item.max_weight, 1),
      volume: roundNumeric(item.volume, 1),
      best_set_json: item.best_set_json || {},
    }));
  const exerciseCountByBodyPart = getExerciseCountByBodyPart(exercises, {
    sort: "fixed",
  });
  const setCountByBodyPart = getSetCountByBodyPart(exercises, {
    sort: "fixed",
  });
  const totalExerciseCount = getExerciseCountTotal(exerciseCountByBodyPart);

  return {
    session: {
      workout_date: workoutDate,
      total_volume: roundNumeric(totalVolume, 1),
      exercise_count: totalExerciseCount,
      summary_json: {
        setCount: totalSetCount,
        totalVolume: roundNumeric(totalVolume, 1),
        exerciseCount: totalExerciseCount,
        exerciseCountByBodyPart,
        setCountByBodyPart,
        items: exercises,
      },
      visibility: options.visibility || "friends",
      photo_visibility: options.photoVisibility || "hidden",
      photo_id: options.photoId || null,
    },
    exercises,
  };
}

export function buildWorkoutSessionPayloadFromHistory(history, workoutDate, options = {}) {
  return buildWorkoutSessionPayloadFromEntries(
    buildWorkoutSessionEntriesFromHistory(history, workoutDate),
    workoutDate,
    options
  );
}

export function buildWorkoutSessionPayloadFromDraft(args) {
  return buildWorkoutSessionPayloadFromEntries(
    buildWorkoutSessionEntriesFromDraft(args),
    args.workoutDate,
    {
      visibility: args.visibility,
      photoVisibility: args.photoVisibility,
      photoId: args.photoId,
    }
  );
}
