/**
 * 不変条件9: contentOrigin が makeDraftMeta の ...meta スプレッドで保持される
 *
 * 背景:
 *   useHistoryHandlers.js:92 と App.jsx:1824 は
 *   withDraftDateMeta(date, draft, { source, hasUnsavedChanges, ... }) を呼ぶが
 *   contentOrigin を overrides に明示しない。
 *   makeDraftMeta が { ...meta, ...overrides, source, ... } という spread 方式のため
 *   入力 meta の contentOrigin は自動的に保持される。
 *   allowlist 方式に変わると contentOrigin が落ちる。
 *
 * テスト有効性の証明手順（手動）:
 *   1. このテストが緑であることを確認
 *   2-a. useHistoryHandlers.js L91-94 の withDraftDateMeta 呼び出しに
 *          contentOrigin: "local_draft",
 *        を overrides として追加する
 *   2-b. App.jsx L1823-1827 の withDraftDateMeta 呼び出しに
 *          contentOrigin: "local_draft",
 *        を overrides として追加する
 *   3. それぞれ対応するテストが赤になることを確認
 *   4. 元に戻す → 再び緑
 *
 *   あるいは:
 *   2-c. appHelpers.js の makeDraftMeta から
 *          ...meta,
 *        の行を削除する（allowlist 化）
 *   3. 両テストが赤になることを確認
 *   4. 元に戻す → 再び緑
 */

// ── jest.mock はホイストされるため最上部に置く ─────────────────────────────

