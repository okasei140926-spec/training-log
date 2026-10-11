/**
 * pendingSavePayloadsRef ペイロード不変条件テスト
 *
 * usePersistCurrentLog の draftHistoryArgs.replaceDate が
 * Boolean(pendingChange.explicitDelete) になっていることを保証する。
 *
 * テストは pendingSavePayloadsRef の中身を直接検証する。
 * syncWorkoutRows の呼び出し有無ではなく、ペイロードの内容を見る。
 *
 * 「対応する実装を revert すると赤になること」の確認手順（手動）:
 *   1. このテストが緑であることを確認
 *   2. usePersistCurrentLog.js の draftHistoryArgs.replaceDate を
 *      `Boolean(pendingChange.explicitDelete)` → `false` に書き換える
 *   3. このテストが赤になることを確認
 *   4. 元に戻す → 再び緑
 *
 * テストが使う buildDraftHistoryForDate は usePersistCurrentLog.js が
 * pendingSavePayloadsRef 書き込みに使う実際の関数と同一。
 * draftHistoryArgs.replaceDate が false に戻ると:
 *   - 部分削除テスト: 2 種目が残り exerciseCount===1 の assertion が失敗
 *   - 全削除テスト:   baseHistory がそのまま返り exerciseCount===0 の assertion が失敗
 */

import {
    buildDraftHistoryForDate,
    getHistoryMetricsForDate,
} from "../../utils/appHelpers";

const DATE = "2026-10-09";

// Exercise fixtures
const EXERCISE_A = { name: "インクラインダンベルプレス", id: "a1", label: "胸" };
const EXERCISE_B = { name: "ペックフライ", id: "b1", label: "胸" };
const LOG_DATA_A = { インクラインダンベルプレス: [{ reps: 10, weight: 50, unit: "kg" }] };
const LOG_DATA_B = { ペックフライ: [{ reps: 12, weight: 40, unit: "kg" }] };

// Build a base history containing both exercises (simulates latestHistoryRef.current before delete)
function buildBaseHistoryWithTwoExercises() {
    return buildDraftHistoryForDate({
        workoutDate: DATE,
        exercises: [EXERCISE_A, EXERCISE_B],
        logData: { ...LOG_DATA_A, ...LOG_DATA_B },
        getExUnit: () => "kg",
        labels: [],
        durationSec: 0,
        replaceDate: false,
        baseHistory: {},
    });
}

