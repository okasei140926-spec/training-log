/**
 * buildSessionExercisesForPlanDay 単体テスト (plan-v2 アルゴリズム)
 *
 * 新アルゴリズム: weeklySetTargets ベースの種目数計算
 *   - cyclesPerWeek = frequency / cycleLength
 *   - setsThisSession = weeklyTarget / cyclesPerWeek
 *   - rawCount = min(round(setsThisSession / setsPerExercise), 3)
 *   - 1日上限: 8種目
 */

import { buildSessionExercisesForPlanDay } from '../utils/generateOnboardingPlan';

// ─────────────────────────────────────────────────────────────
// テスト用定数
// ─────────────────────────────────────────────────────────────

/** getEightWeeksAgoDate() より新しい日付（現在: 2026-11-08 → 8週前 ≈ 2026-09-13） */
const TODAY_DATE = "2026-11-01";   // 8週以内
const OLD_DATE   = "2024-01-01";   // 8週より古い

/**
 * Base setup:
 *   frequency=6, splitType="ppl" (cycleLength=3)
 *   → cyclesPerWeek = 6/3 = 2
 *   level="中級者" → setsPerExercise = 4
 */
const BASE_ANSWERS = {
    level: "中級者",
    frequency: 6,
    location: "ジム",
    favorites: [],
    preferredSplit: "ppl",
};

// ppl splitType で胸部位を使ったシンプルな呼び出し
function callWith(overrides) {
    return buildSessionExercisesForPlanDay({
        bodyParts: ["胸"],
        answers: { ...BASE_ANSWERS },
        history: {},
        weeklySetTargets: { 胸: 12 },
        splitType: "ppl",
        ...overrides,
    });
}

// ─────────────────────────────────────────────────────────────
// 1. weeklySetTargets[bp]=0 → 部位が選ばれない
// ─────────────────────────────────────────────────────────────

