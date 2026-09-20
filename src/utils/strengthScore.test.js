/**
 * Unit tests for strengthScore.js
 * Run with: npm test -- --testPathPattern=strengthScore
 */
import {
    calcCappedE1RM,
    calcEffectiveWeightKg,
    getRankIndex,
    calcRadarValue,
    calcStrengthRanks,
    RANKS,
} from "./strengthScore";

// ── calcCappedE1RM ────────────────────────────────────────────────────────────

describe("calcCappedE1RM", () => {
    test("single rep returns weight", () => {
        expect(calcCappedE1RM(100, 1)).toBe(100);
    });

    test("Epley formula for 10 reps", () => {
        // 100 × (1 + 10/30) = 133.33
        expect(calcCappedE1RM(100, 10)).toBeCloseTo(133.33, 1);
    });

    test("reps capped at 12", () => {
        const at12 = calcCappedE1RM(100, 12);
        const at15 = calcCappedE1RM(100, 15);
        const at20 = calcCappedE1RM(100, 20);
        expect(at15).toBe(at12);
        expect(at20).toBe(at12);
    });

    test("returns 0 for invalid weight", () => {
        expect(calcCappedE1RM(0, 10)).toBe(0);
        expect(calcCappedE1RM(-5, 10)).toBe(0);
        expect(calcCappedE1RM(NaN, 10)).toBe(0);
    });
});

// ── calcEffectiveWeightKg ────────────────────────────────────────────────────

describe("calcEffectiveWeightKg", () => {
    test("barbell: weight × 1.0", () => {
        expect(calcEffectiveWeightKg("100", "barbell", 70)).toBe(100);
    });

    test("smith: weight × 0.9", () => {
        expect(calcEffectiveWeightKg("100", "smith", 70)).toBeCloseTo(90);
    });

    test("dumbbell: perHand × 2 × 0.8", () => {
        expect(calcEffectiveWeightKg("30", "dumbbell", 70)).toBeCloseTo(48); // 30×2×0.8
    });

    test("machine: weight × 0.7", () => {
        expect(calcEffectiveWeightKg("100", "machine", 70)).toBeCloseTo(70);
    });

    test("cable: weight × 0.6", () => {
        expect(calcEffectiveWeightKg("100", "cable", 70)).toBeCloseTo(60);
    });

    test("bodyweight BW with body weight", () => {
        expect(calcEffectiveWeightKg("BW", "bodyweight", 70)).toBe(70);
    });

    test("bodyweight with added weight", () => {
        expect(calcEffectiveWeightKg("10", "bodyweight", 70)).toBe(80);
    });

    test("bodyweight without body_weight_kg → null", () => {
        expect(calcEffectiveWeightKg("BW", "bodyweight", null)).toBeNull();
    });

    test("non-bodyweight BW set → null", () => {
        expect(calcEffectiveWeightKg("BW", "barbell", 70)).toBeNull();
    });
});

// ── getRankIndex ─────────────────────────────────────────────────────────────

describe("getRankIndex (male, 胸)", () => {
    // thresholds: [0.75, 1.0, 1.5, 2.0]
    test("below 中級 → 初級 (0)", () => {
        expect(getRankIndex(0.5, "胸", "male")).toBe(0);
    });
    test("at 中級 threshold → 中級 (1)", () => {
        expect(getRankIndex(0.75, "胸", "male")).toBe(1);
    });
    test("at 上級 threshold → 上級 (2)", () => {
        expect(getRankIndex(1.0, "胸", "male")).toBe(2);
    });
    test("at エリート threshold → エリート (3)", () => {
        expect(getRankIndex(1.5, "胸", "male")).toBe(3);
    });
    test("at レジェンド threshold → レジェンド (4)", () => {
        expect(getRankIndex(2.0, "胸", "male")).toBe(4);
    });
});

describe("getRankIndex (female, 胸)", () => {
    // female = male × 0.6: [0.45, 0.6, 0.9, 1.2]
    test("above female 中級 threshold → 中級", () => {
        expect(getRankIndex(0.5, "胸", "female")).toBe(1);
    });
    test("same ratio that is 上級 female → 上級", () => {
        expect(getRankIndex(0.6, "胸", "female")).toBe(2);
    });
});

// ── calcRadarValue ───────────────────────────────────────────────────────────

describe("calcRadarValue", () => {
    test("at legend threshold → 100", () => {
        expect(calcRadarValue(2.0, "胸", "male")).toBe(100);
    });
    test("at 0 → 0", () => {
        expect(calcRadarValue(0, "胸", "male")).toBe(0);
    });
    test("half of legend → 50", () => {
        expect(calcRadarValue(1.0, "胸", "male")).toBe(50);
    });
    test("above legend → capped at 100", () => {
        expect(calcRadarValue(3.0, "胸", "male")).toBe(100);
    });
});

// ── calcStrengthRanks – integration ─────────────────────────────────────────

describe("calcStrengthRanks", () => {
    const bodyWeight = 70;
    // Bench press: barbell, 体重×1.0 = 100kg × 1RM → ratio 100/70 ≈ 1.43 → 上級
    const mockHistory = {
        "ベンチプレス": [
            {
                date: new Date().toISOString().slice(0, 10), // today
                bodyPart: "胸",
                sets: [{ weight: "100", reps: "1" }],
            },
        ],
    };
    const mockMuscleEx = { 胸: ["ベンチプレス"] };

    test("computes 胸 score correctly", () => {
        const { categories } = calcStrengthRanks(mockHistory, mockMuscleEx, {}, bodyWeight, "male");
        expect(categories["胸"].hasData).toBe(true);
        expect(categories["胸"].scoreKg).toBeCloseTo(100, 0);
        expect(categories["胸"].scoreRatio).toBeCloseTo(100 / 70, 1);
        expect(categories["胸"].rankIndex).toBe(2); // 上級
        expect(categories["胸"].rankLabel).toBe(RANKS[2]);
    });

    test("未計測 category has hasData=false", () => {
        const { categories } = calcStrengthRanks(mockHistory, mockMuscleEx, {}, bodyWeight, "male");
        expect(categories["脚"].hasData).toBe(false);
        expect(categories["脚"].rankLabel).toBe("未計測");
    });

    test("without body weight → all 未計測", () => {
        const { categories } = calcStrengthRanks(mockHistory, mockMuscleEx, {}, null, "male");
        expect(categories["胸"].rankLabel).toBe("未計測");
    });
});
