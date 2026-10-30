/**
 * セットフィールド伝播テスト
 *
 * テスト対象の関数:
 *   - getBestSet              (明示的フィールド構築 → body_weight_kg / __canary が落ちる)
 *   - buildHistoryBestMap     (getBestSet 経由 → added_weight_kg が流れる / body_weight_kg は流れない)
 *   - buildHistoryRecordMap   (同上)
 *   - buildWorkoutSessionEntriesFromDraft  (スプレッド → 全フィールドが生き残る)
 *   - buildWorkoutSessionPayloadFromEntries preview_items.sets
 *                             (明示的ピック → body_weight_kg / __canary が落ちる)
 *   - buildDataFromNormalizedRows  (明示的構築 → DB の added_weight_kg が流れる)
 *   - getWorkoutDraftSnapshotHash  (body_weight_kg / added_weight_kg どちらを変えてもハッシュが変わる)
 *   - formatSetsText          (出力文字列に added_weight_kg が反映される)
 *   - buildWorkoutSetRow      (workout_sets カラム集合の厳密一致)
 *
 * テスト構成:
 *   作業2: カナリアテスト
 *   作業3: 逆向きテスト（DB ペイロードへの混入チェック）
 *   作業4: ハッシュテスト
 *   作業2追加: formatSetsText 出力文字列テスト
 *   作業3追加: buildWorkoutSetRow カラム集合テスト
 */

// workoutDraftStore / workoutRepository が import している副作用モジュールを先にモック
jest.mock('../utils/writeTrace', () => ({
    logWriteTrace: jest.fn(),
    trackRestoreAttempt: jest.fn(() => ({
        count: 0,
        firstTs: Date.now(),
        blocked: 0,
        applied: 0,
    })),
    wpCountExercisesFromHistory: jest.fn(),
    wpCountSetsFromHistory: jest.fn(),
}));

jest.mock('../utils/supabase', () => ({
    supabase: {},
    supabaseConfigError: null,
}));

jest.mock('../features/workout/buildTrustedHistory', () => ({
    getTrustedHistoryMetricsForDate: jest.fn(),
    pickHistoryForDate: jest.fn(),
}));

jest.mock('../features/workout/workoutSaveGuards', () => ({
    getWorkoutSaveGuardDecision: jest.fn(),
}));

import {
    getBestSet,
    buildHistoryBestMap,
    buildHistoryRecordMap,
    formatSetsText,
} from '../components/analytics/analyticsUtils';
import {
    buildWorkoutSessionEntriesFromDraft,
    buildWorkoutSessionPayloadFromEntries,
} from '../utils/workoutSessions';
import { getWorkoutDraftSnapshotHash } from '../features/workout/workoutDraftStore';
import { buildDataFromNormalizedRows, buildWorkoutSetRow } from '../features/workout/workoutRepository';

// analyticsUtils 内の console.log 出力を抑制
beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => {
    console.log.mockRestore();
});

// ─── 共通テストデータ ────────────────────────────────────────────────────────

/** カナリアフィールド付き kg セット */
const makeKgSetWithCanary = (overrides = {}) => ({
    weight: 100,
    reps: 5,
    unit: 'kg',
    added_weight_kg: 10,
    body_weight_kg: 65,
    __canary: 'CANARY',
    done: true,
    ...overrides,
});

/** カナリアフィールド付き BW セット */
const makeBWSetWithCanary = (overrides = {}) => ({
    weight: 'BW',
    reps: 8,
    unit: 'BW',
    weightMode: 'BW',
    added_weight_kg: 10,
    body_weight_kg: 65,
    __canary: 'CANARY',
    done: true,
    ...overrides,
});

/** buildHistoryBestMap / buildHistoryRecordMap 用の ctx */
const makeCtx = (overrides = {}) => ({
    bodyWeightKg: 65,
    hiddenSet: new Set(),
    muscleEx: {},
    exerciseBodyPartOverrides: {},
    historySource: 'test',
    ...overrides,
});

// ─── 作業2: カナリアテスト ────────────────────────────────────────────────────

