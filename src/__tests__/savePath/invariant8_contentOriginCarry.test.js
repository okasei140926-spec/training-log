/**
 * 不変条件8: contentOrigin: "remote" がローカルドラフト採用パスで保持される
 *
 * バグの再現条件:
 *   useHistoryHandlers.js が contentOrigin: "remote" で書き込んだドラフトを
 *   useDraftRestore が localDraft として読み込んだとき、
 *   carry パス（L233-237）が contentOrigin: "local_draft" をハードコードすると
 *   contentOrigin: "remote" が上書きされ、rescueUnsyncedDrafts が
 *   zombie upload してしまう。
 *
 * テスト有効性の証明手順（手動）:
 *   1. このテストが緑であることを確認
 *   2. useDraftRestore.js L236 の
 *        contentOrigin: localDraft?.meta?.contentOrigin || "local_draft",
 *      を
 *        contentOrigin: "local_draft",
 *      に戻す
 *   3. このテストが赤になることを確認（"remote" → "local_draft" になる）
 *   4. 元に戻す → 再び緑
 *
 *   同様に L262 も同じ手順で確認できる（第2テストで検証）。
 */

// ── jest.mock はホイストされるため最上部に置く ─────────────────────────────

jest.mock('../../utils/appHelpers', () => ({
    ...jest.requireActual('../../utils/appHelpers'),
    loadPersistentDeletedDates: jest.fn().mockReturnValue({}),
    shouldLogPerfDebug: jest.fn().mockReturnValue(false),
    getRuntimeEnvironmentLabel: jest.fn().mockReturnValue('test'),
}));

// ── テスト本体 ────────────────────────────────────────────────────────────────

import { renderHook } from '@testing-library/react';
import { useDraftRestore } from '../../hooks/useDraftRestore';

const DATE = '2024-01-15';

/** contentOrigin: "remote" を持つローカルドラフト（ユーザー編集済み） */
const makeRemoteOriginLocalDraft = () => ({
    hasSavedWorkout: true,
    sessionEx: [{ name: 'BenchPress', id: 'bp', order: 0 }],
    logData: { BenchPress: [{ weight: '80', reps: '5', unit: 'kg' }] },
    exerciseUnits: { BenchPress: 'kg' },
    todayLabels: [],
    meta: {
        date: DATE,
        keyDate: DATE,
        draftDate: DATE,
        workoutDate: DATE,
        source: 'weight_change',        // EXPLICIT_WORKOUT_EDIT_REASONS → isUnsavedUserWorkoutDraft: true
        hasUnsavedChanges: true,
        contentOrigin: 'remote',        // ← このフィールドが carry パスで保持されることを確認
    },
});

/** savedDraft（別の種目を持つリモートデータ） */
const makeSavedWorkoutDraft = () => ({
    hasSavedWorkout: true,
    sessionEx: [{ name: 'Squat', id: 'sq', order: 0 }],
    logData: { Squat: [{ weight: '100', reps: '5', unit: 'kg' }] },
    exerciseUnits: { Squat: 'kg' },
    todayLabels: [],
    meta: {
        date: DATE,
        keyDate: DATE,
        draftDate: DATE,
        workoutDate: DATE,
        source: 'remote_supabase',
        hasUnsavedChanges: false,
        contentOrigin: 'remote',
    },
});

/** hasDraftContent の簡易実装（sessionEx があればあり、なければなし） */
const hasDraftContentImpl = (draft) =>
    (draft?.sessionEx || []).length > 0 ||
    Object.keys(draft?.logData || {}).length > 0;

/** useDraftRestore を最小限の props でレンダリングするヘルパー */
const renderRestore = ({ localDraft, savedDraft, applyCurrentLogDraft, markWorkoutContentChanged }) => {
    renderHook(() =>
        useDraftRestore({
            screen: 'log',
            historySyncReady: true,
            logDate: DATE,
            user: { id: 'test-user' },
            pendingWorkoutContentChangeDatesRef: { current: new Set() },
            explicitWorkoutEditDatesRef: { current: new Map() },
            latestLogDraftRef: { current: null },
            trustedHistory: {},
            exerciseUnits: {},
            logData: {},
            sessionEx: [],
            todayLabels: [],
            buildSavedWorkoutDraftForDate: jest.fn().mockReturnValue(savedDraft),
            getCurrentLogDraftSnapshot: jest.fn().mockReturnValue(null),
            loadDraftForDate: jest.fn().mockReturnValue(localDraft),
            hasDraftContent: jest.fn().mockImplementation(hasDraftContentImpl),
            getExUnit: jest.fn().mockReturnValue('kg'),
            applyCurrentLogDraft,
            markWorkoutContentChanged,
            saveDraftForDate: jest.fn(),
        })
    );
};

describe('不変条件8: contentOrigin: "remote" を持つ localDraft が useDraftRestore の carry パスを通っても保持される', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        const { loadPersistentDeletedDates } = require('../../utils/appHelpers');
        loadPersistentDeletedDates.mockReturnValue({});
    });

    test(
        'unsaved user edit（source: "weight_change"）の localDraft が contentOrigin: "remote" を持つ場合、' +
        'applyCurrentLogDraft に渡されるドラフトも contentOrigin: "remote" を保持する',
        () => {
            // ── Arrange ──────────────────────────────────────────────────────
            // useHistoryHandlers.js:324 が contentOrigin: "remote" で書いたドラフトを
            // useDraftRestore が localDraft として読み込む状況を再現する
            const localDraft = makeRemoteOriginLocalDraft();
            const savedDraft = makeSavedWorkoutDraft();
            const applyCurrentLogDraft = jest.fn();
            const markWorkoutContentChanged = jest.fn();

            // ── Act ──────────────────────────────────────────────────────────
            renderRestore({ localDraft, savedDraft, applyCurrentLogDraft, markWorkoutContentChanged });

            // ── Assert ───────────────────────────────────────────────────────
            // applyCurrentLogDraft が呼ばれていること（carry パスに到達した証拠）
            expect(applyCurrentLogDraft).toHaveBeenCalledTimes(1);

            // 適用されたドラフトに contentOrigin: "remote" が保持されていること
            const appliedDraft = applyCurrentLogDraft.mock.calls[0][0];
            expect(appliedDraft?.meta?.contentOrigin).toBe('remote');
        }
    );

    test(
        'contentOrigin を持たない localDraft（古い形式）は "local_draft" にフォールバックする',
        () => {
            // ── Arrange ──────────────────────────────────────────────────────
            // contentOrigin がない古い形式のドラフト
            const localDraftNoOrigin = {
                ...makeRemoteOriginLocalDraft(),
                meta: {
                    date: DATE,
                    keyDate: DATE,
                    draftDate: DATE,
                    workoutDate: DATE,
                    source: 'weight_change',
                    hasUnsavedChanges: true,
                    // contentOrigin: 存在しない（古い形式）
                },
            };
            const savedDraft = makeSavedWorkoutDraft();
            const applyCurrentLogDraft = jest.fn();
            const markWorkoutContentChanged = jest.fn();

            // ── Act ──────────────────────────────────────────────────────────
            renderRestore({ localDraft: localDraftNoOrigin, savedDraft, applyCurrentLogDraft, markWorkoutContentChanged });

            // ── Assert ───────────────────────────────────────────────────────
            expect(applyCurrentLogDraft).toHaveBeenCalledTimes(1);

            // contentOrigin がなければ "local_draft" にフォールバックする
            const appliedDraft = applyCurrentLogDraft.mock.calls[0][0];
            expect(appliedDraft?.meta?.contentOrigin).toBe('local_draft');
        }
    );
});
