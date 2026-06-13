import { calc1RM, getRecordSourceSets, sanitizeWorkoutSet, sanitizeWorkoutSets } from "../../utils/helpers";
import { normalizeExerciseName } from "../../utils/exerciseName";
import { buildBodyPartExerciseKey, normalizeBodyPartLabel, resolveRecordBodyPartLabel } from "../../utils/bodyPartClassification";

export const debugLog = (...args) => {
  if (process.env.NODE_ENV !== "production") console.debug(...args);
};

export const PERIODS = [
  { label: "1ヶ月", days: 30 },
  { label: "3ヶ月", days: 90 },
  { label: "6ヶ月", days: 180 },
  { label: "1年", days: 365 },
];
export const SUMMARY_SCOPE_OPTIONS = [
  { key: "this_week", label: "今週" },
  { key: "last_week", label: "先週" },
  { key: "this_month", label: "今月" },
  { key: "last_month", label: "先月" },
];

export const FIXED_BODY_PART_LABELS = ["胸", "背中", "四頭", "ハム", "尻", "肩", "二頭", "三頭", "腹筋", "その他"];
export const BIG3_EXERCISES = [
  { key: "bench", label: "ベンチプレス" },
  { key: "squat", label: "スクワット" },
  { key: "deadlift", label: "デッドリフト" },
];
export const BODY_PART_CHART_PALETTE = [
  "#0F6B6B",
  "#14958F",
  "#20B8AE",
  "#37CDC4",
  "#65DCD4",
  "#8EE8E2",
  "#5EBFAE",
  "#7ACFC2",
  "#A7EDE8",
  "#B9DAD5",
];
export const BODY_PART_CHART_BG = "rgba(18, 199, 194, 0.045)";
export const BODY_PART_CHART_GRID = "rgba(15, 94, 99, 0.075)";
export const LB_PER_KG = 2.20462;

export const getBodyPartChartFill = (index = 0) =>
  BODY_PART_CHART_PALETTE[Math.min(index, BODY_PART_CHART_PALETTE.length - 1)] || "#20B8AE";

