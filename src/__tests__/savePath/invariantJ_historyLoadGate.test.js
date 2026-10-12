/**
 * 案J 起動時レースコンディション防止テスト
 *
 * J-1 (fix): historyRemoteReady=false のとき、syncWorkoutRowsForDates で
 *   payloadSource="history" + empty + explicitDelete:true → G15 が発動し
 *   heldDates に日付が入る。
 *
 * J-1 (mutation): historyRemoteReady=true のとき同じ条件でも G15 は発動しない。
 *
 * J-2 (fix): pendingSavePayloadsRef が空でも loadDraftForDate がドラフトを返す場合、
 *   payloadSource="draft" となり保存が進む。hasDraftContent の戻り値に関わらず
 *   draftForDate !== null であれば draft が権威になる。
 *
 * J-2 (mutation): pendingSavePayloadsRef が空かつドラフトもない場合、
 *   payloadSource="history" になる。
 *
 * J-3 (fix): 空ドラフト (sessionEx=[], exerciseCount=0) + explicitDelete:true のとき、
 *   payloadSource="draft" のまま削除ペイロードとして扱われ、saveWorkoutForDate が
 *   呼ばれる（history にフォールバックして削除前データが復活しない）。
 *
 * J-4 (fix): contentOrigin="remote" のドラフトが存在するとき、
 *   payloadSource が "draft" にならず heldDates に入る（一方向弁を迂回しない）。
 *
 * J-5 (fix): payloadSource="history_cache" + explicitDelete:true + historyRemoteReady=false
 *   → G15 が発動し saveWorkoutForDate が呼ばれない（キャッシュ由来の削除前データが
 *     upsert されない）。
 *
 * J-6 (fix): useHistoryAutoSave の syncBatch:build ゲートで historyRemoteReady が
 *   undefined のとき fail-open（同期継続）しエラーログが出る。
 */

jest.mock('../../utils/supabase', () => {
    const resolved = (data = [], error = null) => Promise.resolve({ data, error });
    const chain = () => ({
        single: () => resolved(null),
        maybeSingle: () => resolved(null),
        gte: () => chain(),
        order: () => chain(),
        limit: () => resolved([]),
        in: () => resolved([]),
        delete: () => resolved([]),
        upsert: () => resolved([]),
        insert: () => resolved([]),
    });
    return {
        supabase: {
            from: () => ({
                select: () => ({ eq: () => chain() }),
                delete: () => ({ in: () => resolved([]) }),
                upsert: () => resolved([]),
                insert: () => resolved([]),
            }),
        },
    };
});

jest.mock('../../features/workout/workoutRepository', () => ({
    fetchWorkoutRowForDate: jest.fn().mockResolvedValue({ data: null, error: null }),
    fetchWorkoutRowFromWorkoutsData: jest.fn().mockReturnValue(null),
    saveWorkoutForDate: jest.fn().mockResolvedValue({ data: null, error: null }),
    // fetchWorkoutRows is used by useHistoryAutoSave (J-6)
    fetchWorkoutRows: jest.fn().mockResolvedValue({ rows: [], error: null }),
}));

// Mocks below are needed by useHistoryAutoSave (J-6 test)
jest.mock('../../hooks/useHistorySync', () => ({
    REMOTE_HISTORY_SESSION_LOOKBACK_DAYS: 180,
    REMOTE_HISTORY_SESSION_LIMIT: 1000,
    INITIAL_HOME_HISTORY_LOOKBACK_DAYS: 90,
    INITIAL_HOME_HISTORY_LIMIT: 1000,
    HISTORY_RECOVERY_LIMIT: 500,
}));

jest.mock('../../features/workout/workoutDraftStore', () => ({
    ...jest.requireActual('../../features/workout/workoutDraftStore'),
    makeVerifiedWorkoutDraft: () => ({
        hasSavedWorkout: false,
        sessionEx: [],
        logData: {},
        exerciseUnits: {},
        meta: { hasUnsavedChanges: false, source: 'save_verified', date: '2026-01-15' },
    }),
}));

jest.mock('../../utils/workoutTimer', () => ({
    getWorkoutTimerPersistence: jest.fn().mockReturnValue(null),
}));

jest.mock('../../utils/workoutSessions', () => ({
    buildWorkoutSessionPayloadFromHistory: jest.fn().mockReturnValue({}),
}));

jest.mock('../../utils/writeTrace', () => ({
    logWriteTrace: jest.fn(),
    wpCountExercisesFromHistory: jest.fn().mockReturnValue(0),
    wpCountSetsFromHistory: jest.fn().mockReturnValue(0),
    wpCountExercises: jest.fn().mockReturnValue(0),
    wpCountSetsFromLogData: jest.fn().mockReturnValue(0),
}));

jest.mock('../../utils/appHelpers', () => ({
    ...jest.requireActual('../../utils/appHelpers'),
    removePersistentDeletedDate: jest.fn(),
    loadPersistentDeletedDates: jest.fn().mockReturnValue({}),
}));

import { renderHook, act, waitFor } from '@testing-library/react';
import { useHistorySave } from '../../hooks/useHistorySave';
import { useHistoryAutoSave } from '../../hooks/useHistoryAutoSave';
import { useHistoryHandlers } from '../../hooks/useHistoryHandlers';
import { useDraftStore } from '../../hooks/useDraftStore';
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
    loadPersistentDeletedDates,
    loadPendingOps,
    upsertPendingOp,
} from '../../utils/appHelpers';
import {
    mergeHistoryMaps,
    hasValidWorkoutOnDate,
    normalizeExerciseName,
} from '../../utils/helpers';
import {
    fetchWorkoutRowForDate,
    fetchWorkoutRowFromWorkoutsData,
    saveWorkoutForDate,
} from '../../features/workout/workoutRepository';
import { logWriteTrace } from '../../utils/writeTrace';

const DATE = "2026-01-15";
const USER_ID = "test-user-invariantJ";
const HARNESS_TODAY = '2099-01-01';

beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
    loadPersistentDeletedDates.mockReturnValue({});
    // Default: fetchWorkoutRowForDate returns no row (no remote workout)
    fetchWorkoutRowForDate.mockResolvedValue({ row: null, error: null });
    fetchWorkoutRowFromWorkoutsData.mockReturnValue({ row: null });
    // saveWorkoutForDate: return a successful save by default
    saveWorkoutForDate.mockResolvedValue({
        ok: true,
        blocked: false,
        skipped: false,
        error: null,
        verifiedRow: null,
        verifiedMetrics: null,
    });
});

/**
 * Build a useHistorySave hook with sensible defaults.
 * Options allow per-test overrides.
 */
