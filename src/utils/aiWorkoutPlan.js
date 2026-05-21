import { SUGGESTIONS } from "../constants/suggestions";

const KG_TO_LB = 2.20462;
const MAX_PLAN_EXERCISES = 12;
const MAX_PLAN_SETS_PER_EXERCISE = 12;

const BODYWEIGHT_EXERCISE_KEYWORDS = [
  "ディップス",
  "懸垂",
  "チンニング",
  "プルアップ",
  "腕立て",
  "プッシュアップ",
];

const normalizeText = (value) => String(value || "").trim();

export const normalizePlanUnit = (unit) => {
  const value = normalizeText(unit).toLowerCase();
  if (["lb", "lbs", "pound", "pounds", "ポンド"].includes(value)) return "lbs";
  if (["bw", "bodyweight", "自重"].includes(value)) return "BW";
  return "kg";
};

export const getPlanBodyPart = (exerciseName, fallback = "") => {
  const name = normalizeText(exerciseName);
  if (!name) return fallback || "その他";

  const match = Object.entries(SUGGESTIONS).find(([, names]) =>
    names.some((item) => name.includes(item) || item.includes(name))
  );

  return match?.[0] || fallback || "その他";
};

export const isBodyweightExerciseName = (exerciseName) =>
  BODYWEIGHT_EXERCISE_KEYWORDS.some((keyword) => normalizeText(exerciseName).includes(keyword));

const toFinitePositiveNumber = (value) => {
  const normalized = normalizeText(value).replace(/,/g, "");
  const num = Number(normalized);
  return Number.isFinite(num) && num > 0 ? num : 0;
};

const formatWeightValue = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "";
  const rounded = Math.round(num * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
};

export const convertPlanWeight = (weight, fromUnit, toUnit) => {
  const num = Number(weight);
  if (!Number.isFinite(num) || num <= 0) return "";

  const source = normalizePlanUnit(fromUnit);
  const target = normalizePlanUnit(toUnit);
  if (source === "BW" || target === "BW") return "";
  if (source === target) return formatWeightValue(num);
  return formatWeightValue(source === "kg" ? num * KG_TO_LB : num / KG_TO_LB);
};

const normalizePlanSet = (set, fallbackUnit) => {
  const unit = normalizePlanUnit(set?.unit || set?.weightUnit || set?.weight_unit || fallbackUnit);
  const reps = toFinitePositiveNumber(set?.reps || set?.rep || set?.回数);

  if (unit === "BW" || normalizeText(set?.weight).toUpperCase() === "BW" || normalizeText(set?.weight) === "自重") {
    return {
      weight: "BW",
      reps: reps || "",
      unit: "BW",
    };
  }

  const weight = toFinitePositiveNumber(set?.weight || set?.重量);
  return {
    weight: weight ? formatWeightValue(weight) : "",
    reps: reps || "",
    unit,
  };
};

const buildBlankSets = (setCount, unit) =>
  Array.from({ length: Math.max(1, Math.min(MAX_PLAN_SETS_PER_EXERCISE, setCount || 3)) }, () => ({
    weight: unit === "BW" ? "BW" : "",
    reps: "",
    unit,
  }));

