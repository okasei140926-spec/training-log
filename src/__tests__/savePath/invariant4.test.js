/**
 * 不変条件4: 削除した日に再入力できる（persistentDeletedDates から除去される）
 *
 * バグの再現条件:
 *   useHistorySave.js の markWorkoutContentChanged で
 *   explicitEdit かつ full-date delete ペンディング中でない場合に
 *   removePersistentDeletedDate が呼ばれない場合、
 *   Gate A が永続的に日付をブロックし続けて再入力できなくなる。
 *
 * テスト有効性の証明手順（手動):
 *   1. このテストが緑であることを確認
 *   2. useHistorySave.js L160-170 の
 *        if (explicitEdit && !(explicitDelete === true && deleteScope === "date")) {
 *            ...
 *            removePersistentDeletedDate(_userId, normalizedDate);
 *            ...
 *        }
 *      ブロック全体をコメントアウトする
 *   3. このテストが赤になることを確認
 *   4. 元に戻す → 再び緑
 */

jest.mock('../../utils/supabase', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                eq: () => ({
                    single: () => Promise.resolve({ data: null, error: null }),
                    order: () => ({
                        limit: () => Promise.resolve({ data: [], error: null }),
                    }),
                }),
            }),
        }),
    },
}));

jest.mock('../../features/workout/workoutRepository', () => ({
    fetchWorkoutRowForDate: jest.fn().mockResolvedValue({ data: null, error: null }),
    fetchWorkoutRowFromWorkoutsData: jest.fn().mockReturnValue(null),
    saveWorkoutForDate: jest.fn().mockResolvedValue({ data: null, error: null }),
}));

jest.mock('../../utils/workoutSessions', () => ({
    buildWorkoutSessionPayloadFromHistory: jest.fn().mockReturnValue({}),
}));

jest.mock('../../utils/writeTrace', () => ({
    logWriteTrace: jest.fn(),
    wpCountExercisesFromHistory: jest.fn().mockReturnValue(0),
    wpCountSetsFromHistory: jest.fn().mockReturnValue(0),
}));

jest.mock('../../utils/appHelpers', () => ({
    ...jest.requireActual('../../utils/appHelpers'),
    removePersistentDeletedDate: jest.fn(),
    loadPersistentDeletedDates: jest.fn().mockReturnValue({}),
}));

import { renderHook, act } from '@testing-library/react';
import { useHistorySave } from '../../hooks/useHistorySave';
import {
    EXPLICIT_SET_EDIT_REASONS,
    EXPLICIT_WORKOUT_EDIT_REASONS,
    getRuntimeEnvironmentLabel,
    isExplicitWorkoutEditChange,
    getHistoryMetricsForDate,
    getWorkoutSaveGuardDecision,
    getEmptyWorkoutMetrics,
    getWorkoutSummaryMetrics,
    getWorkoutPayloadMetrics,
    isMetricPersistenceMismatch,
    getHistoryDebugSummaryForDate,
    getHistoryDebugDiffForDate,
    applyPreferredHistoryDates,
    logRecordFetchError,
    logWorkoutPersistenceDecision,
    describeHistoryRecordsForDate,
} from '../../utils/appHelpers';
import {
    mergeHistoryMaps,
    hasValidWorkoutOnDate,
    normalizeExerciseName,
} from '../../utils/helpers';
import { removePersistentDeletedDate } from '../../utils/appHelpers';

const DATE = '2024-01-15';
const USER_ID = 'test-user-inv4';

