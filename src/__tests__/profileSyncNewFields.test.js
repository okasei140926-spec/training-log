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
        const setWeeklySetTargets = jest.fn();
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
        const setWeeklySetTargets = jest.fn();
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
        const setWeeklySetTargets = jest.fn();
        const { result } = renderHook(() =>
            useWeeklySetTargetsSync({ userId: 'user-789', setWeeklySetTargets })
        );

        await act(async () => { await result.current.flush(); });

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
        const setWeeklySetTargets = jest.fn();
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
        const setWeeklySetTargets = jest.fn();
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
        const setWeeklySetTargets = jest.fn();
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
        const setWeeklySetTargets = jest.fn();
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
