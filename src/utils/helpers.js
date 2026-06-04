import { WEEK_DAYS } from "../constants/suggestions";

// ─── localStorage ────────────────────────────────────
export function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ─── 日付 ────────────────────────────────────────────
export function getDayLabel(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEK_DAYS[d.getDay()]})`;
}

export function getTodayIdx(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.getDay();
}

export function getTodayStr() {
  return new Date().toISOString().split("T")[0];
}

export function formatDateKey(dateInput = new Date()) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const isPlainObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);

const LB_TO_KG = 0.453592;

const normalizeWorkoutWeightUnit = (unit) => {
  const value = String(unit || "kg").trim().toLowerCase();
  if (value === "lbs" || value === "lb" || value === "pound" || value === "pounds") return "lbs";
  if (value === "bw" || value === "bodyweight" || value === "自重") return "BW";
  return "kg";
};

const getWorkoutSetUnit = (set, fallbackUnit = "kg") =>
  normalizeWorkoutWeightUnit(
    set?.weightMode
    || set?.weightType
    || set?.displayUnit
    || set?.unit
    || set?.weightUnit
    || set?.weight_unit
    || fallbackUnit
  );

const getWorkoutSetDisplayUnit = (unit) => {
  const normalized = normalizeWorkoutWeightUnit(unit);
  return normalized === "lbs" ? "lb" : normalized;
};

const hasDisplayWeightValue = (set) => {
  const value = set?.displayWeight ?? set?.originalWeight ?? set?.inputWeight;
  return value !== undefined && value !== null && String(value).trim() !== "";
};

const getWorkoutSetDisplayWeight = (set, unit) => {
  const value = set?.displayWeight ?? set?.originalWeight ?? set?.inputWeight ?? set?.weight;
  if (normalizeWorkoutWeightUnit(unit) === "BW" || String(value || "").toUpperCase() === "BW") {
    return "BW";
  }
  return value;
};

export function sanitizeWorkoutSet(set, { allowBodyweight = true } = {}) {
  if (!set || typeof set !== "object") return null;

  const reps = Number(set.reps ?? set.rep);
  if (!Number.isFinite(reps) || reps <= 0) return null;

  const unit = getWorkoutSetUnit(set);
  const displayWeight = getWorkoutSetDisplayWeight(set, unit);
  const rawWeight = unit === "lbs" && hasDisplayWeightValue(set)
    ? displayWeight
    : set.weight ?? set.weightKg ?? set.weight_kg ?? set.kg ?? displayWeight;

  if (unit === "BW" || String(rawWeight).toUpperCase() === "BW") {
    if (!allowBodyweight) return null;
    return {
      ...set,
      weight: "BW",
      displayWeight: "BW",
      originalWeight: set.originalWeight ?? displayWeight ?? "BW",
      displayUnit: "BW",
      unit: "BW",
      weightMode: set.weightMode || "BW",
      weightType: set.weightType || "BW",
      weightUnit: set.weightUnit || "BW",
      weight_unit: set.weight_unit || "BW",
      reps,
      done: Boolean(set.done),
    };
  }

  const displayWeightNumber = Number(rawWeight);
  if (!Number.isFinite(displayWeightNumber) || displayWeightNumber <= 0) return null;

  const weightKg = unit === "lbs" ? displayWeightNumber * LB_TO_KG : displayWeightNumber;
  const displayUnit = getWorkoutSetDisplayUnit(unit);

  return {
    ...set,
    weight: weightKg,
    weightKg,
    normalizedWeightKg: weightKg,
    displayWeight: displayWeight ?? rawWeight,
    originalWeight: set.originalWeight ?? displayWeight ?? rawWeight,
    displayUnit,
    unit,
    weightMode: set.weightMode || unit,
    weightType: set.weightType || unit,
    weightUnit: set.weightUnit || unit,
    weight_unit: set.weight_unit || unit,
    reps,
    done: Boolean(set.done),
  };
}

export function sanitizeWorkoutSets(sets, options) {
  return (Array.isArray(sets) ? sets : [])
    .map((set) => sanitizeWorkoutSet(set, options))
    .filter(Boolean);
}

export function isCompletedWorkoutSet(set) {
  if (!set || typeof set !== "object") return false;

  const reps = Number(set.reps);
  if (!Number.isFinite(reps) || reps <= 0) return false;

  if (set.weight === "BW") {
    return true;
  }

  const weight = Number(set.weight);
  return Number.isFinite(weight) && weight > 0;
}

export function getRecordSourceSets(record) {
  if (!record || typeof record !== "object") return [];

  if (Array.isArray(record.sets) && record.sets.length > 0) {
    return record.sets;
  }

  return [{
    weight: record.weight ?? record.weightKg ?? record.weight_kg ?? record.kg ?? record.displayWeight,
    displayWeight: record.displayWeight ?? record.originalWeight ?? record.inputWeight ?? record.weight,
    originalWeight: record.originalWeight ?? record.displayWeight ?? record.weight,
    displayUnit: record.displayUnit ?? record.unit ?? record.weightUnit ?? record.weight_unit,
    unit: record.unit ?? record.weightMode ?? record.weightType ?? record.displayUnit ?? record.weightUnit ?? record.weight_unit,
    weightMode: record.weightMode ?? record.unit ?? record.displayUnit ?? record.weightUnit ?? record.weight_unit,
    weightType: record.weightType ?? record.unit ?? record.displayUnit ?? record.weightUnit ?? record.weight_unit,
    weightUnit: record.weightUnit ?? record.unit ?? record.displayUnit,
    weight_unit: record.weight_unit ?? record.unit ?? record.displayUnit,
    reps: record.reps ?? record.rep,
    done: record.done,
  }];
}

export function sanitizeHistoryRecord(record, { allowBodyweight = true } = {}) {
  if (!record || typeof record !== "object") return null;

  const sets = sanitizeWorkoutSets(getRecordSourceSets(record), { allowBodyweight });
  if (!sets.length) return null;

  const firstSet = sets[0];
  const weight = firstSet.weight === "BW" ? "BW" : Number(firstSet.weight);
  const reps = Number(firstSet.reps);
  const order = Number(record.order);
  const rawDate = record.date ?? record.workoutDate ?? record.workout_date;
  const date = String(rawDate || "").slice(0, 10);
  const bodyPart = String(record.bodyPart || record.body_part || "").trim();

  return {
    ...record,
    date,
    order: Number.isFinite(order) ? order : 999,
    bodyPart,
    sets,
    weight,
    reps,
  };
}

export function hasValidHistoryRecord(record, { allowBodyweight = true } = {}) {
  return Boolean(sanitizeHistoryRecord(record, { allowBodyweight })?.date);
}

export function hasValidWorkoutOnDate(historyMap, targetDate) {
  const normalizedDate = String(targetDate || "").trim();
  if (!normalizedDate) return false;

  return Object.values(historyMap || {}).some((records) =>
    (records || []).some((record) => {
      const sanitizedRecord = sanitizeHistoryRecord(record, { allowBodyweight: true });
      return sanitizedRecord?.date === normalizedDate;
    })
  );
}

export function getValidWorkoutDatesFromHistory(historyMap, { prefix = "", since = "" } = {}) {
  const validDates = new Set();

  Object.values(historyMap || {}).forEach((records) => {
    (records || []).forEach((record) => {
      const sanitizedRecord = sanitizeHistoryRecord(record, { allowBodyweight: true });
      const date = String(sanitizedRecord?.date || "").trim();
      if (!date) return;
      if (prefix && !date.startsWith(prefix)) return;
      if (since && date < since) return;
      validDates.add(date);
    });
  });

  return Array.from(validDates).sort();
}

export function buildHistoryRecordSignature(record) {
  const sanitizedRecord = sanitizeHistoryRecord(record, { allowBodyweight: true });
  if (!sanitizedRecord?.date) return "";

  const setsSignature = sanitizedRecord.sets
    .map((set) => {
      const unit = String(set.displayUnit || set.unit || set.weightUnit || set.weight_unit || "").trim();
      const displayWeight = String(set.displayWeight ?? "").trim();
      return `${set.weight === "BW" ? "BW" : Number(set.weight)}|${displayWeight}|${unit}|${Number(set.reps)}|${set.done ? 1 : 0}`;
    })
    .join(";");

  return `${sanitizedRecord.date}::${sanitizedRecord.bodyPart || ""}::${setsSignature}`;
}

const getHistoryRecordDurationSec = (record) => {
  const candidates = [
    Number(record?.duration_sec),
    Number(record?.durationSec),
    Number(record?.durationMinutes) * 60,
    Number(record?.elapsedMinutes) * 60,
  ];

  const durationSec = candidates.find((value) => Number.isFinite(value) && value > 0);
  return durationSec ? Math.floor(durationSec) : 0;
};

const getHistoryRecordMetrics = (record) => {
  const sanitizedRecord = sanitizeHistoryRecord(record, { allowBodyweight: true });
  const sets = sanitizedRecord?.sets || [];
  const volume = sets.reduce((sum, set) => {
    const weight = Number(set?.weight);
    const reps = Number(set?.reps);
    if (!Number.isFinite(weight) || !Number.isFinite(reps)) return sum;
    return sum + (weight > 0 && reps > 0 ? weight * reps : 0);
  }, 0);

  return {
    setCount: sets.length,
    volume,
  };
};

const choosePreferredHistoryRecord = (existingRecord, incomingRecord) => {
  if (!existingRecord) return incomingRecord;

  const existingSignature = buildHistoryRecordSignature(existingRecord);
  const incomingSignature = buildHistoryRecordSignature(incomingRecord);

  if (!existingSignature) return incomingRecord;
  if (!incomingSignature) return existingRecord;
  if (existingSignature === incomingSignature) {
    const existingDurationSec = getHistoryRecordDurationSec(existingRecord);
    const incomingDurationSec = getHistoryRecordDurationSec(incomingRecord);
    const durationSec = Math.max(existingDurationSec, incomingDurationSec);
    if (durationSec <= 0) return existingRecord;
    const durationMinutes = Math.max(1, Math.round(durationSec / 60));
    return {
      ...existingRecord,
      duration_sec: durationSec,
      durationSec,
      durationMinutes,
      elapsedMinutes: durationMinutes,
    };
  }

  const existingMetrics = getHistoryRecordMetrics(existingRecord);
  const incomingMetrics = getHistoryRecordMetrics(incomingRecord);

  if (incomingMetrics.setCount !== existingMetrics.setCount) {
    return incomingMetrics.setCount > existingMetrics.setCount ? incomingRecord : existingRecord;
  }

  if (incomingMetrics.volume !== existingMetrics.volume) {
    return incomingMetrics.volume > existingMetrics.volume ? incomingRecord : existingRecord;
  }

  return incomingRecord;
};

export function mergeHistoryMaps(...sources) {
  const mergedMaps = new Map();

  sources.forEach((source) => {
    if (!isPlainObject(source)) return;

    Object.entries(source).forEach(([exerciseName, records]) => {
      if (!exerciseName || !Array.isArray(records) || !records.length) return;

      const dateMap = mergedMaps.get(exerciseName) || new Map();

      records.forEach((record) => {
        const sanitizedRecord = sanitizeHistoryRecord(record, { allowBodyweight: true });
        if (!sanitizedRecord?.date) return;

        const existingRecord = dateMap.get(sanitizedRecord.date);
        dateMap.set(
          sanitizedRecord.date,
          choosePreferredHistoryRecord(existingRecord, sanitizedRecord)
        );
      });

      if (dateMap.size > 0) {
        mergedMaps.set(exerciseName, dateMap);
      }
    });
  });

  const mergedHistory = {};

  mergedMaps.forEach((dateMap, exerciseName) => {
    const records = Array.from(dateMap.values())
      .filter(Boolean)
      .sort((a, b) => {
        const dateCompare = String(a?.date || "").localeCompare(String(b?.date || ""));
        if (dateCompare !== 0) return dateCompare;

        const orderA = Number.isFinite(a?.order) ? a.order : 999;
        const orderB = Number.isFinite(b?.order) ? b.order : 999;
        return orderA - orderB;
      });

    if (records.length > 0) {
      mergedHistory[exerciseName] = records;
    }
  });

  return mergedHistory;
}

const getWorkoutRowHistoryData = (row) => {
  if (isPlainObject(row?.data?.history)) return row.data.history;
  if (isPlainObject(row?.data?.records)) return row.data.records;
  return row?.data;
};

const addWorkoutRowRecordToHistory = (historyMap, exerciseName, record, fallbackDate) => {
  if (!exerciseName || !isPlainObject(record)) return;
  const recordDate = String(record?.date || record?.workoutDate || record?.workout_date || "").slice(0, 10);
  const nextRecord = recordDate || !fallbackDate
    ? record
    : {
        ...record,
        date: fallbackDate,
        workoutDate: fallbackDate,
        workout_date: fallbackDate,
      };

  if (!historyMap[exerciseName]) historyMap[exerciseName] = [];
  historyMap[exerciseName].push(nextRecord);
};

const removeHistoryDateFromMap = (historyMap, targetDate) => {
  const normalizedDate = String(targetDate || "").slice(0, 10);
  if (!normalizedDate) return historyMap || {};

  const next = {};
  Object.entries(historyMap || {}).forEach(([exerciseName, records]) => {
    const keptRecords = (records || []).filter((record) => (
      String(record?.date || record?.workoutDate || record?.workout_date || "").slice(0, 10) !== normalizedDate
    ));
    if (keptRecords.length > 0) next[exerciseName] = keptRecords;
  });
  return next;
};

const applyPreferredHistoryDates = (baseHistory, preferredHistory, dates = []) => {
  const normalizedDates = [...new Set(
    (dates || []).map((date) => String(date || "").slice(0, 10)).filter(Boolean)
  )];
  let nextHistory = mergeHistoryMaps(baseHistory || {});

  normalizedDates.forEach((date) => {
    nextHistory = removeHistoryDateFromMap(nextHistory, date);
    const dateRecords = {};
    Object.entries(preferredHistory || {}).forEach(([exerciseName, records]) => {
      const filtered = (records || []).filter((record) => (
        String(record?.date || record?.workoutDate || record?.workout_date || "").slice(0, 10) === date
      ));
      if (filtered.length > 0) dateRecords[exerciseName] = filtered;
    });
    nextHistory = mergeHistoryMaps(nextHistory, dateRecords);
  });

  return nextHistory;
};

export function buildHistoryFromWorkoutRowsWithScopes(rows) {
  const sortedRows = [...(rows || [])]
    .filter((row) => isPlainObject(row?.data))
    .sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")));

  const exactRowHistories = [];
  const legacyEmbeddedHistories = [];

  sortedRows.forEach((row) => {
    const rowDate = String(row?.date || row?.workout_date || row?.workoutDate || "").slice(0, 10);
    const rowHistoryData = getWorkoutRowHistoryData(row);
    const exactHistory = {};
    const legacyHistory = {};

    Object.entries(rowHistoryData || {}).forEach(([exerciseName, rawRecords]) => {
      const records = Array.isArray(rawRecords)
        ? rawRecords
        : isPlainObject(rawRecords)
          ? [rawRecords]
          : [];

      records.forEach((record) => {
        const recordDate = String(record?.date || record?.workoutDate || record?.workout_date || "").slice(0, 10);
        const effectiveDate = recordDate || rowDate;
        if (!effectiveDate) return;

        if (rowDate && effectiveDate !== rowDate) {
          addWorkoutRowRecordToHistory(legacyHistory, exerciseName, record, effectiveDate);
        } else {
          addWorkoutRowRecordToHistory(exactHistory, exerciseName, record, rowDate || effectiveDate);
        }
      });
    });

    exactRowHistories.push(exactHistory);
    legacyEmbeddedHistories.push(legacyHistory);
  });

  const exactHistory = mergeHistoryMaps(...exactRowHistories);
  const legacyHistory = mergeHistoryMaps(...legacyEmbeddedHistories);
  const exactDates = getValidWorkoutDatesFromHistory(exactHistory);
  const history = applyPreferredHistoryDates(legacyHistory, exactHistory, exactDates);

  return {
    history,
    exactHistory,
    legacyHistory,
    exactDates,
    legacyDates: getValidWorkoutDatesFromHistory(legacyHistory),
  };
}

export function buildHistoryFromWorkoutRows(rows) {
  return buildHistoryFromWorkoutRowsWithScopes(rows).history;
}

export const PR_UPDATE_TOLERANCE_KG = 0.15;

export function getBestRmSet(sets, { allowBodyweight = false } = {}) {
  const validSets = sanitizeWorkoutSets(sets, { allowBodyweight });
  if (!validSets.length) return null;

  return validSets.reduce((best, set) => {
    const rm = calc1RM([set]);
    if (!best || rm > best.rm) {
      return {
        ...set,
        rm,
      };
    }
    return best;
  }, null);
}

export function hasMeaningfulPRIncrease(currentSets, previousSets, previousRM = null, tolerance = PR_UPDATE_TOLERANCE_KG) {
  const currentTopSet = getBestRmSet(currentSets, { allowBodyweight: false });
  const previousTopSet = getBestRmSet(previousSets, { allowBodyweight: false });

  if (!currentTopSet || !previousTopSet) return false;

  if (
    Number(currentTopSet.weight) === Number(previousTopSet.weight) &&
    Number(currentTopSet.reps) === Number(previousTopSet.reps)
  ) {
    return false;
  }

  const baselineRM = Number.isFinite(previousRM) && previousRM > 0
    ? previousRM
    : previousTopSet.rm;

  return currentTopSet.rm - baselineRM > tolerance;
}

// ─── 推定1RM計算（Epley式）────────────────────────────
export function calc1RM(sets) {
  const validSets = sanitizeWorkoutSets(sets, { allowBodyweight: false });
  if (!validSets.length) return 0;

  return Math.max(...validSets.map((s) => {
    const weight = Number(s.weight);
    const reps = Number(s.reps);
    if (!Number.isFinite(weight) || !Number.isFinite(reps) || weight <= 0 || reps <= 0) return 0;
    if (reps === 1) return weight;
    return weight * (1 + reps / 30);
  }));
}

// ─── 単位変換 ─────────────────────────────────────────
export const KG_TO_LBS = 2.2046;

/** kg で保存されている値を表示用に変換 */
export function dispW(kg, unit) {
  if (kg === "BW") return "自重";
  if (kg === "" || kg === undefined || kg === null) return "";
  const n = Number(kg);
  if (isNaN(n) || n === 0) return unit === "lbs" ? "" : String(n === 0 ? "" : n);
  return unit === "lbs"
    ? String(Math.round(n * KG_TO_LBS * 10) / 10)
    : String(n);
}

/** ユーザー入力（表示単位）を kg に変換して保存 */
export function storeW(val, unit) {
  if (val === "" || val === undefined || val === null) return val;
  if (val === "BW") return "BW";
  const n = Number(val);
  if (isNaN(n) || unit !== "lbs") return val;
  return String(Math.round(n / KG_TO_LBS * 100) / 100);
}
