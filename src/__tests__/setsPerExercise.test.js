/**
 * computeSetsPerExerciseFromHistory のテスト
 *
 * テスト対象: utils/generateOnboardingPlan.js
 *
 * 検証内容:
 *   - 十分な履歴がある → 算出値が使われる
 *   - 出現回数 < 10 → DEFAULT_PLAN_PARAMS にフォールバック
 *   - 算出値 < 2 → 2 にクランプ
 *   - 算出値 > 5 → 5 にクランプ
 *   - 8週より古い履歴は計算に入らない
 *   - done=false のセットは数に入らない
 *   - setsPerExercise が変わると buildSessionExercisesForPlanDay の種目数が変わる
 */

jest.mock('../utils/supabase', () => ({
  supabase: {},
  supabaseConfigError: null,
}));

import {
  computeSetsPerExerciseFromHistory,
  buildSessionExercisesForPlanDay,
  DEFAULT_PLAN_PARAMS,
} from '../utils/generateOnboardingPlan';

// 2026-11-11 基準。8週前 ≈ 2026-09-16
const RECENT = "2026-11-01"; // 8週以内
const OLD    = "2024-01-01"; // 8週より古い

/** 指定セット数の全 done=true レコードを n 件生成 */
function makeRecords(n, doneSetsPerRecord, date = RECENT, bp = "胸") {
  return Array.from({ length: n }, () => ({
    date,
    bodyPart: bp,
    sets: Array.from({ length: doneSetsPerRecord }, () => ({ done: true, weight: 60, reps: 10 })),
  }));
}

// ─── 履歴が十分なとき算出値が使われる ─────────────────────────────────────

describe('履歴が十分なとき（出現回数 >= 10）算出値が使われる', () => {
  test('10件 × 3セット → value=3, source="history"', () => {
    const history = { 種目A: makeRecords(10, 3) };
    const result = computeSetsPerExerciseFromHistory(history, "中級者");
    expect(result.source).toBe("history");
    expect(result.value).toBeCloseTo(3, 5);
    expect(result.totalOccurrences).toBe(10);
    expect(result.totalSets).toBe(30);
  });

  test('複数種目で合算される', () => {
    const history = {
      種目A: makeRecords(5, 2), // 10 sets
      種目B: makeRecords(5, 4), // 20 sets
    };
    // totalSets=30, occurrences=10 → avg=3.0
    const result = computeSetsPerExerciseFromHistory(history, "中級者");
    expect(result.source).toBe("history");
    expect(result.value).toBeCloseTo(3.0, 5);
  });
});

// ─── 出現回数 < 10 → デフォルト ───────────────────────────────────────────

describe('出現回数 < 10 → DEFAULT_PLAN_PARAMS にフォールバック', () => {
  test('9件ではデフォルト', () => {
    const history = { 種目A: makeRecords(9, 3) };
    const result = computeSetsPerExerciseFromHistory(history, "中級者");
    expect(result.source).toBe("default");
    expect(result.value).toBe(DEFAULT_PLAN_PARAMS["中級者"].sets);
  });

  test('0件（空）でもデフォルト', () => {
    const result = computeSetsPerExerciseFromHistory({}, "初心者");
    expect(result.source).toBe("default");
    expect(result.value).toBe(DEFAULT_PLAN_PARAMS["初心者"].sets);
  });

  test('10件ちょうどは算出値を使う', () => {
    const history = { 種目A: makeRecords(10, 3) };
    const result = computeSetsPerExerciseFromHistory(history, "中級者");
    expect(result.source).toBe("history");
  });
});

// ─── クランプ ──────────────────────────────────────────────────────────────

describe('算出値のクランプ [2, 5]', () => {
  test('1セット/件 × 10件 → raw=1.0 → clamp → 2', () => {
    const history = { 種目A: makeRecords(10, 1) };
    const result = computeSetsPerExerciseFromHistory(history, "中級者");
    expect(result.source).toBe("history");
    expect(result.raw).toBeCloseTo(1.0, 5);
    expect(result.value).toBe(2); // clamped to SPS_MIN
  });

  test('6セット/件 × 10件 → raw=6.0 → clamp → 5', () => {
    const history = { 種目A: makeRecords(10, 6) };
    const result = computeSetsPerExerciseFromHistory(history, "中級者");
    expect(result.source).toBe("history");
    expect(result.raw).toBeCloseTo(6.0, 5);
    expect(result.value).toBe(5); // clamped to SPS_MAX
  });

  test('3セット/件 × 10件 → clamp されない', () => {
    const history = { 種目A: makeRecords(10, 3) };
    const result = computeSetsPerExerciseFromHistory(history, "中級者");
    expect(result.value).toBe(result.raw); // no clamp
  });
});

// ─── 8週フィルタ ──────────────────────────────────────────────────────────

