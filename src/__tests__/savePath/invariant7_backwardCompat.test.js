/**
 * 後方互換テスト: 古い payloadOrigin 形式の救済スキップ
 *
 * 背景:
 *   contentOrigin 導入前に localStorage に書き込まれた古い形式のドラフトは
 *   payloadOrigin: "canonicalDisplayHistory" を持ち、contentOrigin を持たない。
 *   loadDraftForDate の境界で resolveContentOrigin が呼ばれ、
 *   contentOrigin: "remote" に正規化されることで、
 *   rescueUnsyncedDrafts がそのドラフトをスキップできる。
 *
 * テスト有効性の証明手順（手動):
 *   1. このテストが緑であることを確認
 *   2. useDraftStore.js の normalizeDraftForLoad から
 *        contentOrigin: resolveContentOrigin(draft?.meta || {}),
 *      の行を削除する
 *   3. このテストが赤になることを確認（contentOrigin が付かなくなる）
 *   4. 元に戻す → 再び緑
 */

// ── jest.mock はホイストされるため最上部に置く ─────────────────────────────

jest.mock('../../features/workout/workoutDraftStore', () => ({
    loadWorkoutDraft: jest.fn(),
    saveWorkoutDraft: jest.fn().mockReturnValue(true),
    clearWorkoutDraft: jest.fn(),
    getWorkoutDraftKey: jest.fn((date) => `workoutDraft:${date}`),
    validateWorkoutDraftDate: jest.fn().mockReturnValue({ accepted: true, keyDate: '2024-01-15', payloadDate: '2024-01-15', rejectedReason: '' }),
}));

jest.mock('../../utils/writeTrace', () => ({
    logWriteTrace: jest.fn(),
    trackRestoreAttempt: jest.fn().mockReturnValue({ count: 1, blocked: 0, applied: 1 }),
    wpCountExercises: jest.fn().mockReturnValue(1),
    wpCountSetsFromLogData: jest.fn().mockReturnValue(1),
    suppressRestoreLoop: jest.fn(),
    getRestoreLoopSuppressionRemainingSec: jest.fn().mockReturnValue(0),
    getRestoreAttempts: jest.fn().mockReturnValue({ count: 0, blocked: 0, applied: 0 }),
    wpCountExercisesFromHistory: jest.fn().mockReturnValue(0),
    wpCountSetsFromHistory: jest.fn().mockReturnValue(0),
}));

jest.mock('../../utils/appHelpers', () => ({
    ...jest.requireActual('../../utils/appHelpers'),
    loadPersistentDeletedDates: jest.fn().mockReturnValue({}),
    shouldLogPerfDebug: jest.fn().mockReturnValue(false),
}));

// ── テスト本体 ────────────────────────────────────────────────────────────────

import { renderHook } from '@testing-library/react';
import { useDraftStore } from '../../hooks/useDraftStore';

const DATE = '2024-01-15';

describe('後方互換: payloadOrigin のみを持つ古い形式のドラフトが救済からスキップされる', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
    });

    test(
        'payloadOrigin: "canonicalDisplayHistory" を持ち contentOrigin を持たない古い形式のドラフトが ' +
        'loadDraftForDate で contentOrigin: "remote" に正規化される',
        () => {
            // ── Arrange ──────────────────────────────────────────────────────
            // 古い端末の localStorage には payloadOrigin が書き込まれているが
            // contentOrigin フィールドは存在しない
            const { loadWorkoutDraft } = require('../../features/workout/workoutDraftStore');
            loadWorkoutDraft.mockReturnValue({
                sessionEx: [{ name: 'BenchPress', id: 'bp', order: 0 }],
                logData: { BenchPress: [{ weight: '80', reps: '5', unit: 'kg' }] },
                exerciseUnits: {},
                todayLabels: [],
                meta: {
                    date: DATE,
                    keyDate: DATE,
                    draftDate: DATE,
                    workoutDate: DATE,
                    source: 'explicit_date_nav',
                    payloadOrigin: 'canonicalDisplayHistory',  // 古い形式
                    hasUnsavedChanges: true,
                    // contentOrigin は存在しない（古い形式）
                },
            });

            const userIdRef = { current: 'test-user-bc' };
            const { result } = renderHook(() => useDraftStore({ userIdRef }));

            // ── Act ──────────────────────────────────────────────────────────
            const draft = result.current.loadDraftForDate(DATE);

            // ── Assert ───────────────────────────────────────────────────────
            // ① resolveContentOrigin が contentOrigin: "remote" を付与している
            expect(draft?.meta?.contentOrigin).toBe('remote');

            // ② rescueUnsyncedDrafts の判定式でスキップされることの確認
            //    （実際の判定: draft.meta?.contentOrigin === "remote"）
            const isRemoteOriginContent = draft?.meta?.contentOrigin === 'remote';
            expect(isRemoteOriginContent).toBe(true);
        }
    );

    test(
        'payloadOrigin: "fetchedRemoteRows" を持つ古い形式のドラフトも contentOrigin: "remote" に正規化される',
        () => {
            const { loadWorkoutDraft } = require('../../features/workout/workoutDraftStore');
            loadWorkoutDraft.mockReturnValue({
                sessionEx: [{ name: 'Squat', id: 'sq', order: 0 }],
                logData: { Squat: [{ weight: '100', reps: '5', unit: 'kg' }] },
                exerciseUnits: {},
                todayLabels: [],
                meta: {
                    date: DATE,
                    keyDate: DATE,
                    draftDate: DATE,
                    workoutDate: DATE,
                    source: 'remote_supabase',
                    payloadOrigin: 'fetchedRemoteRows',  // 古い形式
                    hasUnsavedChanges: true,
                },
            });

            const { result } = renderHook(() => useDraftStore({ userIdRef: { current: 'test-user-bc2' } }));
            const draft = result.current.loadDraftForDate(DATE);

            expect(draft?.meta?.contentOrigin).toBe('remote');
            expect(draft?.meta?.contentOrigin === 'remote').toBe(true);
        }
    );
});
