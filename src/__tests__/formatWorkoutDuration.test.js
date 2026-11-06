/**
 * formatWorkoutDuration 単体テスト
 *
 * テスト対象: src/utils/workoutTimer.js の formatWorkoutDuration
 *
 * 設計方針:
 *   - Math.floor で切り捨て（経過時間を切り上げない）
 *   - 両コンポーネント（WorkoutElapsedTimer / WorkoutSessionShareModal）が
 *     この1関数を参照することで表示が一致することを検証する
 */

import { formatWorkoutDuration } from '../utils/workoutTimer';

describe('formatWorkoutDuration: 基本フォーマット', () => {
  test('60秒未満 → "" (空文字)', () => {
    expect(formatWorkoutDuration(0)).toBe('');
    expect(formatWorkoutDuration(59)).toBe('');
    expect(formatWorkoutDuration(-1)).toBe('');
  });

  test('60秒 → "1分"', () => {
    expect(formatWorkoutDuration(60)).toBe('1分');
  });

  test('3600秒未満 → "X分"', () => {
    expect(formatWorkoutDuration(3540)).toBe('59分');
    expect(formatWorkoutDuration(3599)).toBe('59分');
  });

  test('ちょうど1時間 → "1時間"', () => {
    expect(formatWorkoutDuration(3600)).toBe('1時間');
  });

  test('1時間13分 (4380秒) → "1時間13分"', () => {
    expect(formatWorkoutDuration(4380)).toBe('1時間13分');
  });

  test('1時間13分台 (4410秒 = 73.5分) → "1時間13分" (floor, 切り捨て)', () => {
    // Math.round なら 1時間14分になる境界値。Math.floor なら 1時間13分。
    expect(formatWorkoutDuration(4410)).toBe('1時間13分');
  });

  test('1時間14分 (4440秒) → "1時間14分"', () => {
    expect(formatWorkoutDuration(4440)).toBe('1時間14分');
  });

  test('null / undefined / 非数値 → ""', () => {
    expect(formatWorkoutDuration(null)).toBe('');
    expect(formatWorkoutDuration(undefined)).toBe('');
    expect(formatWorkoutDuration('abc')).toBe('');
  });
});

describe('formatWorkoutDuration: 両表示が同じ関数を使うことで一致', () => {
  test('4410秒: 旧 Math.round だと "1時間14分"、新 Math.floor だと "1時間13分" に揃う', () => {
    // この境界値で旧 WorkoutSessionShareModal の formatDuration と
    // 旧 WorkoutElapsedTimer の formatFinishedDuration が割れていた。
    // 共有関数は Math.floor なので両方 "1時間13分" になる。
    const result = formatWorkoutDuration(4410);
    expect(result).toBe('1時間13分'); // Math.round なら "1時間14分" → FAIL
    expect(result).not.toBe('1時間14分');
  });
});