describe('作業2: カナリアテスト', () => {
    // ── getBestSet ────────────────────────────────────────────────────────────
    describe('getBestSet', () => {
        test('added_weight_kg がアウトプットに含まれる', () => {
            const result = getBestSet([makeKgSetWithCanary()], 'kg');
            expect(result).not.toBeNull();
            expect(result).toHaveProperty('added_weight_kg', 10);
        });

        test('body_weight_kg がアウトプットに含まれない（明示的フィールド構築）', () => {
            const result = getBestSet([makeKgSetWithCanary()], 'kg');
            expect(result).not.toHaveProperty('body_weight_kg');
        });

        test('__canary がアウトプットに含まれない（明示的フィールド構築）', () => {
            const result = getBestSet([makeKgSetWithCanary()], 'kg');
            expect(result).not.toHaveProperty('__canary');
        });

        test('BW セットでも added_weight_kg が保持される', () => {
            const result = getBestSet([makeBWSetWithCanary()], 'BW', [], 65);
            expect(result).not.toBeNull();
            expect(result).toHaveProperty('added_weight_kg', 10);
            expect(result).not.toHaveProperty('body_weight_kg');
            expect(result).not.toHaveProperty('__canary');
        });
    });

    // ── buildHistoryBestMap ───────────────────────────────────────────────────
    describe('buildHistoryBestMap', () => {
        const history = {
            '懸垂': [{
                date: '2026-10-01',
                bodyPart: '背中',
                body_part: '背中',
                sets: [makeBWSetWithCanary()],
            }],
        };

        test('added_weight_kg がエントリに含まれる', () => {
            const bestMap = buildHistoryBestMap(history, makeCtx());
            const entry = Object.values(bestMap)[0];
            expect(entry).toBeDefined();
            expect(entry).toHaveProperty('added_weight_kg', 10);
        });

        test('body_weight_kg がエントリに含まれない', () => {
            const bestMap = buildHistoryBestMap(history, makeCtx());
            const entry = Object.values(bestMap)[0];
            expect(entry).not.toHaveProperty('body_weight_kg');
        });

        test('__canary がエントリに含まれない', () => {
            const bestMap = buildHistoryBestMap(history, makeCtx());
            const entry = Object.values(bestMap)[0];
            expect(entry).not.toHaveProperty('__canary');
        });
    });

    // ── buildHistoryRecordMap ─────────────────────────────────────────────────
    describe('buildHistoryRecordMap', () => {
        const history = {
            '懸垂': [{
                date: '2026-10-01',
                bodyPart: '背中',
                body_part: '背中',
                sets: [makeBWSetWithCanary()],
            }],
        };

        test('added_weight_kg がエントリに含まれる', () => {
            const recordMap = buildHistoryRecordMap(history, makeCtx());
            const entries = Object.values(recordMap)[0];
            expect(entries).toBeDefined();
            expect(entries.length).toBeGreaterThan(0);
            expect(entries[0]).toHaveProperty('added_weight_kg', 10);
        });

        test('body_weight_kg がエントリに含まれない', () => {
            const recordMap = buildHistoryRecordMap(history, makeCtx());
            const entries = Object.values(recordMap)[0];
            expect(entries[0]).not.toHaveProperty('body_weight_kg');
        });

        test('__canary がエントリに含まれない', () => {
            const recordMap = buildHistoryRecordMap(history, makeCtx());
            const entries = Object.values(recordMap)[0];
            expect(entries[0]).not.toHaveProperty('__canary');
        });
    });

    // ── buildWorkoutSessionEntriesFromDraft (スプレッドパス) ──────────────────
    describe('buildWorkoutSessionEntriesFromDraft (スプレッドパス)', () => {
        const result = buildWorkoutSessionEntriesFromDraft({
            exercises: [{ id: 'chin-up', name: '懸垂', bodyPart: '背中', sets: [] }],
            logData: {
                '懸垂': [makeBWSetWithCanary()],
            },
            getExUnit: () => 'BW',
            workoutDate: '2026-10-01',
        });

        test('entries が生成される', () => {
            expect(result.length).toBe(1);
            expect(result[0].sets.length).toBe(1);
        });

        test('added_weight_kg がスプレッドで生き残る', () => {
            expect(result[0].sets[0]).toHaveProperty('added_weight_kg', 10);
        });

        test('body_weight_kg がスプレッドで生き残る（in-memory 経路は落とさない）', () => {
            expect(result[0].sets[0]).toHaveProperty('body_weight_kg', 65);
        });

        test('__canary がスプレッドで生き残る（in-memory 経路は落とさない）', () => {
            expect(result[0].sets[0]).toHaveProperty('__canary', 'CANARY');
        });
    });

    // ── buildDataFromNormalizedRows ───────────────────────────────────────────
    describe('buildDataFromNormalizedRows', () => {
        const exercises = [{
            id: 1,
            workout_id: 100,
            exercise_name: 'ベンチプレス',
            body_part: '胸',
            display_order: 0,
        }];

        test('added_weight_kg が DB の値から正しく流れる', () => {
            const sets = [{
                id: 1, exercise_id: 1, set_number: 1,
                weight: 100, reps: 5, unit: 'kg',
                display_weight: 100, display_unit: 'kg',
                added_weight_kg: 5,
            }];
            const result = buildDataFromNormalizedRows(exercises, sets, '2026-10-01');
            const set = result['ベンチプレス'][0].sets[0];
            expect(set).toHaveProperty('added_weight_kg', 5);
        });

        test('added_weight_kg: null が null のまま保持される', () => {
            const sets = [{
                id: 1, exercise_id: 1, set_number: 1,
                weight: 100, reps: 5, unit: 'kg',
                display_weight: 100, display_unit: 'kg',
                added_weight_kg: null,
            }];
            const result = buildDataFromNormalizedRows(exercises, sets, '2026-10-01');
            const set = result['ベンチプレス'][0].sets[0];
            expect(set).toHaveProperty('added_weight_kg', null);
        });

        test('__canary は出力に存在しない（明示的フィールド構築）', () => {
            const sets = [{
                id: 1, exercise_id: 1, set_number: 1,
                weight: 100, reps: 5, unit: 'kg',
                display_weight: 100, display_unit: 'kg',
                added_weight_kg: null,
            }];
            const result = buildDataFromNormalizedRows(exercises, sets, '2026-10-01');
            const set = result['ベンチプレス'][0].sets[0];
            expect(set).not.toHaveProperty('__canary');
        });
    });
});