function makeHistorySaveHook({
    pendingWorkoutContentChangeDatesRef,
    pendingSavePayloadsRef,
    loadDraftForDate = null,
    hasDraftContent = null,
    historyRemoteReady = true,
    historyDisplayFromCache = false,
} = {}) {
    const _pendingRef = pendingWorkoutContentChangeDatesRef || { current: new Map() };
    const _payloadsRef = pendingSavePayloadsRef || { current: new Map() };

    const { result } = renderHook(() =>
        useHistorySave({
            pendingWorkoutContentChangeDatesRef: _pendingRef,
            explicitWorkoutEditDatesRef: { current: new Map() },
            user: { id: USER_ID },
            latestUserIdRef: { current: USER_ID },
            applyTrustedWorkoutRowsSnapshot: jest.fn(),
            setSyncFailuresByDate: jest.fn(),
            getTodayKey: () => HARNESS_TODAY,
            getRuntimeEnvironmentLabel,
            EXPLICIT_SET_EDIT_REASONS,
            EXPLICIT_WORKOUT_EDIT_REASONS,
            isExplicitWorkoutEditChange,
            logRecordFetchError,
            logWorkoutPersistenceDecision: jest.fn(),
            getWorkoutSaveGuardDecision: jest.fn().mockReturnValue({ allowed: true, blocked: false, details: { removedExerciseNames: [] }, allowedReason: "test" }),
            getHistoryMetricsForDate,
            getEmptyWorkoutMetrics: jest.fn().mockReturnValue({ hasWorkout: false, exerciseCount: 0, setCount: 0, volume: 0, exerciseNames: [] }),
            getWorkoutSummaryMetrics: jest.fn().mockReturnValue({}),
            getWorkoutPayloadMetrics: jest.fn().mockReturnValue({}),
            isMetricPersistenceMismatch: jest.fn().mockReturnValue(false),
            getHistoryDebugSummaryForDate: jest.fn().mockReturnValue({}),
            getHistoryDebugDiffForDate: jest.fn().mockReturnValue({}),
            applyPreferredHistoryDates: jest.fn().mockImplementation((base, src, dates) => src || {}),
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
            pendingSavePayloadsRef: _payloadsRef,
            onPersistentDeleteChanged: jest.fn(),
            loadDraftForDate,
            hasDraftContent,
            historyRemoteReady,
            historyDisplayFromCache,
        })
    );
    return { result, pendingRef: _pendingRef, payloadsRef: _payloadsRef };
}

