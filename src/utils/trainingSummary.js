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
import {
  getExerciseCountByBodyPart,
  getExerciseCountTotal,
} from "./exerciseCountByBodyPart";
import { getSetCountByBodyPart } from "./setCountByBodyPart";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

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
    const fullEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    const isCurrentMonth = period !== "last_month";
    const end = isCurrentMonth
      ? new Date(Math.min(fullEnd.getTime(), startOfDay(today).getTime()))
      : fullEnd;
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

const getBestSetForEstimated1RM = (sets = []) =>
  (sets || []).reduce((best, set) => {
    const weight = Number(set?.weight);
    const reps = Number(set?.reps);
    if (!Number.isFinite(weight) || weight <= 0) return best;
    if (!Number.isFinite(reps) || reps <= 0) return best;

    const estimated1RM = calc1RM([set]);
    if (!best || estimated1RM > best.estimated1RM) {
      return {
        weight,
        reps,
        estimated1RM,
      };
    }

    return best;
  }, null);

const getMaxWeight = (sets = []) =>
  sets.reduce((max, set) => {
    const weight = Number(set?.weight);
    if (!Number.isFinite(weight) || weight <= 0) return max;
    return Math.max(max, weight);
  }, 0);

const buildDateVolumeTrend = (entries = [], meta) => {
  const grouped = entries.reduce((acc, entry) => {
    acc[entry.date] = (acc[entry.date] || 0) + entry.volume;
    return acc;
  }, {});

  const points = [];
  const cursor = new Date(meta.start);
  const end = new Date(meta.end);

  while (cursor <= end) {
    const key = formatDateKey(cursor);
    points.push({
      date: key,
      label:
        meta.group === "weekly"
          ? WEEKDAY_LABELS[cursor.getDay()]
          : key.slice(5).replace("-", "/"),
      volume: Math.round(grouped[key] || 0),
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return points;
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
        bestSet: getBestSetForEstimated1RM(sanitized.sets),
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
  const totalReps = periodEntries.reduce(
    (sum, entry) =>
      sum +
      (entry.sets || []).reduce((setSum, set) => {
        const reps = Number(set?.reps || 0);
        return Number.isFinite(reps) && reps > 0 ? setSum + reps : setSum;
      }, 0),
    0
  );

  const bodyPartStats = {};
  const exerciseStats = {};
  const dailyStats = {};
  const prePeriodBestMap = {};
  const periodBestMap = {};
  const periodBestRecordMap = {};

  allEntries.forEach((entry) => {
    if (!prePeriodBestMap[entry.key]) prePeriodBestMap[entry.key] = 0;
    if (!periodBestMap[entry.key]) periodBestMap[entry.key] = 0;

    if (entry.date < startKey) {
      prePeriodBestMap[entry.key] = Math.max(prePeriodBestMap[entry.key], entry.bestRM || 0);
    }
  });

  periodEntries.forEach((entry) => {
    if (!dailyStats[entry.date]) {
      dailyStats[entry.date] = {
        date: entry.date,
        setCount: 0,
        volume: 0,
        bodyParts: new Set(),
        exerciseMap: {},
      };
    }
    if (!bodyPartStats[entry.bodyPart]) {
      bodyPartStats[entry.bodyPart] = { bodyPart: entry.bodyPart, sets: 0, volume: 0 };
    }
    bodyPartStats[entry.bodyPart].sets += entry.setCount;
    bodyPartStats[entry.bodyPart].volume += entry.volume;

    dailyStats[entry.date].setCount += entry.setCount;
    dailyStats[entry.date].volume += entry.volume;
    dailyStats[entry.date].bodyParts.add(entry.bodyPart);
    dailyStats[entry.date].exerciseMap[entry.key] = {
      key: entry.key,
      exerciseName: entry.exerciseName,
      bodyPart: entry.bodyPart,
      setCount: entry.setCount,
      volume: entry.volume,
    };

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

    if (
      entry.bestRM > 0 &&
      (!periodBestRecordMap[entry.key] || entry.bestRM > periodBestRecordMap[entry.key].estimated1RM)
    ) {
      periodBestRecordMap[entry.key] = {
        key: entry.key,
        exerciseName: entry.exerciseName,
        bodyPart: entry.bodyPart,
        estimated1RM: Math.round(entry.bestRM),
        weight: entry.bestSet?.weight || 0,
        reps: entry.bestSet?.reps || 0,
        date: entry.date,
      };
    }
  });

  const topBodyPart = Object.values(bodyPartStats)
    .sort((a, b) => b.sets - a.sets || b.volume - a.volume || a.bodyPart.localeCompare(b.bodyPart, "ja"))[0] || null;
  const sortedBodyPartStats = Object.values(bodyPartStats)
    .sort((a, b) => b.sets - a.sets || b.volume - a.volume || a.bodyPart.localeCompare(b.bodyPart, "ja"));
  const sortedExerciseStats = Object.values(exerciseStats)
    .sort((a, b) => b.volume - a.volume || b.setCount - a.setCount || a.exerciseName.localeCompare(b.exerciseName, "ja"));
  const exerciseCountByBodyPart = getExerciseCountByBodyPart(sortedExerciseStats, {
    sort: "fixed",
  });
  const setCountByBodyPart = getSetCountByBodyPart(sortedExerciseStats, {
    sort: "fixed",
  });
  const sortedDailyStats = Object.values(dailyStats)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((item) => ({
      date: item.date,
      setCount: item.setCount,
      volume: Math.round(item.volume),
      exerciseCount: Object.keys(item.exerciseMap).length,
      exerciseCountByBodyPart: getExerciseCountByBodyPart(Object.values(item.exerciseMap), {
        sort: "fixed",
      }),
      setCountByBodyPart: getSetCountByBodyPart(Object.values(item.exerciseMap), {
        sort: "fixed",
      }),
      bodyParts: [...item.bodyParts].sort((a, b) => a.localeCompare(b, "ja")),
      exercises: Object.values(item.exerciseMap).sort(
        (a, b) => b.volume - a.volume || b.setCount - a.setCount || a.exerciseName.localeCompare(b.exerciseName, "ja")
      ),
    }));

  const highlights = sortedExerciseStats.slice(0, 3);

  const prUpdateCount = Object.keys(periodBestMap).reduce((count, key) => {
    const periodBest = periodBestMap[key] || 0;
    const previousBest = prePeriodBestMap[key] || 0;
    if (periodBest > previousBest + PR_UPDATE_TOLERANCE_KG) {
      return count + 1;
    }
    return count;
  }, 0);

  const prUpdates = Object.keys(periodBestRecordMap)
    .map((key) => {
      const record = periodBestRecordMap[key];
      const previousBest = prePeriodBestMap[key] || 0;
      const diffKg = record.estimated1RM - previousBest;
      if (diffKg <= PR_UPDATE_TOLERANCE_KG) return null;

      return {
        ...record,
        diffKg: Math.round(diffKg * 10) / 10,
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.diffKg - a.diffKg ||
        b.estimated1RM - a.estimated1RM ||
        a.exerciseName.localeCompare(b.exerciseName, "ja")
    );

  return {
    ...meta,
    startKey,
    endKey,
    workoutCount: workoutDates.length,
    totalSets: periodEntries.reduce((sum, entry) => sum + entry.setCount, 0),
    totalReps,
    totalVolume,
    exerciseCount: getExerciseCountTotal(exerciseCountByBodyPart),
    exerciseCountByBodyPart,
    setCountByBodyPart,
    topBodyPart: topBodyPart?.bodyPart || "なし",
    bodyPartStats: sortedBodyPartStats,
    exerciseStats: sortedExerciseStats,
    dailyStats: sortedDailyStats,
    prUpdateCount,
    streak: computeLongestStreak(workoutDates),
    highlights,
    trend: buildDateVolumeTrend(periodEntries, meta),
    prUpdates,
  };
}
