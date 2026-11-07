/**
 * 週間セット目標のクランプ定数・関数テスト
 *
 * テスト対象:
 *   - WEEKLY_SET_TARGET_MIN / WEEKLY_SET_TARGET_MAX (useSettings.js)
 *   - clampWeeklySetTarget (useSettings.js)
 *   - computeWeeklyPartBarDisplay (home/homeUtils.js)
 */

jest.mock('../utils/supabase', () => ({
  supabase: {},
  supabaseConfigError: null,
}));

import {
  WEEKLY_SET_TARGET_MIN,
  WEEKLY_SET_TARGET_MAX,
  clampWeeklySetTarget,
} from '../hooks/useSettings';

import { computeWeeklyPartBarDisplay } from '../components/home/homeUtils';

// ─── 定数 ────────────────────────────────────────────────────────────────────

describe('WEEKLY_SET_TARGET 定数', () => {
  test('MIN は 0', () => {
    expect(WEEKLY_SET_TARGET_MIN).toBe(0);
  });

  test('MAX は 50', () => {
    expect(WEEKLY_SET_TARGET_MAX).toBe(50);
  });
});

// ─── clampWeeklySetTarget ─────────────────────────────────────────────────────

describe('clampWeeklySetTarget', () => {
  test('0 はそのまま返る（下限が 0）', () => {
    expect(clampWeeklySetTarget(0)).toBe(0);
  });

  test('-1 は 0 にクランプされる', () => {
    expect(clampWeeklySetTarget(-1)).toBe(0);
  });

  test('-100 は 0 にクランプされる', () => {
    expect(clampWeeklySetTarget(-100)).toBe(0);
  });

  test('50 はそのまま返る（上限が 50）', () => {
    expect(clampWeeklySetTarget(50)).toBe(50);
  });

  test('51 は 50 にクランプされる', () => {
    expect(clampWeeklySetTarget(51)).toBe(50);
  });

  test('中間値 10 はそのまま返る', () => {
    expect(clampWeeklySetTarget(10)).toBe(10);
  });

  test('両画面は同じ定数を使う: MIN から 1 引いた値は MIN になる', () => {
    // SettingsModal と WeeklyTab が同じ clampWeeklySetTarget を呼ぶことで
    // 下限の振る舞いが一致することを確認する
    expect(clampWeeklySetTarget(WEEKLY_SET_TARGET_MIN - 1)).toBe(WEEKLY_SET_TARGET_MIN);
    expect(clampWeeklySetTarget(WEEKLY_SET_TARGET_MAX + 1)).toBe(WEEKLY_SET_TARGET_MAX);
  });
});

// ─── computeWeeklyPartBarDisplay ─────────────────────────────────────────────

describe('computeWeeklyPartBarDisplay', () => {
  // ── target=0 ケース ─────────────────────────────────────────────────────

  test('target=0, done=0: ratio=0（バー幅ゼロ）', () => {
    const { ratio } = computeWeeklyPartBarDisplay(0, 0, false);
    expect(ratio).toBe(0);
  });

  test('target=0, done=0: 達成色（#55D89E）にならない', () => {
    const { color } = computeWeeklyPartBarDisplay(0, 0, false);
    expect(color).not.toBe('#55D89E');
  });

  test('target=0, done=0: isZeroTarget=true', () => {
    const { isZeroTarget } = computeWeeklyPartBarDisplay(0, 0, false);
    expect(isZeroTarget).toBe(true);
  });

  test('target=0, done>0: ratio=0（バー幅ゼロ）', () => {
    // done が 5 あっても target=0 なのでバーは出ない
    const { ratio } = computeWeeklyPartBarDisplay(5, 0, false);
    expect(ratio).toBe(0);
  });

  test('target=0, done>0: 達成色にならない', () => {
    const { color } = computeWeeklyPartBarDisplay(5, 0, false);
    expect(color).not.toBe('#55D89E');
  });

  // ── target>0 ケース ─────────────────────────────────────────────────────

  test('done >= target: 達成色 #55D89E', () => {
    expect(computeWeeklyPartBarDisplay(10, 10, false).color).toBe('#55D89E');
    expect(computeWeeklyPartBarDisplay(12, 10, false).color).toBe('#55D89E');
  });

  test('done/target < 0.7 かつ isLateWeek=true: 警告色 #F6A623', () => {
    // 6/10 = 0.6 < 0.7, isLateWeek=true
    expect(computeWeeklyPartBarDisplay(6, 10, true).color).toBe('#F6A623');
  });

  test('done/target < 0.7 かつ isLateWeek=false: 通常色', () => {
    const { color } = computeWeeklyPartBarDisplay(6, 10, false);
    expect(color).not.toBe('#F6A623');
    expect(color).not.toBe('#55D89E');
  });

  test('target>0: isZeroTarget=false', () => {
    const { isZeroTarget } = computeWeeklyPartBarDisplay(5, 10, false);
    expect(isZeroTarget).toBe(false);
  });

  test('ratio は done/target をそのまま返す（1超えも返す）', () => {
    const { ratio } = computeWeeklyPartBarDisplay(15, 10, false);
    expect(ratio).toBeCloseTo(1.5);
  });
});
