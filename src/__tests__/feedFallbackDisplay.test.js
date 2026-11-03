/**
 * FeedSection フォールバック表示テスト（段階③）
 *
 * テスト対象:
 *   formatSummaryItemSetsText (FeedSection.jsx) — export された純粋関数
 *     summaryItem.max_weight が 0 または未設定 → "${set_count}セット"
 *     summaryItem.max_weight が正の値        → "${max_weight}kg × ${set_count}"
 *
 * 背景:
 *   段階②以前に保存された BW-only セッションは summary_json.items に sets が存在しない。
 *   max_weight=0 のため旧フォールバック "0kg × N" と表示されていた。
 *   段階③でフォールバックを "Nセット" に変更した。
 */

jest.mock('../utils/supabase', () => ({
    supabase: {},
    supabaseConfigError: null,
}));
jest.mock('../context/UserSettingsContext', () => ({
    useUserSettings: jest.fn(() => ({})),
}));
jest.mock('../utils/exerciseName', () => ({
    getBig3ExerciseKey: jest.fn((name) => name),
}));

import { formatSummaryItemSetsText } from '../components/friends/FeedSection';
import { buildDetailedItemsFromSummary } from '../hooks/useFriendsData';

// ─── BW-only（max_weight=0）のフォールバック ────────────────────────────────

describe('formatSummaryItemSetsText: BW-only（max_weight=0）', () => {
    test('max_weight=0 のとき "Nセット" が表示される', () => {
        const summaryItems = [
            {
                exercise_name: '懸垂',
                body_part: '背中',
                set_count: 4,
                max_weight: 0,
                best_set_json: {},
            },
        ];

        const detailedItems = buildDetailedItemsFromSummary(summaryItems);
        const display = formatSummaryItemSetsText(detailedItems[0]);

        expect(display).toBe('4セット');
    });

    test('max_weight が undefined のとき "Nセット" が表示される', () => {
        const summaryItems = [
            {
                exercise_name: 'プランク',
                body_part: '体幹',
                set_count: 3,
                // max_weight: undefined
                best_set_json: {},
            },
        ];

        const detailedItems = buildDetailedItemsFromSummary(summaryItems);
        const display = formatSummaryItemSetsText(detailedItems[0]);

        expect(display).toBe('3セット');
    });

    test('旧スキーマ（sets なし, max_weight=0）で "0kg × N" が表示されないこと', () => {
        const summaryItems = [
            {
                exercise_name: '懸垂',
                body_part: '背中',
                set_count: 5,
                max_weight: 0,
                best_set_json: {},
            },
        ];

        const detailedItems = buildDetailedItemsFromSummary(summaryItems);
        const display = formatSummaryItemSetsText(detailedItems[0]);

        // 旧表示が出ていないことを確認（リグレッション防止）
        expect(display).not.toBe('0kg × 5');
        expect(display).toBe('5セット');
    });
});

// ─── kg セット（max_weight > 0）のフォールバック ─────────────────────────────

describe('formatSummaryItemSetsText: kg セット（max_weight > 0）', () => {
    test('max_weight=100 のとき "100kg × N" が表示される', () => {
        const summaryItems = [
            {
                exercise_name: 'ベンチプレス',
                body_part: '胸',
                set_count: 5,
                max_weight: 100,
                best_set_json: { weight: 100, reps: 5, rm: 112.5 },
            },
        ];

        const detailedItems = buildDetailedItemsFromSummary(summaryItems);
        const display = formatSummaryItemSetsText(detailedItems[0]);

        expect(display).toBe('100kg × 5');
    });

    test('max_weight=87.5 のとき "87.5kg × N" が表示される（小数）', () => {
        const summaryItems = [
            {
                exercise_name: 'スクワット',
                body_part: '脚',
                set_count: 3,
                max_weight: 87.5,
                best_set_json: {},
            },
        ];

        const detailedItems = buildDetailedItemsFromSummary(summaryItems);
        const display = formatSummaryItemSetsText(detailedItems[0]);

        expect(display).toBe('87.5kg × 3');
    });

    test('max_weight=87.55 は小数第1位に丸められる', () => {
        const summaryItems = [
            {
                exercise_name: 'スクワット',
                body_part: '脚',
                set_count: 3,
                max_weight: 87.55,
                best_set_json: {},
            },
        ];

        const detailedItems = buildDetailedItemsFromSummary(summaryItems);
        const display = formatSummaryItemSetsText(detailedItems[0]);

        // Math.round(87.55 * 10) / 10 = 87.6
        expect(display).toBe('87.6kg × 3');
    });
});

// ─── 段階②以降の行（sets あり）はフォールバックを通らないことの確認 ─────────

describe('formatSummaryItemSetsText: sets ありの行はフォールバックを通らない', () => {
    test('sets を持つ summaryItem の detailedItems[0].sets は空でない', () => {
        const summaryItems = [
            {
                exercise_name: '懸垂',
                body_part: '背中',
                set_count: 2,
                max_weight: 0,
                sets: [
                    { weight: 'BW', reps: 8, unit: 'BW', added_weight_kg: 10 },
                    { weight: 'BW', reps: 7, unit: 'BW', added_weight_kg: 10 },
                ],
                best_set_json: {},
            },
        ];

        const detailedItems = buildDetailedItemsFromSummary(summaryItems);
        // sets が存在するので FeedSection.jsx では formatSummaryItemSetsText を呼ばない
        expect(detailedItems[0].sets.length).toBeGreaterThan(0);
    });

    test('sets あり・max_weight=0 でも formatSummaryItemSetsText は "Nセット" を返す（念のため）', () => {
        const item = { set_count: 2, max_weight: 0 };
        const display = formatSummaryItemSetsText(item);
        expect(display).toBe('2セット');
    });
});

// ─── ④ formatKg 統合テスト（FeedSection.formatSummaryItemSetsText） ──────────
// 旧実装: `${Math.round(Number(summaryItem.max_weight) * 10) / 10}kg × ...`
// 新実装: `${formatKg(summaryItem.max_weight)}kg × ...`
//
// 通常の有限数値では両実装の出力は同一。
// FAIL 検証可能なケース:
//   max_weight = Infinity → 旧実装は "Infinitykg × N"、formatKg は "0kg × N"
//   max_weight = "BW"    → 旧実装は "NaNkg × N"、     formatKg は "0kg × N"
//   （どちらも実データには現れないが、Infinity/"BW" は truthy なので
//     三項演算子の真側に入り旧インラインに到達する）
describe('formatSummaryItemSetsText: ④ formatKg 統合 — formatKg でのみ正しい出力になるケース', () => {
    test('lb→kg 変換後の端数（73.481904）が小数1桁に丸まる', () => {
        // 162lbs × 0.453592 = 73.481904
        const item = { set_count: 3, max_weight: 73.481904 };
        expect(formatSummaryItemSetsText(item)).toBe('73.5kg × 3');
    });

    test('max_weight=Infinity → "0kg × N"（旧インラインは "Infinitykg × N"）', () => {
        const item = { set_count: 2, max_weight: Infinity };
        expect(formatSummaryItemSetsText(item)).toBe('0kg × 2');
    });

    test('max_weight="BW"（truthy 文字列）→ "0kg × N"（旧インラインは "NaNkg × N"）', () => {
        const item = { set_count: 1, max_weight: 'BW' };
        expect(formatSummaryItemSetsText(item)).toBe('0kg × 1');
    });
});
