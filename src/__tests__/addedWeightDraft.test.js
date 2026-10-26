/**
 * added_weight_kg の localStorage 永続化テスト
 *
 * テスト対象の層: workoutDraftStore.js の saveWorkoutDraft / loadWorkoutDraft
 *
 * テストできていること:
 *   - saveWorkoutDraft が logData 内の added_weight_kg を落とさずに localStorage に書く
 *   - loadWorkoutDraft が読み戻したとき値が保持されている（往復）
 *   - null を渡したとき null のまま往復する
 *
 * テストできていないこと:
 *   - SetRow の onChange ハンドラが "空文字→null" / "10→10(number)" に変換する部分
 *       → これは SetRow.jsx の JSX ロジックで、React イベントなしでは呼べない
 *   - setField(ex, idx, "added_weight_kg", value) が exercises[].sets[].added_weight_kg
 *     に書いたあと splitExercisesForApp → logData に転写されるまでの経路
 *       → withWeightMode / makeSet / splitExercisesForApp はすべて ...set spread のため
 *         コードレビューで確認済み。フックの renderHook テストが必要な場合は別途追加する。
 */

// workoutDraftStore.js が import している副作用ライブラリをサイレントに
jest.mock('../utils/writeTrace', () => ({
    logWriteTrace: jest.fn(),
    trackRestoreAttempt: jest.fn(() => ({
        count: 0,
        firstTs: Date.now(),
        blocked: 0,
        applied: 0,
    })),
}));

import {
    saveWorkoutDraft,
    loadWorkoutDraft,
} from '../features/workout/workoutDraftStore';

const DATE = '2025-10-24';

/**
 * BW セットを持つドラフトを生成する。
 * setField(ex, idx, "added_weight_kg", addedWeightKg) を呼んだあと
 * saveWorkoutDraft に渡される直前の状態を再現している。
 */
const makeBWDraft = (addedWeightKg) => ({
    date: DATE,
    exercises: [{ id: 'chin-up', name: '懸垂', bodyPart: '背中', sets: [] }],
    logData: {
        '懸垂': [{
            weight: 'BW',
            reps: '8',
            unit: 'BW',
            weightMode: 'BW',
            done: true,
            added_weight_kg: addedWeightKg,
        }],
    },
    exerciseUnits: { '懸垂': 'BW' },
    meta: {
        date: DATE,
        keyDate: DATE,
        draftDate: DATE,
        workoutDate: DATE,
        source: 'user_edit',
        hasUnsavedChanges: true,
        explicitEdit: true,
        layerVersion: 2,
    },
});

describe('added_weight_kg の localStorage 永続化', () => {
    let storage;

    beforeEach(() => {
        storage = window.localStorage;
        storage.clear();
    });

    // ── 書き込み ───────────────────────────────────────────────────────────────

    test('added_weight_kg: 10 が saveWorkoutDraft で localStorage に書かれる', () => {
        saveWorkoutDraft(DATE, makeBWDraft(10), { storage });

        const raw = storage.getItem(`workoutDraft:${DATE}`);
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw);
        expect(parsed.logData['懸垂'][0].added_weight_kg).toBe(10);
    });

    test('added_weight_kg: null を渡したとき localStorage に null が書かれる', () => {
        saveWorkoutDraft(DATE, makeBWDraft(null), { storage });

        const raw = storage.getItem(`workoutDraft:${DATE}`);
        const parsed = JSON.parse(raw);
        // JSON では null → null
        expect(parsed.logData['懸垂'][0].added_weight_kg).toBeNull();
    });

    test('SetRow onChange で空欄→null 変換後の状態（null）が保存される', () => {
        // SetRow の onChange: raw === "" → setField(ex, idx, "added_weight_kg", null)
        // その後 saveWorkoutDraft に来る時点では null が入っている。
        saveWorkoutDraft(DATE, makeBWDraft(null), { storage });

        const raw = storage.getItem(`workoutDraft:${DATE}`);
        const parsed = JSON.parse(raw);
        expect(parsed.logData['懸垂'][0].added_weight_kg).toBeNull();
    });

    // ── 往復（save → load）────────────────────────────────────────────────────

    test('往復: added_weight_kg: 10 → saveWorkoutDraft → loadWorkoutDraft で 10 が保持される', () => {
        saveWorkoutDraft(DATE, makeBWDraft(10), { storage });

        const loaded = loadWorkoutDraft(DATE, { storage });
        expect(loaded).not.toBeNull();
        expect(loaded.logData['懸垂'][0].added_weight_kg).toBe(10);
    });

    test('往復: added_weight_kg: null → 読み戻しても null', () => {
        saveWorkoutDraft(DATE, makeBWDraft(null), { storage });

        const loaded = loadWorkoutDraft(DATE, { storage });
        expect(loaded).not.toBeNull();
        expect(loaded.logData['懸垂'][0].added_weight_kg).toBeNull();
    });

    test('往復: 10 で保存 → 別の値 20 で上書き → 読み戻すと 20', () => {
        saveWorkoutDraft(DATE, makeBWDraft(10), { storage });
        // skipIfSame は meta の updatedAt が変わるため通過する
        saveWorkoutDraft(DATE, {
            ...makeBWDraft(20),
            meta: { ...makeBWDraft(20).meta, updatedAt: new Date(Date.now() + 1).toISOString() },
        }, { storage });

        const loaded = loadWorkoutDraft(DATE, { storage });
        expect(loaded.logData['懸垂'][0].added_weight_kg).toBe(20);
    });

    test('往復: 10 で保存 → null で上書き → 読み戻すと null（加重を削除できる）', () => {
        // 先に内容のある状態を書く
        saveWorkoutDraft(DATE, makeBWDraft(10), { storage });
        // 次のセーブは explicitEdit: true かつ incomingHasContent = true（logData がある）
        // なので空上書きガードは発動しない
        saveWorkoutDraft(DATE, {
            ...makeBWDraft(null),
            meta: { ...makeBWDraft(null).meta, updatedAt: new Date(Date.now() + 1).toISOString() },
        }, { storage });

        const loaded = loadWorkoutDraft(DATE, { storage });
        expect(loaded.logData['懸垂'][0].added_weight_kg).toBeNull();
    });
});
