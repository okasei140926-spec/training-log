import {
  PR_UPDATE_TOLERANCE_KG,
  calc1RM,
  formatDateKey,
  sanitizeHistoryRecord,
} from "./helpers";
import {
  buildBodyPartExerciseKey,
  resolveRecordedBodyPartLabel,
} from "./bodyPartClassification";

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const formatDateLabel = (dateInput) => {
  const key = formatDateKey(dateInput);
  return key.replace(/-/g, "/");
};

const getWeekRange = (today = new Date()) => {
  const base = startOfDay(today);
  const day = base.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(base);
  start.setDate(base.getDate() + diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
};

const getMonthRange = (today = new Date()) => {
  const base = startOfDay(today);
  const start = new Date(base.getFullYear(), base.getMonth(), 1);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  return { start, end };
};

const resolvePeriodMeta = (period, today = new Date()) => {
  if (period === "monthly" || period === "this_month" || period === "last_month") {
    const currentRange = getMonthRange(today);
    const offsetMonths = period === "last_month" ? -1 : 0;
    const start = new Date(
      currentRange.start.getFullYear(),
      currentRange.start.getMonth() + offsetMonths,
      1
    );
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    return {
      key: period === "last_month" ? "last_month" : "this_month",
      group: "monthly",
      title: "月間サマリー",
      shortLabel: period === "last_month" ? "先月" : "今月",
      shareLabel: "Monthly Summary",
      start,
      end,
      rangeLabel: `${start.getFullYear()}/${String(start.getMonth() + 1).padStart(2, "0")}`,
    };
  }

  const currentRange = getWeekRange(today);
  const start = new Date(currentRange.start);
  const end = new Date(currentRange.end);
  if (period === "last_week") {
    start.setDate(start.getDate() - 7);
    end.setDate(end.getDate() - 7);
  }

  return {
    key: period === "last_week" ? "last_week" : "this_week",
    group: "weekly",
    title: "週間サマリー",
    shortLabel: period === "last_week" ? "先週" : "今週",
    shareLabel: "Weekly Summary",
    start,
    end,
    rangeLabel: `${formatDateLabel(start)} - ${formatDateLabel(end)}`,
  };
};

const sumVolume = (sets = []) =>
  sets.reduce((sum, set) => {
    const weight = Number(set?.weight);
    const reps = Number(set?.reps);
    if (!Number.isFinite(weight) || weight <= 0) return sum;
    if (!Number.isFinite(reps) || reps <= 0) return sum;
    return sum + weight * reps;
  }, 0);

const getMaxWeight = (sets = []) =>
  sets.reduce((max, set) => {
    const weight = Number(set?.weight);
    if (!Number.isFinite(weight) || weight <= 0) return max;
    return Math.max(max, weight);
  }, 0);

const buildDateVolumeTrend = (entries = []) => {
  const grouped = entries.reduce((acc, entry) => {
    acc[entry.date] = (acc[entry.date] || 0) + entry.volume;
    return acc;
  }, {});

  return Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, volume]) => ({
      date,
      label: date.slice(5).replace("-", "/"),
      volume: Math.round(volume),
    }));
};

const computeLongestStreak = (dates = []) => {
  if (!dates.length) return 0;

  const uniqueDates = [...new Set(dates)].sort();
  let longest = 1;
  let current = 1;

  for (let i = 1; i < uniqueDates.length; i += 1) {
    const prev = startOfDay(`${uniqueDates[i - 1]}T00:00:00`);
    const next = startOfDay(`${uniqueDates[i]}T00:00:00`);
    const diffDays = Math.round((next.getTime() - prev.getTime()) / DAY_MS);

    if (diffDays === 1) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 1;
    }
  }

  return longest;
};

