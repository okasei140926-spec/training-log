/**
 * Gate A テスト
 *
 * Gate A: useHistoryHandlers.js の handleLogForDate 内、shouldUseLocalDraft ブランチの後に位置する。
 * persistentDeletedDates に載っている日付へのナビゲート時に、Supabase の保存済みコンテンツが
 * 復元されることを防ぐ。
 *
 * 発動条件:
 *   1. persistentDeletedDates[requestedDate] が存在する
 *   2. pendingChange が null（再入力中でない）
 *      OR pendingChange が「全日付削除」の pending（explicitDelete:true && deleteScope:"date"）
 *   3. isUnsavedUserWorkoutDraft(draftForDate) が false
 *      （ユーザーが実際にタイプした内容がない）
 *
 * スキップ条件（Gate A が動かないケース）:
 *   (i)  shouldUseLocalDraft=true → Gate A 到達前に early return
 *   (ii) pendingChange が存在し、かつ全日付削除でない（再入力中）
 *   (iii) isUnsavedUserWorkoutDraft(draftForDate) = true（ユーザーが実際に入力した）
 *
 * 修正箇所を潰す手順（mutation test）:
 *   useHistoryHandlers.js line 180 の
 *     `?? null` を `|| {}` に戻すと
 *   "Gate A が発火して空が適用される" ケースが FAIL する。
 *   （{} が truthy → _hasPendingUserEdit が常に true → Gate A 常にスキップ）
 */

// ── jest.mock はホイストされるため最上部に置く ──────────────────────────────

jest.mock('../utils/appHelpers', () => ({
    ...jest.requireActual('../utils/appHelpers'),
    loadPersistentDeletedDates: jest.fn().mockReturnValue({}),
    addPersistentDeletedDate: jest.fn(),
    removePersistentDeletedDate: jest.fn(),
}));

jest.mock('../utils/writeTrace', () => ({
    logWriteTrace: jest.fn(),
}));

import { makeHarness } from '../testUtils/savePathHarness';
import { withDraftDateMeta } from '../utils/appHelpers';

const DATE = '2026-11-10'; // テスト用の日付（今日でも今後でもない）
const DELETED_AT = '2026-11-01T00:00:00.000Z';

const makeDeletionDraft = () => withDraftDateMeta(DATE, {
    sessionEx: [],
    logData: {},
    exerciseUnits: {},
    todayLabels: [],
}, { source: 'date_delete', hasUnsavedChanges: false });

const makeUnsavedUserDraft = () => withDraftDateMeta(DATE, {
    sessionEx: [{ name: 'ベンチプレス', bodyPart: '胸', label: '胸', order: 0 }],
    logData: { 'ベンチプレス': [{ weight: '60', reps: '10', unit: 'kg' }] },
    exerciseUnits: {},
    todayLabels: ['胸'],
}, { source: 'useWorkoutLog:set_add', hasUnsavedChanges: true });

beforeEach(() => {
    localStorage.clear();
    const { loadPersistentDeletedDates } = require('../utils/appHelpers');
    loadPersistentDeletedDates.mockReturnValue({});
});

// ─────────────────────────────────────────────────────────────
// 1. Gate A が発火するケース
//    削除済み日付に pending change なし、unsaved draft なし、Supabase には記録あり
//    → 保存済みコンテンツではなく空ドラフトが適用される
// ─────────────────────────────────────────────────────────────