describe('1. weeklySetTargets[bp]=0 → 部位が選ばれない', () => {
    test('target=0 の部位は結果に含まれない', () => {
        const result = buildSessionExercisesForPlanDay({
            bodyParts: ["胸", "肩"],
            answers: BASE_ANSWERS,
            history: {},
            weeklySetTargets: { 胸: 0, 肩: 12 },
            splitType: "ppl",
        });
        const bodyPartNames = result.map(ex => ex.bodyPart);
        expect(bodyPartNames).not.toContain("胸");
        // 肩は target>0 なので含まれる
        expect(bodyPartNames).toContain("肩");
    });

    test('全部位 target=0 → 空配列', () => {
        const result = buildSessionExercisesForPlanDay({
            bodyParts: ["胸", "肩"],
            answers: BASE_ANSWERS,
            history: {},
            weeklySetTargets: { 胸: 0, 肩: 0 },
            splitType: "ppl",
        });
        expect(result).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────
// 2. 種目数が計算式どおり
// ─────────────────────────────────────────────────────────────

describe('2. 種目数が計算式どおり', () => {
    // frequency=6, ppl (cycleLength=3) → cyclesPerWeek=2
    // target=12 → setsThisSession=6 → rawCount=round(6/4)=round(1.5)=2
    test('target=12, freq=6, ppl → 2種目', () => {
        const result = buildSessionExercisesForPlanDay({
            bodyParts: ["胸"],
            answers: { ...BASE_ANSWERS, frequency: 6 },
            history: {},
            weeklySetTargets: { 胸: 12 },
            splitType: "ppl",
        });
        expect(result.filter(ex => ex.bodyPart === "胸").length).toBe(2);
    });

    // target=4 → setsThisSession=4/2=2 → rawCount=round(2/4)=round(0.5)=1
    test('target=4, freq=6, ppl → 1種目', () => {
        const result = buildSessionExercisesForPlanDay({
            bodyParts: ["胸"],
            answers: { ...BASE_ANSWERS, frequency: 6 },
            history: {},
            weeklySetTargets: { 胸: 4 },
            splitType: "ppl",
        });
        expect(result.filter(ex => ex.bodyPart === "胸").length).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────
// 3. 部位あたり3種目上限
// ─────────────────────────────────────────────────────────────

describe('3. 部位あたり3種目上限', () => {
    // target=100, cyclesPerWeek=1 → setsThisSession=100 → rawCount=min(round(100/4),3)=3
    test('極端に高い target でも 3 種目に収まる', () => {
        const result = buildSessionExercisesForPlanDay({
            bodyParts: ["胸"],
            answers: { ...BASE_ANSWERS, frequency: 3 },
            history: {},
            weeklySetTargets: { 胸: 100 },
            splitType: "ppl",
        });
        expect(result.filter(ex => ex.bodyPart === "胸").length).toBeLessThanOrEqual(3);
        expect(result.filter(ex => ex.bodyPart === "胸").length).toBe(3);
    });
});

// ─────────────────────────────────────────────────────────────
// 4. 1日8種目上限
// ─────────────────────────────────────────────────────────────

describe('4. 1日8種目上限', () => {
    // 4部位 × rawCount=3 (target=24, freq=3, cycleLength=3, cyclesPerWeek=1)
    // total=12 > 8 → trim to 8
    test('4部位×3種目(計12)→ 8種目に削減される', () => {
        const result = buildSessionExercisesForPlanDay({
            bodyParts: ["胸", "肩", "三頭", "背中"],
            answers: { ...BASE_ANSWERS, frequency: 3 },
            history: {},
            weeklySetTargets: { 胸: 24, 肩: 24, 三頭: 24, 背中: 24 },
            splitType: "ppl",
        });
        expect(result.length).toBeLessThanOrEqual(8);
        expect(result.length).toBe(8);
    });
});

// ─────────────────────────────────────────────────────────────
// 5. 履歴で多い種目が優先
// ─────────────────────────────────────────────────────────────

describe('5. 履歴で多い種目が優先', () => {
    test('実施回数が多い種目が選ばれる（count=1 で order 情報なし）', () => {
        // "HighFreq" has 5 recent records (no order), "LowFreq" has 1
        // count=1 → only 1 exercise selected → must be HighFreq
        const history = {
            "HighFreq": Array.from({ length: 5 }, () => ({ date: TODAY_DATE, bodyPart: "胸" })),
            "LowFreq":  [{ date: TODAY_DATE, bodyPart: "胸" }],
        };
        const result = buildSessionExercisesForPlanDay({
            bodyParts: ["胸"],
            answers: { ...BASE_ANSWERS, frequency: 6 },
            history,
            weeklySetTargets: { 胸: 4 }, // freq=6 → cyclesPerWeek=2 → setsThisSession=2 → rawCount=round(0.5)=1
            splitType: "ppl",
        });
        const names = result.filter(ex => ex.bodyPart === "胸").map(ex => ex.name);
        expect(names.length).toBe(1);
        expect(names[0]).toBe("HighFreq");
    });

    test('freq=5の履歴がある種目が先頭に来る', () => {
        // "A" has 5 recent records, "B" has 1
        const history = {
            "A": Array.from({ length: 5 }, () => ({ date: TODAY_DATE, bodyPart: "胸", order: 0 })),
            "B": [{ date: TODAY_DATE, bodyPart: "胸", order: 1 }],
        };

        const result = buildSessionExercisesForPlanDay({
            bodyParts: ["胸"],
            answers: { ...BASE_ANSWERS, frequency: 3 },
            history,
            weeklySetTargets: { 胸: 12 },
            splitType: "ppl",
        });

        const chestExs = result.filter(ex => ex.bodyPart === "胸").map(ex => ex.name);
        // "A" should appear before "B" because A has higher frequency
        // After order sort: A has avg order 0, B has avg order 1 → A first
        expect(chestExs[0]).toBe("A");
    });

    test('古い履歴 (8週外) は無視される', () => {
        // "OldEx" has only OLD_DATE records → not counted in 8-week window
        // "NewEx" has 1 recent record
        const history = {
            "OldEx": Array.from({ length: 10 }, () => ({ date: OLD_DATE, bodyPart: "胸", order: 0 })),
            "NewEx": [{ date: TODAY_DATE, bodyPart: "胸", order: 0 }],
        };

        const result = buildSessionExercisesForPlanDay({
            bodyParts: ["胸"],
            answers: { ...BASE_ANSWERS, frequency: 3 },
            history,
            weeklySetTargets: { 胸: 4 },
            splitType: "ppl",
        });

        // rawCount = round(4/1/4) = round(1) = 1 → 1 exercise
        const chestExs = result.filter(ex => ex.bodyPart === "胸").map(ex => ex.name);
        expect(chestExs.length).toBe(1);
        // NewEx should be chosen as it has recent history (freq=1 > OldEx freq=0)
        expect(chestExs[0]).toBe("NewEx");
    });
});

// ─────────────────────────────────────────────────────────────
// 6. 履歴なし→テンプレートフォールバック
// ─────────────────────────────────────────────────────────────

describe('6. 履歴なし→テンプレートフォールバック', () => {
    test('空の履歴ではテンプレートが使用される', () => {
        // ジムテンプレート: 胸=["ベンチプレス","インクラインベンチプレス","ペックフライ","ダンベルプレス"]
        const result = buildSessionExercisesForPlanDay({
            bodyParts: ["胸"],
            answers: { ...BASE_ANSWERS, frequency: 3 },
            history: {},
            weeklySetTargets: { 胸: 12 },
            splitType: "ppl",
        });

        expect(result.length).toBeGreaterThan(0);
        result.forEach(ex => {
            expect(typeof ex.name).toBe("string");
            expect(ex.name.length).toBeGreaterThan(0);
        });
    });

    test('戻り値に name, bodyPart, label が含まれる', () => {
        const result = buildSessionExercisesForPlanDay({
            bodyParts: ["胸"],
            answers: BASE_ANSWERS,
            history: {},
            weeklySetTargets: { 胸: 12 },
            splitType: "ppl",
        });
        result.forEach(ex => {
            expect(typeof ex.name).toBe("string");
            expect(typeof ex.bodyPart).toBe("string");
            expect(typeof ex.label).toBe("string");
        });
    });
});

// ─────────────────────────────────────────────────────────────
// 7. 部位内の並びが平均order順
// ─────────────────────────────────────────────────────────────

describe('7. 部位内の並びが平均order順', () => {
    test('平均order が低い種目が先頭に来る', () => {
        // "A" has avg order = 1.0, "B" has avg order = 0.0 → B should come first
        const history = {
            "A": [
                { date: TODAY_DATE, bodyPart: "胸", order: 1 },
                { date: TODAY_DATE, bodyPart: "胸", order: 1 },
            ],
            "B": [
                { date: TODAY_DATE, bodyPart: "胸", order: 0 },
                { date: TODAY_DATE, bodyPart: "胸", order: 0 },
            ],
        };

        // Need count >= 2 for both to be selected
        // freq=3, ppl (cycleLength=3), cyclesPerWeek=1
        // target=16 → setsThisSession=16 → rawCount=min(round(16/4),3)=3
        const result = buildSessionExercisesForPlanDay({
            bodyParts: ["胸"],
            answers: { ...BASE_ANSWERS, frequency: 3 },
            history,
            weeklySetTargets: { 胸: 16 },
            splitType: "ppl",
        });

        const chestExs = result.filter(ex => ex.bodyPart === "胸").map(ex => ex.name);
        expect(chestExs.length).toBeGreaterThanOrEqual(2);
        const aIdx = chestExs.indexOf("A");
        const bIdx = chestExs.indexOf("B");
        expect(bIdx).toBeLessThan(aIdx); // B (order=0) before A (order=1)
    });
});

// ─────────────────────────────────────────────────────────────
// 8. frequency変更で種目数変化
// ─────────────────────────────────────────────────────────────

describe('8. frequency変更で種目数変化', () => {
    // freq=3: cyclesPerWeek=1, setsThisSession=12, rawCount=round(12/4)=3
    // freq=6: cyclesPerWeek=2, setsThisSession=6, rawCount=round(6/4)=2
    // Higher frequency → fewer exercises per session
    test('freq=3 → freq=6 で種目数が減る（同一target）', () => {
        const resultFreq3 = buildSessionExercisesForPlanDay({
            bodyParts: ["胸"],
            answers: { ...BASE_ANSWERS, frequency: 3 },
            history: {},
            weeklySetTargets: { 胸: 12 },
            splitType: "ppl",
        });
        const resultFreq6 = buildSessionExercisesForPlanDay({
            bodyParts: ["胸"],
            answers: { ...BASE_ANSWERS, frequency: 6 },
            history: {},
            weeklySetTargets: { 胸: 12 },
            splitType: "ppl",
        });

        expect(resultFreq3.filter(ex => ex.bodyPart === "胸").length).toBeGreaterThan(
            resultFreq6.filter(ex => ex.bodyPart === "胸").length
        );
    });

    test('freq=3 → 3種目, freq=6 → 2種目 (target=12, ppl)', () => {
        const r3 = buildSessionExercisesForPlanDay({
            bodyParts: ["胸"],
            answers: { ...BASE_ANSWERS, frequency: 3 },
            history: {},
            weeklySetTargets: { 胸: 12 },
            splitType: "ppl",
        }).filter(ex => ex.bodyPart === "胸").length;

        const r6 = buildSessionExercisesForPlanDay({
            bodyParts: ["胸"],
            answers: { ...BASE_ANSWERS, frequency: 6 },
            history: {},
            weeklySetTargets: { 胸: 12 },
            splitType: "ppl",
        }).filter(ex => ex.bodyPart === "胸").length;

        expect(r3).toBe(3);
        expect(r6).toBe(2);
    });
});

// ─────────────────────────────────────────────────────────────
// 9. weeklySetTargets変更で種目数変化
// ─────────────────────────────────────────────────────────────

describe('9. weeklySetTargets変更で種目数変化', () => {
    // freq=6, ppl → cyclesPerWeek=2
    // target=4 → setsThisSession=2 → rawCount=round(0.5)=1
    // target=12 → setsThisSession=6 → rawCount=round(1.5)=2
    test('target増加で種目数が増える', () => {
        const resultLow = buildSessionExercisesForPlanDay({
            bodyParts: ["胸"],
            answers: { ...BASE_ANSWERS, frequency: 6 },
            history: {},
            weeklySetTargets: { 胸: 4 },
            splitType: "ppl",
        });
        const resultHigh = buildSessionExercisesForPlanDay({
            bodyParts: ["胸"],
            answers: { ...BASE_ANSWERS, frequency: 6 },
            history: {},
            weeklySetTargets: { 胸: 12 },
            splitType: "ppl",
        });

        expect(resultHigh.filter(ex => ex.bodyPart === "胸").length).toBeGreaterThan(
            resultLow.filter(ex => ex.bodyPart === "胸").length
        );
    });

    test('target=4 → 1種目, target=12 → 2種目 (freq=6, ppl)', () => {
        const r4 = buildSessionExercisesForPlanDay({
            bodyParts: ["胸"],
            answers: { ...BASE_ANSWERS, frequency: 6 },
            history: {},
            weeklySetTargets: { 胸: 4 },
            splitType: "ppl",
        }).filter(ex => ex.bodyPart === "胸").length;

        const r12 = buildSessionExercisesForPlanDay({
            bodyParts: ["胸"],
            answers: { ...BASE_ANSWERS, frequency: 6 },
            history: {},
            weeklySetTargets: { 胸: 12 },
            splitType: "ppl",
        }).filter(ex => ex.bodyPart === "胸").length;

        expect(r4).toBe(1);
        expect(r12).toBe(2);
    });
});

// ─────────────────────────────────────────────────────────────
// 10. answers=null でもクラッシュしない
// ─────────────────────────────────────────────────────────────

describe('10. answers=null でもクラッシュしない', () => {
    test('answers=null で例外なく実行できる', () => {
        expect(() => {
            buildSessionExercisesForPlanDay({
                bodyParts: ["胸"],
                answers: null,
                history: {},
                weeklySetTargets: { 胸: 10 },
                splitType: "ppl",
            });
        }).not.toThrow();
    });

    test('answers=null の結果は配列', () => {
        const result = buildSessionExercisesForPlanDay({
            bodyParts: ["胸"],
            answers: null,
            history: {},
            weeklySetTargets: { 胸: 10 },
            splitType: "ppl",
        });
        expect(Array.isArray(result)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────
// 11. 空bodyPartsでもクラッシュしない
// ─────────────────────────────────────────────────────────────

describe('11. 空bodyPartsでもクラッシュしない', () => {
    test('bodyParts=[] → 空配列が返る', () => {
        const result = buildSessionExercisesForPlanDay({
            bodyParts: [],
            answers: BASE_ANSWERS,
            history: {},
            weeklySetTargets: {},
            splitType: "ppl",
        });
        expect(result).toEqual([]);
    });
});
