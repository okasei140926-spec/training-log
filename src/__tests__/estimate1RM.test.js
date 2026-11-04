/**
 * estimate1RM 単体テスト
 *
 * テスト対象:
 *   estimate1RM (utils/helpers.js)
 *
 * 背景:
 *   Epley 式 weight * (1 + reps / 30) が4箇所に重複していた。
 *   低レベル純粋関数 estimate1RM に集約し、各サイトがこれを呼ぶ形にした。
 *   - helpers.js:calc1RM の内部
 *   - workoutSelectors.js:calcEstimated1RMFromKg
 *   - LogScreen.jsx:calcProgressionTarget のインライン式
 *   - strengthScore.js:calcCappedE1RM（reps はキャップ後に渡す）
 *
 * テストできていること:
 *   - 基本的な Epley 計算
 *   - reps === 1 のとき weightKg そのまま返す（1RM の定義）
 *   - 不正値（null / NaN / 負数 / 0）→ 0
 *   - calcCappedE1RM のキャップ（1〜12）が維持されること
 */

jest.mock('../utils/supabase', () => ({
    supabase: {},
    supabaseConfigError: null,
}));

import { estimate1RM } from '../utils/helpers';
import { calcCappedE1RM } from '../utils/strengthScore';

// ── estimate1RM 基本 ───────────────────────────────────────────────────────

describe('estimate1RM: Epley 計算', () => {
    test('(100, 5) = 100 * (1 + 5/30) = 116.6...', () => {
        expect(estimate1RM(100, 5)).toBeCloseTo(116.667, 2);
    });

    test('(100, 12) = 100 * (1 + 12/30) = 140', () => {
        expect(estimate1RM(100, 12)).toBeCloseTo(140, 5);
    });

    test('(100, 25) = 100 * (1 + 25/30) = 183.3...', () => {
        expect(estimate1RM(100, 25)).toBeCloseTo(183.333, 2);
    });

    test('(80, 10) = 80 * (1 + 10/30) = 106.6...', () => {
        expect(estimate1RM(80, 10)).toBeCloseTo(106.667, 2);
    });
});

describe('estimate1RM: reps === 1 のとき weightKg をそのまま返す', () => {
    // reps=1 は定義上すでに 1RM なので Epley を通す必要はない。
    // 旧 LogScreen.jsx インライン（ガードなし）では 100kg×1 → 103.33 になっていた。
    test('(100, 1) = 100（Epley 計算せず）', () => {
        expect(estimate1RM(100, 1)).toBe(100);
    });

    test('(70, 1) = 70', () => {
        expect(estimate1RM(70, 1)).toBe(70);
    });
});

describe('estimate1RM: 不正値 → 0', () => {
    test('(0, 5) → 0（weight=0）', () => {
        expect(estimate1RM(0, 5)).toBe(0);
    });

    test('(100, 0) → 0（reps=0）', () => {
        expect(estimate1RM(100, 0)).toBe(0);
    });

    test('(null, 5) → 0', () => {
        expect(estimate1RM(null, 5)).toBe(0);
    });

    test('(100, null) → 0', () => {
        expect(estimate1RM(100, null)).toBe(0);
    });

    test('(NaN, 5) → 0', () => {
        expect(estimate1RM(NaN, 5)).toBe(0);
    });

    test('(100, NaN) → 0', () => {
        expect(estimate1RM(100, NaN)).toBe(0);
    });

    test('(-10, 5) → 0（負数）', () => {
        expect(estimate1RM(-10, 5)).toBe(0);
    });

    test('(100, -1) → 0（負数）', () => {
        expect(estimate1RM(100, -1)).toBe(0);
    });

    test('(Infinity, 5) → 0', () => {
        expect(estimate1RM(Infinity, 5)).toBe(0);
    });

    test('(100, Infinity) → 0', () => {
        expect(estimate1RM(100, Infinity)).toBe(0);
    });
});

// ── calcCappedE1RM キャップ維持の検証 ──────────────────────────────────────

