/**
 * Unit tests for weighted bodyweight (Phase 2-b, data layer)
 * Run with: npm test -- --testPathPattern=weightedBodyweight
 */

import { buildPrWeightLabel, formatBWSetLabel, resolveEffectiveWeightKg } from "./helpers";
import {
  getHistoryMetricsForDate as getHistoryMetricsFromWorkoutHistory,
} from "./workoutHistory";
import {
  getHistoryMetricsForDate as getHistoryMetricsFromAppHelpers,
} from "./appHelpers";

// ── resolveEffectiveWeightKg ──────────────────────────────────────────────────

describe("resolveEffectiveWeightKg", () => {
  test("BW + added_weight_kg → body_weight + added", () => {
    const set = { weight: "BW", body_weight_kg: 65, added_weight_kg: 10, reps: 5 };
    expect(resolveEffectiveWeightKg(set, null)).toBe(75);
  });

  test("BW, added 未設定 → body_weight のみ", () => {
    const set = { weight: "BW", body_weight_kg: 65, reps: 10 };
    expect(resolveEffectiveWeightKg(set, null)).toBe(65);
  });

  test("BW, body_weight_kg なし, bodyWeightKg=65, added=10 → 75", () => {
    const set = { weight: "BW", added_weight_kg: 10, reps: 8 };
    expect(resolveEffectiveWeightKg(set, 65)).toBe(75);
  });

  test("体重未設定, added=10 → null（加重だけでは重量を決められない）", () => {
    const set = { weight: "BW", added_weight_kg: 10, reps: 5 };
    expect(resolveEffectiveWeightKg(set, null)).toBeNull();
  });

  test("数値セット（weight=60）, added_weight_kg=10 → 60（added は無視）", () => {
    const set = { weight: 60, added_weight_kg: 10, reps: 5 };
    expect(resolveEffectiveWeightKg(set, null)).toBe(60);
  });

  test("BW + added_weight_kg が負値 → body_weight のみ（負値は 0 扱い）", () => {
    const set = { weight: "BW", body_weight_kg: 65, added_weight_kg: -5, reps: 5 };
    expect(resolveEffectiveWeightKg(set, null)).toBe(65);
  });

  test("BW + added_weight_kg が NaN → body_weight のみ", () => {
    const set = { weight: "BW", body_weight_kg: 65, added_weight_kg: NaN, reps: 5 };
    expect(resolveEffectiveWeightKg(set, null)).toBe(65);
  });

  test("BW + added_weight_kg が 0 → body_weight のみ（0 は未設定と同じ扱い）", () => {
    const set = { weight: "BW", body_weight_kg: 65, added_weight_kg: 0, reps: 5 };
    expect(resolveEffectiveWeightKg(set, null)).toBe(65);
  });
});

// ── formatBWSetLabel ──────────────────────────────────────────────────────────

describe("formatBWSetLabel", () => {
  test("BW のみ → '自重'", () => {
    expect(formatBWSetLabel({ weight: "BW" })).toBe("自重");
  });

  test("BW + added_weight_kg=10 → '自重+10kg'", () => {
    expect(formatBWSetLabel({ weight: "BW", added_weight_kg: 10 })).toBe("自重+10kg");
  });

  test("BW + added_weight_kg=0 → '自重'", () => {
    expect(formatBWSetLabel({ weight: "BW", added_weight_kg: 0 })).toBe("自重");
  });

  test("BW + added_weight_kg=null → '自重'", () => {
    expect(formatBWSetLabel({ weight: "BW", added_weight_kg: null })).toBe("自重");
  });

  test("BW + added_weight_kg 負値 → '自重'", () => {
    expect(formatBWSetLabel({ weight: "BW", added_weight_kg: -5 })).toBe("自重");
  });

  test("BW + added_weight_kg=5.5 → '自重+5.5kg'", () => {
    expect(formatBWSetLabel({ weight: "BW", added_weight_kg: 5.5 })).toBe("自重+5.5kg");
  });

  test("数値セット → null（呼び出し元が処理）", () => {
    expect(formatBWSetLabel({ weight: 60, reps: 5 })).toBeNull();
  });

  test("weight=0 → null", () => {
    expect(formatBWSetLabel({ weight: 0 })).toBeNull();
  });

  test("set=null → null", () => {
    expect(formatBWSetLabel(null)).toBeNull();
  });

  test("set=undefined → null", () => {
    expect(formatBWSetLabel(undefined)).toBeNull();
  });

  test("weight フィールドなし → null", () => {
    expect(formatBWSetLabel({ reps: 10 })).toBeNull();
  });
});

