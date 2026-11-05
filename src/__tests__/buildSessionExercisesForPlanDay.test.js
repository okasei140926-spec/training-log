/**
 * buildSessionExercisesForPlanDay 単体テスト
 *
 * テスト対象: utils/generateOnboardingPlan.js の buildSessionExercisesForPlanDay
 *
 * 検証内容:
 *   - 戻り値の種目数が SESSION_COUNT[level] に一致すること
 *   - 初心者(4) / 中級者(5) / 上級者(6) それぞれで上限が守られること
 *   - 候補が上限より少ない場合は候補数のみ返ること（クラッシュしない）
 *   - 戻り値に { name, bodyPart } が含まれること
 */

import { buildSessionExercisesForPlanDay } from '../utils/generateOnboardingPlan';

// SESSION_COUNT 定数を直接参照せず、各レベルの期待値を明示する
const EXPECTED_COUNT = { 初心者: 4, 中級者: 5, 上級者: 6 };

// GYM テンプレートに確実に存在する部位と種目数
// TEMPLATES.gym: 胸=[4], 肩=[4], 三頭=[3], 背中=[3], 二頭=[2], 脚=[4]
// Push = ["胸","肩","三頭"], Pull = ["背中","二頭"], Legs = [...4種]
const PUSH_PARTS = ["胸", "肩", "三頭"];

// location: "ジム" でジムテンプレートを使用（胸=4,肩=4,三頭=3 で上限テストに十分な候補数）
const BASE_ANSWERS = { level: "中級者", favorites: [], preferredSplit: "ppl", frequency: 3, location: "ジム" };

// ─────────────────────────────────────────────────────────────
// 1. SESSION_COUNT の上限テスト（レベル別）
// ─────────────────────────────────────────────────────────────

describe('buildSessionExercisesForPlanDay: SESSION_COUNT の上限', () => {
    const history = {}; // 履歴なし → テンプレートフォールバック

    test('初心者: 戻り値は 4 種目以下', () => {
        const result = buildSessionExercisesForPlanDay({
            bodyParts: PUSH_PARTS,
            answers: { ...BASE_ANSWERS, level: "初心者" },
            history,
        });
        expect(result.length).toBeLessThanOrEqual(EXPECTED_COUNT["初心者"]);
    });

    test('初心者: テンプレートが十分ある場合は exactly 4', () => {
        const result = buildSessionExercisesForPlanDay({
            bodyParts: PUSH_PARTS,
            answers: { ...BASE_ANSWERS, level: "初心者" },
            history,
        });
        expect(result.length).toBe(EXPECTED_COUNT["初心者"]);
    });

    test('中級者: テンプレートが十分ある場合は exactly 5', () => {
        const result = buildSessionExercisesForPlanDay({
            bodyParts: PUSH_PARTS,
            answers: { ...BASE_ANSWERS, level: "中級者" },
            history,
        });
        expect(result.length).toBe(EXPECTED_COUNT["中級者"]);
    });

    test('上級者: テンプレートが十分ある場合は exactly 6', () => {
        const result = buildSessionExercisesForPlanDay({
            bodyParts: PUSH_PARTS,
            answers: { ...BASE_ANSWERS, level: "上級者" },
            history,
        });
        expect(result.length).toBe(EXPECTED_COUNT["上級者"]);
    });
});

// ─────────────────────────────────────────────────────────────
// 2. 戻り値の形式
// ─────────────────────────────────────────────────────────────

describe('buildSessionExercisesForPlanDay: 戻り値の形式', () => {
    test('各要素に name と bodyPart が含まれる', () => {
        const result = buildSessionExercisesForPlanDay({
            bodyParts: PUSH_PARTS,
            answers: BASE_ANSWERS,
            history: {},
        });
        result.forEach(ex => {
            expect(typeof ex.name).toBe('string');
            expect(ex.name.length).toBeGreaterThan(0);
            expect(PUSH_PARTS).toContain(ex.bodyPart);
        });
    });
});

// ─────────────────────────────────────────────────────────────
// 3. 候補が上限より少ない場合はクラッシュしない
// ─────────────────────────────────────────────────────────────

describe('buildSessionExercisesForPlanDay: 候補不足でもクラッシュしない', () => {
    test('1部位・テンプレート1種目のみ → 1種目で返る（上限超えない）', () => {
        // history も favorites もなく、テンプレートも1種目だけの部位を想定
        // 実際のテンプレートより少ない candidates を作るため history を使わない
        // 部位に "unknown_part" を渡すとテンプレートが空 → 0種目
        const result = buildSessionExercisesForPlanDay({
            bodyParts: ["unknown_part_xyz"],
            answers: { ...BASE_ANSWERS, level: "上級者" },
            history: {},
        });
        expect(result.length).toBe(0); // candidates が 0 なので 0 が正しい
    });

    test('空配列でもクラッシュしない', () => {
        const result = buildSessionExercisesForPlanDay({
            bodyParts: [],
            answers: BASE_ANSWERS,
            history: {},
        });
        expect(result).toEqual([]);
    });

    test('answers が null でもクラッシュしない（デフォルト level=初心者）', () => {
        const result = buildSessionExercisesForPlanDay({
            bodyParts: PUSH_PARTS,
            answers: null,
            history: {},
        });
        expect(result.length).toBeLessThanOrEqual(EXPECTED_COUNT["初心者"]);
    });
});

// ─────────────────────────────────────────────────────────────
// 4. 履歴がある場合に上限を守ること（バグ修正の核心）
// ─────────────────────────────────────────────────────────────

describe('buildSessionExercisesForPlanDay: 履歴があっても SESSION_COUNT を超えない', () => {
    // 各部位に10種目ずつ履歴がある状態
    const historyWith10PerPart = {};
    PUSH_PARTS.forEach(bp => {
        for (let i = 0; i < 10; i++) {
            const exName = `${bp}種目${i}`;
            historyWith10PerPart[exName] = [{ bodyPart: bp, date: "2026-11-01" }];
        }
    });

    test('中級者: 履歴が豊富でも 5 種目のみ', () => {
        const result = buildSessionExercisesForPlanDay({
            bodyParts: PUSH_PARTS,
            answers: { ...BASE_ANSWERS, level: "中級者" },
            history: historyWith10PerPart,
        });
        expect(result.length).toBe(EXPECTED_COUNT["中級者"]);
    });

    test('上級者: 履歴が豊富でも 6 種目のみ', () => {
        const result = buildSessionExercisesForPlanDay({
            bodyParts: PUSH_PARTS,
            answers: { ...BASE_ANSWERS, level: "上級者" },
            history: historyWith10PerPart,
        });
        expect(result.length).toBe(EXPECTED_COUNT["上級者"]);
    });
});