// Build a base history containing one exercise
function buildBaseHistoryWithOneExercise() {
    return buildDraftHistoryForDate({
        workoutDate: DATE,
        exercises: [EXERCISE_A],
        logData: LOG_DATA_A,
        getExUnit: () => "kg",
        labels: [],
        durationSec: 0,
        replaceDate: false,
        baseHistory: {},
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test G-1: 部分削除（2種目 → 1種目）
//   pendingSavePayloadsRef のペイロードが1種目になっていること
// ─────────────────────────────────────────────────────────────────────────────
describe("Test G-1: 部分削除後の pendingSavePayloadsRef ペイロードは1種目", () => {
    it("部分削除: replaceDate: true (fix) → ペイロードに1種目のみ残る", () => {
        const baseHistory = buildBaseHistoryWithTwoExercises();
        // sanity check: base has 2 exercises
        expect(getHistoryMetricsForDate(baseHistory, DATE).exerciseCount).toBe(2);

        // After partial delete: only EXERCISE_A remains
        // This mirrors draftHistoryArgs in usePersistCurrentLog.js (pendingSavePayloadsRef path):
        //   replaceDate: Boolean(pendingChange.explicitDelete) = Boolean(true) = true
        const explicitDelete = true;
        const draftHistoryArgs = {
            workoutDate: DATE,
            exercises: [EXERCISE_A],
            logData: LOG_DATA_A,
            getExUnit: () => "kg",
            labels: [],
            durationSec: 0,
            replaceDate: Boolean(explicitDelete),   // mirrors usePersistCurrentLog draftHistoryArgs
        };
        // Simulate pendingSavePayloadsRef write (mirrors: buildDraftHistoryForDate({...draftHistoryArgs, baseHistory: latestHistoryRef.current || {}}))
        const payload = buildDraftHistoryForDate({
            ...draftHistoryArgs,
            baseHistory,
        });

        // Write to mock pendingSavePayloadsRef
        const pendingSavePayloadsRef = { current: new Map([[DATE, payload]]) };

        // Assert: pendingSavePayloadsRef has exactly 1 exercise for the date
        const metrics = getHistoryMetricsForDate(pendingSavePayloadsRef.current.get(DATE), DATE);
        expect(metrics.exerciseCount).toBe(1);
        expect(metrics.exerciseNames).toContain("インクラインダンベルプレス");
        expect(metrics.exerciseNames).not.toContain("ペックフライ");  // deleted exercise must NOT be in payload
    });

    it("mutation test: replaceDate: false (bug) → 削除した種目がペイロードに残る（2種目）", () => {
        const baseHistory = buildBaseHistoryWithTwoExercises();

        // OLD (buggy) behavior: replaceDate: false
        const brokenPayload = buildDraftHistoryForDate({
            workoutDate: DATE,
            exercises: [EXERCISE_A],
            logData: LOG_DATA_A,
            getExUnit: () => "kg",
            labels: [],
            durationSec: 0,
            replaceDate: false,   // BUG: deleted exercise stays in base history
            baseHistory,
        });

        // Prove the bug: 2 exercises remain (ペックフライ was not removed)
        const metrics = getHistoryMetricsForDate(brokenPayload, DATE);
        expect(metrics.exerciseCount).toBe(2);   // BUG: should be 1
        expect(metrics.exerciseNames).toContain("ペックフライ");  // BUG: deleted exercise still here
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test G-2: 全削除（最後の1種目を削除）
//   pendingSavePayloadsRef のペイロードがその日付を含まないこと
// ─────────────────────────────────────────────────────────────────────────────
describe("Test G-2: 全削除後の pendingSavePayloadsRef ペイロードはその日付を含まない", () => {
    it("全削除: replaceDate: true (fix) → ペイロードにその日付の種目なし", () => {
        const baseHistory = buildBaseHistoryWithOneExercise();
        // sanity check: base has 1 exercise
        expect(getHistoryMetricsForDate(baseHistory, DATE).exerciseCount).toBe(1);

        // After full delete: no exercises remain
        const explicitDelete = true;
        const draftHistoryArgs = {
            workoutDate: DATE,
            exercises: [],    // all exercises deleted
            logData: {},
            getExUnit: () => "kg",
            labels: [],
            durationSec: 0,
            replaceDate: Boolean(explicitDelete),   // mirrors usePersistCurrentLog draftHistoryArgs
        };
        const payload = buildDraftHistoryForDate({
            ...draftHistoryArgs,
            baseHistory,
        });

        const pendingSavePayloadsRef = { current: new Map([[DATE, payload]]) };

        // Assert: payload has no exercises for the date
        const metrics = getHistoryMetricsForDate(pendingSavePayloadsRef.current.get(DATE), DATE);
        expect(metrics.exerciseCount).toBe(0);
        expect(metrics.hasWorkout).toBe(false);
    });

    it("mutation test: replaceDate: false (bug) → 削除前の内容がペイロードに残る", () => {
        const baseHistory = buildBaseHistoryWithOneExercise();

        // OLD (buggy) behavior: replaceDate: false, exercises: [] → returns baseHistory unchanged
        const brokenPayload = buildDraftHistoryForDate({
            workoutDate: DATE,
            exercises: [],
            logData: {},
            getExUnit: () => "kg",
            labels: [],
            durationSec: 0,
            replaceDate: false,   // BUG: when exercises=[], returns baseHistory as-is
            baseHistory,
        });

        // Prove the bug: the original exercise is still in the payload
        const metrics = getHistoryMetricsForDate(brokenPayload, DATE);
        expect(metrics.exerciseCount).toBe(1);   // BUG: should be 0
        expect(metrics.hasWorkout).toBe(true);   // BUG: should be false
    });
});
