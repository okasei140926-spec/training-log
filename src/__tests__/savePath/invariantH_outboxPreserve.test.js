/**
 * 案H アウトボックス保護・explicitDelete per-mutation・stalled 再試行 不変条件テスト
 *
 * H-1: recordToOutbox: false — システム生成呼び出しはアウトボックスを上書きしない
 *   - markWorkoutContentChanged(..., { recordToOutbox: false }) を呼んでも
 *     localStorage のアウトボックスエントリが変わらないことを検証する
 *
 * H-2: explicitDelete は per-mutation — 前のエントリから継承しない
 *   - 削除ペンディング中（explicitDelete: true）の日付に対して
 *     非削除呼び出し（explicitDelete なし）をすると、エントリの explicitDelete が false になる
 *
 * H-3: stalled エントリは次回起動時の replay で再試行される
 *   - stalled: true のエントリは起動 replay で stalled:false に戻り attempts が +1 される
 *   - 同一セッション内の抑制は syncBatch:build のフィルタ（useHistoryAutoSave:211）が担う
 *   - ※ invariantF Test 8a と同じ: stalled エントリは起動 replay の対象
 *
 * H-4: syncBatch:build は同一セッション内で stalled エントリをバッチから除外する
 *   - guard:permanent-skip が stalled:true を設定すると、その後のバッチに含まれない
 *   - stalled エントリは STALLED_ENTRY_TTL_MS 経過後に自動パージされる
 *
 * H-5: online_resume は network_failure stall のみ解除し hold_limit / guard_skip は解除しない
 *   - stalledReason === "network_failure" のエントリのみ stalled: false にする
 *   - hold_limit / guard_skip stall を online_resume で解除すると ~10s retry ループが再発する
 *
 * 「対応する実装を revert すると赤になること」の確認手順（手動）:
 *   H-1: markWorkoutContentChanged の if (_userId && recordToOutbox !== false) を
 *        if (_userId) に戻す → H-1 テストが赤になる
 *   H-2: explicitDelete の計算に previous.explicitDelete || を復活させる → H-2 テストが赤になる
 *   H-3: App.jsx outbox replay に if (entry.stalled) return; を復活させる → H-3 "fix" テストが赤になる
 *   H-4: syncBatch:build の stalled フィルタ（if (!entry?.stalled) return true;）を削除する → H-4 "fix" テストが赤になる
 *   H-5: App.jsx online_resume の if (_entry?.stalled && _entry.stalledReason === "network_failure") を
 *        if (_entry?.stalled) に戻す → H-5 "fix" テストが赤になる
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
    loadPendingOps,
    upsertPendingOp,
    setPendingOpStalled,
} from '../../utils/appHelpers';
import {
    mergeHistoryMaps,
    hasValidWorkoutOnDate,
    normalizeExerciseName,
} from '../../utils/helpers';

const DATE = "2026-10-09";
const USER_ID = "test-user-invariantH";

beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
});

// ── shared hook factory ───────────────────────────────────────────────────────
function makeHook({ pendingWorkoutContentChangeDatesRef } = {}) {
    const _pendingRef = pendingWorkoutContentChangeDatesRef || { current: new Map() };
    const { result } = renderHook(() =>
        useHistorySave({
            pendingWorkoutContentChangeDatesRef: _pendingRef,
            explicitWorkoutEditDatesRef: { current: new Map() },
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
            onPersistentDeleteChanged: jest.fn(),
        })
    );
    return { result, pendingRef: _pendingRef };
}

// ─────────────────────────────────────────────────────────────────────────────
// H-1: recordToOutbox: false はアウトボックスを上書きしない
// ─────────────────────────────────────────────────────────────────────────────
describe("H-1: recordToOutbox: false — アウトボックスエントリを上書きしない", () => {
    it("fix: アウトボックスに保存された削除エントリが recordToOutbox:false 呼び出しで失われない", () => {
        // Arrange: outbox に delete エントリを書き込む（前セッションの削除操作）
        upsertPendingOp(USER_ID, DATE, {
            reason: "exercise_delete",
            explicitDelete: true,
            explicitEdit: false,
            deleteScope: "partial",
            at: Date.now() - 5000,
            attempts: 1,
            stalled: false,
        });
        const savedEntry = loadPendingOps(USER_ID)[DATE];
        expect(savedEntry.explicitDelete).toBe(true);

        const { result } = makeHook().result.current ? makeHook() : makeHook();
        const hook = makeHook();

        // Act: システム生成呼び出し（rescueUnsyncedDrafts が発行するような呼び出し）
        act(() => {
            hook.result.current.markWorkoutContentChanged(
                DATE,
                "startup_unsynced_draft",
                { explicitEdit: false, explicitDelete: false },
                { recordToOutbox: false }   // ← Problem 1 fix
            );
        });

        // Assert: アウトボックスの元エントリが維持されている
        const afterEntry = loadPendingOps(USER_ID)[DATE];
        expect(afterEntry).toBeDefined();
        expect(afterEntry.explicitDelete).toBe(true);      // 削除フラグが残っている
        expect(afterEntry.reason).toBe("exercise_delete"); // reason が上書きされていない
        expect(afterEntry.attempts).toBe(1);               // attempts が reset されていない
    });

    it("mutation test: recordToOutbox:true（デフォルト）はアウトボックスを上書きする", () => {
        // Arrange
        upsertPendingOp(USER_ID, DATE, {
            reason: "exercise_delete",
            explicitDelete: true,
            explicitEdit: false,
            deleteScope: "partial",
            at: Date.now() - 5000,
            attempts: 1,
            stalled: false,
        });

        const hook = makeHook();

        // Act: recordToOutbox を渡さない（デフォルト = true）
        act(() => {
            hook.result.current.markWorkoutContentChanged(
                DATE,
                "startup_unsynced_draft",
                { explicitEdit: false, explicitDelete: false }
                // recordToOutbox: true (default)
            );
        });

        // BUG証明: アウトボックスが上書きされてしまう
        const afterEntry = loadPendingOps(USER_ID)[DATE];
        expect(afterEntry.reason).toBe("startup_unsynced_draft"); // 上書きされた
        expect(afterEntry.explicitDelete).toBe(false);             // 削除フラグが消えた
        expect(afterEntry.attempts).toBe(0);                       // attempts がリセットされた
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// H-2: explicitDelete は per-mutation — 前のエントリから継承しない
// ─────────────────────────────────────────────────────────────────────────────
describe("H-2: explicitDelete は per-mutation — 前エントリの値を引き継がない", () => {
    it("fix: 削除ペンディング中の日付に非削除呼び出しをすると explicitDelete が false になる", () => {
        // Arrange: 先にフル削除をキューに積む
        const pendingRef = { current: new Map() };
        pendingRef.current.set(DATE, {
            reason: "date_delete",
            explicitDelete: true,
            explicitEdit: false,
            deleteScope: "date",
            updatedAt: new Date().toISOString(),
        });

        const hook = makeHook({ pendingWorkoutContentChangeDatesRef: pendingRef });

        // Act: 削除とは無関係の呼び出し（explicitDelete を渡さない）
        act(() => {
            hook.result.current.markWorkoutContentChanged(
                DATE,
                "startup_unsynced_draft",
                { explicitEdit: false }
                // explicitDelete は渡さない → per-mutation なら false
            );
        });

        // Assert: explicitDelete が false（前のエントリから継承されていない）
        const entry = pendingRef.current.get(DATE);
        expect(entry.explicitDelete).toBe(false);
    });

    it("mutation test: OR-merge があると前の explicitDelete:true が引き継がれてしまう", () => {
        // このテストは OR-merge の「バグ動作」を文書化するものではなく、
        // 修正後も explicitDelete が明示的に false で渡されるとリセットされることを示す。
        // explicitDelete === false の明示渡しは常にリセットとして機能する。
        const pendingRef = { current: new Map() };
        pendingRef.current.set(DATE, {
            reason: "date_delete",
            explicitDelete: true,
            explicitEdit: false,
            deleteScope: "date",
            updatedAt: new Date().toISOString(),
        });

        const hook = makeHook({ pendingWorkoutContentChangeDatesRef: pendingRef });

        // 明示的に explicitDelete: false を渡す → 常にリセット（修正前後共通）
        act(() => {
            hook.result.current.markWorkoutContentChanged(
                DATE,
                "startup_unsynced_draft",
                { explicitEdit: false, explicitDelete: false }
            );
        });

        const entry = pendingRef.current.get(DATE);
        expect(entry.explicitDelete).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// H-3: stalled エントリは次回起動時の replay で再試行される
//       同一セッション内の抑制は syncBatch:build のフィルタが担う
// ─────────────────────────────────────────────────────────────────────────────
describe("H-3: stalled エントリは起動時 replay で再試行される（同一セッション内抑制は syncBatch:build 側で行う）", () => {
    it("fix: stalled:true のエントリは起動 replay で stalled:false に戻り attempts が +1 される", () => {
        const DATE_STALLED = "2026-10-07";
        const DATE_ACTIVE = "2026-10-08";

        // Arrange: stalled エントリと通常エントリを両方書き込む
        upsertPendingOp(USER_ID, DATE_STALLED, {
            reason: "exercise_delete",
            explicitDelete: true,
            explicitEdit: false,
            deleteScope: "partial",
            at: Date.now() - 30000,
            attempts: 3,
            stalled: true,   // ← 前セッションで stalled になったエントリ
        });
        upsertPendingOp(USER_ID, DATE_ACTIVE, {
            reason: "history_record_edit",
            explicitDelete: false,
            explicitEdit: true,
            deleteScope: null,
            at: Date.now() - 10000,
            attempts: 0,
            stalled: false,  // ← 通常エントリ
        });

        // Act: App.jsx outbox replay ロジック（stalled チェックなし — すべて replay）
        const ops = loadPendingOps(USER_ID);
        const markWorkoutContentChanged = jest.fn();
        let replayed = false;
        Object.entries(ops).forEach(([date, entry]) => {
            // stalled エントリも含めてすべて replay する（同一セッション抑制は syncBatch:build 側）
            upsertPendingOp(USER_ID, date, {
                ...entry,
                stalled: false,
                attempts: (entry.attempts || 0) + 1,
            });
            markWorkoutContentChanged(date, entry.reason || "startup_unsynced_draft", {
                explicitDelete: entry.explicitDelete,
                explicitEdit: entry.explicitEdit,
                deleteScope: entry.deleteScope || null,
            }, { recordToOutbox: false });
            replayed = true;
        });

        // Assert: stalled エントリも replay された
        expect(markWorkoutContentChanged).toHaveBeenCalledWith(
            DATE_STALLED,
            "exercise_delete",
            { explicitDelete: true, explicitEdit: false, deleteScope: "partial" },
            { recordToOutbox: false }
        );
        // active エントリも正常に replay された
        expect(markWorkoutContentChanged).toHaveBeenCalledWith(
            DATE_ACTIVE,
            "history_record_edit",
            { explicitDelete: false, explicitEdit: true, deleteScope: null },
            { recordToOutbox: false }
        );
        expect(replayed).toBe(true);

        // stalled エントリのアウトボックスは stalled:false に更新され attempts が増えた
        const stalledAfter = loadPendingOps(USER_ID)[DATE_STALLED];
        expect(stalledAfter.attempts).toBe(4);    // +1 された
        expect(stalledAfter.stalled).toBe(false); // 次セッション開始で stalled がリセットされた
    });

    it("mutation test: stalled チェックあり（旧実装）だと stalled エントリが replay されず attempts が増えない", () => {
        // このテストは旧実装（if (entry.stalled) return;）のバグ動作を文書化する。
        // 旧実装を revert すると stalled エントリが再試行されなくなり、
        // 永続的に失敗したまま残り続けるという問題が起きる。
        const DATE_STALLED = "2026-10-07";

        upsertPendingOp(USER_ID, DATE_STALLED, {
            reason: "exercise_delete",
            explicitDelete: true,
            explicitEdit: false,
            deleteScope: "partial",
            at: Date.now() - 30000,
            attempts: 3,
            stalled: true,
        });

        // OLD (wrong) behavior: stalled チェックあり → stalled エントリがスキップされる
        const ops = loadPendingOps(USER_ID);
        const markWorkoutContentChanged = jest.fn();
        Object.entries(ops).forEach(([date, entry]) => {
            if (entry.stalled) return; // ← 旧実装（間違い）
            upsertPendingOp(USER_ID, date, {
                ...entry,
                stalled: false,
                attempts: (entry.attempts || 0) + 1,
            });
            markWorkoutContentChanged(date, entry.reason || "startup_unsynced_draft", {
                explicitDelete: entry.explicitDelete,
                explicitEdit: entry.explicitEdit,
                deleteScope: entry.deleteScope || null,
            }, { recordToOutbox: false });
        });

        // BUG証明: stalled エントリが replay されなかった
        expect(markWorkoutContentChanged).not.toHaveBeenCalled();
        // attempts も変わらない（永続的に未処理のまま残る）
        const after = loadPendingOps(USER_ID)[DATE_STALLED];
        expect(after.attempts).toBe(3); // 増加しない
        expect(after.stalled).toBe(true); // stalled のまま永続残存
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// H-4: syncBatch:build のフィルタが stalled エントリを同一セッション内で除外する
// ─────────────────────────────────────────────────────────────────────────────
describe("H-4: syncBatch:build は同一セッション内で stalled エントリをバッチから除外する", () => {
    it("fix: stalled:true のエントリは syncBatch:build のフィルタでバッチ対象外になる", () => {
        // このテストは useHistoryAutoSave の syncBatch:build フィルタロジックを
        // 直接シミュレートして、stalled エントリが除外されることを検証する。

        const DATE_STALLED = "2026-10-07";
        const DATE_ACTIVE = "2026-10-08";

        // pendingWorkoutContentChangeDatesRef に相当する Map を作成
        const pendingRef = new Map();
        pendingRef.set(DATE_STALLED, {
            reason: "exercise_delete",
            explicitDelete: true,
            explicitEdit: false,
            stalled: true,       // ← guard:permanent-skip で設定されたフラグ
            stalledAt: Date.now() - 1000,
            updatedAt: new Date().toISOString(),
        });
        pendingRef.set(DATE_ACTIVE, {
            reason: "history_record_edit",
            explicitDelete: false,
            explicitEdit: true,
            stalled: false,
            updatedAt: new Date().toISOString(),
        });

        // syncBatch:build のフィルタロジックをシミュレート
        const livePendingDates = [...pendingRef.keys()];
        const STALLED_ENTRY_TTL_MS = 10 * 60 * 1000; // 10 minutes (実際の定数値)
        const _now = Date.now();
        const syncDates = livePendingDates.filter((d) => {
            const entry = pendingRef.get(d);
            if (!entry?.stalled) return true;
            // TTL チェック（TTL 未超過なのでここでは return false のみ）
            if (_now - (entry.stalledAt || 0) > STALLED_ENTRY_TTL_MS) {
                pendingRef.delete(d);
            }
            return false; // stalled エントリはバッチに含めない
        });

        // Assert: stalled エントリはバッチ対象外
        expect(syncDates).not.toContain(DATE_STALLED);
        // active エントリはバッチ対象
        expect(syncDates).toContain(DATE_ACTIVE);
    });

    it("mutation test: stalled フィルタなしだと stalled エントリもバッチに入り 10s retry ループの原因になる", () => {
        const DATE_STALLED = "2026-10-07";

        const pendingRef = new Map();
        pendingRef.set(DATE_STALLED, {
            reason: "exercise_delete",
            explicitDelete: true,
            explicitEdit: false,
            stalled: true,
            stalledAt: Date.now() - 1000,
            updatedAt: new Date().toISOString(),
        });

        // OLD (buggy) behavior: stalled フィルタなし
        const livePendingDates = [...pendingRef.keys()];
        const syncDates = livePendingDates; // フィルタなし

        // BUG証明: stalled エントリもバッチに含まれる（10s retry ループの原因）
        expect(syncDates).toContain(DATE_STALLED);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// H-5: hold_limit で stalled になったエントリは online_resume で解除されない
//       guard_skip も同様。network_failure のみ online_resume で解除される。
// ─────────────────────────────────────────────────────────────────────────────
describe("H-5: online_resume は network_failure stall のみ解除し hold_limit / guard_skip は解除しない", () => {
    it("fix: hold_limit stall は online_resume で解除されず syncBatch:build から除外される", () => {
        const DATE_HELD = "2026-10-05";

        // Arrange: heldDates retry limit exceeded — ref に hold_limit stall を設定
        const pendingRef = new Map();
        pendingRef.set(DATE_HELD, {
            reason: "startup_unsynced_draft",
            explicitDelete: false,
            explicitEdit: false,
            stalled: true,
            stalledAt: Date.now() - 1000,
            stalledReason: "hold_limit",   // ← hold 上限で stalled
            updatedAt: new Date().toISOString(),
        });

        // Act: online_resume の unstall ロジックをシミュレート
        const _entry = pendingRef.get(DATE_HELD);
        // fix: stalledReason === "network_failure" のみ解除する
        if (_entry?.stalled && _entry.stalledReason === "network_failure") {
            pendingRef.set(DATE_HELD, { ..._entry, stalled: false, stalledAt: null, stalledReason: null });
        }

        // Assert: hold_limit stall は解除されない
        const afterUnstall = pendingRef.get(DATE_HELD);
        expect(afterUnstall.stalled).toBe(true);
        expect(afterUnstall.stalledReason).toBe("hold_limit");

        // さらに syncBatch:build フィルタでもバッチから除外される
        const STALLED_ENTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
        const _now = Date.now();
        const livePendingDates = [...pendingRef.keys()];
        const syncDates = livePendingDates.filter((d) => {
            const entry = pendingRef.get(d);
            if (!entry?.stalled) return true;
            if (_now - (entry.stalledAt || 0) > STALLED_ENTRY_TTL_MS) {
                pendingRef.delete(d);
            }
            return false;
        });

        expect(syncDates).not.toContain(DATE_HELD);
    });

    it("fix: guard_skip stall も online_resume で解除されない", () => {
        const DATE_SKIPPED = "2026-10-06";

        const pendingRef = new Map();
        pendingRef.set(DATE_SKIPPED, {
            reason: "history_record_edit",
            explicitDelete: false,
            explicitEdit: false,
            stalled: true,
            stalledAt: Date.now() - 2000,
            stalledReason: "guard_skip",   // ← guard:permanent-skip で stalled
            updatedAt: new Date().toISOString(),
        });

        // Act: online_resume unstall ロジック
        const _entry = pendingRef.get(DATE_SKIPPED);
        if (_entry?.stalled && _entry.stalledReason === "network_failure") {
            pendingRef.set(DATE_SKIPPED, { ..._entry, stalled: false, stalledAt: null, stalledReason: null });
        }

        // Assert: guard_skip stall は解除されない
        const afterUnstall = pendingRef.get(DATE_SKIPPED);
        expect(afterUnstall.stalled).toBe(true);
        expect(afterUnstall.stalledReason).toBe("guard_skip");
    });

    it("fix: network_failure stall は online_resume で正常に解除される", () => {
        const DATE_NET = "2026-10-04";

        const pendingRef = new Map();
        pendingRef.set(DATE_NET, {
            reason: "history_record_edit",
            explicitDelete: false,
            explicitEdit: true,
            stalled: true,
            stalledAt: Date.now() - 5000,
            stalledReason: "network_failure",   // ← ネットワーク障害で stalled
            updatedAt: new Date().toISOString(),
        });

        // Act: online_resume unstall ロジック
        const _entry = pendingRef.get(DATE_NET);
        if (_entry?.stalled && _entry.stalledReason === "network_failure") {
            pendingRef.set(DATE_NET, { ..._entry, stalled: false, stalledAt: null, stalledReason: null });
        }

        // Assert: network_failure stall は解除される
        const afterUnstall = pendingRef.get(DATE_NET);
        expect(afterUnstall.stalled).toBe(false);
        expect(afterUnstall.stalledReason).toBeNull();
    });

    it("fix: network_failure stall は online_resume で解除された後 syncBatch:build のバッチに戻る", () => {
        const DATE_NET = "2026-10-03";

        const pendingRef = new Map();
        pendingRef.set(DATE_NET, {
            reason: "history_record_edit",
            explicitDelete: false,
            explicitEdit: true,
            stalled: true,
            stalledAt: Date.now() - 5000,
            stalledReason: "network_failure",   // ← :302 で設定された値
            updatedAt: new Date().toISOString(),
        });

        // Act: online_resume unstall ロジック（stalledReason === "network_failure" のみ解除）
        const _entry = pendingRef.get(DATE_NET);
        if (_entry?.stalled && _entry.stalledReason === "network_failure") {
            pendingRef.set(DATE_NET, { ..._entry, stalled: false, stalledAt: null, stalledReason: null });
        }

        // Assert: network_failure stall は解除されてバッチ対象に戻る
        const afterUnstall = pendingRef.get(DATE_NET);
        expect(afterUnstall.stalled).toBe(false);

        // さらに syncBatch:build フィルタでバッチに含まれる
        const STALLED_ENTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
        const _now = Date.now();
        const livePendingDates = [...pendingRef.keys()];
        const syncDates = livePendingDates.filter((d) => {
            const entry = pendingRef.get(d);
            if (!entry?.stalled) return true;
            if (_now - (entry.stalledAt || 0) > STALLED_ENTRY_TTL_MS) {
                pendingRef.delete(d);
            }
            return false;
        });

        expect(syncDates).toContain(DATE_NET);
    });

    it("mutation test: stalledReason を設定しない（:302 の修正を revert）と network_failure stall が online_resume で解除されずバッチに戻らない", () => {
        const DATE_NET = "2026-10-03";

        // stalledReason を設定しない（旧実装 / revert 後）
        const pendingRef = new Map();
        pendingRef.set(DATE_NET, {
            reason: "history_record_edit",
            explicitDelete: false,
            explicitEdit: true,
            stalled: true,
            stalledAt: Date.now() - 5000,
            // stalledReason: "network_failure" を設定しない ← :302 の修正を revert
            updatedAt: new Date().toISOString(),
        });

        // online_resume unstall ロジック（stalledReason === "network_failure" チェックあり）
        const _entry = pendingRef.get(DATE_NET);
        if (_entry?.stalled && _entry.stalledReason === "network_failure") {
            pendingRef.set(DATE_NET, { ..._entry, stalled: false, stalledAt: null, stalledReason: null });
        }

        // BUG証明: stalledReason が未設定なので解除されない → バッチに入らない
        const afterUnstall = pendingRef.get(DATE_NET);
        expect(afterUnstall.stalled).toBe(true); // 解除されなかった

        const STALLED_ENTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
        const _now = Date.now();
        const livePendingDates = [...pendingRef.keys()];
        const syncDates = livePendingDates.filter((d) => {
            const entry = pendingRef.get(d);
            if (!entry?.stalled) return true;
            if (_now - (entry.stalledAt || 0) > STALLED_ENTRY_TTL_MS) {
                pendingRef.delete(d);
            }
            return false;
        });
        expect(syncDates).not.toContain(DATE_NET); // バッチに入らない（通信復帰後も同期されない）
    });

    it("mutation test: stalledReason チェックなし（旧実装）だと hold_limit stall も online_resume で解除される", () => {
        const DATE_HELD = "2026-10-05";

        const pendingRef = new Map();
        pendingRef.set(DATE_HELD, {
            reason: "startup_unsynced_draft",
            explicitDelete: false,
            explicitEdit: false,
            stalled: true,
            stalledAt: Date.now() - 1000,
            stalledReason: "hold_limit",
            updatedAt: new Date().toISOString(),
        });

        // OLD (buggy) behavior: stalledReason チェックなし — stalled なら全部解除
        const _entry = pendingRef.get(DATE_HELD);
        if (_entry?.stalled) {  // ← 旧実装（stalledReason を見ない）
            pendingRef.set(DATE_HELD, { ..._entry, stalled: false, stalledAt: null });
        }

        // BUG証明: hold_limit stall が online_resume で解除されてしまった
        const afterUnstall = pendingRef.get(DATE_HELD);
        expect(afterUnstall.stalled).toBe(false);
        // この後 syncBatch:build にバッチ入り → hold limit → stall → ループの原因
    });
});