// ── getHistoryMetricsForDate — 2つのコピーの一致確認 ─────────────────────────

const makeHistoryMap = (sets) => ({
  懸垂: [{ date: "2026-10-24", sets }],
});

describe("getHistoryMetricsForDate — workoutHistory vs appHelpers の一致", () => {
  const bodyWeightKg = 65;

  test("通常の数値セット — 両方同じ volume", () => {
    const history = makeHistoryMap([
      { weight: 60, reps: 10 },
      { weight: 70, reps: 5 },
    ]);
    const a = getHistoryMetricsFromWorkoutHistory(history, "2026-10-24", { bodyWeightKg });
    const b = getHistoryMetricsFromAppHelpers(history, "2026-10-24", { bodyWeightKg });
    expect(a.volume).toBe(b.volume);
    expect(a.setCount).toBe(b.setCount);
  });

  test("BW セット（body_weight_kg スタンプあり） — 両方同じ volume", () => {
    const history = makeHistoryMap([
      { weight: "BW", reps: 12, body_weight_kg: 65 },
      { weight: "BW", reps: 8,  body_weight_kg: 65 },
    ]);
    const a = getHistoryMetricsFromWorkoutHistory(history, "2026-10-24", { bodyWeightKg });
    const b = getHistoryMetricsFromAppHelpers(history, "2026-10-24", { bodyWeightKg });
    expect(a.volume).toBe(b.volume);
    // 65 * 12 + 65 * 8 = 780 + 520 = 1300
    expect(a.volume).toBeCloseTo(1300, 0);
  });

  test("加重 BW セット（body_weight_kg + added_weight_kg） — 両方同じ volume", () => {
    const history = makeHistoryMap([
      { weight: "BW", reps: 5, body_weight_kg: 65, added_weight_kg: 10 },
      { weight: "BW", reps: 3, body_weight_kg: 65, added_weight_kg: 10 },
    ]);
    const a = getHistoryMetricsFromWorkoutHistory(history, "2026-10-24", { bodyWeightKg });
    const b = getHistoryMetricsFromAppHelpers(history, "2026-10-24", { bodyWeightKg });
    expect(a.volume).toBe(b.volume);
    // (65+10)*5 + (65+10)*3 = 375 + 225 = 600
    expect(a.volume).toBeCloseTo(600, 0);
  });

  test("BW セット（スタンプなし、bodyWeightKg で補完） — 両方同じ volume", () => {
    const history = makeHistoryMap([
      { weight: "BW", reps: 10 },
    ]);
    const a = getHistoryMetricsFromWorkoutHistory(history, "2026-10-24", { bodyWeightKg });
    const b = getHistoryMetricsFromAppHelpers(history, "2026-10-24", { bodyWeightKg });
    expect(a.volume).toBe(b.volume);
    // 65 * 10 = 650
    expect(a.volume).toBeCloseTo(650, 0);
  });

  test("加重 BW, スタンプなし, bodyWeightKg で補完 — 両方同じ volume", () => {
    const history = makeHistoryMap([
      { weight: "BW", reps: 5, added_weight_kg: 10 },
    ]);
    const a = getHistoryMetricsFromWorkoutHistory(history, "2026-10-24", { bodyWeightKg });
    const b = getHistoryMetricsFromAppHelpers(history, "2026-10-24", { bodyWeightKg });
    expect(a.volume).toBe(b.volume);
    // (65+10)*5 = 375
    expect(a.volume).toBeCloseTo(375, 0);
  });

  test("体重完全未設定 + BW — volume = 0 （セットは存在するが計算不能）", () => {
    const history = makeHistoryMap([
      { weight: "BW", reps: 10 },
    ]);
    const a = getHistoryMetricsFromWorkoutHistory(history, "2026-10-24", { bodyWeightKg: null });
    const b = getHistoryMetricsFromAppHelpers(history, "2026-10-24", { bodyWeightKg: null });
    expect(a.volume).toBe(b.volume);
    expect(a.volume).toBe(0);
    // setCount は volume と独立して計算される
    expect(a.setCount).toBe(1);
    expect(b.setCount).toBe(1);
  });
});

