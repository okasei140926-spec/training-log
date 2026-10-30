/**
 * summary_json.items[].sets 追加テスト（段階②）
 *
 * テスト対象:
 *   buildSessionItemSets          (workoutSessions.js) — 共通ビルダー
 *   buildWorkoutSessionPayloadFromEntries (workoutSessions.js) — 書き込み側
 *   buildDetailedItemsFromSummary (useFriendsData.js)  — 読み取り側
 *
 * 背景:
 *   summary_json.items に sets を追加することで、フレンドフィードで
 *   BW セットの詳細（「自重+10kg × 8」）が表示されるようになる。
 *   preview_items.sets と summary_json.items[].sets は同一の
 *   buildSessionItemSets から生成し、片方だけ壊れる事故を防ぐ。
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
    normalizeExerciseName: jest.fn((name) => String(name || '').toLowerCase().trim()),
}));

import {
    buildSessionItemSets,
    buildWorkoutSessionPayloadFromEntries,
} from '../utils/workoutSessions';
import { buildDetailedItemsFromSummary } from '../hooks/useFriendsData';
import { formatBWSetLabel } from '../utils/helpers';

// ─── テストデータヘルパー ────────────────────────────────────────────────────

/** 自重+10kg セット（entry.displaySets 相当） */
const makeBWEntry = (overrides = {}) => ({
    exerciseName: '懸垂',
    bodyPart: '背中',
    order: 0,
    sets: [
        { weight: 'BW', reps: 8, unit: 'BW', added_weight_kg: 10, body_weight_kg: 65, done: true },
        { weight: 'BW', reps: 7, unit: 'BW', added_weight_kg: 10, body_weight_kg: 65, done: true },
    ],
    displaySets: [
        { weight: 'BW', reps: 8, unit: 'BW', added_weight_kg: 10, body_weight_kg: 65, done: true },
        { weight: 'BW', reps: 7, unit: 'BW', added_weight_kg: 10, body_weight_kg: 65, done: true },
    ],
    ...overrides,
});

/** 数値セット（ベンチプレス） */
const makeKgEntry = () => ({
    exerciseName: 'ベンチプレス',
    bodyPart: '胸',
    order: 1,
    sets: [
        { weight: 100, reps: 5, unit: 'kg', added_weight_kg: null, done: true },
        { weight: 100, reps: 5, unit: 'kg', added_weight_kg: null, done: true },
    ],
    displaySets: [
        { weight: 100, reps: 5, unit: 'kg', added_weight_kg: null, done: true },
        { weight: 100, reps: 5, unit: 'kg', added_weight_kg: null, done: true },
    ],
});

// ─── buildSessionItemSets 単体テスト ─────────────────────────────────────────

describe('buildSessionItemSets', () => {
    test('BW セットから weight/reps/unit/added_weight_kg を取り出す', () => {
        const sets = [{ weight: 'BW', reps: 8, unit: 'BW', added_weight_kg: 10, body_weight_kg: 65 }];
        const result = buildSessionItemSets(sets);
        expect(result[0]).toEqual({ weight: 'BW', reps: 8, unit: 'BW', added_weight_kg: 10 });
    });

    test('body_weight_kg を含まない（フレンドに体重が漏れないこと）', () => {
        const sets = [{ weight: 'BW', reps: 8, unit: 'BW', added_weight_kg: 10, body_weight_kg: 65 }];
        const result = buildSessionItemSets(sets);
        expect(result[0]).not.toHaveProperty('body_weight_kg');
    });

    test('kg セットから weight/reps/unit/added_weight_kg を取り出す', () => {
        const sets = [{ weight: 100, reps: 5, unit: 'kg', added_weight_kg: null, body_weight_kg: 70 }];
        const result = buildSessionItemSets(sets);
        expect(result[0]).toEqual({ weight: 100, reps: 5, unit: 'kg', added_weight_kg: null });
        expect(result[0]).not.toHaveProperty('body_weight_kg');
    });

    test('空配列 → 空配列', () => {
        expect(buildSessionItemSets([])).toEqual([]);
    });

    test('引数なし → 空配列', () => {
        expect(buildSessionItemSets()).toEqual([]);
    });
});

// ─── summary_json.items[].sets の書き込みテスト ──────────────────────────────

