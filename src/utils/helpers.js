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

const isPlainObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function sanitizeWorkoutSet(set, { allowBodyweight = true } = {}) {
  if (!set || typeof set !== "object") return null;

  const reps = Number(set.reps);
  if (!Number.isFinite(reps) || reps <= 0) return null;

  if (set.weight === "BW") {
    if (!allowBodyweight) return null;
    return {
      ...set,
      weight: "BW",
      reps,
      done: Boolean(set.done),
    };
  }

  const weight = Number(set.weight);
  if (!Number.isFinite(weight) || weight <= 0) return null;

  return {
    ...set,
    weight,
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

  return [{ weight: record.weight, reps: record.reps, done: record.done }];
}

export function sanitizeHistoryRecord(record, { allowBodyweight = true } = {}) {
  if (!record || typeof record !== "object") return null;

  const sets = sanitizeWorkoutSets(getRecordSourceSets(record), { allowBodyweight });
  if (!sets.length) return null;

  const firstSet = sets[0];
  const weight = firstSet.weight === "BW" ? "BW" : Number(firstSet.weight);
  const reps = Number(firstSet.reps);
  const order = Number(record.order);
  const bodyPart = String(record.bodyPart || record.body_part || "").trim();

  return {
    ...record,
    date: String(record.date || ""),
    order: Number.isFinite(order) ? order : 999,
    bodyPart,
    sets,
    weight,
    reps,
  };
}

export function buildHistoryRecordSignature(record) {
  const sanitizedRecord = sanitizeHistoryRecord(record, { allowBodyweight: true });
  if (!sanitizedRecord?.date) return "";

  const setsSignature = sanitizedRecord.sets
    .map((set) => `${set.weight === "BW" ? "BW" : Number(set.weight)}|${Number(set.reps)}|${set.done ? 1 : 0}`)
    .join(";");

  return `${sanitizedRecord.date}::${sanitizedRecord.bodyPart || ""}::${setsSignature}`;
}

const choosePreferredHistoryRecord = (existingRecord, incomingRecord) => {
  if (!existingRecord) return incomingRecord;

  const existingSignature = buildHistoryRecordSignature(existingRecord);
  const incomingSignature = buildHistoryRecordSignature(incomingRecord);

  if (!existingSignature) return incomingRecord;
  if (!incomingSignature) return existingRecord;
  if (existingSignature === incomingSignature) return existingRecord;
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

export function buildHistoryFromWorkoutRows(rows) {
  const sortedRows = [...(rows || [])]
    .filter((row) => isPlainObject(row?.data))
    .sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")));

  return mergeHistoryMaps(...sortedRows.map((row) => row.data));
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
