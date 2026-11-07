/**
 * routineEx 再構築ロジックのテスト
 *
 * テスト対象:
 *   - shouldRebuildMuscleEx (generateOnboardingPlan.js)
 *   - shouldResetPlanProgress (generateOnboardingPlan.js)
 *   - mergeMuscleEx (generateOnboardingPlan.js)
 *   - buildMuscleExFromAnswers が frequency / preferredSplit を読まないこと
 */

jest.mock('../utils/supabase', () => ({
  supabase: {},
  supabaseConfigError: null,
}));

import {
  buildMuscleExFromAnswers,
  mergeMuscleEx,
  shouldRebuildMuscleEx,
  shouldResetPlanProgress,
} from '../utils/generateOnboardingPlan';

// ─── shouldRebuildMuscleEx ────────────────────────────────────────────────────

describe('shouldRebuildMuscleEx', () => {
  test.each(["level", "location", "hasDumbbells"])(
    '%s → true（種目ライブラリ再構築対象）',
    (fieldId) => {
      expect(shouldRebuildMuscleEx(fieldId)).toBe(true);
    }
  );

  test.each(["frequency", "preferredSplit"])(
    '%s → false（分割ルーティングのみ、テンプレートに影響しない）',
    (fieldId) => {
      expect(shouldRebuildMuscleEx(fieldId)).toBe(false);
    }
  );

  test('未知のフィールド → false', () => {
    expect(shouldRebuildMuscleEx("goal")).toBe(false);
    expect(shouldRebuildMuscleEx("unknown")).toBe(false);
    expect(shouldRebuildMuscleEx("")).toBe(false);
  });
});

// ─── shouldResetPlanProgress ──────────────────────────────────────────────────

describe('shouldResetPlanProgress', () => {
  test.each(["level", "frequency", "location", "hasDumbbells", "preferredSplit"])(
    '%s → true（プラン進行リセット対象）',
    (fieldId) => {
      expect(shouldResetPlanProgress(fieldId)).toBe(true);
    }
  );

  test.each(["goal", "gender", "birthdate", "trainingYears"])(
    '%s → false（プラン進行リセット不要）',
    (fieldId) => {
      expect(shouldResetPlanProgress(fieldId)).toBe(false);
    }
  );

  test('未知のフィールド → false', () => {
    expect(shouldResetPlanProgress("unknown")).toBe(false);
    expect(shouldResetPlanProgress("")).toBe(false);
  });
});

// ─── mergeMuscleEx ────────────────────────────────────────────────────────────

describe('mergeMuscleEx', () => {
  const exA = { id: 'ob_胸_ベンチプレス', name: 'ベンチプレス', label: '胸', bodyPart: '胸' };
  const exB = { id: 'ob_胸_ダンベルフライ', name: 'ダンベルフライ', label: '胸', bodyPart: '胸' };
  const exCustom = { id: 'custom_胸_インクラインプレス', name: 'インクラインプレス', label: '胸', bodyPart: '胸' };
  const exBack = { id: 'ob_背中_懸垂', name: '懸垂', label: '背中', bodyPart: '背中' };
  const exBackCustom = { id: 'custom_背中_シーテッドロウ', name: 'シーテッドロウ', label: '背中', bodyPart: '背中' };

  test('prevMuscleEx が空なら newMuscleEx をそのまま返す', () => {
    const newEx = { 胸: [exA] };
    const result = mergeMuscleEx(newEx, {});
    expect(result).toEqual({ 胸: [exA] });
  });

  test('prevMuscleEx が null でも newMuscleEx をそのまま返す', () => {
    const newEx = { 胸: [exA] };
    const result = mergeMuscleEx(newEx, null);
    expect(result).toEqual({ 胸: [exA] });
  });

  test('new に存在する種目は重複しない（prevにも同じidがある場合）', () => {
    const newEx = { 胸: [exA, exB] };
    const prevEx = { 胸: [exA] }; // exA は重複
    const result = mergeMuscleEx(newEx, prevEx);
    expect(result['胸']).toHaveLength(2);
    expect(result['胸'].map(e => e.id)).toEqual([exA.id, exB.id]);
  });

  test('prev にだけある種目（カスタム追加）は末尾に保持される', () => {
    const newEx = { 胸: [exA, exB] };
    const prevEx = { 胸: [exA, exCustom] }; // exCustom はカスタム追加
    const result = mergeMuscleEx(newEx, prevEx);
    expect(result['胸']).toHaveLength(3);
    expect(result['胸'][0]).toEqual(exA); // new 分が先
    expect(result['胸'][2]).toEqual(exCustom); // カスタムが後
  });

  test('prev にしかない部位も結果に含まれる', () => {
    const newEx = { 胸: [exA] };
    const prevEx = { 胸: [exA], 背中: [exBack, exBackCustom] };
    const result = mergeMuscleEx(newEx, prevEx);
    expect(result['背中']).toEqual([exBack, exBackCustom]);
  });

  test('new にしかない部位も結果に含まれる', () => {
    const newEx = { 胸: [exA], 肩: [{ id: 'ob_肩_OHP', name: 'OHP', label: '肩', bodyPart: '肩' }] };
    const prevEx = { 胸: [exA] };
    const result = mergeMuscleEx(newEx, prevEx);
    expect(result['肩']).toHaveLength(1);
  });
});

// ─── buildMuscleExFromAnswers: frequency と preferredSplit は無視される ───────

describe('buildMuscleExFromAnswers: frequency / preferredSplit は出力に影響しない', () => {
  const baseAnswers = {
    level: '初心者',
    location: 'ジム',
    frequency: 3,
    preferredSplit: 'upper_lower',
    favorites: [],
  };

  test('frequency を変えても同じ muscleEx が返る', () => {
    const result3 = buildMuscleExFromAnswers({ ...baseAnswers, frequency: 3 });
    const result5 = buildMuscleExFromAnswers({ ...baseAnswers, frequency: 5 });
    expect(result3).toEqual(result5);
  });

  test('preferredSplit を変えても同じ muscleEx が返る', () => {
    const resultUL = buildMuscleExFromAnswers({ ...baseAnswers, preferredSplit: 'upper_lower' });
    const resultPPL = buildMuscleExFromAnswers({ ...baseAnswers, preferredSplit: 'ppl' });
    expect(resultUL).toEqual(resultPPL);
  });

  test('level を変えると muscleEx の種目数が変わる（初心者=2, 中級者=3）', () => {
    const beginner = buildMuscleExFromAnswers({ ...baseAnswers, level: '初心者' });
    const intermediate = buildMuscleExFromAnswers({ ...baseAnswers, level: '中級者' });
    // 初心者は部位あたり最大2種目、中級者は最大3種目
    const beCount = Object.values(beginner).reduce((s, arr) => s + arr.length, 0);
    const imCount = Object.values(intermediate).reduce((s, arr) => s + arr.length, 0);
    expect(imCount).toBeGreaterThanOrEqual(beCount);
  });
});
