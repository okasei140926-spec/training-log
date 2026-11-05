/**
 * プラン開始パス: handleLogForDate({ planExercises }) の挙動テスト
 *
 * バグの再現条件:
 *   handleLogForDate の planExercises 分岐（早期リターン）が存在しない場合、
 *   通常の restore パスに落ちて shouldUseSavedWorkout / baseExercises が
 *   プランの種目を上書きしてしまう。
 *
 * テスト有効性の証明手順（手動):
 *   1. このテストが緑であることを確認
 *   2. useHistoryHandlers.js の "if (planExercises) {" ブロック全体を
 *      コメントアウト（早期リターンを無効化）
 *   3. このテストが赤になることを確認
 *   4. 元に戻す → 再び緑
 *
 * データ保護の検証:
 *   - 保存済み記録がある日にプランを開始した場合、既存のセット記録が保持される
 *   - 未保存入力がある場合、その内容が保持される
 *   - 既存にない種目のみが追加される（重複しない）
 */

// ── jest.mock はホイストされるため最上部に置く ──────────────────────────────

jest.mock('../../utils/appHelpers', () => ({
    ...jest.requireActual('../../utils/appHelpers'),
    loadPersistentDeletedDates: jest.fn().mockReturnValue({}),
    addPersistentDeletedDate: jest.fn(),
    removePersistentDeletedDate: jest.fn(),
}));

jest.mock('../../utils/writeTrace', () => ({
    logWriteTrace: jest.fn(),
}));

// ── テスト本体 ────────────────────────────────────────────────────────────────
import { makeHarness } from '../../testUtils/savePathHarness';

const DATE = '2026-11-05';

const makePlanExercises = (names) =>
    names.map((name, i) => ({ name, bodyPart: '胸', label: '胸', order: i }));

describe('planStartPath: 今日が空のときプランの種目がそのまま適用される', () => {
    beforeEach(() => {
        localStorage.clear();
        const { loadPersistentDeletedDates } = require('../../utils/appHelpers');
        loadPersistentDeletedDates.mockReturnValue({});
    });

    test('applyLogDraftState にプランの種目数が渡される', () => {
        const planExercises = makePlanExercises(['ベンチプレス', 'スクワット', 'ラットプルダウン', 'デッドリフト', 'ショルダープレス']);
        const h = makeHarness({
            savedWorkout: null,  // Supabase に記録なし
            localDraft: null,    // ローカルドラフトなし
        });

        h.logForDateWithPlan(DATE, planExercises, ['胸', '脚', '背中']);

        expect(h.applyLogDraftState).toHaveBeenCalledTimes(1);
        const applied = h.applyLogDraftState.mock.calls[0][0];
        expect(applied.sessionEx.length).toBe(planExercises.length);
        expect(applied.sessionEx.map(e => e.name)).toEqual(
            planExercises.map(e => e.name)
        );
    });

    test('applyLogDraftState に渡された logData は空', () => {
        const planExercises = makePlanExercises(['ベンチプレス', 'スクワット', 'デッドリフト', 'ショルダープレス', 'サイドレイズ']);
        const h = makeHarness({ savedWorkout: null, localDraft: null });

        h.logForDateWithPlan(DATE, planExercises, ['胸']);

        const applied = h.applyLogDraftState.mock.calls[0][0];
        expect(applied.logData).toEqual({});
    });
});