// ── buildPrWeightLabel ────────────────────────────────────────────────────────
// useAI.js の2箇所（formatBig3MatchedExercise / buildExerciseHistoryContextTextFromStats）
// が formatBWSetLabel 経由でラベルを生成していることを検証する。
// formatBWSetLabel は ${added}kg（丸めなし）を使うため、
// added_weight_kg=5.55 のとき inline（formatKg 経由）と結果が異なる。
// このテストは inline に戻したとき FAIL する。
describe("buildPrWeightLabel", () => {
  // ── BW セット ────────────────────────────────────────────────────────────
  test("BW + added=10 → 自重+10kg", () => {
    expect(buildPrWeightLabel({ weight: "BW", added_weight_kg: 10 }))
      .toBe("自重+10kg");
  });

  test("BW + added=0 → 自重", () => {
    expect(buildPrWeightLabel({ weight: "BW", added_weight_kg: 0 }))
      .toBe("自重");
  });

  test("BW + added=null → 自重", () => {
    expect(buildPrWeightLabel({ weight: "BW", added_weight_kg: null }))
      .toBe("自重");
  });

  test("BW + added=5.5 → 自重+5.5kg", () => {
    expect(buildPrWeightLabel({ weight: "BW", added_weight_kg: 5.5 }))
      .toBe("自重+5.5kg");
  });

  // formatBWSetLabel は ${added}kg（丸めなし）。
  // inline（formatKg 経由）は formatKg(5.55) = "5.6" になる。
  // 置き換え前に戻したとき、このテストが FAIL する。
  test("BW + added=5.55 → 自重+5.55kg（丸めなし: formatBWSetLabel 経由の確認）", () => {
    expect(buildPrWeightLabel({ weight: "BW", added_weight_kg: 5.55 }))
      .toBe("自重+5.55kg");
  });

  // ── effectiveKg あり ─────────────────────────────────────────────────────
  test("BW + added=10 + effectiveKg=80 → 自重+10kg(80kg)", () => {
    expect(buildPrWeightLabel({ weight: "BW", added_weight_kg: 10, effectiveKg: 80 }))
      .toBe("自重+10kg(80kg)");
  });

  test("BW + added=0 + effectiveKg=70 → 自重(70kg)", () => {
    expect(buildPrWeightLabel({ weight: "BW", added_weight_kg: 0, effectiveKg: 70 }))
      .toBe("自重(70kg)");
  });

  test("BW + effectiveKg=null → effectiveKg なしの bwLabel のみ", () => {
    expect(buildPrWeightLabel({ weight: "BW", added_weight_kg: 10, effectiveKg: null }))
      .toBe("自重+10kg");
  });

  // ── 数値セット ────────────────────────────────────────────────────────────
  test("weight=100 → 100kg", () => {
    expect(buildPrWeightLabel({ weight: 100 })).toBe("100kg");
  });

  test("weight=72.5 → 72.5kg", () => {
    expect(buildPrWeightLabel({ weight: 72.5 })).toBe("72.5kg");
  });

  test("pr=null → 0kg（呼び出し元が pr 非 null を保証するが境界値確認）", () => {
    expect(buildPrWeightLabel(null)).toBe("0kg");
  });
});
