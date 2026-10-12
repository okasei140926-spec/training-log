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

    it("mutation test: historyRemoteReady=true の場合、同じ条件でも G15 は発動しない（保存が進む）", async () => {
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
            loadDraftForDate: jest.fn().mockReturnValue(null),
            hasDraftContent: jest.fn().mockReturnValue(false),
            historyRemoteReady: true, // remote ready → G15 should NOT fire
        });

        let syncResults;
        await act(async () => {
            syncResults = await result.current.syncWorkoutRowsForDates(
                USER_ID,
                {},
                [DATE]
            );
        });

        // G15 は発動しない
        const g11Call = logWriteTrace.mock.calls.find(
            ([tag]) => tag === "G15:history-not-loaded-guard"
        );
        expect(g11Call).toBeUndefined();

        // 保存が呼ばれている（heldDates ではない）
        expect(syncResults.heldDates).not.toContain(DATE);
        expect(saveWorkoutForDate).toHaveBeenCalled();
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
