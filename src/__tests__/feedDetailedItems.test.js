/**
 * フレンドフィード detailedItems フォールバックテスト
 *
 * テスト対象:
 *   buildDetailedItemsFromSummary (useFriendsData.js)
 *
 * 背景:
 *   フレンドの workouts テーブルは RLS で読めないため、
 *   buildFeedItemFromHistoryDate の entries が常に空になり、
 *   summaryItems（summary_json.items）から detailedItems を
 *   組み立てるフォールバックパスに落ちる。
 *
 *   このフォールバックが max_weight を落としていたため、
 *   FeedSection で `summaryItem.max_weight || 0` = 0 になり
 *   数値セットの日でも「0kg × N」と表示されていた。
 *
 * テスト:
 *   - max_weight と set_count が summaryItems から detailedItems に保持されること
 *   - sets が空でも exercise_name / body_part が正しく写ること
 *   - 複数エクササイズが正しくマップされること
 */

// useFriendsData が import する副作用モジュールを先にモック
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

import { buildDetailedItemsFromSummary } from '../hooks/useFriendsData';

describe('buildDetailedItemsFromSummary', () => {
    describe('max_weight の保持', () => {
        test('summary_json.items の max_weight が detailedItems に保持される', () => {
            const summaryItems = [
                {
                    exercise_name: 'ベンチプレス',
                    body_part: '胸',
                    set_count: 5,
                    max_weight: 100,
                    volume: 2250,
                    best_set_json: { weight: 100, reps: 5, rm: 112.5 },
                },
            ];

            const result = buildDetailedItemsFromSummary(summaryItems);

            expect(result).toHaveLength(1);
            expect(result[0].max_weight).toBe(100);
        });

        test('max_weight が小数でも正しく保持される', () => {
            const summaryItems = [
                {
                    exercise_name: 'スクワット',
                    body_part: '脚',
                    set_count: 3,
                    max_weight: 87.5,
                    volume: 787.5,
                    best_set_json: {},
                },
            ];

            const result = buildDetailedItemsFromSummary(summaryItems);

            expect(result[0].max_weight).toBe(87.5);
        });

        test('max_weight が 0 なら 0 になる（BW-only など）', () => {
            const summaryItems = [
                {
                    exercise_name: '懸垂',
                    body_part: '背中',
                    set_count: 4,
                    max_weight: 0,
                    volume: 0,
                    best_set_json: {},
                },
            ];

            const result = buildDetailedItemsFromSummary(summaryItems);

            expect(result[0].max_weight).toBe(0);
        });

        test('max_weight が undefined なら 0 にフォールバックする', () => {
            const summaryItems = [
                {
                    exercise_name: '懸垂',
                    body_part: '背中',
                    set_count: 3,
                    // max_weight は undefined
                    best_set_json: {},
                },
            ];

            const result = buildDetailedItemsFromSummary(summaryItems);

            expect(result[0].max_weight).toBe(0);
        });
    });

    describe('set_count の保持', () => {
        test('set_count が保持される', () => {
            const summaryItems = [
                {
                    exercise_name: 'ベンチプレス',
                    body_part: '胸',
                    set_count: 5,
                    max_weight: 100,
                    best_set_json: {},
                },
            ];

            const result = buildDetailedItemsFromSummary(summaryItems);

            expect(result[0].set_count).toBe(5);
        });
    });

    describe('FeedSection 表示パスの検証', () => {
        test('100kg × 5 のフレンドワークアウトが正しい値を持つ', () => {
            // summary_json.items のリアルなケース
            const summaryItems = [
                {
                    exercise_name: 'ベンチプレス',
                    body_part: '胸',
                    set_count: 5,
                    max_weight: 100,
                    volume: 2250,
                    best_set_json: { weight: 100, reps: 5, rm: 112.5 },
                },
                {
                    exercise_name: 'スクワット',
                    body_part: '脚',
                    set_count: 3,
                    max_weight: 120,
                    volume: 1080,
                    best_set_json: { weight: 120, reps: 3, rm: 130.8 },
                },
            ];

            const result = buildDetailedItemsFromSummary(summaryItems);

            expect(result).toHaveLength(2);

            // FeedSection: summaryItem.sets.length === 0 なのでフォールバック表示
            // `${summaryItem.max_weight}kg × ${summaryItem.set_count}`
            expect(result[0].sets).toEqual([]);           // sets は空
            expect(result[0].max_weight).toBe(100);       // → "100kg × 5"
            expect(result[0].set_count).toBe(5);

            expect(result[1].sets).toEqual([]);
            expect(result[1].max_weight).toBe(120);       // → "120kg × 3"
            expect(result[1].set_count).toBe(3);
        });
    });

    describe('その他フィールド', () => {
        test('exercise_name と body_part が保持される', () => {
            const summaryItems = [
                {
                    exercise_name: 'デッドリフト',
                    body_part: '背中',
                    set_count: 4,
                    max_weight: 150,
                    best_set_json: {},
                },
            ];

            const result = buildDetailedItemsFromSummary(summaryItems);

            expect(result[0].exercise_name).toBe('デッドリフト');
            expect(result[0].body_part).toBe('背中');
        });

        test('空配列を渡すと空配列が返る', () => {
            expect(buildDetailedItemsFromSummary([])).toEqual([]);
        });

        test('引数なしでも空配列が返る', () => {
            expect(buildDetailedItemsFromSummary()).toEqual([]);
        });
    });
});