describe('planStartPath: 保存済み記録がある日でも既存セットが保持される', () => {
    beforeEach(() => {
        localStorage.clear();
        const { loadPersistentDeletedDates } = require('../../utils/appHelpers');
        loadPersistentDeletedDates.mockReturnValue({});
    });

    test('既存の種目＋logData が引き継がれ、プランの新種目だけ追加される', () => {
        const existingExercises = ['チェストプレス', 'レッグプレス'];
        const planExercises = makePlanExercises([
            'チェストプレス',  // 既存と重複 → 追加しない
            'スクワット',      // 新規 → 追加
            'ラットプルダウン',// 新規 → 追加
            'デッドリフト',    // 新規 → 追加
            'ショルダープレス',// 新規 → 追加
        ]);

        const h = makeHarness({
            savedWorkout: {
                date: DATE,
                exercises: existingExercises,
            },
            localDraft: null,
        });

        h.logForDateWithPlan(DATE, planExercises, ['胸', '脚']);

        const applied = h.applyLogDraftState.mock.calls[0][0];
        const appliedNames = applied.sessionEx.map(e => e.name);

        // 既存の種目が先頭に来る
        expect(appliedNames.slice(0, existingExercises.length)).toEqual(existingExercises);
        // 重複なし
        const unique = new Set(appliedNames);
        expect(unique.size).toBe(appliedNames.length);
        // 重複除外後のプラン種目が追加されている
        const newPlanNames = planExercises
            .map(e => e.name)
            .filter(n => !existingExercises.includes(n));
        newPlanNames.forEach(name => {
            expect(appliedNames).toContain(name);
        });
    });

    test('既存のセット記録（logData）が保持される', () => {
        const h = makeHarness({
            savedWorkout: {
                date: DATE,
                exercises: ['ベンチプレス'],
            },
            localDraft: null,
        });

        h.logForDateWithPlan(DATE, makePlanExercises(['スクワット']), ['脚']);

        const applied = h.applyLogDraftState.mock.calls[0][0];
        // harness が savedWorkout に自動付与するセット記録が引き継がれること
        expect(applied.logData['ベンチプレス']).toBeDefined();
        expect(applied.logData['ベンチプレス'].length).toBeGreaterThan(0);
    });
});

describe('planStartPath: 未保存ローカルドラフトがある場合も保持される', () => {
    beforeEach(() => {
        localStorage.clear();
        const { loadPersistentDeletedDates } = require('../../utils/appHelpers');
        loadPersistentDeletedDates.mockReturnValue({});
    });

    test('未保存ドラフトの種目＋セットが引き継がれる', () => {
        const { withDraftDateMeta } = require('../../utils/appHelpers');
        const unsavedDraft = withDraftDateMeta(DATE, {
            sessionEx: [{ name: '懸垂', bodyPart: '背中', label: '背中', order: 0 }],
            logData: { '懸垂': [{ weight: 'BW', reps: '10', unit: 'BW', done: true }] },
            exerciseUnits: {},
            todayLabels: ['背中'],
        }, { source: 'useWorkoutLog:set_add', hasUnsavedChanges: true });

        const h = makeHarness({
            savedWorkout: null,
            localDraft: unsavedDraft,
        });

        h.logForDateWithPlan(DATE, makePlanExercises(['スクワット', 'デッドリフト']), ['脚']);

        const applied = h.applyLogDraftState.mock.calls[0][0];
        const appliedNames = applied.sessionEx.map(e => e.name);

        // 未保存の種目が先頭にある
        expect(appliedNames[0]).toBe('懸垂');
        // プランの新種目が追加されている
        expect(appliedNames).toContain('スクワット');
        expect(appliedNames).toContain('デッドリフト');
        // 未保存のセット記録が保持されている
        expect(applied.logData['懸垂']).toBeDefined();
    });
});