const buildEntries = ({
  history = {},
  muscleEx = {},
  hiddenBodyParts = [],
  exerciseBodyPartOverrides = {},
}) => {
  const entries = [];

  Object.entries(history || {}).forEach(([exerciseName, records]) => {
    (records || []).forEach((record, index) => {
      const sanitized = sanitizeHistoryRecord(record, { allowBodyweight: true });
      if (!sanitized?.date || !sanitized.sets?.length) return;

      const bodyPart = resolveRecordedBodyPartLabel(sanitized, exerciseName, {
        muscleEx,
        hiddenBodyParts,
        exerciseBodyPartOverrides,
      });

      if (!bodyPart) return;

      const volume = sumVolume(sanitized.sets);
      const bestRM = calc1RM(sanitized.sets);
      const maxWeight = getMaxWeight(sanitized.sets);
      const normalizedKey = buildBodyPartExerciseKey(bodyPart, exerciseName);

      entries.push({
        id: `${normalizedKey}-${sanitized.date}-${index}`,
        key: normalizedKey,
        exerciseName,
        bodyPart,
        date: sanitized.date,
        sets: sanitized.sets,
        setCount: sanitized.sets.length,
        volume,
        bestRM,
        maxWeight,
      });
    });
  });

  return entries.sort((a, b) => a.date.localeCompare(b.date));
};

export function buildTrainingSummary({
  history = {},
  period = "weekly",
  today = new Date(),
  muscleEx = {},
  hiddenBodyParts = [],
  exerciseBodyPartOverrides = {},
}) {
  const meta = resolvePeriodMeta(period, today);
  const startKey = formatDateKey(meta.start);
  const endKey = formatDateKey(meta.end);
  const allEntries = buildEntries({
    history,
    muscleEx,
    hiddenBodyParts,
    exerciseBodyPartOverrides,
  });
  const periodEntries = allEntries.filter((entry) => entry.date >= startKey && entry.date <= endKey);
  const workoutDates = [...new Set(periodEntries.map((entry) => entry.date))].sort();
  const totalVolume = Math.round(periodEntries.reduce((sum, entry) => sum + entry.volume, 0));
  const exerciseKeys = [...new Set(periodEntries.map((entry) => entry.key))];

  const bodyPartStats = {};
  const exerciseStats = {};
  const prePeriodBestMap = {};
  const periodBestMap = {};

  allEntries.forEach((entry) => {
    if (!prePeriodBestMap[entry.key]) prePeriodBestMap[entry.key] = 0;
    if (!periodBestMap[entry.key]) periodBestMap[entry.key] = 0;

    if (entry.date < startKey) {
      prePeriodBestMap[entry.key] = Math.max(prePeriodBestMap[entry.key], entry.bestRM || 0);
    }
  });

  periodEntries.forEach((entry) => {
    if (!bodyPartStats[entry.bodyPart]) {
      bodyPartStats[entry.bodyPart] = { bodyPart: entry.bodyPart, sets: 0, volume: 0 };
    }
    bodyPartStats[entry.bodyPart].sets += entry.setCount;
    bodyPartStats[entry.bodyPart].volume += entry.volume;

    if (!exerciseStats[entry.key]) {
      exerciseStats[entry.key] = {
        key: entry.key,
        exerciseName: entry.exerciseName,
        bodyPart: entry.bodyPart,
        setCount: 0,
        volume: 0,
        maxWeight: 0,
      };
    }

    exerciseStats[entry.key].setCount += entry.setCount;
    exerciseStats[entry.key].volume += entry.volume;
    exerciseStats[entry.key].maxWeight = Math.max(exerciseStats[entry.key].maxWeight, entry.maxWeight);
    periodBestMap[entry.key] = Math.max(periodBestMap[entry.key] || 0, entry.bestRM || 0);
  });

  const topBodyPart = Object.values(bodyPartStats)
    .sort((a, b) => b.sets - a.sets || b.volume - a.volume || a.bodyPart.localeCompare(b.bodyPart, "ja"))[0] || null;

  const highlights = Object.values(exerciseStats)
    .sort((a, b) => b.volume - a.volume || b.setCount - a.setCount || a.exerciseName.localeCompare(b.exerciseName, "ja"))
    .slice(0, 3);

  const prUpdateCount = Object.keys(periodBestMap).reduce((count, key) => {
    const periodBest = periodBestMap[key] || 0;
    const previousBest = prePeriodBestMap[key] || 0;
    if (periodBest > previousBest + PR_UPDATE_TOLERANCE_KG) {
      return count + 1;
    }
    return count;
  }, 0);

  return {
    ...meta,
    startKey,
    endKey,
    workoutCount: workoutDates.length,
    totalVolume,
    exerciseCount: exerciseKeys.length,
    topBodyPart: topBodyPart?.bodyPart || "なし",
    prUpdateCount,
    streak: computeLongestStreak(workoutDates),
    highlights,
    trend: buildDateVolumeTrend(periodEntries),
  };
}