const WEEKDAY_LABELS_A = ["日", "月", "火", "水", "木", "金", "土"];
export const formatDate = (date) => {
  if (!date) return null;
  const d = new Date(date + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAY_LABELS_A[d.getDay()]})`;
};
export const getBodyPartDisplayLabel = (bodyPart) => normalizeBodyPartLabel(bodyPart);

export const normalizePrUnit = (unit) => {
  const value = String(unit || "kg").toLowerCase();
  if (value === "lbs" || value === "lb" || value === "pound" || value === "pounds") return "lb";
  if (value === "bw" || value === "bodyweight" || value === "自重") return "BW";
  return "kg";
};

export const formatPrWeightValue = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.toUpperCase() === "BW") return "自重";
  const num = Number(text);
  if (!Number.isFinite(num)) return text;
  const rounded = Math.round(num * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
};

export const getSetDisplayUnit = (set, fallbackUnit = "kg") =>
  normalizePrUnit(set?.displayUnit || set?.unit || set?.weightUnit || set?.weight_unit || fallbackUnit);

export const getSetDisplayWeight = (set) => {
  const unit = getSetDisplayUnit(set);
  if (unit === "BW" || String(set?.weight || "").toUpperCase() === "BW") return "自重";
  return formatPrWeightValue(set?.displayWeight ?? set?.weight);
};

export const getExplicitDisplayWeight = (set) => {
  const value = set?.displayWeight ?? set?.originalWeight ?? set?.inputWeight;
  return value !== undefined && value !== null && String(value).trim() !== "" ? value : null;
};

export const getRecordFallbackDisplayUnit = (record, fallbackUnit = "kg") =>
  normalizePrUnit(
    record?.displayUnit
    || record?.unit
    || record?.weightUnit
    || record?.weight_unit
    || record?.weightMode
    || record?.weightType
    || fallbackUnit
  );

export const getAnalyticsDisplayUnit = (rawSet = {}, record = {}, fallbackUnit = "kg") =>
  normalizePrUnit(
    rawSet?.displayUnit
    || rawSet?.unit
    || rawSet?.weightUnit
    || rawSet?.weight_unit
    || rawSet?.weightMode
    || rawSet?.weightType
    || record?.displayUnit
    || record?.unit
    || record?.weightUnit
    || record?.weight_unit
    || record?.weightMode
    || record?.weightType
    || fallbackUnit
  );

export const getAnalyticsDisplayWeight = (rawSet = {}, sanitizedSet = {}, displayUnit = "kg") => {
  if (displayUnit === "BW" || sanitizedSet?.weight === "BW" || String(rawSet?.weight || "").toUpperCase() === "BW") {
    return "自重";
  }

  const explicitDisplayWeight = getExplicitDisplayWeight(rawSet);
  if (explicitDisplayWeight !== null) return formatPrWeightValue(explicitDisplayWeight);

  const normalizedKg = Number(
    sanitizedSet?.normalizedWeightKg
    ?? sanitizedSet?.weightKg
    ?? sanitizedSet?.weight
  );
  if (displayUnit === "lb" && Number.isFinite(normalizedKg)) {
    return formatPrWeightValue(normalizedKg * LB_PER_KG);
  }

  return formatPrWeightValue(rawSet?.weight ?? sanitizedSet?.weight);
};

export const buildValidSetEntries = (record, { allowBodyweight = false } = {}) => {
  const fallbackUnit = getRecordFallbackDisplayUnit(record);
  return getRecordSourceSets(record)
    .map((rawSet) => {
      const rawSetUnit = rawSet?.displayUnit
        || rawSet?.unit
        || rawSet?.weightUnit
        || rawSet?.weight_unit
        || rawSet?.weightMode
        || rawSet?.weightType
        || null;
      const displayUnit = getAnalyticsDisplayUnit(rawSet, record, fallbackUnit);
      const explicitDisplayWeight = getExplicitDisplayWeight(rawSet);
      const sanitizeUnit = displayUnit === "lb" && !rawSetUnit && explicitDisplayWeight === null
        ? "kg"
        : displayUnit;
      const normalizedRawSet = {
        ...rawSet,
        displayUnit: sanitizeUnit,
        unit: rawSet?.unit || rawSet?.weightMode || rawSet?.weightType || sanitizeUnit,
        weightUnit: rawSet?.weightUnit || rawSet?.weight_unit || sanitizeUnit,
        weight_unit: rawSet?.weight_unit || rawSet?.weightUnit || sanitizeUnit,
        weightMode: rawSet?.weightMode || rawSet?.unit || sanitizeUnit,
        weightType: rawSet?.weightType || rawSet?.unit || sanitizeUnit,
      };
      const sanitizedSet = sanitizeWorkoutSet(normalizedRawSet, { allowBodyweight });
      if (!sanitizedSet) return null;
      const displayWeight = getAnalyticsDisplayWeight(rawSet, sanitizedSet, displayUnit);
      return {
        rawSet,
        set: {
          ...sanitizedSet,
          displayWeight,
          originalWeight: getExplicitDisplayWeight(rawSet) ?? displayWeight,
          displayUnit,
        },
        displayWeight,
        displayUnit,
      };
    })
    .filter(Boolean);
};

export const formatPrSetLabel = (item) => {
  if (!item) return "";
  const unit = normalizePrUnit(item.displayUnit || item.unit || "kg");
  const reps = formatPrWeightValue(item.reps);
  if (unit === "BW" || item.displayWeight === "自重" || item.weight === "BW") {
    return `自重 × ${reps}rep`;
  }
  const weight = formatPrWeightValue(item.displayWeight ?? item.weight);
  return `${weight}${unit} × ${reps}rep`;
};

export const buildValidSets = (record) =>
  sanitizeWorkoutSets(getRecordSourceSets(record), { allowBodyweight: false });

export const getRecordScopeFlags = (record) => {
  const sourceText = String(
    record?.historyScope
    || record?.sourceScope
    || record?.source
    || record?.sourceTable
    || record?.recordSource
    || ""
  ).toLowerCase();

  return {
    exactHistoryUsed: record?.exactHistory === true || sourceText.includes("exact") || sourceText.includes("workouts.data"),
    legacyHistoryUsed: record?.legacyHistory === true || sourceText.includes("legacy"),
    summaryJsonUsed: sourceText.includes("summary_json") || sourceText.includes("workout_session"),
    cacheUsed: sourceText.includes("cache") || sourceText.includes("localstorage"),
  };
};

export const logAnalyticsPrCalculation = (payload) => {
  console.log("[analytics pr]", {
    action: "analytics_pr_calculation",
    ...payload,
  });
};

export const logAnalyticsPrDisplayUnit = (payload) => {
  console.log("[analytics pr]", {
    action: "analytics_pr_display_unit",
    ...payload,
  });
};

export const isStalePrCandidate = (candidate) => (
  Boolean(candidate?.scopeFlags?.legacyHistoryUsed)
  || Boolean(candidate?.scopeFlags?.summaryJsonUsed)
  || Boolean(candidate?.scopeFlags?.cacheUsed)
);

export const filterAnalyticsPrCandidates = (candidates = [], key = "") => {
  const exactDates = new Set(
    candidates
      .filter((candidate) => candidate?.scopeFlags?.exactHistoryUsed)
      .map((candidate) => candidate?.date)
      .filter(Boolean)
  );
  const hasTrustedCandidate = candidates.some((candidate) => !isStalePrCandidate(candidate));

  return candidates.filter((candidate) => {
    const rejectedByExactSameDate = Boolean(
      candidate?.date
      && exactDates.has(candidate.date)
      && !candidate?.scopeFlags?.exactHistoryUsed
    );
    const rejectedByTrustedHistory = hasTrustedCandidate && isStalePrCandidate(candidate);
    const rejected = rejectedByExactSameDate || rejectedByTrustedHistory;

    if (rejected) {
      logAnalyticsPrCalculation({
        ...candidate.logPayload,
        exerciseKey: key,
        usedTrustedHistory: !isStalePrCandidate(candidate),
        usedSummaryJson: Boolean(candidate?.scopeFlags?.summaryJsonUsed),
        usedLegacyHistory: Boolean(candidate?.scopeFlags?.legacyHistoryUsed),
        usedManualBest: false,
        rejectedStalePR: true,
        ignoredStalePRSource: true,
        reason: rejectedByExactSameDate
          ? "exactHistory exists for same date; stale PR candidate ignored"
          : "trusted history exists; summary/legacy/cache PR candidate ignored",
      });
    }

    return !rejected;
  });
};

export const getBestSet = (validSets = [], fallbackUnit = "kg", setEntries = []) =>
  validSets.reduce((best, set, index) => {
    const score = calc1RM([set]);
    if (!best || score > best.score) {
      const entry = setEntries[index];
      const displayUnit = entry?.displayUnit || getSetDisplayUnit(set, fallbackUnit);
      const displayWeight = entry?.displayWeight ?? getSetDisplayWeight(set);
      return {
        weight: Number(set.weight),
        normalizedKgValue: Number(set.weight),
        normalizedKg: Number(set.weight),
        originalWeight: set.originalWeight ?? set.displayWeight ?? set.weight,
        originalUnit: displayUnit,
        displayWeight,
        displayUnit,
        reps: Number(set.reps),
        score,
      };
    }
    return best;
  }, null);

export const formatSetsText = (sets = [], fallbackUnit = "kg", setEntries = []) =>
  sets.map((set, index) => formatPrSetLabel({
    weight: Number(set.weight),
    displayWeight: setEntries[index]?.displayWeight ?? getSetDisplayWeight(set),
    displayUnit: setEntries[index]?.displayUnit || getSetDisplayUnit(set, fallbackUnit),
    reps: Number(set.reps),
  })).join(" / ");

export const sortByDateDesc = (a, b) => {
  const aDate = a?.date || "";
  const bDate = b?.date || "";
  if (aDate !== bDate) return bDate.localeCompare(aDate);
  return (b?.estimated1RM || 0) - (a?.estimated1RM || 0);
};

export const sortBodyPartLabels = (labels = []) =>
  [...new Set(labels)].sort((a, b) => {
    const aIndex = FIXED_BODY_PART_LABELS.indexOf(a);
    const bIndex = FIXED_BODY_PART_LABELS.indexOf(b);
    const safeA = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
    const safeB = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
    if (safeA !== safeB) return safeA - safeB;
    return String(a).localeCompare(String(b), "ja");
  });

export const sortByRecentDateDesc = (aDate, bDate) => {
  const safeA = String(aDate || "");
  const safeB = String(bDate || "");
  return safeB.localeCompare(safeA);
};

export const sortPrItemsByUsage = (a, b) => {
  const recordCountDiff = Number(b?.recordCount || 0) - Number(a?.recordCount || 0);
  if (recordCountDiff !== 0) return recordCountDiff;

  const latestDateDiff = sortByRecentDateDesc(a?.latestRecordDate, b?.latestRecordDate);
  if (latestDateDiff !== 0) return latestDateDiff;

  const estimatedDiff = Number(b?.estimated1RM || 0) - Number(a?.estimated1RM || 0);
  if (estimatedDiff !== 0) return estimatedDiff;

  return String(a?.displayName || a?.name || "").localeCompare(String(b?.displayName || b?.name || ""), "ja");
};

export const getCompositeKey = (bodyPart, exerciseName) =>
  buildBodyPartExerciseKey(bodyPart, normalizeExerciseName(exerciseName));

export const resolveAnalyticsBodyPart = (record, exerciseName, ctx) => {
  const bodyPart = resolveRecordBodyPartLabel(record, exerciseName, {
    muscleEx: ctx.muscleEx,
    exerciseBodyPartOverrides: ctx.exerciseBodyPartOverrides,
  });
  if (!bodyPart || ctx.hiddenSet.has(bodyPart)) return null;
  return bodyPart;
};

export const buildHistoryBestMap = (history = {}, ctx) => {
  const candidateMap = {};

  Object.entries(history || {}).forEach(([exerciseName, records]) => {
    const normalizedName = normalizeExerciseName(exerciseName);

    (records || []).forEach((record, index) => {
      const bodyPart = resolveAnalyticsBodyPart(record, exerciseName, ctx);
      if (!bodyPart) return;

      const setEntries = buildValidSetEntries(record, { allowBodyweight: false });
      const validSets = setEntries.map((entry) => entry.set);
      const rm = calc1RM(validSets);
      const bestSet = getBestSet(validSets, record?.displayUnit || record?.unit || record?.weightUnit || record?.weight_unit || "kg", setEntries);
      if (!bestSet || rm <= 0) return;

      const key = getCompositeKey(bodyPart, normalizedName);
      const scopeFlags = getRecordScopeFlags(record);
      const logPayload = {
        exerciseName: normalizedName,
        source: ctx.historySource || "canonicalDisplayHistory",
        date: record?.date || null,
        originalWeight: bestSet.originalWeight,
        originalUnit: bestSet.originalUnit,
        reps: bestSet.reps,
        normalizedKgValue: bestSet.normalizedKgValue,
        normalizedKg: bestSet.normalizedKg,
        displayWeight: bestSet.displayWeight,
        displayUnit: bestSet.displayUnit,
        estimated1RM: Math.round(rm),
        chosenPRDate: record?.date || null,
        chosenPRSet: {
          weight: bestSet.originalWeight,
          unit: bestSet.originalUnit,
          reps: bestSet.reps,
        },
        chosenPROriginalSet: {
          weight: bestSet.originalWeight,
          unit: bestSet.originalUnit,
          reps: bestSet.reps,
        },
        exactHistoryUsed: scopeFlags.exactHistoryUsed,
        legacyHistoryUsed: scopeFlags.legacyHistoryUsed,
      };
      logAnalyticsPrDisplayUnit({
        exerciseName: normalizedName,
        date: record?.date || null,
        originalWeight: bestSet.originalWeight,
        originalUnit: bestSet.originalUnit,
        displayWeight: bestSet.displayWeight,
        displayUnit: bestSet.displayUnit,
        normalizedKg: bestSet.normalizedKg,
        usedForCalculationOnly: true,
      });
      if (!candidateMap[key]) candidateMap[key] = [];
      candidateMap[key].push({
        key,
        name: normalizedName,
        displayName: normalizedName,
        bodyPart,
        weight: bestSet.weight,
        displayWeight: bestSet.displayWeight,
        displayUnit: bestSet.displayUnit,
        reps: bestSet.reps,
        estimated1RM: Math.round(rm),
        score: rm,
        date: record?.date || null,
        source: "workouts.data",
        sourceLabel: null,
        sourceIndex: index,
        scopeFlags,
        logPayload,
      });
    });
  });

  const bestMap = {};
  Object.entries(candidateMap).forEach(([key, candidates]) => {
    const filteredCandidates = filterAnalyticsPrCandidates(candidates, key);
    const best = filteredCandidates.reduce((currentBest, candidate) => (
      !currentBest || Number(candidate.score || 0) > Number(currentBest.score || 0)
        ? candidate
        : currentBest
    ), null);
    if (!best) return;

    logAnalyticsPrCalculation({
      ...best.logPayload,
      usedTrustedHistory: true,
      usedSummaryJson: Boolean(best.scopeFlags.summaryJsonUsed),
      usedLegacyHistory: Boolean(best.scopeFlags.legacyHistoryUsed),
      usedManualBest: false,
      rejectedStalePR: false,
      ignoredStalePRSource: false,
    });

    const { score, scopeFlags, logPayload, sourceIndex, ...entry } = best;
    bestMap[key] = entry;
  });

  return bestMap;
};

export const buildManualBestMap = (manualBests = [], ctx) => {
  const bestMap = {};

  (manualBests || []).forEach((entry) => {
    if (!entry?.exercise_name) return;
    const normalizedName = normalizeExerciseName(entry.exercise_name);
    const bodyPart = resolveAnalyticsBodyPart({ bodyPart: entry?.body_part }, entry.exercise_name, ctx);
    if (!bodyPart) return;

    const validSets = buildValidSets({ weight: entry.weight, reps: entry.reps });
    const rm = calc1RM(validSets);
    if (!validSets.length || rm <= 0) return;

    const key = getCompositeKey(bodyPart, normalizedName);
    if (!bestMap[key] || rm > bestMap[key].estimated1RM) {
      bestMap[key] = {
        key,
        name: normalizedName,
        displayName: normalizedName,
        bodyPart,
        weight: Number(entry.weight),
        displayWeight: formatPrWeightValue(entry.weight),
        displayUnit: "kg",
        reps: Number(entry.reps),
        estimated1RM: Math.round(rm),
        date: entry.best_date || null,
        source: "manual",
        sourceLabel: "移行記録",
      };
    }
  });

  return bestMap;
};

export const buildHistoryRecordMap = (history = {}, ctx) => {
  const candidateMap = {};

  Object.entries(history || {}).forEach(([exerciseName, records]) => {
    const normalizedName = normalizeExerciseName(exerciseName);

    (records || []).forEach((record, index) => {
      const bodyPart = resolveAnalyticsBodyPart(record, exerciseName, ctx);
      if (!bodyPart) return;

      const setEntries = buildValidSetEntries(record, { allowBodyweight: false });
      const validSets = setEntries.map((entry) => entry.set);
      const rm = calc1RM(validSets);
      const bestSet = getBestSet(validSets, record?.displayUnit || record?.unit || record?.weightUnit || record?.weight_unit || "kg", setEntries);
      if (!bestSet || rm <= 0) return;

      const key = getCompositeKey(bodyPart, normalizedName);
      const scopeFlags = getRecordScopeFlags(record);
      const displayRecord = {
        id: `history-${key}-${record?.date || "nodate"}-${index}`,
        key,
        name: normalizedName,
        displayName: normalizedName,
        bodyPart,
        date: record?.date || null,
        weight: bestSet.weight,
        displayWeight: bestSet.displayWeight,
        displayUnit: bestSet.displayUnit,
        reps: bestSet.reps,
        estimated1RM: Math.round(rm),
        setsText: formatSetsText(validSets, record?.displayUnit || record?.unit || record?.weightUnit || record?.weight_unit || "kg", setEntries),
        source: "workouts.data",
        sourceLabel: null,
        score: rm,
        scopeFlags,
        logPayload: {
          exerciseName: normalizedName,
          source: ctx.historySource || "canonicalDisplayHistory",
          date: record?.date || null,
          originalWeight: bestSet.originalWeight,
          originalUnit: bestSet.originalUnit,
          reps: bestSet.reps,
          normalizedKgValue: bestSet.normalizedKgValue,
          normalizedKg: bestSet.normalizedKg,
          displayWeight: bestSet.displayWeight,
          displayUnit: bestSet.displayUnit,
          estimated1RM: Math.round(rm),
          chosenPRDate: record?.date || null,
          chosenPRSet: {
            weight: bestSet.originalWeight,
            unit: bestSet.originalUnit,
            reps: bestSet.reps,
          },
          exactHistoryUsed: scopeFlags.exactHistoryUsed,
          legacyHistoryUsed: scopeFlags.legacyHistoryUsed,
        },
      };
      logAnalyticsPrDisplayUnit({
        exerciseName: normalizedName,
        date: record?.date || null,
        originalWeight: bestSet.originalWeight,
        originalUnit: bestSet.originalUnit,
        displayWeight: bestSet.displayWeight,
        displayUnit: bestSet.displayUnit,
        normalizedKg: bestSet.normalizedKg,
        usedForCalculationOnly: true,
      });
      if (!candidateMap[key]) candidateMap[key] = [];
      candidateMap[key].push(displayRecord);
    });
  });

  const recordMap = {};
  Object.entries(candidateMap).forEach(([key, candidates]) => {
    recordMap[key] = filterAnalyticsPrCandidates(candidates, key)
      .map(({ score, scopeFlags, logPayload, ...record }) => record);
  });

  return recordMap;
};

export const buildManualRecordMap = (manualBests = [], ctx) => {
  const recordMap = {};

  (manualBests || []).forEach((entry, index) => {
    if (!entry?.exercise_name) return;
    const normalizedName = normalizeExerciseName(entry.exercise_name);
    const bodyPart = resolveAnalyticsBodyPart({ bodyPart: entry?.body_part }, entry.exercise_name, ctx);
    if (!bodyPart) return;

    const validSets = buildValidSets({ weight: entry.weight, reps: entry.reps });
    const rm = calc1RM(validSets);
    if (!validSets.length || rm <= 0) return;

    const key = getCompositeKey(bodyPart, normalizedName);
    if (!recordMap[key]) recordMap[key] = [];
    recordMap[key].push({
      id: `manual-${key}-${entry?.best_date || "nodate"}-${entry?.id || index}`,
      key,
      name: normalizedName,
      displayName: normalizedName,
      bodyPart,
      date: entry.best_date || null,
      weight: Number(entry.weight),
      displayWeight: formatPrWeightValue(entry.weight),
      displayUnit: "kg",
      reps: Number(entry.reps),
      estimated1RM: Math.round(rm),
      setsText: formatPrSetLabel({
        weight: Number(entry.weight),
        displayWeight: formatPrWeightValue(entry.weight),
        displayUnit: "kg",
        reps: Number(entry.reps),
      }),
      source: "manual",
      sourceLabel: "移行記録",
    });
  });

  return recordMap;
};

export const buildChartData = (records = [], period) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - period);

  const grouped = {};
  records.forEach((record) => {
    if (!record?.date) return;
    const recordDate = new Date(`${record.date}T00:00:00`);
    if (recordDate < cutoff) return;

    if (!grouped[record.date] || record.estimated1RM > grouped[record.date].estimated1RM) {
      grouped[record.date] = record;
    }
  });

  const sorted = Object.values(grouped)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

  const maxWeight = sorted.reduce((max, record) => Math.max(max, Number(record.estimated1RM || 0)), 0);
  const latestDate = sorted[sorted.length - 1]?.date || null;

  return sorted.map((record) => ({
    rawDate: record.date,
    date: record.date.slice(5),
    weight: Number(record.estimated1RM || 0),
    setWeight: record.weight,
    setLabel: formatPrSetLabel(record),
    reps: record.reps,
    isLatest: record.date === latestDate,
    isPeak: Number(record.estimated1RM || 0) === maxWeight,
  }));
};

export const buildChartDomain = (chartData = []) => {
  if (!chartData.length) return [0, 100];

  const values = chartData.map((item) => Number(item.weight || 0)).filter(Number.isFinite);
  if (!values.length) return [0, 100];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 1);
  const minRange = Math.max(8, Math.ceil(max * 0.08));
  const paddedSpread = Math.max(spread, minRange);
  const padding = Math.max(2, Math.ceil(paddedSpread * 0.15));

  let domainMin = Math.floor((min - padding) / 5) * 5;
  let domainMax = Math.ceil((max + padding) / 5) * 5;

  if (domainMax - domainMin < minRange) {
    const midpoint = (max + min) / 2;
    domainMin = Math.floor((midpoint - minRange / 2) / 5) * 5;
    domainMax = Math.ceil((midpoint + minRange / 2) / 5) * 5;
  }

  if (domainMin < 0) domainMin = 0;
  if (domainMax <= domainMin) domainMax = domainMin + minRange;

  return [domainMin, domainMax];
};

export const buildChartTicks = (chartData = []) => {
  if (chartData.length <= 3) return chartData.map((item) => item.date);
  const midIndex = Math.floor((chartData.length - 1) / 2);
  return [...new Set([
    chartData[0]?.date,
    chartData[midIndex]?.date,
    chartData[chartData.length - 1]?.date,
  ].filter(Boolean))];
};