describe('planStartPath: 保存済み10種目の日にプランを開始して全種目が保持される', () => {
    const TEN_EXERCISES = [
        'ベンチプレス', 'スクワット', 'ラットプルダウン', 'デッドリフト', 'ショルダープレス',
        'レッグカール', 'バイセプスカール', 'トライセプスプッシュダウン', 'レッグエクステンション', 'フライ',
    ];
    const NEW_PLAN_NAMES = ['サイドレイズ', 'フロントレイズ', 'プルダウン'];

    beforeEach(() => {
        localStorage.clear();
        const { loadPersistentDeletedDates } = require('../../utils/appHelpers');
        loadPersistentDeletedDates.mockReturnValue({});
    });

    test('保存済み10種目が全て残り、プランの未収録3種目が追加される（計13種目）', () => {
        // 重複2 + 新規3 の計5種目プラン
        const planNames = [...NEW_PLAN_NAMES, 'ベンチプレス', 'スクワット'];
        const planExercises = makePlanExercises(planNames);

        const h = makeHarness({
            savedWorkout: { date: DATE, exercises: TEN_EXERCISES },
            localDraft: null,
        });

        h.logForDateWithPlan(DATE, planExercises, ['胸', '脚', '肩']);

        const applied = h.applyLogDraftState.mock.calls[0][0];
        const appliedNames = applied.sessionEx.map(e => e.name);

        // 保存済み10種目が全て残っている
        TEN_EXERCISES.forEach(name => {
            expect(appliedNames).toContain(name);
        });
        // 新規3種目が追加されている
        NEW_PLAN_NAMES.forEach(name => {
            expect(appliedNames).toContain(name);
        });
        // 合計13種目（重複なし）
        expect(applied.sessionEx.length).toBe(13);
        const unique = new Set(appliedNames);
        expect(unique.size).toBe(13);
    });

    test('navigate-back: プラン開始後にページを離れて戻ってきてもドラフトが復元される', () => {
        const { withDraftDateMeta } = require('../../utils/appHelpers');

        // プラン開始後 → デバウンスで localStorage に書き込まれた内容（source: "explicit_date_nav"）
        const savedPlanDraft = withDraftDateMeta(DATE, {
            sessionEx: [
                ...TEN_EXERCISES.map((name, i) => ({ name, bodyPart: '胸', label: '胸', order: i })),
                ...NEW_PLAN_NAMES.map((name, i) => ({ name, bodyPart: '肩', label: '肩', order: i + 10 })),
            ],
            logData: Object.fromEntries(
                TEN_EXERCISES.map(name => [name, [{ weight: '60', reps: '10', unit: 'kg' }]])
            ),
            exerciseUnits: {},
            todayLabels: ['胸', '肩'],
        }, { source: 'explicit_date_nav', hasUnsavedChanges: true });

        const h = makeHarness({
            savedWorkout: { date: DATE, exercises: TEN_EXERCISES },
            localDraft: savedPlanDraft,  // ← プラン開始後のドラフトがローカルに存在
        });

        // 通常の logForDate（プランパスではない）でナビゲートバック
        h.logForDate(DATE);

        const applied = h.applyLogDraftState.mock.calls[0][0];
        expect(applied).not.toBeNull();
        const appliedNames = applied.sessionEx?.map(e => e.name) ?? [];

        // 10 + 3 = 13種目が復元される（zombie-clear されない）
        expect(appliedNames.length).toBe(13);
        TEN_EXERCISES.forEach(name => {
            expect(appliedNames).toContain(name);
        });
        NEW_PLAN_NAMES.forEach(name => {
            expect(appliedNames).toContain(name);
        });
    });
});