export const normalizeWorkoutPlan = (rawPlan) => {
  const source = Array.isArray(rawPlan) ? rawPlan : [];
  const seen = new Set();

  return source
    .map((item) => {
      const exerciseName = normalizeText(item?.exerciseName || item?.name || item?.exercise || item?.種目名);
      if (!exerciseName) return null;

      const proposedUnit =
        item?.unit || item?.weightUnit || item?.weight_unit || (isBodyweightExerciseName(exerciseName) ? "BW" : "kg");
      const unit = normalizePlanUnit(proposedUnit);
      const bodyPart = normalizeText(item?.bodyPart || item?.body_part || item?.part || item?.部位) || getPlanBodyPart(exerciseName);
      const explicitSets = Array.isArray(item?.sets) ? item.sets : [];
      const setCount = Math.min(
        MAX_PLAN_SETS_PER_EXERCISE,
        Math.max(
          0,
          Math.floor(toFinitePositiveNumber(item?.setCount || item?.setsCount || item?.set_count || item?.sets_total || item?.セット数))
        )
      );
      const normalizedSets = explicitSets
        .map((set) => normalizePlanSet(set, unit))
        .filter((set) => set.weight === "BW" || set.weight || set.reps);
      const sets = normalizedSets.length
        ? normalizedSets.slice(0, MAX_PLAN_SETS_PER_EXERCISE)
        : buildBlankSets(setCount || explicitSets.length || 3, unit);

      return {
        id: `${exerciseName}-${bodyPart}-${sets.length}`,
        exerciseName,
        bodyPart,
        unit,
        sets,
        memo: normalizeText(item?.memo || item?.note || item?.メモ),
      };
    })
    .filter(Boolean)
    .filter((item) => {
      const key = `${item.exerciseName}-${item.bodyPart}-${item.unit}-${item.sets.length}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_PLAN_EXERCISES);
};

const stripLinePrefix = (line) =>
  normalizeText(line)
    .replace(/^[・\-*]\s*/, "")
    .replace(/^\d+[.)、]\s*/, "")
    .replace(/^種目[:：]\s*/, "");

const parseWorkoutLine = (line) => {
  const text = stripLinePrefix(line);
  if (!text || !text.includes("セット")) return null;

  const setCountMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:セット|set|sets)/i);
  const setCount = setCountMatch ? Math.max(1, Math.floor(Number(setCountMatch[1]))) : 0;
  if (!setCount) return null;

  const bodyweight = /自重|body\s*weight|BW/i.test(text);
  const weightedMatch = text.match(/(\d+(?:\.\d+)?)\s*(kg|kgs|キロ|lb|lbs|ポンド)?\s*[×xX]\s*(\d+(?:\.\d+)?)\s*(?:回|rep|reps)?/i);
  const bodyweightRepsMatch = text.match(/(?:自重|body\s*weight|BW)\s*[×xX]\s*(\d+(?:\.\d+)?)\s*(?:回|rep|reps)?/i);
  const unit = bodyweight ? "BW" : normalizePlanUnit(weightedMatch?.[2] || "kg");
  const reps = weightedMatch
    ? Math.floor(Number(weightedMatch[3]))
    : bodyweightRepsMatch
      ? Math.floor(Number(bodyweightRepsMatch[1]))
      : 0;
  const weight = bodyweight ? "BW" : weightedMatch ? formatWeightValue(weightedMatch[1]) : "";

  let exerciseName = text
    .replace(/[:：].*$/, "")
    .replace(/\d+(?:\.\d+)?\s*(?:kg|kgs|キロ|lb|lbs|ポンド)?\s*[×xX]\s*\d+(?:\.\d+)?\s*(?:回|rep|reps)?/i, "")
    .replace(/\d+(?:\.\d+)?\s*(?:セット|set|sets).*/i, "")
    .replace(/自重.*/i, "")
    .trim();

  exerciseName = exerciseName || text.split(/\s+/)[0];
  if (!exerciseName || exerciseName.length > 32) return null;

  const sets = Array.from({ length: Math.min(MAX_PLAN_SETS_PER_EXERCISE, setCount) }, () => ({
    weight,
    reps: reps || "",
    unit,
  }));

  return {
    exerciseName,
    bodyPart: getPlanBodyPart(exerciseName),
    unit,
    sets,
  };
};

export const extractWorkoutPlanFromText = (text) => {
  const lines = normalizeText(text)
    .split(/\n+/)
    .map(stripLinePrefix)
    .filter(Boolean);

  const parsed = lines.map(parseWorkoutLine).filter(Boolean);
  if (parsed.length < 2) return [];
  return normalizeWorkoutPlan(parsed);
};
