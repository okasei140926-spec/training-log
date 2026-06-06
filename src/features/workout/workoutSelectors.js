import { calc1RM, sanitizeHistoryRecord } from "../../utils/helpers";
import { normalizeExerciseName } from "../../utils/exerciseName";
import { normalizeBodyPartLabel } from "../../utils/bodyPartClassification";
import { getSetCountByBodyPart } from "../../utils/setCountByBodyPart";
import { getExerciseCountByBodyPart } from "../../utils/exerciseCountByBodyPart";

const normalizeDateKey = (value) => String(value || "").slice(0, 10);

const roundMetric = (value) => Math.round(Number(value || 0) * 10) / 10;

const isInRange = (date, startDate, endDate) => {
  const normalizedDate = normalizeDateKey(date);
  const start = normalizeDateKey(startDate);
  const end = normalizeDateKey(endDate);
  if (!normalizedDate) return false;
  if (start && normalizedDate < start) return false;
  if (end && normalizedDate > end) return false;
  return true;
};

const getDisplayUnit = (set) => {
  const unit = String(set?.displayUnit || set?.unit || set?.weightUnit || set?.weight_unit || "kg");
  if (unit === "lbs") return "lb";
  return unit;
};

const getDisplayWeight = (set) => {
  if (set?.weight === "BW" || getDisplayUnit(set) === "BW") return "自重";
  const value = set?.displayWeight ?? set?.originalWeight ?? set?.inputWeight ?? set?.weight;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? roundMetric(numeric) : value;
};

export function historyToWorkoutSessions(trustedHistory = {}) {
  const byDate = new Map();

  Object.entries(trustedHistory || {}).forEach(([exerciseName, records]) => {
    (records || []).forEach((record) => {
      const sanitized = sanitizeHistoryRecord(record, { allowBodyweight: true });
      const date = normalizeDateKey(sanitized?.date);
      if (!date) return;

      const session = byDate.get(date) || {
        date,
        exercises: [],
        totalSets: 0,
        totalVolume: 0,
        bodyParts: [],
      };
      const sets = sanitized.sets || [];
      const bodyPart = normalizeBodyPartLabel(sanitized.bodyPart || record?.bodyPart || record?.body_part, "その他");
      const volume = sets.reduce((sum, set) => {
        const weight = Number(set?.weight);
        const reps = Number(set?.reps);
        if (!Number.isFinite(weight) || !Number.isFinite(reps) || weight <= 0 || reps <= 0) return sum;
        return sum + weight * reps;
      }, 0);

      session.exercises.push({
        name: exerciseName,
        exerciseName,
        bodyPart,
        sets,
        setCount: sets.length,
        volume: roundMetric(volume),
        order: Number.isFinite(Number(sanitized.order)) ? Number(sanitized.order) : session.exercises.length,
      });
      session.totalSets += sets.length;
      session.totalVolume += volume;
      if (bodyPart && !session.bodyParts.includes(bodyPart)) session.bodyParts.push(bodyPart);
      byDate.set(date, session);
    });
  });

  return Array.from(byDate.values())
    .map((session) => ({
      ...session,
      totalVolume: roundMetric(session.totalVolume),
      exercises: [...session.exercises].sort((a, b) => a.order - b.order),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function selectSessionsInRange(trustedHistory, { startDate = "", endDate = "" } = {}) {
  return historyToWorkoutSessions(trustedHistory).filter((session) =>
    isInRange(session.date, startDate, endDate)
  );
}

export function selectRecentRecords(trustedHistory, { limit = 5 } = {}) {
  return historyToWorkoutSessions(trustedHistory).slice(0, limit);
}

export function selectHomeWeeklySummary(trustedHistory, {
  startDate,
  endDate,
} = {}) {
  const sessions = selectSessionsInRange(trustedHistory, { startDate, endDate });
  const entries = sessions.flatMap((session) =>
    session.exercises.map((exercise) => ({
      ...exercise,
      date: session.date,
    }))
  );

  const bodyPartCounts = getSetCountByBodyPart(entries, { sort: "count" });
  const setCountByExercise = entries.reduce((acc, entry) => {
    acc[entry.exerciseName] = (acc[entry.exerciseName] || 0) + Number(entry.setCount || 0);
    return acc;
  }, {});

  return {
    source: "trustedHistory",
    sessions,
    bodyPartCounts,
    setCountByExercise,
    totalSets: entries.reduce((sum, entry) => sum + Number(entry.setCount || 0), 0),
    totalVolume: roundMetric(entries.reduce((sum, entry) => sum + Number(entry.volume || 0), 0)),
  };
}

export function selectCalendarSummaries(trustedHistory, {
  startDate = "",
  endDate = "",
} = {}) {
  return selectSessionsInRange(trustedHistory, { startDate, endDate }).reduce((acc, session) => {
    acc[session.date] = {
      date: session.date,
      totalSets: session.totalSets,
      totalVolume: session.totalVolume,
      bodyParts: session.bodyParts,
      exercises: session.exercises,
    };
    return acc;
  }, {});
}

export function selectAnalyticsSummary(trustedHistory, {
  startDate = "",
  endDate = "",
} = {}) {
  const sessions = selectSessionsInRange(trustedHistory, { startDate, endDate });
  const entries = sessions.flatMap((session) => session.exercises);

  return {
    source: "trustedHistory",
    sessions,
    totalVolume: roundMetric(sessions.reduce((sum, session) => sum + Number(session.totalVolume || 0), 0)),
    workoutCount: sessions.length,
    exerciseCount: getExerciseCountByBodyPart(entries).reduce((sum, item) => sum + Number(item.count || 0), 0),
    setCount: sessions.reduce((sum, session) => sum + Number(session.totalSets || 0), 0),
    bodyPartSetCounts: getSetCountByBodyPart(entries, { sort: "count" }),
  };
}

export function selectExercisePrHistory(trustedHistory, exerciseName) {
  const targetName = normalizeExerciseName(exerciseName);
  const records = [];

  Object.entries(trustedHistory || {}).forEach(([historyExerciseName, historyRecords]) => {
    if (normalizeExerciseName(historyExerciseName) !== targetName) return;

    (historyRecords || []).forEach((record) => {
      const sanitized = sanitizeHistoryRecord(record, { allowBodyweight: true });
      if (!sanitized?.date) return;

      (sanitized.sets || []).forEach((set, setIndex) => {
        const normalizedKg = set?.weight === "BW" ? 0 : Number(set?.weight || 0);
        const reps = Number(set?.reps || 0);
        if (set?.weight !== "BW" && (!Number.isFinite(normalizedKg) || normalizedKg <= 0)) return;
        if (!Number.isFinite(reps) || reps <= 0) return;

        records.push({
          exerciseName: historyExerciseName,
          date: sanitized.date,
          setIndex,
          originalWeight: getDisplayWeight(set),
          originalUnit: getDisplayUnit(set),
          displayWeight: getDisplayWeight(set),
          displayUnit: getDisplayUnit(set),
          normalizedKg,
          reps,
          estimated1RM: set?.weight === "BW" ? 0 : calc1RM([set]),
          source: "trustedHistory",
          originalSet: set,
        });
      });
    });
  });

  return records.sort((a, b) =>
    b.estimated1RM - a.estimated1RM ||
    b.normalizedKg - a.normalizedKg ||
    b.reps - a.reps ||
    b.date.localeCompare(a.date)
  );
}

export function selectExercisePr(trustedHistory, exerciseName) {
  return selectExercisePrHistory(trustedHistory, exerciseName)[0] || null;
}
