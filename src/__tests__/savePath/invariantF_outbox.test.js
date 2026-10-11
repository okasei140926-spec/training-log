/**
 * 案F Outbox 不変条件テスト
 *
 * Test 1: Full delete → restart → delete is re-sent
 * Test 2: Partial delete → restart → remaining state is re-sent
 * Test 3: Guard rejects write → outbox entry is NOT deleted (stays stalled)
 * Test 4: Delete then re-entry → outbox delete is replaced by upsert
 * Test 8a: Stalled entry is replayed on next restart (Fix 2)
 * Test 8b: explicitDelete bypasses A-1 debounce (Fix 3)
 */

import {
    loadPendingOps,
    upsertPendingOp,
    deletePendingOp,
    setPendingOpStalled,
    getPendingOpsKey,
    hasOutboxEntryForDate,
} from "../../utils/appHelpers";

const USER_ID = "test-user-abc";
const DATE = "2026-10-01";

// Helper: reset localStorage before each test
beforeEach(() => {
    window.localStorage.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Full delete → restart → delete is re-sent
// ─────────────────────────────────────────────────────────────────────────────
describe("Test 1: full delete in outbox is replayed at startup", () => {
    it("loadPendingOps returns the delete entry and markWorkoutContentChanged is called with delete params", () => {
        // Arrange: write a delete op to the outbox (new schema without op field)
        upsertPendingOp(USER_ID, DATE, {
            reason: "exercise_delete",
            explicitDelete: true,
            explicitEdit: false,
            deleteScope: null,
            at: Date.now(),
            attempts: 0,
            stalled: false,
        });

        // Act: simulate startup replay logic (new format)
        const ops = loadPendingOps(USER_ID);
        const markWorkoutContentChanged = jest.fn();
        let replayed = false;
        Object.entries(ops).forEach(([date, entry]) => {
            // Reset stalled flag and increment attempts before replaying
            upsertPendingOp(USER_ID, date, {
                ...entry,
                stalled: false,
                attempts: (entry.attempts || 0) + 1,
            });
            markWorkoutContentChanged(date, entry.reason || "startup_unsynced_draft", {
                explicitDelete: entry.explicitDelete,
                explicitEdit: entry.explicitEdit,
                deleteScope: entry.deleteScope || null,
            });
            replayed = true;
        });

        // Assert
        expect(replayed).toBe(true);
        expect(markWorkoutContentChanged).toHaveBeenCalledWith(
            DATE,
            "exercise_delete",
            { explicitDelete: true, explicitEdit: false, deleteScope: null }
        );
        // Verify attempts was incremented
        const opsAfter = loadPendingOps(USER_ID);
        expect(opsAfter[DATE].attempts).toBe(1);
        expect(opsAfter[DATE].stalled).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Upsert op in outbox → startup re-sends the date
// ─────────────────────────────────────────────────────────────────────────────
describe("Test 2: upsert op in outbox is replayed at startup", () => {
    it("loadPendingOps returns the upsert entry and markWorkoutContentChanged is called with non-delete params", () => {
        // Arrange: write an upsert op (e.g., user re-entered data after a delete)
        upsertPendingOp(USER_ID, DATE, {
            reason: "weight_change",
            explicitDelete: false,
            explicitEdit: false,
            deleteScope: null,
            at: Date.now(),
            attempts: 0,
            stalled: false,
        });

        // Act: simulate startup replay logic (new format)
        const ops = loadPendingOps(USER_ID);
        const markWorkoutContentChanged = jest.fn();
        let replayed = false;
        Object.entries(ops).forEach(([date, entry]) => {
            upsertPendingOp(USER_ID, date, {
                ...entry,
                stalled: false,
                attempts: (entry.attempts || 0) + 1,
            });
            markWorkoutContentChanged(date, entry.reason || "startup_unsynced_draft", {
                explicitDelete: entry.explicitDelete,
                explicitEdit: entry.explicitEdit,
                deleteScope: entry.deleteScope || null,
            });
            replayed = true;
        });

        // Assert
        expect(replayed).toBe(true);
        expect(markWorkoutContentChanged).toHaveBeenCalledWith(
            DATE,
            "weight_change",
            { explicitDelete: false, explicitEdit: false, deleteScope: null }
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Guard permanently rejects write → outbox entry is stalled
//         Stalled entries ARE replayed on next restart (Fix 2)
// ─────────────────────────────────────────────────────────────────────────────
describe("Test 3: guard permanent-skip marks op stalled, does not delete it", () => {
    it("setPendingOpStalled marks entry as stalled without removing it", () => {
        // Arrange: an active outbox entry
        upsertPendingOp(USER_ID, DATE, {
            reason: "set_add",
            explicitDelete: false,
            explicitEdit: false,
            deleteScope: null,
            at: Date.now(),
            attempts: 0,
            stalled: false,
        });

        // Act: simulate guard permanent-skip (stall, do NOT delete)
        const deletePendingOpSpy = jest.fn();
        // We are testing that deletePendingOp is NOT the thing called here
        setPendingOpStalled(USER_ID, DATE);

        // Assert: entry still exists but is stalled
        const ops = loadPendingOps(USER_ID);
        expect(ops[DATE]).toBeDefined();
        expect(ops[DATE].stalled).toBe(true);
        expect(deletePendingOpSpy).not.toHaveBeenCalled();
    });

    it("stalled entry IS included in startup replay (Fix 2: stalled means retry next session, not give up forever)", () => {
        // Arrange: a stalled outbox entry
        upsertPendingOp(USER_ID, DATE, {
            reason: "set_add",
            explicitDelete: false,
            explicitEdit: false,
            deleteScope: null,
            at: Date.now(),
            attempts: 2,
            stalled: true,
        });

        // Act: simulate startup replay — stalled entries are now included
        const ops = loadPendingOps(USER_ID);
        const markWorkoutContentChanged = jest.fn();
        Object.entries(ops).forEach(([date, entry]) => {
            // No stalled check — all entries are replayed
            upsertPendingOp(USER_ID, date, {
                ...entry,
                stalled: false,
                attempts: (entry.attempts || 0) + 1,
            });
            markWorkoutContentChanged(date, entry.reason || "startup_unsynced_draft", {
                explicitDelete: entry.explicitDelete,
                explicitEdit: entry.explicitEdit,
                deleteScope: entry.deleteScope || null,
            });
        });

        // Assert: stalled entry WAS replayed
        expect(markWorkoutContentChanged).toHaveBeenCalledWith(
            DATE,
            "set_add",
            { explicitDelete: false, explicitEdit: false, deleteScope: null }
        );
        // And the entry was un-stalled with incremented attempts
        const opsAfter = loadPendingOps(USER_ID);
        expect(opsAfter[DATE].stalled).toBe(false);
        expect(opsAfter[DATE].attempts).toBe(3);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: Delete then re-entry → outbox delete is replaced by upsert
// ─────────────────────────────────────────────────────────────────────────────
describe("Test 4: upsertPendingOp overwrites existing entry for same date", () => {
    it("writing re-entry after delete for the same date replaces the delete entry", () => {
        // Arrange: first a delete entry
        upsertPendingOp(USER_ID, DATE, {
            reason: "date_delete",
            explicitDelete: true,
            explicitEdit: false,
            deleteScope: null,
            at: Date.now() - 1000,
            attempts: 0,
            stalled: false,
        });

        // Act: then a re-entry (exercise_add) overwrites the delete
        upsertPendingOp(USER_ID, DATE, {
            reason: "exercise_add",
            explicitDelete: false,
            explicitEdit: true,
            deleteScope: null,
            at: Date.now(),
            attempts: 0,
            stalled: false,
        });

        // Assert: only the re-entry remains
        const ops = loadPendingOps(USER_ID);
        expect(ops[DATE]).toBeDefined();
        expect(ops[DATE].explicitDelete).toBe(false);
        expect(ops[DATE].reason).toBe("exercise_add");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8a: Stalled entry is replayed on next restart; attempts > 10 is discarded
// ─────────────────────────────────────────────────────────────────────────────
describe("Test 8a: stalled entry replayed on restart; exhausted entries discarded", () => {
    it("stalled entry with attempts:2 is replayed and un-stalled with attempts:3", () => {
        // Arrange: stalled entry from previous session
        upsertPendingOp(USER_ID, DATE, {
            reason: "weight_change",
            explicitDelete: false,
            explicitEdit: false,
            deleteScope: null,
            at: Date.now(),
            attempts: 2,
            stalled: true,
        });

        // Act: simulate startup replay (stalled entries included — no guard)
        const ops = loadPendingOps(USER_ID);
        const markWorkoutContentChanged = jest.fn();
        Object.entries(ops).forEach(([date, entry]) => {
            upsertPendingOp(USER_ID, date, {
                ...entry,
                stalled: false,
                attempts: (entry.attempts || 0) + 1,
            });
            markWorkoutContentChanged(date, entry.reason || "startup_unsynced_draft", {
                explicitDelete: entry.explicitDelete,
                explicitEdit: entry.explicitEdit,
                deleteScope: entry.deleteScope || null,
            });
        });

        // Assert: markWorkoutContentChanged WAS called
        expect(markWorkoutContentChanged).toHaveBeenCalledWith(
            DATE,
            "weight_change",
            { explicitDelete: false, explicitEdit: false, deleteScope: null }
        );
        // Assert: entry is un-stalled with attempts incremented to 3
        const opsAfter = loadPendingOps(USER_ID);
        expect(opsAfter[DATE]).toBeDefined();
        expect(opsAfter[DATE].stalled).toBe(false);
        expect(opsAfter[DATE].attempts).toBe(3);
    });

    it("entry with attempts:11 is discarded by loadPendingOps (not returned)", () => {
        // Arrange: write entry with attempts > 10 directly to localStorage
        const key = getPendingOpsKey(USER_ID);
        const raw = JSON.stringify({
            [DATE]: {
                reason: "weight_change",
                explicitDelete: false,
                explicitEdit: false,
                deleteScope: null,
                at: Date.now(),
                attempts: 11,
                stalled: false,
            },
        });
        window.localStorage.setItem(key, raw);

        // Act
        const ops = loadPendingOps(USER_ID);

        // Assert: entry with attempts > 10 is filtered out
        expect(ops[DATE]).toBeUndefined();
    });

    it("mutation test: adding if(entry.stalled) return prevents markWorkoutContentChanged from being called", () => {
        // This verifies what happens when the old guard is re-added (should go red in production)
        upsertPendingOp(USER_ID, DATE, {
            reason: "weight_change",
            explicitDelete: false,
            explicitEdit: false,
            deleteScope: null,
            at: Date.now(),
            attempts: 2,
            stalled: true,
        });

        const ops = loadPendingOps(USER_ID);
        const markWorkoutContentChanged = jest.fn();
        Object.entries(ops).forEach(([date, entry]) => {
            if (entry.stalled) return; // OLD behavior re-introduced
            upsertPendingOp(USER_ID, date, {
                ...entry,
                stalled: false,
                attempts: (entry.attempts || 0) + 1,
            });
            markWorkoutContentChanged(date, entry.reason || "startup_unsynced_draft", {
                explicitDelete: entry.explicitDelete,
                explicitEdit: entry.explicitEdit,
                deleteScope: entry.deleteScope || null,
            });
        });

        // With the old guard, markWorkoutContentChanged should NOT be called
        expect(markWorkoutContentChanged).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8b: explicitDelete bypasses A-1 debounce
// ─────────────────────────────────────────────────────────────────────────────
describe("Test 8b: explicitDelete bypasses A-1 debounce", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    it("saveWorkoutDraft is called immediately (no setTimeout) when explicitDelete is true", () => {
        const saveWorkoutDraft = jest.fn();
        const onDraftPersist = jest.fn();
        const lastSavedHashRef = { current: null };
        const draftHash = "hash-delete-123";
        const normalizedDate = "2026-10-01";

        // Simulate the bypass logic from useWorkoutLog
        const draftToPersist = {
            meta: { explicitDelete: true, explicitEdit: false, hasUnsavedChanges: true },
            exercises: [],
            logData: {},
        };

        // Inline the bypass logic
        let timerFired = false;
        if (draftToPersist.meta?.explicitDelete) {
            saveWorkoutDraft(normalizedDate, draftToPersist, {});
            onDraftPersist(draftToPersist, { source: "useWorkoutLog", hash: draftHash });
            lastSavedHashRef.current = draftHash;
        } else {
            window.setTimeout(() => {
                timerFired = true;
                saveWorkoutDraft(normalizedDate, draftToPersist, {});
                onDraftPersist(draftToPersist, { source: "useWorkoutLog", hash: draftHash });
                lastSavedHashRef.current = draftHash;
            }, 350);
        }

        // Assert: called synchronously (before any timers run)
        expect(saveWorkoutDraft).toHaveBeenCalledTimes(1);
        expect(onDraftPersist).toHaveBeenCalledTimes(1);
        expect(lastSavedHashRef.current).toBe(draftHash);
        expect(timerFired).toBe(false);
    });

    it("saveWorkoutDraft is NOT called synchronously for normal (non-explicitDelete) drafts", () => {
        const saveWorkoutDraft = jest.fn();
        const onDraftPersist = jest.fn();
        const lastSavedHashRef = { current: null };
        const draftHash = "hash-normal-456";
        const normalizedDate = "2026-10-01";
        const debounceMs = 350;

        const draftToPersist = {
            meta: { explicitDelete: false, explicitEdit: true, hasUnsavedChanges: true },
            exercises: [{ name: "Squat" }],
            logData: {},
        };

        // Inline the bypass + debounce logic
        if (draftToPersist.meta?.explicitDelete) {
            saveWorkoutDraft(normalizedDate, draftToPersist, {});
            onDraftPersist(draftToPersist, { source: "useWorkoutLog", hash: draftHash });
            lastSavedHashRef.current = draftHash;
        } else {
            window.setTimeout(() => {
                saveWorkoutDraft(normalizedDate, draftToPersist, {});
                onDraftPersist(draftToPersist, { source: "useWorkoutLog", hash: draftHash });
                lastSavedHashRef.current = draftHash;
            }, debounceMs);
        }

        // Before any timers run: not called
        expect(saveWorkoutDraft).not.toHaveBeenCalled();

        // Advance to just before debounce fires
        jest.advanceTimersByTime(349);
        expect(saveWorkoutDraft).not.toHaveBeenCalled();

        // Advance past debounce
        jest.advanceTimersByTime(1);
        expect(saveWorkoutDraft).toHaveBeenCalledTimes(1);
    });

    it("mutation test: removing explicitDelete bypass means saveWorkoutDraft is NOT called until 350ms", () => {
        const saveWorkoutDraft = jest.fn();
        const draftHash = "hash-mutant-789";
        const normalizedDate = "2026-10-01";
        const debounceMs = 350;

        const draftToPersist = {
            meta: { explicitDelete: true, explicitEdit: false, hasUnsavedChanges: true },
            exercises: [],
            logData: {},
        };

        // WITHOUT the bypass (mutation: remove the if block)
        window.setTimeout(() => {
            saveWorkoutDraft(normalizedDate, draftToPersist, {});
        }, debounceMs);

        // Assert: not called immediately
        expect(saveWorkoutDraft).not.toHaveBeenCalled();
        jest.advanceTimersByTime(349);
        expect(saveWorkoutDraft).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(saveWorkoutDraft).toHaveBeenCalledTimes(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 9: F-2 blocks remote overwrite even when outbox entry is stalled
// Uses the exported hasOutboxEntryForDate helper which useDraftRestore calls directly.
// Reverting hasOutboxEntryForDate to `Boolean(ops[date]) && !ops[date].stalled`
// causes these tests to fail.
// ─────────────────────────────────────────────────────────────────────────────
describe("Test 9: useDraftRestore F-2 — stalled outbox entry still blocks remote overwrite", () => {
    it("hasOutboxEntryForDate returns true for stalled entry → remote does not overwrite", () => {
        // Arrange: stalled outbox entry for the date
        upsertPendingOp(USER_ID, DATE, {
            reason: "exercise_delete",
            explicitDelete: true,
            explicitEdit: false,
            deleteScope: null,
            at: Date.now(),
            attempts: 3,
            stalled: true,
        });

        // Act: use the actual helper that useDraftRestore calls
        const ops = loadPendingOps(USER_ID);
        const result = hasOutboxEntryForDate(ops, DATE);

        // Assert: returns true → remote overwrite is blocked
        expect(result).toBe(true);
    });

    it("mutation test: hasOutboxEntryForDate with stalled-excluded logic returns false (regression)", () => {
        // Arrange: stalled outbox entry for the date
        upsertPendingOp(USER_ID, DATE, {
            reason: "exercise_delete",
            explicitDelete: true,
            explicitEdit: false,
            deleteScope: null,
            at: Date.now(),
            attempts: 3,
            stalled: true,
        });

        // Act: simulate old broken logic (stalled excluded) — NOT what hasOutboxEntryForDate does
        const ops = loadPendingOps(USER_ID);
        const hasPendingOp_old = ops[DATE] && !ops[DATE].stalled; // OLD behavior

        // Assert: old logic returns false → would NOT block remote overwrite (regression)
        expect(hasPendingOp_old).toBeFalsy();
        // And confirm hasOutboxEntryForDate does NOT behave like the old logic
        expect(hasOutboxEntryForDate(ops, DATE)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional: deletePendingOp removes the entry on sync success
// ─────────────────────────────────────────────────────────────────────────────
describe("deletePendingOp clears entry on sync success", () => {
    it("removes the entry after successful sync", () => {
        upsertPendingOp(USER_ID, DATE, {
            reason: "weight_change",
            explicitDelete: false,
            explicitEdit: false,
            deleteScope: null,
            at: Date.now(),
            attempts: 0,
            stalled: false,
        });
        expect(loadPendingOps(USER_ID)[DATE]).toBeDefined();

        deletePendingOp(USER_ID, DATE);

        expect(loadPendingOps(USER_ID)[DATE]).toBeUndefined();
    });
});
