/**
 * Test harness for useHistoryHandlers.
 *
 * テスト本体は「シナリオ」と「アサーション」だけを書く。
 * フックの40個の props の組み立てはここで吸収し、
 * テスト本体に props がベタ書きされないようにする。
 *
 * 使い方:
 *   const h = makeHarness({
 *     pendingChange:   { date: '2024-01-15', explicitDelete: true },
 *     savedWorkout:    { date: '2024-01-15', exercises: ['Bench Press'] },
 *     localDraft:      null,
 *     persistentDeleted: {},
 *   });
 *   h.logForDate('2024-01-15');
 *   expect(h.appliedSessionEx?.length ?? 0).toBe(0);
 *
 * 構造が変わった（props が増減した）場合は、このファイルだけ直す。
 * テスト本体は生き残る。
 *
 * jest.mock は呼び出し元のテストファイルで宣言すること（ホイスト制約）。
 * モックされた loadPersistentDeletedDates は makeHarness 内で
 * .mockReturnValue() を通じて制御する。
 */

import { renderHook, act } from '@testing-library/react';
import { useHistoryHandlers } from '../hooks/useHistoryHandlers';
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
    loadPersistentDeletedDates, // テストコンテキストではモック済み
} from '../utils/appHelpers';

// テスト内では「今日ではない」日付として機能する遠い未来の日付
const HARNESS_TODAY = '2099-01-01';

// セッション中のどの日付とも被らない「空の現在ドラフト」
const makeEmptyCurrentDraft = () => ({
    sessionEx: null,  // null にすることで hasDraftContent === false
    logData: {},
    exerciseUnits: {},
    todayLabels: [],
    meta: {
        source: 'current_log_snapshot',
        hasUnsavedChanges: false,
    },
});

// ローカルドラフトが存在しない場合の返り値（localStorage が空の状態）
const makeEmptyLocalDraft = (date) => ({
    sessionEx: null,
    logData: {},
    exerciseUnits: {},
    todayLabels: [],
    meta: {
        date,
        keyDate: date,
        draftDate: date,
        workoutDate: date,
        source: 'empty_draft',
        hasUnsavedChanges: false,
    },
});

/**
 * @param {object} options
 * @param {object|null} options.pendingChange
 *   - date: string (YYYY-MM-DD)
 *   - explicitDelete?: boolean
 *   - explicitEdit?: boolean
 *   - deleteScope?: 'date'|'partial'|null
 * @param {object|null} options.savedWorkout
 *   - date: string (YYYY-MM-DD)
 *   - exercises: string[]  (種目名の配列)
 * @param {object|null} options.localDraft
 *   useDraftStore 形式のドラフトオブジェクト。null = ローカルに何もない
 * @param {object} options.persistentDeleted
 *   { [YYYY-MM-DD]: ISOstring } 形式。デフォルト {} = Gate A をスキップ
 * @param {string} options.logDate
 *   現在開いている日付。デフォルト = HARNESS_TODAY
 * @param {Array} options.trustedWorkoutRows
 *   trustedWorkoutRowsRef.current の初期値。デフォルト [] = 信頼済み行なし
 */
