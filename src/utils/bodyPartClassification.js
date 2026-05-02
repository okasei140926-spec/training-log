import { QUICK_LABELS, SUGGESTIONS } from "../constants/suggestions";
import { normalizeExerciseName } from "./exerciseName";

const BODY_PART_PRIORITY = [...QUICK_LABELS, "その他"];

const normalizeName = (name) =>
  normalizeExerciseName(String(name || "").replace(/\s+/g, "").trim());

export const matchesExerciseName = (candidateName, exName) => {
  const base = normalizeName(candidateName);
  const normalized = normalizeName(exName);
  return !!base && !!normalized && (base === normalized || base.includes(normalized) || normalized.includes(base));
};

const sortLabelsByPriority = (labels = []) =>
  [...new Set(labels)].sort((a, b) => {
    const aIndex = BODY_PART_PRIORITY.indexOf(a);
    const bIndex = BODY_PART_PRIORITY.indexOf(b);
    const safeA = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
    const safeB = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
    if (safeA !== safeB) return safeA - safeB;
    return String(a).localeCompare(String(b), "ja");
  });

export const getDefaultBodyPartLabels = (exName) =>
  sortLabelsByPriority(
    Object.entries(SUGGESTIONS)
      .filter(([, names]) => (names || []).some((name) => matchesExerciseName(name, exName)))
      .map(([label]) => label)
  );

export const getPrimaryDefaultBodyPartLabel = (exName) =>
  getDefaultBodyPartLabels(exName)[0] || null;

export const getVisibleCustomBodyPartLabels = (exName, muscleEx = {}, hiddenBodyParts = []) => {
  const hiddenSet = new Set(hiddenBodyParts || []);
  return sortLabelsByPriority(
    Object.entries(muscleEx || {})
      .filter(([label]) => label && !hiddenSet.has(label))
      .filter(([, list]) =>
        (list || []).some((ex) => {
          const name = typeof ex === "string" ? ex : ex?.name;
          return matchesExerciseName(name, exName);
        })
      )
      .map(([label]) => label)
  );
};

export const getExplicitCustomBodyPartLabels = (exName, muscleEx = {}, hiddenBodyParts = []) => {
  const visibleCustomLabels = getVisibleCustomBodyPartLabels(exName, muscleEx, hiddenBodyParts);

  return visibleCustomLabels.filter((label) => {
    const defaultsForLabel = SUGGESTIONS[label] || [];
    return !defaultsForLabel.some((name) => matchesExerciseName(name, exName));
  });
};

const getOverrideLabel = (exName, exerciseBodyPartOverrides = {}, hiddenBodyParts = []) => {
  const hiddenSet = new Set(hiddenBodyParts || []);
  const overrideLabel = exerciseBodyPartOverrides?.[normalizeExerciseName(exName)];
  if (!overrideLabel || hiddenSet.has(overrideLabel)) return null;
  return overrideLabel;
};

export const resolveVisibleBodyPartLabel = (
  exName,
  { muscleEx = {}, hiddenBodyParts = [], exerciseBodyPartOverrides = {} } = {}
) => {
  const hiddenSet = new Set(hiddenBodyParts || []);
  const defaultLabels = getDefaultBodyPartLabels(exName);
  const visibleDefaultLabels = defaultLabels.filter((label) => !hiddenSet.has(label));
  const overrideLabel = getOverrideLabel(exName, exerciseBodyPartOverrides, hiddenBodyParts);

  if (overrideLabel) {
    return overrideLabel;
  }

  if (visibleDefaultLabels.length === 1) {
    return visibleDefaultLabels[0];
  }

  if (visibleDefaultLabels.length > 1) {
    const explicitCustomLabels = getExplicitCustomBodyPartLabels(exName, muscleEx, hiddenBodyParts);
    return explicitCustomLabels[0] || visibleDefaultLabels[0];
  }

  if (defaultLabels.length > 0) {
    return null;
  }

  const visibleCustomLabels = getVisibleCustomBodyPartLabels(exName, muscleEx, hiddenBodyParts);
  return visibleCustomLabels[0] || null;
};

export const getBodyPartResolutionSamples = (
  muscleEx = {},
  hiddenBodyParts = [],
  exerciseBodyPartOverrides = {}
) => ([
  "スクワット",
  "スミススクワット",
  "スミスマシンスクワット",
  "ハックスクワット",
  "レッグプレス",
  "レッグエクステンション",
  "ルーマニアンデッドリフト",
  "シーテッドレッグカール",
  "ライイングレッグカール",
  "ブルガリアンスクワット",
  "アダクター",
]).map((name) => ({
  name,
  label: resolveVisibleBodyPartLabel(name, { muscleEx, hiddenBodyParts, exerciseBodyPartOverrides }),
}));