jest.mock('../../utils/appHelpers', () => ({
    ...jest.requireActual('../../utils/appHelpers'),
    loadPersistentDeletedDates: jest.fn().mockReturnValue({}),
    shouldLogPerfDebug: jest.fn().mockReturnValue(false),
    getRuntimeEnvironmentLabel: jest.fn().mockReturnValue('test'),
    addPersistentDeletedDate: jest.fn(),
    removePersistentDeletedDate: jest.fn(),
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

// ── テスト本体 ────────────────────────────────────────────────────────────────

import { renderHook, act } from '@testing-library/react';
import { useHistoryHandlers } from '../../hooks/useHistoryHandlers';
import { useDraftStore } from '../../hooks/useDraftStore';
import {
    normalizeDraftDateKey,
    withDraftDateMeta,
    withDraftMeta,
    isExplicitWorkoutEditChange,
    isUnsavedUserWorkoutDraft,
    isCleanPersistedDraft,
    isDestructiveWorkoutRegression,
    shouldPreserveRawDraftOverIncoming,
    getDraftMetricsForDate,
    getDraftPayloadDate,
    getDraftDateValidation,
    getRuntimeEnvironmentLabel,
    loadPersistentDeletedDates,
} from '../../utils/appHelpers';

const CURRENT_DATE = '2024-01-14';  // 現在表示中の日付
const TARGET_DATE  = '2024-01-15';  // ナビ先の日付

// useHistoryHandlers の最小 props セット
const makeHandlerProps = (overrides = {}) => ({
    user: { id: 'test-user' },
    history: {},
    latestHistoryRef: { current: {} },
    historyRevisionRef: { current: 0 },
    persistHistoryForUser: jest.fn(),
    syncWorkoutRowsForDates: jest.fn().mockResolvedValue({ failedDates: [], skippedDates: [] }),
    syncWorkoutSessionSnapshot: jest.fn().mockResolvedValue({}),
    deleteRemoteWorkoutArtifactsForDate: jest.fn().mockResolvedValue({}),
    appendHistoryDeleteMarkers: jest.fn(),
    commitHistoryDeleteMarkers: jest.fn(),
    historyDeleteMarkersRef: { current: {} },
    clearDraftForDate: jest.fn(),
    saveDraftForDate: jest.fn(),
    loadDraftForDate: jest.fn().mockReturnValue({
        sessionEx: null, logData: {}, exerciseUnits: {}, todayLabels: [],
        meta: { date: TARGET_DATE, keyDate: TARGET_DATE, draftDate: TARGET_DATE,
                workoutDate: TARGET_DATE, source: 'empty_draft', hasUnsavedChanges: false },
    }),
    applyLogDraftState: jest.fn(),
    buildSavedWorkoutDraftForDate: jest.fn().mockReturnValue({
        hasSavedWorkout: false, sessionEx: [], logData: {}, exerciseUnits: {}, todayLabels: [],
        meta: { date: TARGET_DATE, keyDate: TARGET_DATE, source: 'history', hasUnsavedChanges: false },
    }),
    setHistory: jest.fn(),
    logDate: CURRENT_DATE,
    setLogDate: jest.fn(),
    setLogMode: jest.fn(),
    setScreen: jest.fn(),
    summary: null,
    setSummary: jest.fn(),
    workoutDayShareTarget: null,
    setWorkoutDayShareTarget: jest.fn(),
    workoutStartedForDate: null,
    resetWorkoutElapsedTimer: jest.fn(),
    savedWorkoutDurationSecByDate: {},
    setSavedWorkoutDurationSecByDate: jest.fn(),
    setSessionSyncVersion: jest.fn(),
    queueWorkoutSessionSync: jest.fn(),
    pendingWorkoutContentChangeDatesRef: { current: new Map() },
    pendingWorkoutSessionSyncDatesRef: { current: new Set() },
    explicitWorkoutEditDatesRef: { current: new Map() },
    clearSyncFailure: jest.fn(),
    recordSyncFailure: jest.fn(),
    refreshHistorySyncDiagnostic: jest.fn(),
    pendingSavePayloadsRef: { current: new Map() },
    applyWorkoutsDataHistorySnapshot: jest.fn(),
    workoutsDataHistoryRef: { current: {} },
    markWorkoutContentChanged: jest.fn(),
    applyTrustedWorkoutRowsSnapshot: jest.fn(),
    trustedWorkoutRowsRef: { current: [] },
    applyTrustedSessionRowsSnapshot: jest.fn(),
    trustedSessionRows: [],
    onPersistentDeleteChanged: null,
    pendingDeleteUndoRef: { current: null },
    setPendingDeleteUndo: jest.fn(),
    hasDraftContent: (draft) =>
        draft.sessionEx !== null ||
        Object.keys(draft.logData || {}).length > 0,
    normalizeDraftDateKey,
    withDraftDateMeta,
    getCurrentLogDraftSnapshot: jest.fn().mockReturnValue({
        sessionEx: null, logData: {}, exerciseUnits: {}, todayLabels: [], meta: null,
    }),
    latestLogDraftRef: { current: { meta: { source: 'current_log_snapshot', hasUnsavedChanges: false } } },
    getTodayKey: () => '2099-01-01',
    trustedHistory: {},
    getDraftMetricsForDate,
    getExUnit: jest.fn().mockReturnValue('kg'),
    isExplicitWorkoutEditChange,
    isCleanPersistedDraft,
    isDestructiveWorkoutRegression,
    shouldPreserveRawDraftOverIncoming,
    isUnsavedUserWorkoutDraft,
    logRestoreDecision: jest.fn(),
    getDraftDateValidation,
    getDraftKey: (baseKey, dateStr) => `${baseKey}_${normalizeDraftDateKey(dateStr)}`,
    getDraftPayloadDate,
    getRuntimeEnvironmentLabel,
    buildWorkoutDraftForDateFromHistory: jest.fn(),
    withDraftMeta,
    applyLocalHistoryDates: jest.fn(),
    buildHistoryRecordDeleteKey: jest.fn().mockReturnValue('delete-key'),
    removeHistoryDate: jest.fn().mockReturnValue({}),
    onDeleteDateClearCompletion: jest.fn(),
    invalidateSupabaseFetchFreshByPrefix: jest.fn(),
    ...overrides,
});

describe('不変条件9: contentOrigin が draft meta の ...spread によって保持される', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
        const { loadPersistentDeletedDates } = require('../../utils/appHelpers');
        loadPersistentDeletedDates.mockReturnValue({});
    });

    // ────────────────────────────────────────────────────────────────────────
    // テスト 9a: useHistoryHandlers.js:92 の「日付ナビ前の現ドラフト保存」パス
    // ────────────────────────────────────────────────────────────────────────
    test(
        '9a: handleLogForDate による日付ナビ前の現ドラフト保存で ' +
        'contentOrigin: "remote" が保持される',
        () => {
            // ── Arrange ──────────────────────────────────────────────────────
            // 現在開いている日付のドラフトは Supabase 由来で contentOrigin: "remote"
            // （useHistoryHandlers.js:104 の shouldUseSavedWorkout パスで保存されたもの）
            const currentDraftWithRemoteOrigin = {
                hasSavedWorkout: true,
                sessionEx: [{ name: 'BenchPress', id: 'bp', order: 0 }],
                logData: { BenchPress: [{ weight: '80', reps: '5', unit: 'kg' }] },
                exerciseUnits: {},
                todayLabels: [],
                meta: {
                    date: CURRENT_DATE,
                    keyDate: CURRENT_DATE,
                    draftDate: CURRENT_DATE,
                    workoutDate: CURRENT_DATE,
                    source: 'canonical_display_history',
                    hasUnsavedChanges: false,
                    contentOrigin: 'remote',   // ← これが保持されることを確認
                },
            };

            const saveDraftForDate = jest.fn();

            const { result } = renderHook(() =>
                useHistoryHandlers(makeHandlerProps({
                    logDate: CURRENT_DATE,
                    saveDraftForDate,
                    getCurrentLogDraftSnapshot: jest.fn().mockReturnValue(currentDraftWithRemoteOrigin),
                    latestLogDraftRef: {
                        current: {
                            ...currentDraftWithRemoteOrigin,
                            meta: currentDraftWithRemoteOrigin.meta,
                        },
                    },
                }))
            );

            // ── Act ──────────────────────────────────────────────────────────
            // ユーザーが TARGET_DATE に日付ナビ → CURRENT_DATE の現ドラフトが保存される
            act(() => result.current.handleLogForDate(TARGET_DATE));

            // ── Assert ───────────────────────────────────────────────────────
            // saveDraftForDate が呼ばれていること
            expect(saveDraftForDate).toHaveBeenCalledTimes(1);

            // 保存されたドラフトに contentOrigin: "remote" が保持されていること
            const [savedDate, savedDraft] = saveDraftForDate.mock.calls[0];
            expect(savedDate).toBe(CURRENT_DATE);
            expect(savedDraft?.meta?.contentOrigin).toBe('remote');
        }
    );

    // ────────────────────────────────────────────────────────────────────────
    // テスト 9b: App.jsx:1824 の「onDraftChange 自動保存」パターン
    // withDraftDateMeta(date, { meta: draftMeta }, { source, hasUnsavedChanges, ... })
    // ────────────────────────────────────────────────────────────────────────
    test(
        '9b: App.jsx:1817-1828 の自動保存パターンで ' +
        'contentOrigin: "remote" が withDraftDateMeta を通じて保持される',
        () => {
            // ── Arrange ──────────────────────────────────────────────────────
            // latestLogDraftRef.current?.meta から取られた draftMeta
            // （useHistoryHandlers が shouldUseSavedWorkout パスで保存した meta）
            const draftMeta = {
                date: TARGET_DATE,
                keyDate: TARGET_DATE,
                draftDate: TARGET_DATE,
                workoutDate: TARGET_DATE,
                source: 'canonical_display_history',
                hasUnsavedChanges: false,
                contentOrigin: 'remote',   // ← これが保持されることを確認
            };

            // ── Act ──────────────────────────────────────────────────────────
            // App.jsx:1817-1828 のコード構造を直接再現する
            const draft = withDraftDateMeta(TARGET_DATE, {
                todayLabels: [],
                logData: { BenchPress: [{ weight: '80', reps: '5', unit: 'kg' }] },
                sessionEx: [{ name: 'BenchPress', id: 'bp', order: 0 }],
                exerciseUnits: {},
                meta: draftMeta,
            }, {
                source: draftMeta?.source || 'autosave_draft',
                hasUnsavedChanges: draftMeta?.hasUnsavedChanges ?? true,
                updatedAt: draftMeta?.updatedAt,
                remoteVerifiedAt: draftMeta?.remoteVerifiedAt,
                // contentOrigin は明示しない ← spread で継承されることを確認
            });

            // ── Assert: withDraftDateMeta の段階で保持されること ─────────────
            expect(draft?.meta?.contentOrigin).toBe('remote');
        }
    );

    // ────────────────────────────────────────────────────────────────────────
    // テスト 9c: saveDraftForDate → loadDraftForDate のラウンドトリップ
    // makeWorkoutDraftMeta の allowlist と makeDraftMeta の draft_meta_DATE 書き込みが
    // contentOrigin を保持することの確認
    // ────────────────────────────────────────────────────────────────────────
    test(
        '9c: saveDraftForDate → loadDraftForDate のラウンドトリップで ' +
        'contentOrigin: "remote" が localStorage を通じて保持される',
        () => {
            // ── Arrange ──────────────────────────────────────────────────────
            const { result } = renderHook(() =>
                useDraftStore({ userIdRef: { current: 'test-user' } })
            );

            const draftToSave = withDraftDateMeta(TARGET_DATE, {
                todayLabels: [],
                logData: { BenchPress: [{ weight: '80', reps: '5', unit: 'kg' }] },
                sessionEx: [{ name: 'BenchPress', id: 'bp', order: 0 }],
                exerciseUnits: {},
                meta: {
                    date: TARGET_DATE,
                    keyDate: TARGET_DATE,
                    draftDate: TARGET_DATE,
                    workoutDate: TARGET_DATE,
                    source: 'canonical_display_history',
                    hasUnsavedChanges: false,
                    contentOrigin: 'remote',
                },
            }, {
                source: 'canonical_display_history',
                hasUnsavedChanges: false,
                contentOrigin: 'remote',
            });

            // ── Act ──────────────────────────────────────────────────────────
            act(() => result.current.saveDraftForDate(TARGET_DATE, draftToSave));
            const loaded = result.current.loadDraftForDate(TARGET_DATE);

            // ── Assert ───────────────────────────────────────────────────────
            expect(loaded?.meta?.contentOrigin).toBe('remote');
        }
    );
});