describe('planStartPath: 削除済みドラフトが復活しないこと', () => {
    beforeEach(() => {
        localStorage.clear();
        const { loadPersistentDeletedDates } = require('../../utils/appHelpers');
        loadPersistentDeletedDates.mockReturnValue({});
    });

    test('a. 全削除後（正常系）: deleteAllHistoryForDate が書く hasUnsavedChanges:false ドラフトがあれば空が適用される', () => {
        const { withDraftDateMeta } = require('../../utils/appHelpers');

        // deleteAllHistoryForDate が書く削除後ドラフト（useHistoryHandlers.js:876-886）:
        //   source: "date_delete", hasUnsavedChanges: false
        // これにより localDraftHasUnsavedChanges=false → localDraftCanOverrideSaved=false
        // → shouldUseLocalDraft=false かつフォールバック(line 413)も不発 → 空ドラフトが表示される。
        // localHasMoreExercises が true になっても localDraftCanOverrideSaved=false が先行ガードになる。
        const deletionDraft = withDraftDateMeta(DATE, {
            sessionEx: [],
            logData: {},
            exerciseUnits: {},
            todayLabels: [],
        }, { source: 'date_delete', hasUnsavedChanges: false });

        const h = makeHarness({
            savedWorkout: null,         // 削除済みなので Supabase に記録なし
            localDraft: deletionDraft,  // deleteAllHistoryForDate が書いた削除後ドラフト
            persistentDeleted: { [DATE]: new Date().toISOString() },
        });

        h.logForDate(DATE);

        const applied = h.applyLogDraftState.mock.calls[0][0];
        // localDraftCanOverrideSaved=false → 空ドラフトが適用される
        const appliedNames = applied.sessionEx ?? [];
        expect(Array.isArray(appliedNames) ? appliedNames.length : 0).toBe(0);
    });

    test('a-追記: localHasMoreExercises は localDraftCanOverrideSaved=false で阻まれる（先行ガード検証）', () => {
        const { withDraftDateMeta } = require('../../utils/appHelpers');

        // localHasMoreExercises が sessionEx 数で true になっても
        // hasUnsavedChanges:false → localDraftCanOverrideSaved=false が先行するため
        // shouldUseLocalDraft は true にならない。
        // これが localHasMoreExercises が削除済み種目を復活させない主因。
        const draftWithExercisesButNotUnsaved = withDraftDateMeta(DATE, {
            sessionEx: makePlanExercises(['ベンチプレス', 'スクワット', 'ラットプルダウン', 'デッドリフト', 'ショルダープレス']),
            logData: {},
            exerciseUnits: {},
            todayLabels: [],
        }, { source: 'date_delete', hasUnsavedChanges: false });

        const h = makeHarness({
            savedWorkout: null,
            localDraft: draftWithExercisesButNotUnsaved,
            persistentDeleted: { [DATE]: new Date().toISOString() },
        });

        h.logForDate(DATE);

        const applied = h.applyLogDraftState.mock.calls[0][0];
        const appliedNames = applied.sessionEx ?? [];
        // hasUnsavedChanges:false なので localDraftCanOverrideSaved=false → 種目は復活しない
        expect(Array.isArray(appliedNames) ? appliedNames.length : 0).toBe(0);
    });

    test('b. 同一デバイスでの部分削除後: ローカルドラフトは削除後の2種目のみ（5種目は復活しない）', () => {
        const { withDraftDateMeta } = require('../../utils/appHelpers');

        // 同一デバイスで5種目→2種目に部分削除した後の状態:
        //   - Supabase: 2種目
        //   - local: 2種目（削除結果がドラフトに書き込まれている）
        //   - source: "useWorkoutLog:exercise_delete", hasUnsavedChanges: true
        const deletionDraft = withDraftDateMeta(DATE, {
            sessionEx: [
                { name: 'チェストプレス', bodyPart: '胸', label: '胸', order: 0 },
                { name: 'レッグプレス', bodyPart: '脚', label: '脚', order: 1 },
            ],
            logData: {
                'チェストプレス': [{ weight: '60', reps: '10', unit: 'kg' }],
                'レッグプレス': [{ weight: '80', reps: '10', unit: 'kg' }],
            },
            exerciseUnits: {},
            todayLabels: ['胸', '脚'],
        }, { source: 'useWorkoutLog:exercise_delete', hasUnsavedChanges: true });

        const h = makeHarness({
            savedWorkout: { date: DATE, exercises: ['チェストプレス', 'レッグプレス'] },
            localDraft: deletionDraft,
        });

        h.logForDate(DATE);

        const applied = h.applyLogDraftState.mock.calls[0][0];
        const appliedNames = (applied.sessionEx || []).map(e => e.name);

        // 削除後の2種目のみが表示される
        expect(appliedNames.length).toBe(2);
        expect(appliedNames).toContain('チェストプレス');
        expect(appliedNames).toContain('レッグプレス');
        // 削除された3種目は含まれない
        expect(appliedNames).not.toContain('スクワット');
        expect(appliedNames).not.toContain('ラットプルダウン');
        expect(appliedNames).not.toContain('デッドリフト');
    });
});

describe('planStartPath: プラン種目が全て既存にある場合は追加しない', () => {
    beforeEach(() => {
        localStorage.clear();
        const { loadPersistentDeletedDates } = require('../../utils/appHelpers');
        loadPersistentDeletedDates.mockReturnValue({});
    });

    test('全種目重複 → 既存の種目数のまま変わらない', () => {
        const existingExercises = ['ベンチプレス', 'スクワット'];
        const planExercises = makePlanExercises(['ベンチプレス', 'スクワット']);

        const h = makeHarness({
            savedWorkout: { date: DATE, exercises: existingExercises },
            localDraft: null,
        });

        h.logForDateWithPlan(DATE, planExercises, ['胸', '脚']);

        const applied = h.applyLogDraftState.mock.calls[0][0];
        expect(applied.sessionEx.length).toBe(existingExercises.length);
    });
});
