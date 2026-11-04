/**
 * useProfileSync の新3項目テスト
 *
 * テスト対象:
 *   resolveNewSyncFields (hooks/useProfileSync.js)
 *   useWeeklySetTargetsSync (hooks/useWeeklySetTargetsSync.js)
 *
 * 背景:
 *   profiles テーブルに custom_split_sequence / week_start_day / weekly_set_targets
 *   を追加し、端末間で設定を同期するようにした。
 *
 * テストできていること:
 *   - 解決ルール3パターン（profiles優先 / localStorage優先+書き戻し / 両方null）×3項目
 *   - weekly_set_targets の {} が「値なし」扱いされないこと
 *   - デバウンスが flush されること（保留中の変更が失われないこと）
 *   - 送信ペイロードに未知のキーが混入しないこと
 *
 * テストできていないこと:
 *   - useProfileSync フック全体の統合動作（Supabase SELECT → apply まで）
 *   - handleSaveWeekStartDay / handleSaveCustomSplit の Supabase 書き込み
 *     → App.jsx の useCallback 内であり renderHook なしでは単体テストできない
 */

jest.mock('../utils/supabase', () => {
    const mockEq = jest.fn().mockResolvedValue({ error: null, count: 1 });
    const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq });
    const mockFrom = jest.fn().mockReturnValue({ update: mockUpdate });
    return {
        supabase: { from: mockFrom },
        supabaseConfigError: null,
        __mockFrom: mockFrom,
        __mockUpdate: mockUpdate,
        __mockEq: mockEq,
    };
});

// helpers は save/load を実際に使う（jest.mock しない）
jest.mock('../utils/generateOnboardingPlan', () => ({
    buildMuscleExFromAnswers: jest.fn(() => ({})),
    buildPlanDaySequence: jest.fn(() => []),
    getSplitTypeFromPreference: jest.fn(() => "fullbody"),
    getNextPlanDayIndex: jest.fn(() => 0),
    determineSplitType: jest.fn(() => "fullbody"),
}));

import { resolveNewSyncFields } from '../hooks/useProfileSync';
import { renderHook, act } from '@testing-library/react';
import { useWeeklySetTargetsSync } from '../hooks/useWeeklySetTargetsSync';

// handleSave は setWeeklySetTargets を updater 形式で呼ぶ。
// jest.fn() だと updater が実行されず pendingRef.current が設定されないため、
// 実際に state を更新するスマートモックを使う。
const makeStateMock = (initial = {}) => {
    let state = initial;
    return jest.fn((updaterOrValue) => {
        state = typeof updaterOrValue === "function" ? updaterOrValue(state) : updaterOrValue;
    });
};

// ── resolveNewSyncFields のテスト ──────────────────────────────────────────

const EXPECTED_UPLOAD_KEYS = new Set([
    "custom_split_sequence",
    "week_start_day",
    "weekly_set_targets",
]);

// 「変更なし（conflict なし）」の標準 snapshot/current セット
const noConflictBase = {
    snapshotCustomSplit:      null,
    currentCustomSplit:       null,
    snapshotWeekStartDay:     null,
    currentWeekStartDay:      null,
    snapshotWeeklySetTargets: null,
    currentWeeklySetTargets:  null,
};

describe('resolveNewSyncFields: custom_split_sequence', () => {
    const seq = [{ label: "A", bodyParts: ["胸", "肩"] }];

    test('profiles 優先 — DB に値あり → localUpdates に追加', () => {
        const { localUpdates, uploadPayload } = resolveNewSyncFields({
            ...noConflictBase,
            data: { custom_split_sequence: seq, week_start_day: null, weekly_set_targets: null },
        });
        expect(localUpdates.customSplitSequence).toEqual(seq);
        expect(uploadPayload.custom_split_sequence).toBeUndefined();
    });

    test('localStorage 優先 — DB null、ローカルに値あり → uploadPayload に追加', () => {
        const { localUpdates, uploadPayload } = resolveNewSyncFields({
            ...noConflictBase,
            currentCustomSplit: seq,
            data: { custom_split_sequence: null, week_start_day: null, weekly_set_targets: null },
        });
        expect(uploadPayload.custom_split_sequence).toEqual(seq);
        expect(localUpdates.customSplitSequence).toBeUndefined();
    });

    test('両方 null → 何もしない', () => {
        const { localUpdates, uploadPayload } = resolveNewSyncFields({
            ...noConflictBase,
            data: { custom_split_sequence: null, week_start_day: null, weekly_set_targets: null },
        });
        expect(localUpdates.customSplitSequence).toBeUndefined();
        expect(uploadPayload.custom_split_sequence).toBeUndefined();
    });

    test('競合: SELECT 中にユーザーが変更 → スキップ', () => {
        const seqOld = [{ label: "B" }];
        const seqNew = [{ label: "C" }];
        const { localUpdates, uploadPayload } = resolveNewSyncFields({
            ...noConflictBase,
            snapshotCustomSplit: seqOld,  // 変更前
            currentCustomSplit:  seqNew,  // 変更後（ユーザーが変更）
            data: { custom_split_sequence: seq, week_start_day: null, weekly_set_targets: null },
        });
        expect(localUpdates.customSplitSequence).toBeUndefined();
        expect(uploadPayload.custom_split_sequence).toBeUndefined();
    });
});