describe('8週より古い履歴は計算に入らない', () => {
  test('古い記録だけ → 出現回数0 → デフォルト', () => {
    const history = { 種目A: makeRecords(20, 5, OLD) };
    const result = computeSetsPerExerciseFromHistory(history, "中級者");
    expect(result.source).toBe("default");
    expect(result.totalOccurrences).toBe(0);
  });

  test('古い記録10件 + 最近の記録3セット/件10件 → 最近分だけ算出', () => {
    const history = {
      種目A: [
        ...makeRecords(10, 10, OLD),   // 古い（除外）
        ...makeRecords(10, 3, RECENT), // 最近
      ],
    };
    const result = computeSetsPerExerciseFromHistory(history, "中級者");
    expect(result.source).toBe("history");
    expect(result.totalOccurrences).toBe(10);
    expect(result.value).toBeCloseTo(3, 5);
  });
});

// ─── done=false は除く ────────────────────────────────────────────────────

describe('done=false のセットは数に入らない', () => {
  test('done=true 2セット + done=false 2セット → 2として数える', () => {
    const record = {
      date: RECENT,
      bodyPart: "胸",
      sets: [
        { done: true,  weight: 60, reps: 10 },
        { done: true,  weight: 60, reps: 10 },
        { done: false, weight: 60, reps: 10 },
        { done: false, weight: 60, reps: 10 },
      ],
    };
    const history = { 種目A: Array.from({ length: 10 }, () => ({ ...record })) };
    const result = computeSetsPerExerciseFromHistory(history, "中級者");
    expect(result.source).toBe("history");
    expect(result.totalSets).toBe(20); // 10 records × 2 done sets
    expect(result.value).toBeCloseTo(2, 5);
  });

  test('done=false しかないレコードは出現回数にも含まれない', () => {
    const notDoneRecord = {
      date: RECENT,
      bodyPart: "胸",
      sets: [{ done: false, weight: 60, reps: 10 }],
    };
    const doneRecord = {
      date: RECENT,
      bodyPart: "胸",
      sets: Array.from({ length: 3 }, () => ({ done: true, weight: 60, reps: 10 })),
    };
    // 9件 not-done + 10件 done=3sets → occurrences=10 (not-doneは除外) → avg=3
    const history = {
      種目A: [
        ...Array.from({ length: 9 }, () => ({ ...notDoneRecord })),
        ...Array.from({ length: 10 }, () => ({ ...doneRecord })),
      ],
    };
    const result = computeSetsPerExerciseFromHistory(history, "中級者");
    expect(result.source).toBe("history");
    expect(result.totalOccurrences).toBe(10);
    expect(result.value).toBeCloseTo(3, 5);
  });
});

// ─── setsPerExercise が変わると種目数が変わる ─────────────────────────────

describe('setsPerExercise が変わると buildSessionExercisesForPlanDay の種目数が変わる', () => {
  const BASE_ANSWERS = {
    level: "中級者",
    frequency: 3,
    location: "ジム",
    favorites: [],
    preferredSplit: "ppl",
  };

  // ppl cycleLength=3, freq=3 → cyclesPerWeek=1
  // target=12 → setsThisSession=12
  // setsPerExercise=2 → rawCount=round(12/2)=6 → cap → 3
  // setsPerExercise=4 → rawCount=round(12/4)=3
  // setsPerExercise=6(clamped to 5) → rawCount=round(12/5)=round(2.4)=2

  test('setsPerExercise=2(raw=1,clamped) → 部位あたり3種目（上限）', () => {
    // 10件 × done=1セット → raw=1.0 → clamped to 2
    const thinHistory = { 種目A: makeRecords(10, 1) };
    const result = buildSessionExercisesForPlanDay({
      bodyParts: ["胸"],
      answers: BASE_ANSWERS,
      history: thinHistory,
      weeklySetTargets: { 胸: 12 },
      splitType: "ppl",
    });
    // rawCount = round(12/2) = 6 → capped to 3
    expect(result.filter(e => e.bodyPart === "胸").length).toBe(3);
  });

  test('setsPerExercise=4(default) → 部位あたり3種目', () => {
    // 履歴なし → DEFAULT=4 → rawCount=round(12/4)=3
    const result = buildSessionExercisesForPlanDay({
      bodyParts: ["胸"],
      answers: BASE_ANSWERS,
      history: {},
      weeklySetTargets: { 胸: 12 },
      splitType: "ppl",
    });
    expect(result.filter(e => e.bodyPart === "胸").length).toBe(3);
  });

  test('setsPerExercise が大きいほど種目数が少なくなる', () => {
    // fewSets: 10件×done=1セット → sps=2(clamped) → rawCount=round(12/2)=6→3
    // manySets: 10件×done=5セット → sps=5(clamped) → rawCount=round(12/5)=round(2.4)=2
    const fewSetsHistory = { 種目A: makeRecords(10, 1) };
    const manySetsHistory = { 種目A: makeRecords(10, 5) };
    const call = (history) => buildSessionExercisesForPlanDay({
      bodyParts: ["胸"],
      answers: BASE_ANSWERS,
      history,
      weeklySetTargets: { 胸: 12 },
      splitType: "ppl",
    }).filter(e => e.bodyPart === "胸").length;

    expect(call(fewSetsHistory)).toBeGreaterThan(call(manySetsHistory));
  });
});
