import {
  BODY_PART_DISPLAY_ORDER,
  BODY_PART_ENGLISH_LABELS,
} from "./exerciseCountByBodyPart";
import { normalizeBodyPartLabel } from "./bodyPartClassification";

const getBodyPartOrderIndex = (bodyPart) => {
  const index = BODY_PART_DISPLAY_ORDER.indexOf(bodyPart);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

const getEntryBodyPart = (entry, fallbackBodyPart = "その他") => {
  const raw = String(entry?.bodyPart || entry?.body_part || "").trim();
  return normalizeBodyPartLabel(raw, fallbackBodyPart);
};

const getEntrySets = (entry) => (Array.isArray(entry?.sets) ? entry.sets.filter(Boolean) : []);

const isValidSet = (set) => {
  const reps = Number(set?.reps);
  if (!Number.isFinite(reps) || reps <= 0) return false;

  if (set?.weight === "BW") return true;

  const weight = Number(set?.weight);
  return Number.isFinite(weight) && weight > 0;
};

const getEntryValidSetCount = (entry) => {
  const sets = getEntrySets(entry);
  if (sets.length > 0) {
    return sets.reduce((sum, set) => sum + (isValidSet(set) ? 1 : 0), 0);
  }

  const setCount = Number(entry?.setCount ?? entry?.set_count ?? 0);
  return Number.isFinite(setCount) && setCount > 0 ? setCount : 0;
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

  return getSetCountByBodyPart(entriesOrCounts, options);
};

export function getSetCountByBodyPart(
  entries = [],
  {
    hiddenBodyParts = [],
    fallbackBodyPart = "その他",
    sort = "fixed",
  } = {}
) {
  const hiddenSet = new Set((hiddenBodyParts || []).map((part) => normalizeBodyPartLabel(part)));
  const countsMap = {};

  (entries || []).forEach((entry) => {
    const bodyPart = getEntryBodyPart(entry, fallbackBodyPart);
    if (hiddenSet.has(bodyPart)) return;

    const validSetCount = getEntryValidSetCount(entry);
    if (!validSetCount) return;

    countsMap[bodyPart] = (countsMap[bodyPart] || 0) + validSetCount;
  });

  return toCountsArray(countsMap, sort);
}

export function getSetCountTotal(entriesOrCounts = [], options = {}) {
  return normalizeCountsInput(entriesOrCounts, options).reduce(
    (sum, item) => sum + Number(item.count || 0),
    0
  );
}

export function formatSetCountByBodyPart(
  entriesOrCounts = [],
  {
    hiddenBodyParts = [],
    fallbackBodyPart = "その他",
    sort = "fixed",
    maxParts = null,
    separator = " / ",
    suffix = "セット",
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
    parts.push(`${totalLabel} ${getSetCountTotal(counts)}${suffix}`);
  }

  return parts.join(separator);
}