describe('resolveNewSyncFields: week_start_day', () => {
    test('profiles 優先 — DB=0（日曜）→ localUpdates に追加', () => {
        const { localUpdates, uploadPayload } = resolveNewSyncFields({
            ...noConflictBase,
            currentWeekStartDay: 1,  // ローカルは月曜
            data: { custom_split_sequence: null, week_start_day: 0, weekly_set_targets: null },
        });
        expect(localUpdates.weekStartDay).toBe(0);
        expect(uploadPayload.week_start_day).toBeUndefined();
    });

    test('localStorage 優先 — DB null、ローカル=1 → uploadPayload に追加', () => {
        const { localUpdates, uploadPayload } = resolveNewSyncFields({
            ...noConflictBase,
            currentWeekStartDay: 1,
            data: { custom_split_sequence: null, week_start_day: null, weekly_set_targets: null },
        });
        expect(uploadPayload.week_start_day).toBe(1);
        expect(localUpdates.weekStartDay).toBeUndefined();
    });

    test('両方 null → 何もしない', () => {
        const { localUpdates, uploadPayload } = resolveNewSyncFields({
            ...noConflictBase,
            data: { custom_split_sequence: null, week_start_day: null, weekly_set_targets: null },
        });
        expect(localUpdates.weekStartDay).toBeUndefined();
        expect(uploadPayload.week_start_day).toBeUndefined();
    });

    test('DB と localStorage が同じ値 → localUpdates に追加されない', () => {
        // 値は同じなので上書き不要
        const { localUpdates } = resolveNewSyncFields({
            ...noConflictBase,
            currentWeekStartDay: 1,
            data: { custom_split_sequence: null, week_start_day: 1, weekly_set_targets: null },
        });
        expect(localUpdates.weekStartDay).toBeUndefined();
    });
});

describe('resolveNewSyncFields: weekly_set_targets', () => {
    const targets = { 胸: 12, 背中: 14 };

    test('profiles 優先 — DB に値あり → localUpdates に追加', () => {
        const { localUpdates, uploadPayload } = resolveNewSyncFields({
            ...noConflictBase,
            data: { custom_split_sequence: null, week_start_day: null, weekly_set_targets: targets },
        });
        expect(localUpdates.weeklySetTargets).toEqual(targets);
        expect(uploadPayload.weekly_set_targets).toBeUndefined();
    });

    test('localStorage 優先 — DB null、ローカルに値あり → uploadPayload に追加', () => {
        const { localUpdates, uploadPayload } = resolveNewSyncFields({
            ...noConflictBase,
            currentWeeklySetTargets: targets,
            data: { custom_split_sequence: null, week_start_day: null, weekly_set_targets: null },
        });
        expect(uploadPayload.weekly_set_targets).toEqual(targets);
        expect(localUpdates.weeklySetTargets).toBeUndefined();
    });

    test('両方 null → 何もしない', () => {
        const { localUpdates, uploadPayload } = resolveNewSyncFields({
            ...noConflictBase,
            data: { custom_split_sequence: null, week_start_day: null, weekly_set_targets: null },
        });
        expect(localUpdates.weeklySetTargets).toBeUndefined();
        expect(uploadPayload.weekly_set_targets).toBeUndefined();
    });

    test('{} は「値なし」ではなく「全部外した状態」 — ローカル {} → uploadPayload に追加される', () => {
        // {} を null 扱いにするとユーザーが全部外した設定が復元できなくなる
        const { uploadPayload } = resolveNewSyncFields({
            ...noConflictBase,
            currentWeeklySetTargets: {},
            data: { custom_split_sequence: null, week_start_day: null, weekly_set_targets: null },
        });
        expect(uploadPayload.weekly_set_targets).toEqual({});
    });

    test('{} は「値なし」ではなく「全部外した状態」 — DB {} → localUpdates に追加される', () => {
        const { localUpdates } = resolveNewSyncFields({
            ...noConflictBase,
            data: { custom_split_sequence: null, week_start_day: null, weekly_set_targets: {} },
        });
        expect(localUpdates.weeklySetTargets).toEqual({});
    });
});

