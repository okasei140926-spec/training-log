import { QUICK_LABELS, SUGGESTIONS } from "../constants/suggestions";
import { normalizeExerciseName } from "./exerciseName";

const BODY_PART_ALIASES = {
  ハムストリングス: "ハム",
  ハムストリング: "ハム",
  大腿二頭筋: "ハム",
  お尻: "尻",
  臀部: "尻",
  ケツ: "尻",
  腹: "腹筋",
  腹部: "腹筋",
};

const BODY_PART_PRIORITY = [...new Set(QUICK_LABELS.map((label) => BODY_PART_ALIASES[label] || label)), "その他"];

const normalizeName = (name) =>
  normalizeExerciseName(String(name || "").replace(/\s+/g, "").trim());

export const normalizeBodyPartLabel = (label, fallbackBodyPart = "その他") => {
  const raw = String(label || "").trim();
  if (!raw) return fallbackBodyPart;
  return BODY_PART_ALIASES[raw] || raw;
};

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
  (() => {
    const normalized = normalizeName(exName);
    const exactLabels = [];
    const fuzzyLabels = [];

    Object.entries(SUGGESTIONS).forEach(([label, names]) => {
      const entries = names || [];
      const hasExact = entries.some((name) => normalizeName(name) === normalized);
      if (hasExact) {
        exactLabels.push(label);
        return;
      }

      const hasFuzzy = entries.some((name) => matchesExerciseName(name, exName));
      if (hasFuzzy) {
        fuzzyLabels.push(label);
      }
    });

    return sortLabelsByPriority(exactLabels.length > 0 ? exactLabels : fuzzyLabels);
  })();

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

export const buildBodyPartExerciseKey = (bodyPart, exName) =>
  `${normalizeBodyPartLabel(bodyPart, "")}::${normalizeExerciseName(exName)}`;

export const resolveRecordBodyPartLabel = (
  record,
  exName,
  { muscleEx = {}, exerciseBodyPartOverrides = {} } = {}
) => {
  const explicitBodyPart = String(record?.bodyPart || record?.body_part || "").trim();
  if (explicitBodyPart) return normalizeBodyPartLabel(explicitBodyPart);

  const overrideLabel = getOverrideLabel(exName, exerciseBodyPartOverrides, []);
  if (overrideLabel) return normalizeBodyPartLabel(overrideLabel);

  const visibleCustomLabels = getVisibleCustomBodyPartLabels(exName, muscleEx, []);
  if (visibleCustomLabels.length === 1) return normalizeBodyPartLabel(visibleCustomLabels[0]);

  const defaultLabels = getDefaultBodyPartLabels(exName);
  if (defaultLabels.length > 0) return normalizeBodyPartLabel(defaultLabels[0]);

  return visibleCustomLabels[0] ? normalizeBodyPartLabel(visibleCustomLabels[0]) : null;
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
    return normalizeBodyPartLabel(overrideLabel);
  }

  if (visibleDefaultLabels.length === 1) {
    return normalizeBodyPartLabel(visibleDefaultLabels[0]);
  }

  if (visibleDefaultLabels.length > 1) {
    const explicitCustomLabels = getExplicitCustomBodyPartLabels(exName, muscleEx, hiddenBodyParts);
    return normalizeBodyPartLabel(explicitCustomLabels[0] || visibleDefaultLabels[0]);
  }

  if (defaultLabels.length > 0) {
    return null;
  }

  const visibleCustomLabels = getVisibleCustomBodyPartLabels(exName, muscleEx, hiddenBodyParts);
  return visibleCustomLabels[0] ? normalizeBodyPartLabel(visibleCustomLabels[0]) : null;
};

export const resolveRecordedBodyPartLabel = (
  record,
  exName,
  { muscleEx = {}, hiddenBodyParts = [], exerciseBodyPartOverrides = {} } = {}
) => {
  const bodyPart = resolveRecordBodyPartLabel(record, exName, {
    muscleEx,
    exerciseBodyPartOverrides,
  });
  const normalizedBodyPart = normalizeBodyPartLabel(bodyPart);
  const hiddenSet = new Set((hiddenBodyParts || []).map((part) => normalizeBodyPartLabel(part)));
  if (!normalizedBodyPart || hiddenSet.has(normalizedBodyPart)) return null;
  return normalizedBodyPart;
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