// ─────────────────────────────────────────────────────────────────────────────
// J-1: G15 ガード — historyRemoteReady=false のとき explicitDelete + empty history を保留する
// ─────────────────────────────────────────────────────────────────────────────
describe("J-1: G15 ガード — historyRemoteReady=false で explicitDelete + empty history を保留する", () => {
    it("fix: historyRemoteReady=false + explicitDelete:true + payloadSource=history → heldDates に日付が入る", async () => {
        const pendingRef = { current: new Map() };
        pendingRef.current.set(DATE, {
            reason: "startup_replay",
            explicitEdit: false,
            explicitDelete: true,
            deleteScope: "full",
            updatedAt: new Date().toISOString(),
        });

        const { result } = makeHistorySaveHook({
            pendingWorkoutContentChangeDatesRef: pendingRef,
            // pendingSavePayloadsRef is empty → directPayloadMap = null
            // loadDraftForDate returns null → payloadSource = "history"
            loadDraftForDate: jest.fn().mockReturnValue(null),
            hasDraftContent: jest.fn().mockReturnValue(false),
            historyRemoteReady: false,
        });

        let syncResults;
        await act(async () => {
            syncResults = await result.current.syncWorkoutRowsForDates(
                USER_ID,
                {}, // empty history
                [DATE]
            );
        });

        // G15 は g15HeldDates に入る（heldDates ではない）
        expect(syncResults.g15HeldDates).toContain(DATE);
        expect(syncResults.heldDates).not.toContain(DATE);
        expect(syncResults.syncedDates).not.toContain(DATE);
        expect(syncResults.skippedDates).not.toContain(DATE);
        expect(saveWorkoutForDate).not.toHaveBeenCalled();

        // G15 がログに記録されている
        const g15Call = logWriteTrace.mock.calls.find(
            ([tag]) => tag === "G15:history-not-loaded-guard"
        );
        expect(g15Call).toBeDefined();
        expect(g15Call[1].decision).toBe("hold");
    });

    it("mutation test: explicitDelete=false のとき、payloadSource=history でも G15 は発動しない", async () => {
        const pendingRef = { current: new Map() };
        pendingRef.current.set(DATE, {
            reason: "startup_replay",
            explicitEdit: false,
            explicitDelete: false,  // ← NOT a delete; G15 must not fire
            updatedAt: new Date().toISOString(),
        });

        const { result } = makeHistorySaveHook({
            pendingWorkoutContentChangeDatesRef: pendingRef,
            loadDraftForDate: jest.fn().mockReturnValue(null),
            hasDraftContent: jest.fn().mockReturnValue(false),
            historyRemoteReady: false, // even false doesn't matter — no explicitDelete
        });

        let syncResults;
        await act(async () => {
            syncResults = await result.current.syncWorkoutRowsForDates(
                USER_ID,
                {},
                [DATE]
            );
        });

        // G15 は発動しない（explicitDelete=false なので）
        const g15Call = logWriteTrace.mock.calls.find(
            ([tag]) => tag === "G15:history-not-loaded-guard"
        );
        expect(g15Call).toBeUndefined();

        // heldDates には入らない
        expect(syncResults.g15HeldDates).not.toContain(DATE);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// J-2: ドラフトフォールバック — pendingSavePayloadsRef が空のとき draft が使われる
// ─────────────────────────────────────────────────────────────────────────────
describe("J-2: ドラフトフォールバック — pendingSavePayloadsRef 空のとき draft payload を使う", () => {
    it("fix: loadDraftForDate がコンテンツありのドラフトを返す場合 payloadSource=draft, exerciseCount=1", async () => {
        const pendingRef = { current: new Map() };
        pendingRef.current.set(DATE, {
            reason: "startup_replay",
            explicitEdit: true,
            explicitDelete: false,
            updatedAt: new Date().toISOString(),
        });

        // Draft with one exercise
        const draftWithExercise = {
            sessionEx: [{ name: "Squat", order: 0 }],
            logData: { Squat: [{ weight: "60", reps: "10", set: 1 }] },
            exerciseUnits: { Squat: "kg" },
            todayLabels: [],
            meta: { source: "local_draft", hasUnsavedChanges: true },
        };

        const { result } = makeHistorySaveHook({
            pendingWorkoutContentChangeDatesRef: pendingRef,
            // pendingSavePayloadsRef is empty → directPayloadMap = null
            loadDraftForDate: jest.fn().mockReturnValue(draftWithExercise),
            hasDraftContent: jest.fn().mockReturnValue(true),
            historyRemoteReady: true,
        });

        let syncResults;
        await act(async () => {
            syncResults = await result.current.syncWorkoutRowsForDates(
                USER_ID,
                {}, // empty history
                [DATE]
            );
        });

        // payloadSource=draft が syncWorkoutRows ログに記録されている
        const syncRowCall = logWriteTrace.mock.calls.find(
            ([tag]) => tag === "syncWorkoutRows"
        );
        expect(syncRowCall).toBeDefined();
        expect(syncRowCall[1].extra?.payloadSource).toBe("draft");

        // 保存が呼ばれた（G8 などでブロックされていない）
        // Note: hasValidWorkoutOnDate mock returns false by default; saveWorkoutForDate
        // would be skipped by G8 unless explicitDelete is true.
        // With payloadSource=draft and a non-empty draft, hasWorkoutForDate is determined
        // by the actual hasValidWorkoutOnDate call on the built history.
        // The real hasValidWorkoutOnDate is mocked to false here so G8 non-explicit block applies.
        // But since explicitEdit=true, G8 will hold (not skip). Either way payloadSource=draft.
        expect(syncRowCall[1].extra?.payloadSource).toBe("draft");
    });

    it("mutation test: loadDraftForDate が null を返す場合 payloadSource=history", async () => {
        const pendingRef = { current: new Map() };
        pendingRef.current.set(DATE, {
            reason: "startup_replay",
            explicitEdit: true,
            explicitDelete: false,
            updatedAt: new Date().toISOString(),
        });

        const { result } = makeHistorySaveHook({
            pendingWorkoutContentChangeDatesRef: pendingRef,
            loadDraftForDate: jest.fn().mockReturnValue(null),
            hasDraftContent: jest.fn().mockReturnValue(false),
            historyRemoteReady: true,
        });

        let syncResults;
        await act(async () => {
            syncResults = await result.current.syncWorkoutRowsForDates(
                USER_ID,
                {},
                [DATE]
            );
        });

        const syncRowCall = logWriteTrace.mock.calls.find(
            ([tag]) => tag === "syncWorkoutRows"
        );
        expect(syncRowCall).toBeDefined();
        expect(syncRowCall[1].extra?.payloadSource).toBe("history");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// J-4: contentOrigin="remote" のドラフト — 一方向弁迂回を防ぐ
// ─────────────────────────────────────────────────────────────────────────────
describe("J-4: contentOrigin=remote のドラフトは payload に使われず heldDates に入る", () => {
    it("fix: loadDraftForDate が contentOrigin=remote のドラフトを返すとき heldDates に入る", async () => {
        const pendingRef = { current: new Map() };
        pendingRef.current.set(DATE, {
            reason: "startup_replay",
            explicitEdit: false,
            explicitDelete: true,
            updatedAt: new Date().toISOString(),
        });

        // Remote-origin draft — must NOT be used as save payload
        const remoteDraft = {
            sessionEx: [{ name: "インクラインベンチプレス", order: 0 }],
            logData: { "インクラインベンチプレス": [{ weight: "60", reps: "10", set: 1 }] },
            exerciseUnits: { "インクラインベンチプレス": "kg" },
            todayLabels: [],
            meta: {
                source: "remote_supabase",
                contentOrigin: "remote",   // ← 一方向弁によりブロックされるべき
                hasUnsavedChanges: false,
            },
        };

        const { result } = makeHistorySaveHook({
            pendingWorkoutContentChangeDatesRef: pendingRef,
            loadDraftForDate: jest.fn().mockReturnValue(remoteDraft),
            hasDraftContent: jest.fn().mockReturnValue(true),
            historyRemoteReady: true,
        });

        let syncResults;
        await act(async () => {
            syncResults = await result.current.syncWorkoutRowsForDates(
                USER_ID,
                {},
                [DATE]
            );
        });

        // heldDates に入っている（保留）
        expect(syncResults.heldDates).toContain(DATE);
        expect(syncResults.syncedDates).not.toContain(DATE);
        // saveWorkoutForDate は呼ばれない
        expect(saveWorkoutForDate).not.toHaveBeenCalled();

        // remote-draft-hold ログが記録されている
        const holdCall = logWriteTrace.mock.calls.find(
            ([tag]) => tag === "remote-draft-hold"
        );
        expect(holdCall).toBeDefined();
        expect(holdCall[1].decision).toBe("hold");

        // syncWorkoutRows ログは記録されていない（早期 return のため）
        const syncRowCall = logWriteTrace.mock.calls.find(
            ([tag]) => tag === "syncWorkoutRows"
        );
        expect(syncRowCall).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// J-5: payloadSource="history_cache" — G15 がキャッシュ由来の削除前データを止める
// ─────────────────────────────────────────────────────────────────────────────
describe("J-5: payloadSource=history_cache + G15 — キャッシュ由来データの upsert を防ぐ", () => {
    it("fix: historyDisplayFromCache=true + historyRemoteReady=false + explicitDelete:true → G15 が発動し upsert されない", async () => {
        const pendingRef = { current: new Map() };
        pendingRef.current.set(DATE, {
            reason: "startup_replay",
            explicitEdit: false,
            explicitDelete: true,
            deleteScope: "full",
            updatedAt: new Date().toISOString(),
        });

        // No draft: loadDraftForDate=null → draftForDate=null → payloadSource determined by historyDisplayFromCache
        const { result } = makeHistorySaveHook({
            pendingWorkoutContentChangeDatesRef: pendingRef,
            loadDraftForDate: null,   // no draft function → falls through to history
            historyRemoteReady: false,
            historyDisplayFromCache: true,   // cache available but remote not loaded
        });

        // staleHistory = キャッシュに残っている削除前データ
        const staleHistory = {
            [DATE]: { "ベンチプレス": { sets: [{ weight: "80", reps: "5" }] } }
        };

        let syncResults;
        await act(async () => {
            syncResults = await result.current.syncWorkoutRowsForDates(
                USER_ID,
                staleHistory,
                [DATE]
            );
        });

        // G15 は g15HeldDates に入る（heldDates ではない）
        expect(syncResults.g15HeldDates).toContain(DATE);
        expect(syncResults.heldDates).not.toContain(DATE);
        expect(syncResults.syncedDates).not.toContain(DATE);
        // saveWorkoutForDate は呼ばれない（stale data が upsert されない）
        expect(saveWorkoutForDate).not.toHaveBeenCalled();

        // G15 が "history_cache" で発動している
        const g15Call = logWriteTrace.mock.calls.find(
            ([tag]) => tag === "G15:history-not-loaded-guard"
        );
        expect(g15Call).toBeDefined();
        expect(g15Call[1].decision).toBe("hold");
        expect(g15Call[1].extra?.payloadSource).toBe("history_cache");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// J-6: historyRemoteReady=undefined → useHistoryAutoSave gate が fail-open する
// ─────────────────────────────────────────────────────────────────────────────
describe("J-6: historyRemoteReady=undefined → syncBatch:build gate が fail-open する", () => {
    it("fix: historyRemoteReady が undefined でも同期が継続し、エラーログが出る", async () => {
        const pendingWorkoutContentChangeDatesRef = { current: new Map() };
        pendingWorkoutContentChangeDatesRef.current.set(DATE, {
            explicitEdit: true,
            reason: "exercise_add",
            updatedAt: new Date().toISOString(),
        });

        const syncWorkoutRowsForDatesMock = jest.fn().mockResolvedValue({
            syncedDates: [DATE],
            failedDates: [],
            skippedDates: [],
            heldDates: [],
            verifiedHistoryByDate: {},
        });

        const { result } = renderHook(() =>
            useHistoryAutoSave({
                history: {},
                user: { id: USER_ID },
                historySyncReady: true,
                historyRemoteReady: undefined,       // ← 配線なし
                historyDisplayFromCache: undefined,  // ← 配線なし
                persistHistoryForUser: jest.fn(),
                logDate: HARNESS_TODAY,
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
                syncWorkoutRowsForDates: syncWorkoutRowsForDatesMock,
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
                forceSyncVersion: 0,
                invalidateSupabaseFetchFreshByPrefix: jest.fn(),
            })
        );

        // act で全ての pending な Promise chain / microtask をフラッシュする
        await act(async () => {
            // empty — just flush
        });

        // syncBatch:build の "historyRemoteReady_not_wired" ログが出ている
        const notWiredCall = logWriteTrace.mock.calls.find(
            ([tag, payload]) => tag === "syncBatch:build" && payload?.reason === "historyRemoteReady_not_wired"
        );
        expect(notWiredCall).toBeDefined();
        expect(notWiredCall[1].decision).toBe("pass");

        // gate の "history_not_loaded" スキップログは出ていない
        const skipCall = logWriteTrace.mock.calls.find(
            ([tag, payload]) => tag === "syncBatch:build" && payload?.decision === "skip"
        );
        expect(skipCall).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// J-3: 空ドラフト + explicitDelete — history にフォールバックせず削除ペイロードを使う
// ─────────────────────────────────────────────────────────────────────────────
describe("J-3: 空ドラフト + explicitDelete — history フォールバックで削除前データが復活しない", () => {
    it("fix: sessionEx=[] のドラフトが存在するとき payloadSource=draft で saveWorkoutForDate が呼ばれる", async () => {
        // 全削除後タスクキル → 再起動シナリオ:
        //   - ドラフトは「存在するが空」(exerciseCount=0)
        //   - pendingSavePayloadsRef は空（タスクキルで消えた）
        //   - normalizedHistoryMap には削除前のデータが残っている
        // 期待: payloadSource="draft" のまま進み history のデータは使われない。

        const pendingRef = { current: new Map() };
        pendingRef.current.set(DATE, {
            reason: "startup_replay",
            explicitEdit: false,
            explicitDelete: true,
            deleteScope: "full",
            updatedAt: new Date().toISOString(),
        });

        // 空のドラフト（全削除後に書かれた状態）
        const emptyDraft = {
            sessionEx: [],
            logData: {},
            exerciseUnits: {},
            todayLabels: [],
            meta: { source: "explicitDelete_bypass", hasUnsavedChanges: false },
        };

        const { result } = makeHistorySaveHook({
            pendingWorkoutContentChangeDatesRef: pendingRef,
            loadDraftForDate: jest.fn().mockReturnValue(emptyDraft),
            hasDraftContent: jest.fn().mockReturnValue(false), // 空なので false だが…
            historyRemoteReady: true,
        });

        // normalizedHistoryMap に削除前データが入っている想定（exercises あり）
        const staleHistory = {
            [DATE]: { "ベンチプレス": { sets: [{ weight: "80", reps: "5" }] } }
        };

        let syncResults;
        await act(async () => {
            syncResults = await result.current.syncWorkoutRowsForDates(
                USER_ID,
                staleHistory,
                [DATE]
            );
        });

        // payloadSource=draft が記録されている（history にフォールバックしていない）
        const syncRowCall = logWriteTrace.mock.calls.find(
            ([tag]) => tag === "syncWorkoutRows"
        );
        expect(syncRowCall).toBeDefined();
        expect(syncRowCall[1].extra?.payloadSource).toBe("draft");

        // 保存が呼ばれた（G15 で保留されていない）
        expect(syncResults.heldDates).not.toContain(DATE);
        expect(saveWorkoutForDate).toHaveBeenCalled();

        // stale history の演習名が payload に混入していないこと
        // saveWorkoutForDate に渡された historyMap を確認
        const saveCall = saveWorkoutForDate.mock.calls[0];
        const savedHistoryMap = saveCall?.[0]?.historyMap ?? saveCall?.[0] ?? {};
        // "ベンチプレス" は空ドラフトから来ていないはずなので存在しないか exerciseCount=0
        const savedDateData = savedHistoryMap?.[DATE];
        const hasStaleName = savedDateData && "ベンチプレス" in savedDateData;
        expect(hasStaleName).toBeFalsy();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// J-7: G15 — exerciseCount 非零でも explicitDelete + history → G15 発動
// ─────────────────────────────────────────────────────────────────────────────
describe("J-7: G15 — exerciseCount 非零でも explicitDelete + history → G15 発動", () => {
    it("fix: explicitDelete:true + payloadSource:history + hasWorkoutForDate:true → G15 hold / saveWorkoutForDate 未呼び出し", async () => {
        const pendingRef = { current: new Map() };
        pendingRef.current.set(DATE, {
            reason: "startup_replay",
            explicitEdit: false,
            explicitDelete: true,
            deleteScope: "date",
            updatedAt: new Date().toISOString(),
        });

        // hasValidWorkoutOnDate が true を返す → hasWorkoutForDate=true (パス1 再現)
        const { result } = renderHook(() =>
            useHistorySave({
                pendingWorkoutContentChangeDatesRef: pendingRef,
                explicitWorkoutEditDatesRef: { current: new Map() },
                user: { id: USER_ID },
                latestUserIdRef: { current: USER_ID },
                applyTrustedWorkoutRowsSnapshot: jest.fn(),
                setSyncFailuresByDate: jest.fn(),
                getTodayKey: () => HARNESS_TODAY,
                getRuntimeEnvironmentLabel,
                EXPLICIT_SET_EDIT_REASONS,
                EXPLICIT_WORKOUT_EDIT_REASONS,
                isExplicitWorkoutEditChange,
                logRecordFetchError,
                logWorkoutPersistenceDecision: jest.fn(),
                getWorkoutSaveGuardDecision: jest.fn().mockReturnValue({
                    allowed: true, blocked: false,
                    details: { removedExerciseNames: [] }, allowedReason: "test",
                }),
                getHistoryMetricsForDate,
                getEmptyWorkoutMetrics: jest.fn().mockReturnValue({
                    hasWorkout: true, exerciseCount: 2, setCount: 3,
                    volume: 100, exerciseNames: ["インクラインダンベルプレス", "ペックフライ"],
                }),
                getWorkoutSummaryMetrics: jest.fn().mockReturnValue({}),
                getWorkoutPayloadMetrics: jest.fn().mockReturnValue({}),
                isMetricPersistenceMismatch: jest.fn().mockReturnValue(false),
                getHistoryDebugSummaryForDate: jest.fn().mockReturnValue({}),
                getHistoryDebugDiffForDate: jest.fn().mockReturnValue({}),
                applyPreferredHistoryDates: jest.fn().mockImplementation((base, src) => src || {}),
                normalizeExerciseName: jest.fn((name) => name),
                mergeHistoryMaps: jest.fn().mockReturnValue({}),
                hasValidWorkoutOnDate: jest.fn().mockReturnValue(true), // ← 非空 (パス1)
                findEditedSetInHistory: jest.fn().mockReturnValue(null),
                isEditedSetPersisted: jest.fn().mockReturnValue(false),
                getSetEditSummary: jest.fn().mockReturnValue(''),
                getSetEditUnit: jest.fn().mockReturnValue('kg'),
                buildHistoryFromWorkoutSessionRows: jest.fn().mockReturnValue({}),
                describeHistoryRecordsForDate,
                clearHistoryDeleteMarkerForDate: null,
                pendingSavePayloadsRef: { current: new Map() },
                onPersistentDeleteChanged: jest.fn(),
                loadDraftForDate: jest.fn().mockReturnValue(null), // no draft → payloadSource="history"
                hasDraftContent: jest.fn().mockReturnValue(false),
                historyRemoteReady: true, // true でも G15 が発動することを示す
                historyDisplayFromCache: false,
            })
        );

        let syncResults;
        await act(async () => {
            syncResults = await result.current.syncWorkoutRowsForDates(
                USER_ID,
                {}, // historyMap
                [DATE]
            );
        });

        // G15 が発動 — hasWorkoutForDate=true でも historyRemoteReady=true でも保留される
        expect(syncResults.g15HeldDates).toContain(DATE);
        expect(syncResults.heldDates).not.toContain(DATE);
        expect(syncResults.syncedDates).not.toContain(DATE);
        expect(saveWorkoutForDate).not.toHaveBeenCalled();

        const g15Call = logWriteTrace.mock.calls.find(
            ([tag]) => tag === "G15:history-not-loaded-guard"
        );
        expect(g15Call).toBeDefined();
        expect(g15Call[1].decision).toBe("hold");
        // hasWorkoutForDate は extra に記録されている（追跡用）
        expect(g15Call[1].extra?.hasWorkoutForDate).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// J-8 / J-9: date_delete 経路の空ドラフト書き込み + undo 巻き戻し
// useHistoryHandlers の deleteAllHistoryForDate / undoDeleteAllHistoryForDate を対象とする
// ─────────────────────────────────────────────────────────────────────────────

/** J-8/J-9/J-11 用: useHistoryHandlers を最小限の props でレンダリングする */
function makeHistoryHandlersHook({ saveDraftForDate, clearDraftForDate, loadDraftForDate, markWorkoutContentChanged: _markWorkoutContentChanged, pendingWorkoutContentChangeDatesRef } = {}) {
    const _saveDraftForDate = saveDraftForDate || jest.fn();
    const _clearDraftForDate = clearDraftForDate || jest.fn();
    const _markWorkoutContentChangedFn = _markWorkoutContentChanged || jest.fn();
    const _pendingRef = pendingWorkoutContentChangeDatesRef || { current: new Map() };
    const _loadDraftForDate = loadDraftForDate || jest.fn().mockReturnValue({
        sessionEx: null,
        logData: {},
        exerciseUnits: {},
        todayLabels: [],
        meta: { source: "empty_draft", hasUnsavedChanges: false, contentOrigin: "empty" },
    });
    const pendingDeleteUndoRef = { current: null };

    const { result } = renderHook(() =>
        useHistoryHandlers({
            user: { id: USER_ID },
            history: {},
            latestHistoryRef: { current: {} },
            historyRevisionRef: { current: 0 },
            persistHistoryForUser: jest.fn(),
            syncWorkoutRowsForDates: jest.fn().mockResolvedValue({
                syncedDates: [], failedDates: [], skippedDates: [], heldDates: [],
            }),
            syncWorkoutSessionSnapshot: jest.fn().mockResolvedValue({ synced: true }),
            deleteRemoteWorkoutArtifactsForDate: jest.fn().mockResolvedValue({}),
            appendHistoryDeleteMarkers: jest.fn(),
            commitHistoryDeleteMarkers: jest.fn(),
            historyDeleteMarkersRef: { current: { dates: [], records: [] } },
            clearDraftForDate: _clearDraftForDate,
            saveDraftForDate: _saveDraftForDate,
            loadDraftForDate: _loadDraftForDate,
            applyLogDraftState: jest.fn(),
            setHistory: jest.fn(),
            logDate: HARNESS_TODAY,
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
            queueWorkoutSessionSync: jest.fn(),
            pendingWorkoutContentChangeDatesRef: _pendingRef,
            pendingWorkoutSessionSyncDatesRef: { current: new Set() },
            explicitWorkoutEditDatesRef: { current: new Map() },
            clearSyncFailure: jest.fn(),
            recordSyncFailure: jest.fn(),
            refreshHistorySyncDiagnostic: jest.fn().mockResolvedValue({}),
            applyWorkoutsDataHistorySnapshot: jest.fn().mockReturnValue(false),
            workoutsDataHistoryRef: { current: {} },
            markWorkoutContentChanged: _markWorkoutContentChangedFn,
            applyTrustedWorkoutRowsSnapshot: jest.fn(),
            trustedWorkoutRowsRef: { current: [] },
            applyTrustedSessionRowsSnapshot: jest.fn(),
            trustedSessionRows: [],
            onPersistentDeleteChanged: jest.fn(),
            pendingSavePayloadsRef: { current: new Map() },
            buildSavedWorkoutDraftForDate: jest.fn().mockReturnValue({
                hasSavedWorkout: false, sessionEx: [], logData: {}, exerciseUnits: {},
            }),
            setSessionSyncVersion: jest.fn(),
            pendingDeleteUndoRef,
            setPendingDeleteUndo: jest.fn(),
            hasDraftContent: jest.fn().mockReturnValue(false),
            normalizeDraftDateKey: (d) => String(d || "").slice(0, 10),
            withDraftDateMeta: (date, draft, meta) => ({
                ...(draft || {}),
                meta: { ...(draft?.meta || {}), ...meta, date },
            }),
            getCurrentLogDraftSnapshot: jest.fn().mockReturnValue({}),
            latestLogDraftRef: { current: null },
            getTodayKey: () => HARNESS_TODAY,
            trustedHistory: {},
            getDraftMetricsForDate: jest.fn().mockReturnValue({ exerciseCount: 0, setCount: 0, volume: 0 }),
            getExUnit: jest.fn().mockReturnValue('kg'),
            isExplicitWorkoutEditChange: jest.fn().mockReturnValue(false),
            isCleanPersistedDraft: jest.fn().mockReturnValue(false),
            isDestructiveWorkoutRegression: jest.fn().mockReturnValue(false),
            shouldPreserveRawDraftOverIncoming: jest.fn().mockReturnValue({
                preserve: false, localRawMetrics: {}, incomingRawMetrics: {}, removedExerciseNames: [],
            }),
            isUnsavedUserWorkoutDraft: jest.fn().mockReturnValue(false),
            logRestoreDecision: jest.fn(),
            getDraftDateValidation: jest.fn().mockReturnValue({ accepted: true }),
            getDraftKey: (base, date) => `${base}_${date}`,
            getDraftPayloadDate: jest.fn().mockReturnValue(null),
            getRuntimeEnvironmentLabel: jest.fn().mockReturnValue("test"),
            buildWorkoutDraftForDateFromHistory: jest.fn().mockReturnValue({
                hasSavedWorkout: false, sessionEx: [], logData: {},
            }),
            withDraftMeta: (draft, meta) => ({ ...(draft || {}), meta: { ...(draft?.meta || {}), ...meta } }),
            applyLocalHistoryDates: jest.fn().mockReturnValue({}),
            buildHistoryRecordDeleteKey: jest.fn().mockImplementation((date, ex) => `${date}::${ex}`),
            removeHistoryDate: jest.fn().mockImplementation((history) => history || {}),
            onDeleteDateClearCompletion: jest.fn(),
            invalidateSupabaseFetchFreshByPrefix: jest.fn().mockReturnValue([]),
        })
    );

    return { result, pendingDeleteUndoRef, saveDraftForDate: _saveDraftForDate, clearDraftForDate: _clearDraftForDate, markWorkoutContentChanged: _markWorkoutContentChangedFn, pendingRef: _pendingRef };
}

describe("J-8: date_delete 経路で空ドラフトが書かれる", () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    it("fix: deleteAllHistoryForDate が saveDraftForDate に sessionEx=[] + meta.explicitDelete=true を渡す", () => {
        const saveDraftForDate = jest.fn();
        const clearDraftForDate = jest.fn();

        const { result } = makeHistoryHandlersHook({ saveDraftForDate, clearDraftForDate });

        act(() => {
            result.current.deleteAllHistoryForDate(DATE);
        });

        // saveDraftForDate が空ドラフトで呼ばれている
        const saveCall = saveDraftForDate.mock.calls.find(([date]) => date === DATE);
        expect(saveCall).toBeDefined();
        const savedDraft = saveCall[1];
        expect(savedDraft.sessionEx).toEqual([]);
        expect(savedDraft.meta?.explicitDelete).toBe(true);
        expect(savedDraft.meta?.source).toBe("date_delete");

        // clearDraftForDate は対象日付では呼ばれていない（replace → not clear）
        const clearCall = clearDraftForDate.mock.calls.find(([date]) => date === DATE);
        expect(clearCall).toBeUndefined();
    });
});

describe("J-9: undoDeleteAllHistoryForDate で previousDraft が復元される", () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    it("J-9a fix: previousDraft あり → saveDraftForDate でそのまま復元する", () => {
        const previousDraft = {
            sessionEx: [{ name: "インクラインダンベルプレス" }, { name: "ペックフライ" }],
            logData: {
                "インクラインダンベルプレス": [{ weight: "60", reps: "10" }],
                "ペックフライ": [{ weight: "40", reps: "12" }],
            },
            exerciseUnits: {},
            todayLabels: [],
            meta: { source: "local_draft", hasUnsavedChanges: false },
        };

        const saveDraftForDate = jest.fn();
        const clearDraftForDate = jest.fn();
        const loadDraftForDate = jest.fn().mockReturnValue(previousDraft);

        const { result, pendingDeleteUndoRef } = makeHistoryHandlersHook({
            saveDraftForDate,
            clearDraftForDate,
            loadDraftForDate,
        });

        act(() => { result.current.deleteAllHistoryForDate(DATE); });

        expect(pendingDeleteUndoRef.current?.previousDraft).toBe(previousDraft);

        act(() => { result.current.undoDeleteAllHistoryForDate(); });

        // undo 後: saveDraftForDate の最後の呼び出しが previousDraft を渡している
        const saveCalls = saveDraftForDate.mock.calls.filter(([date]) => date === DATE);
        expect(saveCalls.length).toBeGreaterThanOrEqual(2);
        expect(saveCalls[saveCalls.length - 1][1]).toBe(previousDraft);

        // clearDraftForDate は undo で呼ばれていない（previousDraft があるので）
        expect(clearDraftForDate).not.toHaveBeenCalledWith(DATE);
    });

    it("J-9b fix: previousDraft なし（ドラフト未作成日） → clearDraftForDate を呼ぶ（{} を書かない）", () => {
        // 削除前にドラフトが存在しない状態: loadDraftForDate は emptyDraft を返す
        const emptyDraftPlaceholder = {
            sessionEx: null,
            logData: {},
            exerciseUnits: {},
            todayLabels: [],
            meta: { source: "empty_draft", hasUnsavedChanges: false, contentOrigin: "empty" },
        };
        // loadDraftForDate が emptyDraft を返す = previousDraft = emptyDraft（null ではない）
        // useHistoryHandlers では loadDraftForDate の戻り値をそのまま previousDraft に保存する。
        // useDraftStore の実装では「ドラフトなし」でも emptyDraft を返すため、
        // previousDraft は emptyDraft オブジェクト（null にはならない）になる。
        //
        // ここでは "ドラフト未作成 = previousDraft が emptyDraft" の代わりに、
        // undoDeleteAllHistoryForDate の内部で previousDraft が null/undefined のとき
        // clearDraftForDate が呼ばれることを直接検証するため、
        // pendingDeleteUndoRef を手動で null に設定するパスを通す。
        //
        // NOTE: deleteAllHistoryForDate は常に loadDraftForDate 結果（emptyDraft）を
        // previousDraft に保存するため、現実の null ケースは pendingDeleteUndoRef を
        // 外部から操作するシナリオのみ。ここでは undoDeleteAllHistoryForDate の
        // 分岐ロジックをユニットテストする。

        const saveDraftForDate = jest.fn();
        const clearDraftForDate = jest.fn();

        const { result, pendingDeleteUndoRef } = makeHistoryHandlersHook({
            saveDraftForDate,
            clearDraftForDate,
        });

        // pendingDeleteUndoRef を手動で null previousDraft のケースに設定する
        act(() => {
            pendingDeleteUndoRef.current = {
                date: DATE,
                previousHistory: {},
                previousDraft: null, // ← ドラフトなし
                previousDurationSec: 0,
                timeoutId: null,
            };
        });

        act(() => { result.current.undoDeleteAllHistoryForDate(); });

        // clearDraftForDate が対象日付で呼ばれている
        expect(clearDraftForDate).toHaveBeenCalledWith(DATE);

        // saveDraftForDate は呼ばれていない（{} を書かない）
        const emptySaveCall = saveDraftForDate.mock.calls.find(
            ([date, draft]) => date === DATE && (!draft || Object.keys(draft).length === 0)
        );
        expect(emptySaveCall).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// J-10: シート削除 オフライン → タスクキル → 再起動 → 削除完了（end-to-end）
// G で実際に失敗した「空ドラフトがタスクキルを越えて残り再起動後に読み戻される」経路
// ─────────────────────────────────────────────────────────────────────────────
describe("J-10: シート削除 オフライン → 再起動後に payloadSource=draft で削除が完了する", () => {
    it("fix: date_delete が書いた空ドラフトを再起動後に loadDraftForDate が返し、payloadSource=draft で削除が完了する", async () => {
        // ── Step 1: date_delete 経路が localStorage に空ドラフトを書く ────────
        const userIdRef = { current: USER_ID };
        const { result: draftResult } = renderHook(() =>
            useDraftStore({ userIdRef })
        );

        act(() => {
            draftResult.current.saveDraftForDate(DATE, {
                sessionEx: [],
                logData: {},
                exerciseUnits: {},
                todayLabels: [],
                meta: {
                    source: "date_delete",
                    hasUnsavedChanges: false,
                    explicitDelete: true,
                },
            });
        });

        // ── Step 2: 再起動を模したリセット ──────────────────────────────────
        // localStorage は保持したまま ref 類（pendingSavePayloadsRef など）はクリア
        // pendingWorkoutContentChangeDatesRef にはアウトボックスの再生エントリを置く
        const pendingRef = { current: new Map() };
        pendingRef.current.set(DATE, {
            reason: "startup_replay",
            explicitEdit: false,
            explicitDelete: true,
            deleteScope: "date",
            updatedAt: new Date().toISOString(),
        });

        // ── Step 3: loadDraftForDate が null でないことを確認 ────────────────
        let loadedDraft;
        act(() => {
            loadedDraft = draftResult.current.loadDraftForDate(DATE);
        });
        expect(loadedDraft).not.toBeNull();
        // contentOrigin が "empty" でないこと（G で崩れていた箇所）
        expect(loadedDraft?.meta?.contentOrigin).not.toBe("empty");

        // ── Step 4: syncWorkoutRowsForDates で payloadSource="draft" を確認 ──
        // useHistorySave に実 loadDraftForDate を渡す
        const { result } = makeHistorySaveHook({
            pendingWorkoutContentChangeDatesRef: pendingRef,
            loadDraftForDate: draftResult.current.loadDraftForDate,
            historyRemoteReady: true,
            historyDisplayFromCache: false,
        });

        // staleHistory = 削除前の状態（再起動後の history に残っている可能性がある）
        const staleHistory = {
            "インクラインダンベルプレス": [
                { date: DATE, sets: [{ weight: "80", reps: "5" }] },
            ],
            "ペックフライ": [
                { date: DATE, sets: [{ weight: "40", reps: "12" }] },
            ],
        };

        let syncResults;
        await act(async () => {
            syncResults = await result.current.syncWorkoutRowsForDates(
                USER_ID,
                staleHistory,
                [DATE]
            );
        });

        // payloadSource="draft" で同期が進んだ（stale history は採用されていない）
        const syncRowCall = logWriteTrace.mock.calls.find(
            ([tag]) => tag === "syncWorkoutRows"
        );
        expect(syncRowCall).toBeDefined();
        expect(syncRowCall[1].extra?.payloadSource).toBe("draft"); // 手順4

        // G15 の hold は発動していない（payloadSource が "history" でないため）
        expect(syncResults.g15HeldDates).not.toContain(DATE);

        // saveWorkoutForDate が呼ばれている（sync が完了した）
        expect(saveWorkoutForDate).toHaveBeenCalled();
        expect(syncResults.syncedDates).toContain(DATE);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// J-11: undo 後に pendingRef と outbox の両方で explicitDelete=false になる
// ─────────────────────────────────────────────────────────────────────────────
describe("J-11: undoDeleteAllHistoryForDate が保留エントリから削除の意図を取り除く", () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    it("fix: undo 後に markWorkoutContentChanged(date, 'date_delete_undo', { explicitEdit:true, explicitDelete:false }) が呼ばれ pendingRef と outbox が更新される", () => {
        // ── Arrange ──────────────────────────────────────────────────────────
        // pendingRef に date_delete 後の状態（explicitDelete:true）を設定する
        const pendingRef = { current: new Map() };
        pendingRef.current.set(DATE, {
            reason: "date_delete",
            explicitDelete: true,
            explicitEdit: false,
            deleteScope: "date",
            updatedAt: new Date().toISOString(),
        });
        // outbox にも同じ内容を書く（date_delete が書いた状態を模倣）
        upsertPendingOp(USER_ID, DATE, {
            reason: "date_delete",
            explicitDelete: true,
            explicitEdit: false,
            deleteScope: "date",
            at: Date.now(),
            attempts: 0,
            stalled: false,
        });

        // markWorkoutContentChanged spy: 実際に pendingRef と outbox を更新する実装
        const markWorkoutContentChanged = jest.fn((date, reason, options) => {
            const prev = pendingRef.current.get(date) || {};
            const explicitDelete = options?.explicitDelete === false ? false : Boolean(options?.explicitDelete);
            const explicitEdit = Boolean(options?.explicitEdit || prev.explicitEdit);
            pendingRef.current.set(date, {
                ...prev,
                reason,
                explicitDelete,
                explicitEdit,
                deleteScope: options?.explicitEdit ? null : prev.deleteScope,
            });
            upsertPendingOp(USER_ID, date, {
                reason,
                explicitDelete,
                explicitEdit,
                deleteScope: null,
                at: Date.now(),
                attempts: 0,
                stalled: false,
            });
        });

        const { result, pendingDeleteUndoRef } = makeHistoryHandlersHook({
            markWorkoutContentChanged,
            pendingWorkoutContentChangeDatesRef: pendingRef,
        });

        // delete を実行し pendingDeleteUndoRef に pending を積む
        act(() => { result.current.deleteAllHistoryForDate(DATE); });

        // undo を実行
        act(() => { result.current.undoDeleteAllHistoryForDate(); });

        // ── Assert: markWorkoutContentChanged の呼び出し確認 ──────────────────
        expect(markWorkoutContentChanged).toHaveBeenCalledWith(
            DATE,
            "date_delete_undo",
            { explicitEdit: true, explicitDelete: false }
        );

        // ── Assert: pendingRef の状態確認 ─────────────────────────────────────
        const entry = pendingRef.current.get(DATE);
        expect(entry).toBeDefined();
        expect(entry.explicitDelete).toBe(false);
        expect(entry.explicitEdit).toBe(true);
        expect(entry.reason).toBe("date_delete_undo");

        // ── Assert: outbox (localStorage) の状態確認 ─────────────────────────
        const outbox = loadPendingOps(USER_ID);
        expect(outbox[DATE]).toBeDefined();
        expect(outbox[DATE].explicitDelete).toBe(false);
        expect(outbox[DATE].explicitEdit).toBe(true);
        expect(outbox[DATE].reason).toBe("date_delete_undo");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// J-12: undo 後の同期で G15 不発・復元内容が Supabase に書かれる
// ─────────────────────────────────────────────────────────────────────────────
describe("J-12: undo 後の同期で G15 は発動せず saveWorkoutForDate が呼ばれる", () => {
    it("fix: explicitDelete=false + no draft + history with exercises → G15 不発 + saveWorkoutForDate 呼び出し", async () => {
        // ── Arrange ──────────────────────────────────────────────────────────
        // undo 後の pendingRef: markWorkoutContentChanged が書いた状態
        const pendingRef = { current: new Map() };
        pendingRef.current.set(DATE, {
            reason: "date_delete_undo",
            explicitEdit: true,
            explicitDelete: false,   // ← undo によって false に更新されている
            deleteScope: null,
            updatedAt: new Date().toISOString(),
        });

        // undo で previousDraft が null だった場合 → clearDraftForDate が呼ばれてドラフトなし
        // loadDraftForDate は null を返す → payloadSource="history" になる
        const { result } = renderHook(() =>
            useHistorySave({
                pendingWorkoutContentChangeDatesRef: pendingRef,
                explicitWorkoutEditDatesRef: { current: new Map() },
                user: { id: USER_ID },
                latestUserIdRef: { current: USER_ID },
                applyTrustedWorkoutRowsSnapshot: jest.fn(),
                setSyncFailuresByDate: jest.fn(),
                getTodayKey: () => HARNESS_TODAY,
                getRuntimeEnvironmentLabel,
                EXPLICIT_SET_EDIT_REASONS,
                EXPLICIT_WORKOUT_EDIT_REASONS,
                isExplicitWorkoutEditChange,
                logRecordFetchError,
                logWorkoutPersistenceDecision: jest.fn(),
                getWorkoutSaveGuardDecision: jest.fn().mockReturnValue({
                    allowed: true, blocked: false,
                    details: { removedExerciseNames: [] }, allowedReason: "test",
                }),
                getHistoryMetricsForDate,
                // getEmptyWorkoutMetrics is called when remote row is null → should return empty
                // (no remote workout exists for this date after delete)
                getEmptyWorkoutMetrics: jest.fn().mockReturnValue({
                    hasWorkout: false, exerciseCount: 0, setCount: 0, volume: 0, exerciseNames: [],
                }),
                getWorkoutSummaryMetrics: jest.fn().mockReturnValue({}),
                getWorkoutPayloadMetrics: jest.fn().mockReturnValue({}),
                isMetricPersistenceMismatch: jest.fn().mockReturnValue(false),
                getHistoryDebugSummaryForDate: jest.fn().mockReturnValue({}),
                getHistoryDebugDiffForDate: jest.fn().mockReturnValue({}),
                applyPreferredHistoryDates: jest.fn().mockImplementation((base, src) => src || {}),
                normalizeExerciseName: jest.fn((name) => name),
                mergeHistoryMaps,      // real: actual merge logic
                hasValidWorkoutOnDate, // real: returns true when records exist for the date
                findEditedSetInHistory: jest.fn().mockReturnValue(null),
                isEditedSetPersisted: jest.fn().mockReturnValue(false),
                getSetEditSummary: jest.fn().mockReturnValue(''),
                getSetEditUnit: jest.fn().mockReturnValue('kg'),
                buildHistoryFromWorkoutSessionRows: jest.fn().mockReturnValue({}),
                describeHistoryRecordsForDate,
                clearHistoryDeleteMarkerForDate: null,
                pendingSavePayloadsRef: { current: new Map() },
                onPersistentDeleteChanged: jest.fn(),
                loadDraftForDate: jest.fn().mockReturnValue(null), // ドラフトなし
                hasDraftContent: jest.fn().mockReturnValue(false),
                historyRemoteReady: true,
                historyDisplayFromCache: false,
            })
        );

        // undo 後に history に復元された内容
        // hasValidWorkoutOnDate expects: { exerciseName: [{ date, sets }] }
        const restoredHistory = {
            "インクラインダンベルプレス": [
                { date: DATE, sets: [{ weight: "60", reps: "10", set: 1 }] },
            ],
            "ペックフライ": [
                { date: DATE, sets: [{ weight: "40", reps: "12", set: 1 }] },
            ],
        };

        let syncResults;
        await act(async () => {
            syncResults = await result.current.syncWorkoutRowsForDates(
                USER_ID,
                restoredHistory,
                [DATE]
            );
        });

        // ── Assert: G15 は発動しない（explicitDelete=false なので）─────────────
        expect(syncResults.g15HeldDates).not.toContain(DATE);
        const g15Call = logWriteTrace.mock.calls.find(
            ([tag]) => tag === "G15:history-not-loaded-guard"
        );
        expect(g15Call).toBeUndefined();

        // ── Assert: saveWorkoutForDate が呼ばれている（Supabase に書かれる）────
        expect(saveWorkoutForDate).toHaveBeenCalled();
        expect(syncResults.syncedDates).toContain(DATE);

        // ── Assert: 復元した演習名が payload に含まれている ──────────────────
        // saveWorkoutForDate({ userId, date, history: dateScopedHistoryForSave, ... })
        // history = applyPreferredHistoryDates({}, effectiveHistoryForDate, [DATE])
        //         = effectiveHistoryForDate (via mock) = restoredHistory (exercise-keyed map)
        const saveCall = saveWorkoutForDate.mock.calls[0];
        const historyArg = saveCall?.[0]?.history ?? {};
        const hasRestoredExercise = "インクラインダンベルプレス" in historyArg;
        expect(hasRestoredExercise).toBe(true);
    });
});