describe('resolveNewSyncFields: 送信ペイロードに未知のキーが混入しないこと', () => {
    test('uploadPayload のキーは expected set の部分集合', () => {
        const { uploadPayload } = resolveNewSyncFields({
            ...noConflictBase,
            currentCustomSplit:      [{ label: "A" }],
            currentWeekStartDay:     1,
            currentWeeklySetTargets: { 胸: 10 },
            data: {
                custom_split_sequence: null,
                week_start_day:        null,
                weekly_set_targets:    null,
            },
        });
        for (const key of Object.keys(uploadPayload)) {
            expect(EXPECTED_UPLOAD_KEYS.has(key)).toBe(true);
        }
    });

    test('localUpdates のキーは expected set の部分集合', () => {
        const { localUpdates } = resolveNewSyncFields({
            ...noConflictBase,
            data: {
                custom_split_sequence: [{ label: "A" }],
                week_start_day:        0,
                weekly_set_targets:    { 胸: 10 },
            },
        });
        const expectedLocalKeys = new Set(["customSplitSequence", "weekStartDay", "weeklySetTargets"]);
        for (const key of Object.keys(localUpdates)) {
            expect(expectedLocalKeys.has(key)).toBe(true);
        }
    });
});

// ── useWeeklySetTargetsSync のテスト ───────────────────────────────────────