describe('calcCappedE1RM: estimate1RM に移行後もキャップが維持される', () => {
    test('(100, 25) → reps を 12 にキャップ → 140（reps=25 のまま計算しない）', () => {
        // reps=25 をそのまま渡すと 100*(1+25/30)=183.3 になるが、
        // キャップにより 100*(1+12/30)=140 であること
        expect(calcCappedE1RM(100, 25)).toBeCloseTo(140, 5);
    });

    test('(100, 13) → reps を 12 にキャップ → 140', () => {
        expect(calcCappedE1RM(100, 13)).toBeCloseTo(140, 5);
    });

    test('(100, 12) → キャップ上限ちょうど → 140', () => {
        expect(calcCappedE1RM(100, 12)).toBeCloseTo(140, 5);
    });

    test('(100, 1) → キャップ下限 → 100（reps=1 は estimate1RM が weight を返す）', () => {
        expect(calcCappedE1RM(100, 1)).toBe(100);
    });

    test('(100, 5) → キャップ範囲内 → 116.6...（通常計算）', () => {
        expect(calcCappedE1RM(100, 5)).toBeCloseTo(116.667, 2);
    });

    test('不正値: (0, 5) → 0', () => {
        expect(calcCappedE1RM(0, 5)).toBe(0);
    });

    test('不正値: (-1, 5) → 0', () => {
        expect(calcCappedE1RM(-1, 5)).toBe(0);
    });
});

// ── 置き換え前後の出力一致確認（要件仕様テーブル） ────────────────────────
//
// 各入力に対する旧実装との比較。
// LogScreen.jsx:281 の (100, 1) のみ変化する（103.33 → 100）。
// それ以外は全て一致する。
//
// | 入力        | 旧 calc1RM/selector/selector | 新 estimate1RM | 旧 calcCappedE1RM | 新 calcCappedE1RM |
// |-------------|-------------------------------|----------------|-------------------|-------------------|
// | (100, 1)    | 100                           | 100 ✓          | 100               | 100 ✓             |
// | (100, 5)    | 116.67                        | 116.67 ✓       | 116.67            | 116.67 ✓          |
// | (100, 12)   | 140                           | 140 ✓          | 140               | 140 ✓             |
// | (100, 25)   | 183.33                        | 183.33 ✓       | 140 (capped)      | 140 ✓             |
// | (0, 5)      | 0                             | 0 ✓            | 0                 | 0 ✓               |
// | (100, 0)    | 0                             | 0 ✓            | 0                 | 0 ✓               |
//
// ※ 旧 LogScreen.jsx:281 は reps=1 ガードなし → (100,1) = 103.33（バグ）
//   新実装では 100 に修正される。影響: calcProgressionTarget の best-set 選択で
//   reps=1 セットの e1rm が下がり、高 e1rm の他セットが選ばれやすくなる。
//   表示への影響は「🎯 今日のチャレンジ」の推薦値のみ。

describe('estimate1RM: 置き換え前後の出力一致（仕様テーブル全6パターン）', () => {
    test('(100, 1) = 100', () => { expect(estimate1RM(100, 1)).toBe(100); });
    test('(100, 5) ≈ 116.67', () => { expect(estimate1RM(100, 5)).toBeCloseTo(116.667, 2); });
    test('(100, 12) = 140', () => { expect(estimate1RM(100, 12)).toBeCloseTo(140, 5); });
    test('(100, 25) ≈ 183.33', () => { expect(estimate1RM(100, 25)).toBeCloseTo(183.333, 2); });
    test('(0, 5) = 0', () => { expect(estimate1RM(0, 5)).toBe(0); });
    test('(100, 0) = 0', () => { expect(estimate1RM(100, 0)).toBe(0); });

    test('calcCappedE1RM(100, 25) = 140（キャップ維持）', () => {
        expect(calcCappedE1RM(100, 25)).toBeCloseTo(140, 5);
    });
});
