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

// ─── 推定1RM計算（Epley式）────────────────────────────
export function calc1RM(sets) {
  if (!sets || !sets.length) return 0;
  return Math.max(...sets.map(s => {
    if (!s.weight || s.weight === "BW") return 0;
    return Number(s.weight) * (1 + Number(s.reps) / 30);
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