describe('buildWorkoutSessionPayloadFromEntries — summary_json.items[].sets', () => {
    test('summary_json.items[].sets に added_weight_kg が含まれる', () => {
        const payload = buildWorkoutSessionPayloadFromEntries([makeBWEntry()], '2026-10-31');
        const item = payload.session.summary_json.items[0];
        expect(Array.isArray(item.sets)).toBe(true);
        expect(item.sets.length).toBe(2);
        expect(item.sets[0].added_weight_kg).toBe(10);
    });

    test('summary_json.items[].sets に body_weight_kg が含まれない', () => {
        const payload = buildWorkoutSessionPayloadFromEntries([makeBWEntry()], '2026-10-31');
        const item = payload.session.summary_json.items[0];
        // body_weight_kg が紛れ込んだら FAIL（将来の事故防止）
        item.sets.forEach((set) => {
            expect(set).not.toHaveProperty('body_weight_kg');
        });
    });

    test('preview_items.sets と summary_json.items[].sets が同一内容（1エントリの場合）', () => {
        const payload = buildWorkoutSessionPayloadFromEntries([makeBWEntry()], '2026-10-31');
        const previewSets = payload.preview_items[0].sets;
        const summarySets = payload.session.summary_json.items[0].sets;
        expect(previewSets).toEqual(summarySets);
    });

    test('kg セットの summary_json.items[].sets が正しい', () => {
        const payload = buildWorkoutSessionPayloadFromEntries([makeKgEntry()], '2026-10-31');
        const item = payload.session.summary_json.items[0];
        expect(item.sets[0].weight).toBe(100);
        expect(item.sets[0].unit).toBe('kg');
        expect(item.sets[0]).not.toHaveProperty('body_weight_kg');
    });

    test('複数エクササイズで summary_json.items[].sets がそれぞれ正しい', () => {
        const payload = buildWorkoutSessionPayloadFromEntries(
            [makeBWEntry(), makeKgEntry()],
            '2026-10-31'
        );
        const items = payload.session.summary_json.items;
        const bwItem  = items.find((i) => i.exercise_name === '懸垂');
        const kgItem  = items.find((i) => i.exercise_name === 'ベンチプレス');

        expect(bwItem.sets[0].weight).toBe('BW');
        expect(bwItem.sets[0].added_weight_kg).toBe(10);
        expect(kgItem.sets[0].weight).toBe(100);
    });

    test('同一キーのエントリが2件あるとき sets が結合される', () => {
        const entry1 = { ...makeBWEntry(), sets: [{ weight: 'BW', reps: 8, unit: 'BW', added_weight_kg: 10, done: true }], displaySets: [{ weight: 'BW', reps: 8, unit: 'BW', added_weight_kg: 10, done: true }] };
        const entry2 = { ...makeBWEntry(), sets: [{ weight: 'BW', reps: 6, unit: 'BW', added_weight_kg: 10, done: true }], displaySets: [{ weight: 'BW', reps: 6, unit: 'BW', added_weight_kg: 10, done: true }] };
        const payload = buildWorkoutSessionPayloadFromEntries([entry1, entry2], '2026-10-31');
        const item = payload.session.summary_json.items[0];
        expect(item.sets.length).toBe(2);
        expect(item.sets.map((s) => s.reps)).toEqual([8, 6]);
    });
});

// ─── 読み取り側テスト（buildDetailedItemsFromSummary 経由） ─────────────────

describe('読み取り側: summary_json.items[].sets → detailedItems → 表示', () => {
    test('sets を持つ summaryItems が detailedItems に正しく伝播する', () => {
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

        const result = buildDetailedItemsFromSummary(summaryItems);

        expect(result[0].sets).toHaveLength(2);
        expect(result[0].sets[0].weight).toBe('BW');
        expect(result[0].sets[0].added_weight_kg).toBe(10);
    });

    test('sets なしの古い行（sets フィールドなし）で例外が出ない', () => {
        const summaryItems = [
            {
                exercise_name: '懸垂',
                body_part: '背中',
                set_count: 2,
                max_weight: 65,
                // sets フィールドなし（旧スキーマ）
                best_set_json: {},
            },
        ];

        expect(() => buildDetailedItemsFromSummary(summaryItems)).not.toThrow();
        const result = buildDetailedItemsFromSummary(summaryItems);
        expect(result[0].sets).toEqual([]);   // 段階①のフォールバックに落ちる
        expect(result[0].max_weight).toBe(65); // max_weight は保持される
    });

    test('自重+10kg × 8 の表示まで：BW セットが formatBWSetLabel で正しく変換される', () => {
        // summary_json.items から来るデータ（stage 2 で追加される sets）
        const summaryItems = [
            {
                exercise_name: '懸垂',
                body_part: '背中',
                set_count: 1,
                max_weight: 0,
                sets: [{ weight: 'BW', reps: 8, unit: 'BW', added_weight_kg: 10 }],
                best_set_json: {},
            },
        ];

        const detailedItems = buildDetailedItemsFromSummary(summaryItems);
        const set = detailedItems[0].sets[0];

        // formatSessionSetDisplay の中身: formatBWSetLabel(set) + reps
        const bwLabel = formatBWSetLabel(set);
        const display = bwLabel != null
            ? `${bwLabel} × ${set.reps}`
            : `${Math.round(Number(set.weight || 0) * 10) / 10}kg × ${set.reps}`;

        expect(display).toBe('自重+10kg × 8');
    });

    test('added_weight_kg なしの BW セットは「自重 × 5」と表示される', () => {
        const summaryItems = [
            {
                exercise_name: '懸垂',
                body_part: '背中',
                set_count: 1,
                max_weight: 0,
                sets: [{ weight: 'BW', reps: 5, unit: 'BW', added_weight_kg: null }],
                best_set_json: {},
            },
        ];

        const detailedItems = buildDetailedItemsFromSummary(summaryItems);
        const set = detailedItems[0].sets[0];
        const bwLabel = formatBWSetLabel(set);
        const display = bwLabel != null
            ? `${bwLabel} × ${set.reps}`
            : `${Math.round(Number(set.weight || 0) * 10) / 10}kg × ${set.reps}`;

        expect(display).toBe('自重 × 5');
    });
});