describe('不変条件4: 削除した日に再入力すると persistentDeletedDates から除去される', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test(
        '削除ペンディング中の日付で explicitEdit: true を渡すと ' +
        'removePersistentDeletedDate が呼ばれる',
        () => {
            // ── Arrange ──────────────────────────────────────────────────────
            // 前提: DATE は以前にフルデート削除された
            //       → pendingWorkoutContentChangeDatesRef に explicitDelete:true, deleteScope:'date' が入っている
            // 操作: ユーザーが DATE に再入力（explicitEdit: true）
            //       → markWorkoutContentChanged が呼ばれる
            // 期待: deleteScope は explicitEdit によりリセット（null）
            //       → 条件 !(explicitDelete===true && deleteScope==="date") が true
            //       → removePersistentDeletedDate が呼ばれる
            const pendingWorkoutContentChangeDatesRef = { current: new Map() };
            pendingWorkoutContentChangeDatesRef.current.set(DATE, {
                explicitDelete: true,
                deleteScope: 'date',
                reason: 'date_delete',
                updatedAt: new Date().toISOString(),
            });
            const explicitWorkoutEditDatesRef = { current: new Map() };
            const onPersistentDeleteChanged = jest.fn();

            const { result } = renderHook(() =>
                useHistorySave({
                    pendingWorkoutContentChangeDatesRef,
                    explicitWorkoutEditDatesRef,
                    user: { id: USER_ID },
                    latestUserIdRef: { current: USER_ID },
                    applyTrustedWorkoutRowsSnapshot: jest.fn(),
                    setSyncFailuresByDate: jest.fn(),
                    getTodayKey: () => '2099-01-01',
                    getRuntimeEnvironmentLabel,
                    EXPLICIT_SET_EDIT_REASONS,
                    EXPLICIT_WORKOUT_EDIT_REASONS,
                    isExplicitWorkoutEditChange,
                    logRecordFetchError,
                    logWorkoutPersistenceDecision: jest.fn(),
                    getWorkoutSaveGuardDecision: jest.fn().mockReturnValue({ allowed: true }),
                    getHistoryMetricsForDate,
                    getEmptyWorkoutMetrics: jest.fn().mockReturnValue({}),
                    getWorkoutSummaryMetrics: jest.fn().mockReturnValue({}),
                    getWorkoutPayloadMetrics: jest.fn().mockReturnValue({}),
                    isMetricPersistenceMismatch: jest.fn().mockReturnValue(false),
                    getHistoryDebugSummaryForDate: jest.fn().mockReturnValue({}),
                    getHistoryDebugDiffForDate: jest.fn().mockReturnValue({}),
                    applyPreferredHistoryDates: jest.fn().mockReturnValue({}),
                    normalizeExerciseName: jest.fn((name) => name),
                    mergeHistoryMaps: jest.fn().mockReturnValue({}),
                    hasValidWorkoutOnDate: jest.fn().mockReturnValue(false),
                    findEditedSetInHistory: jest.fn().mockReturnValue(null),
                    isEditedSetPersisted: jest.fn().mockReturnValue(false),
                    getSetEditSummary: jest.fn().mockReturnValue(''),
                    getSetEditUnit: jest.fn().mockReturnValue('kg'),
                    buildHistoryFromWorkoutSessionRows: jest.fn().mockReturnValue({}),
                    describeHistoryRecordsForDate,
                    clearHistoryDeleteMarkerForDate: null,
                    pendingSavePayloadsRef: { current: new Map() },
                    onPersistentDeleteChanged,
                })
            );

            // ── Act ──────────────────────────────────────────────────────────
            // ユーザーが削除済み日付に再入力する（history_record_edit = explicit edit reason）
            act(() => {
                result.current.markWorkoutContentChanged(DATE, 'history_record_edit', {
                    explicitEdit: true,
                });
            });

            // ── Assert ───────────────────────────────────────────────────────
            // deleteScope が explicitEdit によりリセットされるため、
            // !(explicitDelete===true && deleteScope==="date") → !(true && false) → true
            // → removePersistentDeletedDate が呼ばれる
            expect(removePersistentDeletedDate).toHaveBeenCalledTimes(1);
            expect(removePersistentDeletedDate).toHaveBeenCalledWith(USER_ID, DATE);
        }
    );
});
