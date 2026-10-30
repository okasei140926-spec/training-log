/**
 * formatKg 丸めテスト
 *
 * テスト対象:
 *   formatKg (utils/helpers.js)
 *   ※ useAI.js は helpers.js から import して re-export している
 *
 * 背景:
 *   lb→kg 変換後の生値（例: 73.481904kg）が AI プロンプトに漏れていた。
 *   formatKg を導入して文字列埋め込み直前に小数1桁へ丸め、
 *   計算（1RM・ボリューム）は生値のまま保持する設計にした。
 */

jest.mock('../utils/supabase', () => ({
    supabase: {},
    supabaseConfigError: null,
}));

import { formatKg } from '../utils/helpers';

describe('formatKg: 基本的な丸め', () => {
    test('整数値は余計な小数を持たない', () => {
        expect(formatKg(100)).toBe('100');
    });

    test('ぴったり小数1桁はそのまま', () => {
        expect(formatKg(87.5)).toBe('87.5');
    });

    test('lb→kg 変換の端数が小数1桁に丸まる', () => {
        // 162lbs × 0.453592 = 73.481904
        expect(formatKg(73.481904)).toBe('73.5');
    });

    test('小数2桁以下は四捨五入される', () => {
        // Math.round(87.55 * 10) / 10 = 87.6
        expect(formatKg(87.55)).toBe('87.6');
    });

    test('小数2桁以下は切り捨て側も正しく丸まる', () => {
        expect(formatKg(87.54)).toBe('87.5');
    });
});

describe('formatKg: エッジケース', () => {
    test('0 は "0" を返す', () => {
        expect(formatKg(0)).toBe('0');
    });

    test('null は "0" を返す（null coalescing）', () => {
        expect(formatKg(null)).toBe('0');
    });

    test('undefined は "0" を返す', () => {
        expect(formatKg(undefined)).toBe('0');
    });

    test('NaN は "0" を返す', () => {
        expect(formatKg(NaN)).toBe('0');
    });

    test('Infinity は "0" を返す', () => {
        expect(formatKg(Infinity)).toBe('0');
    });

    test('文字列数値も正しく丸まる', () => {
        expect(formatKg('73.481904')).toBe('73.5');
    });

    test('文字列 "BW" は NaN なので "0" を返す', () => {
        // BW セットは formatKg を呼ばないが、誤って呼ばれても例外にならないことを確認
        expect(formatKg('BW')).toBe('0');
    });
});