export function makeHarness({
    pendingChange = null,
    savedWorkout = null,
    localDraft = null,
    persistentDeleted = {},
    logDate = HARNESS_TODAY,
    trustedWorkoutRows = [],
} = {}) {
    // テストファイルの jest.mock によってモック化されている関数に
    // このシナリオの返り値を設定する
    loadPersistentDeletedDates.mockReturnValue(persistentDeleted);

    // ── 同期待ちキュー ────────────────────────────────────────────────────────
    const pendingWorkoutContentChangeDatesRef = { current: new Map() };
    if (pendingChange) {
        const { date, ...rest } = pendingChange;
        pendingWorkoutContentChangeDatesRef.current.set(
            normalizeDraftDateKey(date),
            rest
        );
    }

    // ── 観測対象のスパイ ──────────────────────────────────────────────────────
    const applyLogDraftState = jest.fn();
    const applyTrustedWorkoutRowsSnapshotSpy = jest.fn();
    const saveDraftForDateSpy = jest.fn();

    // ── buildSavedWorkoutDraftForDate: シナリオ設定に従って返す ───────────────
    // App.jsx の実装を簡略化して「日付と種目リストだけで制御できる」stub。
    // 第2引数（trustedHistory）は harness では無視する。
    const buildSavedWorkoutDraftForDate = jest.fn((dateStr) => {
        const d = normalizeDraftDateKey(dateStr);
        const sw = savedWorkout;
        if (sw && normalizeDraftDateKey(sw.date) === d && (sw.exercises || []).length > 0) {
            const exNames = sw.exercises;
            return {
                hasSavedWorkout: true,
                sessionEx: exNames.map((name, i) => ({
                    id: name,
                    name,
                    label: null,
                    bodyPart: null,
                    order: i,
                })),
                logData: Object.fromEntries(
                    exNames.map((name) => [name, [{ weight: '60', reps: '10', unit: 'kg' }]])
                ),
                exerciseUnits: {},
                meta: {
                    date: d,
                    keyDate: d,
                    draftDate: d,
                    workoutDate: d,
                    source: 'history',
                    hasUnsavedChanges: false,
                },
            };
        }
        return {
            hasSavedWorkout: false,
            sessionEx: [],
            logData: {},
            exerciseUnits: {},
            meta: {
                date: d,
                keyDate: d,
                draftDate: d,
                workoutDate: d,
                source: 'history',
                hasUnsavedChanges: false,
            },
        };
    });

    // ── loadDraftForDate: ローカルドラフトを返す ────────────────────────────
    const loadDraftForDate = jest.fn((dateStr) => {
        const d = normalizeDraftDateKey(dateStr);
        if (localDraft && normalizeDraftDateKey(localDraft?.meta?.date) === d) {
            return localDraft;
        }
        return makeEmptyLocalDraft(d);
    });

    // ── hasDraftContent: useDraftStore の実装と同じロジック ─────────────────
    // （useDraftStore はフックなので props として inline で渡す）
    const hasDraftContent = (draft) =>
        draft.sessionEx !== null ||
        Object.keys(draft.logData || {}).length > 0 ||
        Object.keys(draft.exerciseUnits || {}).length > 0 ||
        (draft.todayLabels || []).length > 0;

    // ── フックのレンダリング ──────────────────────────────────────────────────
    const { result } = renderHook(() =>
        useHistoryHandlers({
            // ─ アイデンティティ ─
            user: { id: 'test-user-1' },

            // ─ 履歴状態 ─
            history: {},
            latestHistoryRef: { current: {} },
            historyRevisionRef: { current: 0 },

            // ─ リモート同期（handleLogForDate では使用されない） ─
            persistHistoryForUser: jest.fn(),
            syncWorkoutRowsForDates: jest.fn().mockResolvedValue({ failedDates: [], skippedDates: [] }),
            syncWorkoutSessionSnapshot: jest.fn().mockResolvedValue({}),
            deleteRemoteWorkoutArtifactsForDate: jest.fn().mockResolvedValue({}),
            appendHistoryDeleteMarkers: jest.fn(),
            commitHistoryDeleteMarkers: jest.fn(),
            historyDeleteMarkersRef: { current: {} },

            // ─ ドラフト操作 ─
            clearDraftForDate: jest.fn(),
            saveDraftForDate: saveDraftForDateSpy,
            loadDraftForDate,
            applyLogDraftState,       // ← 観測対象
            buildSavedWorkoutDraftForDate,  // ← シナリオで制御

            // ─ 画面状態 ─
            setHistory: jest.fn(),
            logDate,
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

            // ─ 同期キュー ─
            queueWorkoutSessionSync: jest.fn(),
            pendingWorkoutContentChangeDatesRef,  // ← シナリオで制御
            pendingWorkoutSessionSyncDatesRef: { current: new Set() },
            explicitWorkoutEditDatesRef: { current: new Map() },
            clearSyncFailure: jest.fn(),
            recordSyncFailure: jest.fn(),
            refreshHistorySyncDiagnostic: jest.fn(),
            pendingSavePayloadsRef: { current: new Map() },

            // ─ 信頼済み行 ─
            applyWorkoutsDataHistorySnapshot: jest.fn(),
            workoutsDataHistoryRef: { current: {} },
            markWorkoutContentChanged: jest.fn(),
            applyTrustedWorkoutRowsSnapshot: applyTrustedWorkoutRowsSnapshotSpy,
            trustedWorkoutRowsRef: { current: trustedWorkoutRows },
            applyTrustedSessionRowsSnapshot: jest.fn(),
            trustedSessionRows: [],

            // ─ その他の状態 ─
            onPersistentDeleteChanged: null,
            pendingDeleteUndoRef: { current: null },
            setPendingDeleteUndo: jest.fn(),

            // ─ handleLogForDate で使うヘルパー（実装を渡す） ─
            hasDraftContent,
            normalizeDraftDateKey,
            withDraftDateMeta,
            getCurrentLogDraftSnapshot: jest.fn().mockReturnValue(makeEmptyCurrentDraft()),
            latestLogDraftRef: { current: { meta: { source: 'current_log_snapshot', hasUnsavedChanges: false } } },
            getTodayKey: () => HARNESS_TODAY,
            trustedHistory: {},  // buildSavedWorkoutDraftForDate の stub で代替
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
            buildWorkoutDraftForDateFromHistory: jest.fn(),  // handleLogForDate では不使用
            withDraftMeta,

            // ─ handleEditHistory / deleteAllHistoryForDate でのみ使用 ─
            applyLocalHistoryDates: jest.fn(),
            buildHistoryRecordDeleteKey: jest.fn().mockReturnValue('delete-key'),
            removeHistoryDate: jest.fn().mockReturnValue({}),
            onDeleteDateClearCompletion: jest.fn(),
            invalidateSupabaseFetchFreshByPrefix: jest.fn(),
        })
    );

    // ── 公開インターフェース ──────────────────────────────────────────────────
    return {
        /** handleLogForDate(date) を act() でラップして呼ぶ */
        logForDate(date) {
            act(() => {
                result.current.handleLogForDate(date);
            });
        },

        /** handleDeleteHistory(exName, historyIdx, recordDate, setIdx) を act() でラップして呼ぶ */
        deleteHistory(exName, historyIdx, recordDate, setIdx) {
            act(() => {
                result.current.handleDeleteHistory(exName, historyIdx, recordDate, setIdx);
            });
        },

        /** applyLogDraftState に渡された最初の引数（適用されたドラフト） */
        get appliedDraft() {
            return applyLogDraftState.mock.calls[0]?.[0] ?? null;
        },

        /** 適用されたドラフトの sessionEx（null なら [] 扱い） */
        get appliedSessionEx() {
            return this.appliedDraft?.sessionEx ?? null;
        },

        /** saveDraftForDate への最初の呼び出しの第2引数（保存されたドラフト） */
        get savedDraft() {
            return saveDraftForDateSpy.mock.calls[0]?.[1] ?? null;
        },

        /** 生のスパイ（呼び出し回数などの詳細確認に使う） */
        applyLogDraftState,
        applyTrustedWorkoutRowsSnapshot: applyTrustedWorkoutRowsSnapshotSpy,
        saveDraftForDate: saveDraftForDateSpy,

        /** フックの生の result（高度なアサーションが必要な場合） */
        result,
    };
}