// ─── 作業3: 逆向きテスト ─────────────────────────────────────────────────────

describe('作業3: 逆向きテスト（DB ペイロードへの混入チェック）', () => {
    // ── buildWorkoutSessionPayloadFromEntries / preview_items.sets ────────────
    describe('buildWorkoutSessionPayloadFromEntries / preview_items.sets', () => {
        const entries = [{
            exerciseName: '懸垂',
            bodyPart: '背中',
            order: 0,
            date: '2026-10-01',
            sets: [makeBWSetWithCanary({ reps: 8 })],
            displaySets: [makeBWSetWithCanary({ reps: 8 })],
        }];
        const payload = buildWorkoutSessionPayloadFromEntries(entries, '2026-10-01');
        const previewSet = payload?.preview_items?.[0]?.sets?.[0];

        test('payload が生成される', () => {
            expect(payload).not.toBeNull();
            expect(previewSet).toBeDefined();
        });

        test('weight / reps / unit / added_weight_kg が含まれる', () => {
            expect(previewSet).toHaveProperty('weight', 'BW');
            expect(previewSet).toHaveProperty('reps', 8);
            expect(previewSet).toHaveProperty('unit', 'BW');
            expect(previewSet).toHaveProperty('added_weight_kg', 10);
        });

        test('body_weight_kg が preview_items.sets に混入しない', () => {
            expect(previewSet).not.toHaveProperty('body_weight_kg');
        });

        test('__canary が preview_items.sets に混入しない', () => {
            expect(previewSet).not.toHaveProperty('__canary');
        });
    });
});

// ─── 作業4: ハッシュテスト ────────────────────────────────────────────────────

describe('作業4: ハッシュテスト', () => {
    const makeDraft = (body_weight_kg, added_weight_kg) => ({
        date: '2026-10-01',
        exercises: [{
            id: 'chin-up',
            name: '懸垂',
            bodyPart: '背中',
            sets: [{
                weight: 'BW',
                reps: 8,
                unit: 'BW',
                done: true,
                body_weight_kg,
                added_weight_kg,
            }],
        }],
        logData: {},
        exerciseUnits: {},
    });

    test('body_weight_kg が変わるとハッシュが変わる', () => {
        const h1 = getWorkoutDraftSnapshotHash(makeDraft(65, 10));
        const h2 = getWorkoutDraftSnapshotHash(makeDraft(70, 10));
        expect(h1).not.toBe(h2);
    });

    test('added_weight_kg が変わるとハッシュが変わる', () => {
        const h1 = getWorkoutDraftSnapshotHash(makeDraft(65, 10));
        const h2 = getWorkoutDraftSnapshotHash(makeDraft(65, 20));
        expect(h1).not.toBe(h2);
    });

    test('null → 値 に変えるとハッシュが変わる（body_weight_kg）', () => {
        const base = getWorkoutDraftSnapshotHash(makeDraft(null, null));
        const withBW = getWorkoutDraftSnapshotHash(makeDraft(65, null));
        expect(base).not.toBe(withBW);
    });

    test('null → 値 に変えるとハッシュが変わる（added_weight_kg）', () => {
        const base = getWorkoutDraftSnapshotHash(makeDraft(null, null));
        const withAdded = getWorkoutDraftSnapshotHash(makeDraft(null, 10));
        expect(base).not.toBe(withAdded);
    });

    test('body_weight_kg と added_weight_kg は独立してハッシュに影響する', () => {
        const withBW = getWorkoutDraftSnapshotHash(makeDraft(65, null));
        const withAdded = getWorkoutDraftSnapshotHash(makeDraft(null, 10));
        expect(withBW).not.toBe(withAdded);
    });

    test('同じ値なら同じハッシュ（再現性）', () => {
        const h1 = getWorkoutDraftSnapshotHash(makeDraft(65, 10));
        const h2 = getWorkoutDraftSnapshotHash(makeDraft(65, 10));
        expect(h1).toBe(h2);
    });
});

