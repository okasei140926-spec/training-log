/**
 * 不変条件6: 同期失敗でキューからエントリが消えない（stalled になる）
 *
 * バグの再現条件:
 *   useHistoryAutoSave.js の failedDates ハンドラで
 *   pendingWorkoutContentChangeDatesRef.current.set(date, {...stalled:true}) の代わりに
 *   .delete(date) を呼ぶと、
 *   ネットワーク復帰後にキューが空になって同期が永遠にリトライされなくなる。
 *
 * テスト有効性の証明手順（手動):
 *   1. このテストが緑であることを確認
 *   2. useHistoryAutoSave.js L282-297 の
 *        pendingWorkoutContentChangeDatesRef.current.set(date, {
 *            ..._existingEntry,
 *            stalled: true,
 *            stalledAt: Date.now(),
 *        });
 *      を
 *        pendingWorkoutContentChangeDatesRef.current.delete(date);
 *      に書き換える
 *   3. このテストが赤になることを確認
 *   4. 元に戻す → 再び緑
 */

// ── jest.mock はホイストされるため最上部に置く ─────────────────────────────

jest.mock('../../utils/supabase', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                eq: () => ({
                    gte: () => ({
                        order: () => ({
                            limit: () => Promise.resolve({ data: [], error: null }),
                        }),
                    }),
                }),
            }),
        }),
    },
}));

jest.mock('../../features/workout/workoutRepository', () => ({
    fetchWorkoutRows: () => Promise.resolve({ rows: [], error: null }),
}));

jest.mock('../../features/workout/workoutDraftStore', () => ({
    ...jest.requireActual('../../features/workout/workoutDraftStore'),
    makeVerifiedWorkoutDraft: () => ({
        hasSavedWorkout: false,
        sessionEx: [],
        logData: {},
        exerciseUnits: {},
        meta: { hasUnsavedChanges: false, source: 'save_verified', date: '2024-01-15' },
    }),
}));

jest.mock('../../utils/writeTrace', () => ({
    logWriteTrace: jest.fn(),
    trackRestoreAttempt: jest.fn().mockReturnValue({ count: 1, blocked: 0, applied: 1 }),
    wpCountExercisesFromHistory: jest.fn().mockReturnValue(0),
    wpCountSetsFromHistory: jest.fn().mockReturnValue(0),
}));

// useHistorySync の定数だけ取り出す（supabase を使うため本体はモック）
jest.mock('../../hooks/useHistorySync', () => ({
    REMOTE_HISTORY_SESSION_LOOKBACK_DAYS: 180,
    REMOTE_HISTORY_SESSION_LIMIT: 1000,
    INITIAL_HOME_HISTORY_LOOKBACK_DAYS: 90,
    INITIAL_HOME_HISTORY_LIMIT: 1000,
    HISTORY_RECOVERY_LIMIT: 500,
}));

jest.mock('../../utils/workoutTimer', () => ({
    getWorkoutTimerPersistence: jest.fn().mockReturnValue(null),
}));

// ── テスト本体 ────────────────────────────────────────────────────────────────

import { renderHook, act, waitFor } from '@testing-library/react';
import { useHistoryAutoSave } from '../../hooks/useHistoryAutoSave';

const DATE = '2024-01-15';
const USER_ID = 'test-user-inv6';