describe('useWeeklySetTargetsSync: デバウンスと flush', () => {
    // supabase モックを取得
    const { __mockFrom, __mockUpdate, __mockEq } = jest.requireMock('../utils/supabase');

    beforeEach(() => {
        jest.useFakeTimers();
        // clearAllMocks が mockReturnValue をリセットする場合があるため毎回再設定
        __mockEq.mockResolvedValue({ error: null, count: 1 });
        __mockUpdate.mockReturnValue({ eq: __mockEq });
        __mockFrom.mockReturnValue({ update: __mockUpdate });
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    test('flush: handleSave 後にタイマーが発火する前に flush → Supabase に送信される', async () => {
        const setWeeklySetTargets = makeStateMock({});
        const userId = 'user-123';
        const { result } = renderHook(() =>
            useWeeklySetTargetsSync({ userId, setWeeklySetTargets })
        );

        const targets = { 胸: 12, 背中: 14 };
        act(() => { result.current.handleSave(targets); });
        // タイマーはまだ発火していない
        expect(__mockFrom).not.toHaveBeenCalled();

        // flush を呼ぶ
        await act(async () => { await result.current.flush(); });

        expect(__mockFrom).toHaveBeenCalledWith("profiles");
        expect(__mockUpdate).toHaveBeenCalledWith(
            { weekly_set_targets: targets },
            { count: "exact" }
        );
        expect(__mockEq).toHaveBeenCalledWith("id", userId);
    });

    test('flush: 複数回 handleSave → flush は最後の値を送信する', async () => {
        const setWeeklySetTargets = makeStateMock({});
        const { result } = renderHook(() =>
            useWeeklySetTargetsSync({ userId: 'user-456', setWeeklySetTargets })
        );

        act(() => { result.current.handleSave({ 胸: 10 }); });
        act(() => { result.current.handleSave({ 胸: 11 }); });
        act(() => { result.current.handleSave({ 胸: 12 }); });

        await act(async () => { await result.current.flush(); });

        // 最後の値だけが送信される
        expect(__mockUpdate).toHaveBeenCalledTimes(1);
        expect(__mockUpdate).toHaveBeenCalledWith(
            { weekly_set_targets: { 胸: 12 } },
            { count: "exact" }
        );
    });

    test('flush: handleSave を呼ばずに flush → Supabase に送信されない', async () => {
        const setWeeklySetTargets = makeStateMock({});
        const { result } = renderHook(() =>
            useWeeklySetTargetsSync({ userId: 'user-789', setWeeklySetTargets })
        );

        await act(async () => { await result.current.flush(); });

        expect(__mockFrom).not.toHaveBeenCalled();
    });

    // ── ペイロード内容の検証（バグ修正: handleSave が updater 関数を解決しなかった問題） ──
    //
    // 修正前の状態:
    //   SettingsModal.jsx が setWeeklySetTargets?.((prev) => ({...})) と呼ぶ
    //   → handleSave は関数を受け取り pendingRef.current に関数を格納
    //   → flush は { weekly_set_targets: [Function] } を送信
    //   → JSON.stringify で関数は消え {} になり PostgREST は 204 を返す（空更新）
    //
    // 修正後: handleSave が setWeeklySetTargets((prev) => {...}) 形式で呼ぶことで
    //   updater 関数を解決し、resolved な値を pendingRef.current に格納する
    //   SettingsModal は updater 形式のまま（連打時の累積を担保するため変更しない）

    test('handleSave に渡したオブジェクトが Supabase の weekly_set_targets に格納される', async () => {
        const setWeeklySetTargets = makeStateMock({});
        const { result } = renderHook(() =>
            useWeeklySetTargetsSync({ userId: 'payload-check', setWeeklySetTargets })
        );

        const targets = { 胸: 12, 背中: 14, 脚: 10 };
        act(() => { result.current.handleSave(targets); });
        await act(async () => { await result.current.flush(); });

        const payload = __mockUpdate.mock.calls[0][0];
        // weekly_set_targets がオブジェクトであること（関数・undefined ではないこと）
        expect(typeof payload.weekly_set_targets).toBe('object');
        expect(payload.weekly_set_targets).toEqual(targets);
        // JSON.stringify で空にならないこと（関数/undefined は stringify すると {} になる）
        expect(JSON.stringify(payload.weekly_set_targets)).not.toBe('{}');
    });

    test('handleSave に updater 関数を渡したとき、解決後のオブジェクトが Supabase ペイロードに入る', async () => {
        // SettingsModal は (prev) => ({...prev, [bp]: next}) 形式で呼ぶ。
        // handleSave が updater 関数を解決しなければ pendingRef.current に関数が入り
        // flush 時に {} が送信される（バグ）。
        const setWeeklySetTargets = makeStateMock({ 胸: 10 });
        const { result } = renderHook(() =>
            useWeeklySetTargetsSync({ userId: 'updater-check', setWeeklySetTargets })
        );

        const updater = (prev) => ({ ...prev, 胸: (prev['胸'] ?? 10) + 1 });
        act(() => { result.current.handleSave(updater); });
        await act(async () => { await result.current.flush(); });

        const payload = __mockUpdate.mock.calls[0][0];
        // 関数ではなくオブジェクトが格納されること
        expect(typeof payload.weekly_set_targets).toBe('object');
        expect(payload.weekly_set_targets).toEqual({ 胸: 11 });
        // JSON.stringify で空にならないこと
        expect(JSON.stringify(payload.weekly_set_targets)).not.toBe('{}');
    });

    test('連打: updater 関数で 3 回 handleSave → 累積した値が Supabase に送信される', async () => {
        // 連打（+1 を 3 回）しても、makeStateMock が updater を実行するため
        // pendingRef.current には最終累積値が入る。
        // SettingsModal が updater 形式を維持している理由: 連打時の累積を担保するため。
        const setWeeklySetTargets = makeStateMock({ 胸: 10 });
        const { result } = renderHook(() =>
            useWeeklySetTargetsSync({ userId: 'rapid-click', setWeeklySetTargets })
        );

        const inc = (prev) => ({ ...prev, 胸: (prev['胸'] ?? 10) + 1 });
        act(() => { result.current.handleSave(inc); });
        act(() => { result.current.handleSave(inc); });
        act(() => { result.current.handleSave(inc); });

        await act(async () => { await result.current.flush(); });

        expect(__mockUpdate).toHaveBeenCalledTimes(1);
        expect(__mockUpdate).toHaveBeenCalledWith(
            { weekly_set_targets: { 胸: 13 } },
            { count: "exact" }
        );
    });

    test('handleSave に undefined を渡した後 flush → Supabase に送信されない（== null ガード）', async () => {
        // pending == null は null と undefined を両方弾く。
        // === null のままだと undefined !== null になりガードを通過してしまう。
        const setWeeklySetTargets = makeStateMock({});
        const { result } = renderHook(() =>
            useWeeklySetTargetsSync({ userId: 'undef-guard', setWeeklySetTargets })
        );

        // undefined を渡すと pendingRef.current = undefined になる
        act(() => { result.current.handleSave(undefined); });
        await act(async () => { await result.current.flush(); });

        // == null ガードにより Supabase は呼ばれないこと
        expect(__mockFrom).not.toHaveBeenCalled();
    });
});

// ── useWeeklySetTargetsSync: 画面離脱イベントで flush ─────────────────────────

describe('useWeeklySetTargetsSync: 画面離脱イベントで flush', () => {
    const { __mockFrom, __mockUpdate, __mockEq } = jest.requireMock('../utils/supabase');

    beforeEach(() => {
        jest.useFakeTimers();
        __mockEq.mockResolvedValue({ error: null, count: 1 });
        __mockUpdate.mockReturnValue({ eq: __mockEq });
        __mockFrom.mockReturnValue({ update: __mockUpdate });
        // jsdom のデフォルトは 'visible' に戻す
        Object.defineProperty(document, 'visibilityState', {
            value: 'visible', configurable: true, writable: true,
        });
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
        Object.defineProperty(document, 'visibilityState', {
            value: 'visible', configurable: true, writable: true,
        });
    });

    test('visibilitychange(hidden) で flush が走る', async () => {
        const setWeeklySetTargets = makeStateMock({});
        const { result } = renderHook(() =>
            useWeeklySetTargetsSync({ userId: 'ev-user-1', setWeeklySetTargets })
        );

        act(() => { result.current.handleSave({ 胸: 10 }); });
        expect(__mockFrom).not.toHaveBeenCalled();

        await act(async () => {
            Object.defineProperty(document, 'visibilityState', {
                value: 'hidden', configurable: true, writable: true,
            });
            document.dispatchEvent(new Event('visibilitychange'));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(__mockFrom).toHaveBeenCalledWith('profiles');
        expect(__mockUpdate).toHaveBeenCalledWith(
            { weekly_set_targets: { 胸: 10 } },
            { count: "exact" }
        );
    });

    test('visibilitychange(visible) では flush しない', async () => {
        const setWeeklySetTargets = makeStateMock({});
        renderHook(() =>
            useWeeklySetTargetsSync({ userId: 'ev-user-2', setWeeklySetTargets })
        );

        await act(async () => {
            // visibilityState は 'visible' のまま
            document.dispatchEvent(new Event('visibilitychange'));
            await Promise.resolve();
        });

        expect(__mockFrom).not.toHaveBeenCalled();
    });

    test('pagehide で flush が走る', async () => {
        const setWeeklySetTargets = makeStateMock({});
        const { result } = renderHook(() =>
            useWeeklySetTargetsSync({ userId: 'ev-user-3', setWeeklySetTargets })
        );

        act(() => { result.current.handleSave({ 背中: 14 }); });
        expect(__mockFrom).not.toHaveBeenCalled();

        await act(async () => {
            window.dispatchEvent(new Event('pagehide'));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(__mockFrom).toHaveBeenCalledWith('profiles');
        expect(__mockUpdate).toHaveBeenCalledWith(
            { weekly_set_targets: { 背中: 14 } },
            { count: "exact" }
        );
    });

    test('アンマウント時に flush が走る', async () => {
        const setWeeklySetTargets = makeStateMock({});
        const { result, unmount } = renderHook(() =>
            useWeeklySetTargetsSync({ userId: 'ev-user-4', setWeeklySetTargets })
        );

        act(() => { result.current.handleSave({ 肩: 8 }); });
        expect(__mockFrom).not.toHaveBeenCalled();

        await act(async () => {
            unmount();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(__mockFrom).toHaveBeenCalledWith('profiles');
        expect(__mockUpdate).toHaveBeenCalledWith(
            { weekly_set_targets: { 肩: 8 } },
            { count: "exact" }
        );
    });
});