// ─── 作業2追加: formatSetsText 出力文字列テスト ───────────────────────────────
//
// 確認した実際の出力（src/__tests__/formatProbe.test.js で検証）:
//   BW + added=10, reps=8          → "自重+10kg × 8rep"
//   BW + added なし, reps=5        → "自重 × 5rep"
//   100kg + added=5(無視), reps=5  → "100kg × 5rep"
//   上記2件の複数セット            → "自重+10kg × 8rep / 自重 × 5rep"
//
// added_weight_kg を削除すると BW セットの bwLabel が "自重" に変わるため
// "自重+10kg × 8rep" → "自重 × 8rep" となり FAIL する。

describe('作業2追加: formatSetsText 出力文字列テスト', () => {
    test('BW + added_weight_kg=10 → "自重+10kg × 8rep"', () => {
        const result = formatSetsText(
            [{ weight: 'BW', reps: 8, unit: 'BW', added_weight_kg: 10, done: true }],
            'BW',
        );
        expect(result).toBe('自重+10kg × 8rep');
    });

    test('BW + added_weight_kg なし → "自重 × 5rep"', () => {
        const result = formatSetsText(
            [{ weight: 'BW', reps: 5, unit: 'BW', done: true }],
            'BW',
        );
        expect(result).toBe('自重 × 5rep');
    });

    test('数値セット (added_weight_kg は出力に影響しない) → "100kg × 5rep"', () => {
        const result = formatSetsText(
            [{ weight: 100, reps: 5, unit: 'kg', added_weight_kg: 5, done: true }],
            'kg',
        );
        expect(result).toBe('100kg × 5rep');
    });

    test('複数セットは " / " で連結される', () => {
        const result = formatSetsText(
            [
                { weight: 'BW', reps: 8, unit: 'BW', added_weight_kg: 10, done: true },
                { weight: 'BW', reps: 5, unit: 'BW', done: true },
            ],
            'BW',
        );
        expect(result).toBe('自重+10kg × 8rep / 自重 × 5rep');
    });
});

// ─── 作業3追加: buildWorkoutSetRow カラム集合テスト ───────────────────────────
//
// workout_sets への INSERT に渡されるカラム集合が変わったら即 FAIL させる。
// 未知フィールドが混入すると PostgREST が 400 を返すため、ここで止める。
//
// 期待カラム（確認済み出力から取得）:
//   added_weight_kg, display_unit, display_weight, exercise_id,
//   reps, set_number, unit, user_id, weight

describe('作業3追加: buildWorkoutSetRow カラム集合テスト', () => {
    const EXPECTED_COLUMNS = [
        'added_weight_kg',
        'display_unit',
        'display_weight',
        'exercise_id',
        'reps',
        'set_number',
        'unit',
        'user_id',
        'weight',
    ].sort();

    test('kg セットのカラム集合が完全一致する', () => {
        const row = buildWorkoutSetRow(
            { weight: 100, reps: 5, unit: 'kg', displayWeight: 100, displayUnit: 'kg', added_weight_kg: 5, done: true },
            0,
            { exercise_id: 'ex-1', user_id: 'user-1' },
        );
        expect(Object.keys(row).sort()).toEqual(EXPECTED_COLUMNS);
    });

    test('BW + added_weight_kg セットのカラム集合が完全一致する', () => {
        const row = buildWorkoutSetRow(
            { weight: 'BW', reps: 8, unit: 'BW', added_weight_kg: 10, done: true },
            0,
            { exercise_id: 'ex-1', user_id: 'user-1' },
        );
        expect(Object.keys(row).sort()).toEqual(EXPECTED_COLUMNS);
    });

    test('BW セット (added_weight_kg なし) のカラム集合が完全一致する', () => {
        const row = buildWorkoutSetRow(
            { weight: 'BW', reps: 3, unit: 'BW', done: true },
            0,
            { exercise_id: 'ex-1', user_id: 'user-1' },
        );
        expect(Object.keys(row).sort()).toEqual(EXPECTED_COLUMNS);
    });

    test('added_weight_kg の値が正しく変換される (数値)', () => {
        const row = buildWorkoutSetRow(
            { weight: 100, reps: 5, unit: 'kg', added_weight_kg: 10 },
            0,
            { exercise_id: 'ex-1', user_id: 'user-1' },
        );
        expect(row.added_weight_kg).toBe(10);
    });

    test('added_weight_kg: null は null のまま保持される', () => {
        const row = buildWorkoutSetRow(
            { weight: 100, reps: 5, unit: 'kg', added_weight_kg: null },
            0,
            { exercise_id: 'ex-1', user_id: 'user-1' },
        );
        expect(row.added_weight_kg).toBeNull();
    });
});