/** useHistoryAutoSave に渡す最小限の props を組み立てる */
function makeAutoSaveProps({
    pendingWorkoutContentChangeDatesRef,
    syncWorkoutRowsForDates,
    forceSyncVersion = 0,
} = {}) {
    return {
        history: {},
        user: { id: USER_ID },
        historySyncReady: true,
        historyRemoteReady: true,
        historyDisplayFromCache: false,
        persistHistoryForUser: jest.fn(),
        logDate: '2099-01-01',
        screen: 'log',
        clearSyncFailure: jest.fn(),
        getCurrentHistoryDeleteMarkers: jest.fn().mockReturnValue({}),
        historyRevisionRef: { current: 0 },
        historySaveQueueRef: { current: Promise.resolve() },
        latestUserIdRef: { current: USER_ID },
        latestHistoryRef: { current: {} },
        latestLogDraftRef: { current: null },
        pendingWorkoutContentChangeDatesRef,
        pendingWorkoutSessionSyncDatesRef: { current: new Set() },
        pendingWorkoutNotificationRef: { current: null },
        explicitWorkoutEditDatesRef: { current: new Map() },
        workoutsDataHistoryRef: { current: {} },
        workoutTimerStateRef: { current: null },
        historyRemoteLoadFailedRef: { current: false },
        recordSyncFailure: jest.fn(),
        refreshHistorySyncDiagnostic: jest.fn().mockResolvedValue({}),
        hasRemoteWorkoutForDate: jest.fn().mockReturnValue(false),
        savedWorkoutDurationSecByDate: {},
        syncWorkoutSessionSnapshot: jest.fn().mockResolvedValue({ skipped: false }),
        syncWorkoutRowsForDates,
        cleanupWorkoutSessionsForHistory: jest.fn().mockResolvedValue({}),
        applyTrustedSessionRowsSnapshot: jest.fn(),
        applyTrustedWorkoutRowsSnapshot: jest.fn(),
        applyWorkoutsDataHistorySnapshot: jest.fn().mockReturnValue(false),
        workoutFinishedAt: null,
        workoutIsFinished: false,
        workoutLastActivityAt: null,
        workoutStartedAt: null,
        workoutStartedForDate: null,
        applyLocalHistoryDates: jest.fn().mockReturnValue({}),
        applyLogDraftState: jest.fn(),
        loadDraftForDate: jest.fn().mockReturnValue(null),
        saveDraftForDate: jest.fn(),
        clearDraftForDate: jest.fn(),
        clearLastActiveExerciseForDate: jest.fn(),
        setHistory: jest.fn(),
        setSessionSyncVersion: jest.fn(),
        forceSyncVersion,
        invalidateSupabaseFetchFreshByPrefix: jest.fn(),
    };
}

describe('不変条件6: 同期失敗でキューからエントリが消えない', () => {
    test(
        'syncWorkoutRowsForDates が 3 回失敗するとエントリが stalled になりキューに残る',
        async () => {
            // ── Arrange ──────────────────────────────────────────────────────
            const pendingWorkoutContentChangeDatesRef = { current: new Map() };
            pendingWorkoutContentChangeDatesRef.current.set(DATE, {
                explicitEdit: true,
                reason: 'history_record_edit',
                updatedAt: new Date().toISOString(),
            });

            // syncWorkoutRowsForDates は常に failedDates を返す（ネットワーク障害）
            const syncWorkoutRowsForDates = jest.fn().mockResolvedValue({
                failedDates: [DATE],
                skippedDates: [],
                heldDates: [],
            });

            const initialProps = makeAutoSaveProps({
                pendingWorkoutContentChangeDatesRef,
                syncWorkoutRowsForDates,
                forceSyncVersion: 0,
            });

            const { rerender } = renderHook(
                (props) => useHistoryAutoSave(props),
                { initialProps }
            );

            // ── Act ──────────────────────────────────────────────────────────
            // 初回レンダリングで Cycle 1 が起動する（count=1）
            // forceSyncVersion を変えると Cycle 2、Cycle 3 がトリガーされる
            await act(async () => {
                rerender({ ...initialProps, forceSyncVersion: 1 });
            });
            await act(async () => {
                rerender({ ...initialProps, forceSyncVersion: 2 });
            });

            // 非同期チェーンが完了するまで待機
            await waitFor(
                () => {
                    const entry = pendingWorkoutContentChangeDatesRef.current.get(DATE);
                    expect(entry?.stalled).toBe(true);
                },
                { timeout: 5000 }
            );

            // ── Assert ───────────────────────────────────────────────────────
            // エントリはキューに残っている（delete されていない）
            expect(pendingWorkoutContentChangeDatesRef.current.has(DATE)).toBe(true);

            // stalled: true になっている
            const entry = pendingWorkoutContentChangeDatesRef.current.get(DATE);
            expect(entry?.stalled).toBe(true);
            expect(entry?.stalledAt).toBeGreaterThan(0);
        }
    );
});
