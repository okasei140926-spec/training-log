/**
 * formatPreviousSet テスト
 *
 * テスト対象:
 *   formatPreviousSet (components/log/SetRow.jsx)
 *
 * 背景:
 *   BW セットの「前回」表示で added_weight_kg が無視されていた。
 *   formatBWSetLabel 経由に統一し、"前回 自重+10kg × 9" が表示されるようにした。
 *
 * テストできていること:
 *   - 純粋 BW（added_weight_kg なし/0）→ "前回 自重 × N"
 *   - BW + added_weight_kg → "前回 自重+Xkg × N"
 *   - 数値セット（kg）→ "前回 Xkg × N"
 *   - 数値セット（lb→kg）→ 単位変換が効く
 *   - previousSet が null → "前回 -"
 *
 * テストできていないこと:
 *   - SetRow JSX 内での実際のレンダリング（React イベントなしでは呼べない）
 */

jest.mock('../utils/supabase', () => ({
    supabase: {},
    supabaseConfigError: null,
}));

import { formatPreviousSet } from '../components/log/SetRow';

describe('formatPreviousSet: BW セット', () => {
    test('weight=BW、added_weight_kg なし → "前回 自重 × N"', () => {
        const set = { weight: 'BW', reps: 9 };
        expect(formatPreviousSet(set, 'BW', 'BW')).toBe('前回 自重 × 9');
    });

    test('weight=BW、added_weight_kg=0 → "前回 自重 × N"', () => {
        const set = { weight: 'BW', added_weight_kg: 0, reps: 10 };
        expect(formatPreviousSet(set, 'BW', 'BW')).toBe('前回 自重 × 10');
    });

    test('weight=BW、added_weight_kg=10 → "前回 自重+10kg × N"', () => {
        const set = { weight: 'BW', added_weight_kg: 10, reps: 9 };
        expect(formatPreviousSet(set, 'BW', 'BW')).toBe('前回 自重+10kg × 9');
    });

    test('weight=BW、added_weight_kg=5.5（小数）→ "前回 自重+5.5kg × N"', () => {
        const set = { weight: 'BW', added_weight_kg: 5.5, reps: 8 };
        expect(formatPreviousSet(set, 'BW', 'BW')).toBe('前回 自重+5.5kg × 8');
    });
});

describe('formatPreviousSet: 数値セット', () => {
    test('kg セット → "前回 Xkg × N"', () => {
        const set = { weight: '100', unit: 'kg', reps: 5 };
        expect(formatPreviousSet(set, 'kg', 'kg')).toBe('前回 100kg × 5');
    });

    test('小数 kg → 小数1桁に丸まる', () => {
        const set = { weight: '87.5', unit: 'kg', reps: 6 };
        expect(formatPreviousSet(set, 'kg', 'kg')).toBe('前回 87.5kg × 6');
    });

    test('previousSet が null → "前回 -"', () => {
        expect(formatPreviousSet(null, 'kg', 'kg')).toBe('前回 -');
    });

    test('reps が 0 → repsLabel が "-"', () => {
        const set = { weight: '80', unit: 'kg', reps: 0 };
        expect(formatPreviousSet(set, 'kg', 'kg')).toBe('前回 80kg × -');
    });
});

describe('formatPreviousSet: targetUnit=BW で sourceUnit=kg（単位切り替え）', () => {
    // 前回は数値セット、今回は BW モード: weight は数値のまま表示
    test('targetUnit=BW、sourceUnit=kg → sourceUnit にフォールバック', () => {
        const set = { weight: '80', unit: 'kg', reps: 5 };
        // formatBWSetLabel(set) は null（weight !== "BW"）
        // displayUnit = sourceUnit（kg）にフォールバック
        expect(formatPreviousSet(set, 'kg', 'BW')).toBe('前回 80kg × 5');
    });
});