describe('Gate A: 削除済み日付で pending なし → 空が適用される', () => {
    test('Supabase に記録があっても Gate A が空ドラフトを返す', () => {
        // この状況: 削除は完了してキューが空になったが
        // Supabase 側にはまだデータが残っている（遅延削除 or エラー）
        const h = makeHarness({
            savedWorkout: { date: DATE, exercises: ['ベンチプレス', 'スクワット'] },
            localDraft: makeDeletionDraft(),       // deleteAllHistoryForDate が書いた削除後ドラフト
            persistentDeleted: { [DATE]: DELETED_AT },
            // pendingChange: 指定なし（Map に値なし → null）
        });

        h.logForDate(DATE);

        const applied = h.applyLogDraftState.mock.calls[0][0];
        const appliedNames = applied.sessionEx ?? [];
        // Gate A が発火 → 空ドラフト
        expect(Array.isArray(appliedNames) ? appliedNames.length : 0).toBe(0);
    });

    test('localDraft が空であっても Gate A が空ドラフトを返す', () => {
        const h = makeHarness({
            savedWorkout: { date: DATE, exercises: ['デッドリフト'] },
            localDraft: null,
            persistentDeleted: { [DATE]: DELETED_AT },
        });

        h.logForDate(DATE);

        const applied = h.applyLogDraftState.mock.calls[0][0];
        const appliedNames = applied.sessionEx ?? [];
        expect(Array.isArray(appliedNames) ? appliedNames.length : 0).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────
// 2. Gate A がスキップされるケース (i): pending change あり（再入力中）
//    _hasPendingUserEdit = true → Gate A をスキップ → Supabase 記録が復元される
// ─────────────────────────────────────────────────────────────

describe('Gate A: 再入力中（pending change あり）→ Gate A スキップ', () => {
    test('explicitEdit:true の pending change があると Supabase 記録が復元される', () => {
        // ユーザーが削除後に再度トレーニングを始めた：
        // pendingWorkoutContentChangeDatesRef に explicitEdit:true が入っている状態
        const h = makeHarness({
            savedWorkout: { date: DATE, exercises: ['ベンチプレス', 'スクワット'] },
            localDraft: null,
            persistentDeleted: { [DATE]: DELETED_AT },
            pendingChange: { date: DATE, explicitEdit: true, explicitDelete: false },
        });

        h.logForDate(DATE);

        const applied = h.applyLogDraftState.mock.calls[0][0];
        const appliedNames = (applied.sessionEx || []).map(e => e.name);
        // Gate A スキップ → shouldUseSavedWorkout=true → Supabase 記録が表示される
        expect(appliedNames).toContain('ベンチプレス');
        expect(appliedNames).toContain('スクワット');
        expect(appliedNames.length).toBe(2);
    });

    test('全日付削除 pending（explicitDelete:true, deleteScope:date）では Gate A が発火する', () => {
        // 削除がまだ sync 中（pending queue に削除インテントが残っている）
        // この場合は _hasPendingUserEdit = false になる（再入力ではなく削除確定中）
        const h = makeHarness({
            savedWorkout: { date: DATE, exercises: ['ベンチプレス'] },
            localDraft: makeDeletionDraft(),
            persistentDeleted: { [DATE]: DELETED_AT },
            pendingChange: { date: DATE, explicitDelete: true, deleteScope: 'date' },
        });

        h.logForDate(DATE);

        const applied = h.applyLogDraftState.mock.calls[0][0];
        const appliedNames = applied.sessionEx ?? [];
        // Gate A 発火 → 空
        expect(Array.isArray(appliedNames) ? appliedNames.length : 0).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────
// 3. Gate A がスキップされるケース (iii): ユーザーが実際に入力済み
//    isUnsavedUserWorkoutDraft = true → Gate A 例外 (ii) → ローカルドラフト適用
// ─────────────────────────────────────────────────────────────

describe('Gate A: ユーザーが実際に入力済み → Gate A スキップ（データ保護）', () => {
    test('source:useWorkoutLog:set_add の unsaved draft は Gate A をスキップして適用される', () => {
        // ユーザーが削除後に再度種目を追加してセットを入力した場合
        // source が "useWorkoutLog:set_add" → isUnsavedUserWorkoutDraft = true
        // → shouldUseLocalDraft = true（localDraftCanOverrideSaved && isUnsavedUserWorkoutDraft）
        // → Gate A 到達前に early return
        const h = makeHarness({
            savedWorkout: null,
            localDraft: makeUnsavedUserDraft(),
            persistentDeleted: { [DATE]: DELETED_AT },
        });

        h.logForDate(DATE);

        const applied = h.applyLogDraftState.mock.calls[0][0];
        const appliedNames = (applied.sessionEx || []).map(e => e.name);
        // ユーザー入力が保護される
        expect(appliedNames).toContain('ベンチプレス');
        expect(appliedNames.length).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────
// 4. 削除されていない日付は Gate A が動かない（通常の復元）
// ─────────────────────────────────────────────────────────────

describe('Gate A: 削除されていない日付 → 通常の restore', () => {
    test('persistentDeleted にない日付は Supabase 記録が通常通り復元される', () => {
        const h = makeHarness({
            savedWorkout: { date: DATE, exercises: ['ラットプルダウン', 'デッドリフト'] },
            localDraft: null,
            persistentDeleted: {},  // 削除なし
        });

        h.logForDate(DATE);

        const applied = h.applyLogDraftState.mock.calls[0][0];
        const appliedNames = (applied.sessionEx || []).map(e => e.name);
        expect(appliedNames).toContain('ラットプルダウン');
        expect(appliedNames).toContain('デッドリフト');
    });
});

// ─────────────────────────────────────────────────────────────
// 5. 削除後にプラン開始 → navigate-back でプランの種目が残る
//    （shouldUseLocalDraft = true via localHasMoreExercises が Gate A の前に返る）
//
//    修正箇所を潰す手順（mutation test）:
//      localHasMoreExercises に `!_persistentDeletedForGuard[requestedDate] &&` を
//      再追加すると、このテストが FAIL する。
//      （削除済み日付では localHasMoreExercises = false → shouldUseLocalDraft = false
//        → Gate A が発火 → 空が適用される）
// ─────────────────────────────────────────────────────────────

describe('Gate A: 削除後プラン開始 → navigate-back でプランの種目が保持される', () => {
    const PLAN_NAMES = ['サイドレイズ', 'フロントレイズ', 'プルダウン'];

    // プラン開始後 → navigate away → localStorage に保存されたドラフトの状態:
    //   source: "explicit_date_nav", hasUnsavedChanges: true, logData: {} (sets未記録)
    // deleteAllHistoryForDate は hasUnsavedChanges:false を書くため、
    // hasUnsavedChanges:true のドラフトは削除後のユーザー操作（プラン開始）によるもの。
    const makePostPlanDraft = () => withDraftDateMeta(DATE, {
        sessionEx: PLAN_NAMES.map((name, i) => ({ name, bodyPart: '肩', label: '肩', order: i })),
        logData: {},
        exerciseUnits: {},
        todayLabels: ['肩'],
    }, { source: 'explicit_date_nav', hasUnsavedChanges: true });

    test('削除後プラン種目（sets未記録）は navigate-back でも消えない', () => {
        // 状態:
        //   - persistentDeletedDates: DATE が入っている
        //   - savedWorkout: null（trustedHistory から削除済み）
        //   - localDraft: plan-start 後のドラフト（hasUnsavedChanges:true）
        //   - pendingChange: なし（sync 完了）
        const h = makeHarness({
            savedWorkout: null,
            localDraft: makePostPlanDraft(),
            persistentDeleted: { [DATE]: new Date().toISOString() },
            // pendingChange: 指定なし
        });

        h.logForDate(DATE);

        const applied = h.applyLogDraftState.mock.calls[0][0];
        const appliedNames = (applied.sessionEx || []).map(e => e.name);

        // プランの種目が保持されること（Gate A がスキップされること）
        expect(appliedNames.length).toBeGreaterThan(0);
        PLAN_NAMES.forEach(name => {
            expect(appliedNames).toContain(name);
        });
    });

    test('削除後アクションなし（plan なし）では Gate A が発火して空が返る', () => {
        // ユーザーが削除後にプランも操作もしていない：
        // localDraft は deleteAllHistoryForDate が書いた hasUnsavedChanges:false のまま
        const deletionDraft = withDraftDateMeta(DATE, {
            sessionEx: [],
            logData: {},
            exerciseUnits: {},
            todayLabels: [],
        }, { source: 'date_delete', hasUnsavedChanges: false });

        const h = makeHarness({
            savedWorkout: { date: DATE, exercises: ['ベンチプレス'] },
            localDraft: deletionDraft,
            persistentDeleted: { [DATE]: new Date().toISOString() },
        });

        h.logForDate(DATE);

        const applied = h.applyLogDraftState.mock.calls[0][0];
        const appliedNames = applied.sessionEx ?? [];
        // Gate A が発火 → Supabase の記録は復活しない
        expect(Array.isArray(appliedNames) ? appliedNames.length : 0).toBe(0);
    });
});
