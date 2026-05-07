import { dispW } from "./helpers";
import { normalizeExerciseName } from "./exerciseName";
import {
  getExerciseCountByBodyPart,
  getExerciseCountTotal,
} from "./exerciseCountByBodyPart";

export const formatWorkoutDaySummaryDuration = (seconds) => {
  const totalSec = Math.max(0, Math.floor(Number(seconds) || 0));
  if (!totalSec) return "0分";

  const totalMin = Math.floor(totalSec / 60);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;

  if (hours <= 0) return `${totalMin}分`;
  return `${hours}時間${minutes}分`;
};

export const formatWorkoutDaySummaryWeight = (weight, unit = "kg") => {
  if (weight === "BW") return "自重";
  const displayed = dispW(weight, unit);
  if (!displayed) return "-";
  return `${displayed}${unit}`;
};

export const formatWorkoutDaySummarySet = (set, unit = "kg") =>
  `${formatWorkoutDaySummaryWeight(set?.weight, unit)} × ${Number(set?.reps || 0)}rep`;

export const buildWorkoutDaySummaryPrKey = (bodyPart, exerciseName) =>
  `${String(bodyPart || "").trim()}::${normalizeExerciseName(exerciseName)}`;

export function buildWorkoutDaySummary({
  title,
  date,
  entries = [],
  getExUnit,
  fallbackUnit = "kg",
  prKeys = [],
  durationSec = 0,
  isShared = false,
  openWorkoutDate = "",
  shareTarget = null,
}) {
  const normalizedEntries = [...(entries || [])].filter(Boolean);
  const prKeySet = new Set(prKeys || []);

  const bodyParts = [
    ...new Set(
      normalizedEntries
        .map((entry) => String(entry?.bodyPart || "").trim())
        .filter(Boolean)
    ),
  ];

  const items = normalizedEntries.map((entry, index) => {
    const exerciseName = String(entry?.name || "").trim();
    const bodyPart = String(entry?.bodyPart || "").trim();
    const setCount = Number(entry?.setCount || entry?.sets?.length || 0);
    const unit =
      (typeof getExUnit === "function" ? getExUnit(exerciseName) : fallbackUnit) || fallbackUnit;
    const setDetails = (entry?.sets || [])
      .map((set) => formatWorkoutDaySummarySet(set, unit))
      .join(" / ");

    return {
      key: entry?.id || `${exerciseName}-${date}-${index}`,
      name: exerciseName,
      bodyPart,
      setCount,
      setDetails,
      isPr: prKeySet.has(buildWorkoutDaySummaryPrKey(bodyPart, exerciseName)),
    };
  });

  const totalVolume = Math.round(
    normalizedEntries.reduce((sum, entry) => sum + Number(entry?.volume || 0), 0)
  );
  const exerciseCountByBodyPart = getExerciseCountByBodyPart(normalizedEntries, {
    sort: "fixed",
  });
  const totalSetCount = normalizedEntries.reduce(
    (sum, entry) => sum + Number(entry?.setCount || entry?.sets?.length || 0),
    0
  );

  return {
    title,
    date,
    durationSec: Math.max(0, Math.floor(Number(durationSec) || 0)),
    totalVolume,
    setCount: totalSetCount,
    exerciseCount: getExerciseCountTotal(exerciseCountByBodyPart),
    exerciseCountByBodyPart,
    prCount: prKeySet.size,
    bodyParts,
    items,
    isShared: Boolean(isShared),
    openWorkoutDate: String(openWorkoutDate || "").trim(),
    shareTarget,
  };
}
