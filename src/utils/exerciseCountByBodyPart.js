import { buildBodyPartExerciseKey, normalizeBodyPartLabel } from "./bodyPartClassification";

export const BODY_PART_DISPLAY_ORDER = [
  "胸",
  "背中",
  "四頭",
  "ハム",
  "尻",
  "肩",
  "二頭",
  "三頭",
  "腹筋",
  "その他",
];

export const BODY_PART_ENGLISH_LABELS = {
  胸: "CHEST",
  背中: "BACK",
  四頭: "QUADS",
  ハム: "HAMSTRINGS",
  尻: "GLUTES",
  肩: "SHOULDERS",
  二頭: "BICEPS",
  三頭: "TRICEPS",
  腹筋: "ABS",
  その他: "OTHER",
};

const getBodyPartOrderIndex = (bodyPart) => {
  const index = BODY_PART_DISPLAY_ORDER.indexOf(bodyPart);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

const getEntryExerciseName = (entry) =>
  String(
    entry?.name ||
      entry?.exerciseName ||
      entry?.exercise_name ||
      entry?.displayName ||
      ""
  ).trim();

const getEntryBodyPart = (entry, fallbackBodyPart = "その他") => {
  const raw = String(entry?.bodyPart || entry?.body_part || "").trim();
  return normalizeBodyPartLabel(raw, fallbackBodyPart);
};

const getEntrySets = (entry) => (Array.isArray(entry?.sets) ? entry.sets.filter(Boolean) : []);

const hasValidSet = (set) => {
  const reps = Number(set?.reps);
  if (!Number.isFinite(reps) || reps <= 0) return false;

  if (set?.weight === "BW") return true;

  const weight = Number(set?.weight);
  return Number.isFinite(weight) && weight > 0;
};

const hasValidEntry = (entry, hiddenSet = new Set(), fallbackBodyPart = "その他") => {
  const exerciseName = getEntryExerciseName(entry);
  if (!exerciseName) return false;

  const bodyPart = getEntryBodyPart(entry, fallbackBodyPart);
  if (hiddenSet.has(bodyPart)) return false;

  const sets = getEntrySets(entry);
  if (sets.length > 0) {
    return sets.some(hasValidSet);
  }

  const setCount = Number(entry?.setCount ?? entry?.set_count ?? 0);
  return Number.isFinite(setCount) && setCount > 0;
};

const toCountsArray = (countsMap, sort) => {
  const items = Object.entries(countsMap).map(([bodyPart, count]) => ({
    bodyPart,
    count,
  }));

  if (sort === "count") {
    return items.sort(
      (a, b) =>
        b.count - a.count ||
        getBodyPartOrderIndex(a.bodyPart) - getBodyPartOrderIndex(b.bodyPart) ||
        a.bodyPart.localeCompare(b.bodyPart, "ja")
    );
  }

  return items.sort(
    (a, b) =>
      getBodyPartOrderIndex(a.bodyPart) - getBodyPartOrderIndex(b.bodyPart) ||
      a.bodyPart.localeCompare(b.bodyPart, "ja")
  );
};

const normalizeCountsInput = (entriesOrCounts = [], options = {}) => {
  if (
    Array.isArray(entriesOrCounts) &&
    entriesOrCounts.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.bodyPart === "string" &&
        Number.isFinite(Number(item.count))
    )
  ) {
    const countsMap = {};
    entriesOrCounts.forEach((item) => {
      const bodyPart = getEntryBodyPart(item, options.fallbackBodyPart || "その他");
      countsMap[bodyPart] = (countsMap[bodyPart] || 0) + Number(item.count || 0);
    });
    return toCountsArray(countsMap, options.sort || "fixed");
  }

  return getExerciseCountByBodyPart(entriesOrCounts, options);
};

export function getExerciseCountByBodyPart(
  entries = [],
  {
    hiddenBodyParts = [],
    fallbackBodyPart = "その他",
    sort = "fixed",
  } = {}
) {
  const hiddenSet = new Set((hiddenBodyParts || []).map((part) => normalizeBodyPartLabel(part)));
  const keys = new Set();
  const countsMap = {};

  (entries || []).forEach((entry) => {
    if (!hasValidEntry(entry, hiddenSet, fallbackBodyPart)) return;

    const exerciseName = getEntryExerciseName(entry);
    const bodyPart = getEntryBodyPart(entry, fallbackBodyPart);
    const key = buildBodyPartExerciseKey(bodyPart, exerciseName);

    if (keys.has(key)) return;
    keys.add(key);

    countsMap[bodyPart] = (countsMap[bodyPart] || 0) + 1;
  });

  return toCountsArray(countsMap, sort);
}

export function getExerciseCountTotal(entriesOrCounts = [], options = {}) {
  return normalizeCountsInput(entriesOrCounts, options).reduce(
    (sum, item) => sum + Number(item.count || 0),
    0
  );
}

export function formatExerciseCountByBodyPart(
  entriesOrCounts = [],
  {
    hiddenBodyParts = [],
    fallbackBodyPart = "その他",
    sort = "fixed",
    maxParts = null,
    separator = " / ",
    suffix = "種目",
    locale = "ja",
    includeTotal = false,
    totalLabel = "合計",
  } = {}
) {
  const counts = normalizeCountsInput(entriesOrCounts, {
    hiddenBodyParts,
    fallbackBodyPart,
    sort,
  });

  const visibleCounts =
    typeof maxParts === "number" && maxParts > 0 ? counts.slice(0, maxParts) : counts;

  const labelMap = locale === "en" ? BODY_PART_ENGLISH_LABELS : null;
  const parts = visibleCounts.map((item) => {
    const bodyPartLabel = labelMap?.[item.bodyPart] || item.bodyPart;
    return `${bodyPartLabel} ${item.count}${suffix}`;
  });

  if (includeTotal && counts.length > visibleCounts.length) {
    parts.push(`${totalLabel} ${getExerciseCountTotal(counts)}${suffix}`);
  }

  return parts.join(separator);
}
