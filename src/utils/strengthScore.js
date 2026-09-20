/**
 * Strength score and rank calculation for the Growth tab.
 * All functions are pure — no side effects, no imports from React.
 */
import { EQUIPMENT_COEFFICIENTS, PRESET_EQUIPMENT, inferEquipment } from "./equipmentTypes";

// ── Constants ────────────────────────────────────────────────────────────────

/** Score is computed from the last N weeks of history */
export const SCORE_WEEK_WINDOW = 8;

/** Body-part groups used for scoring (腹筋/尻 are excluded) */
export const SCORE_CATEGORIES = ["胸", "背中", "脚", "肩", "腕"];

/** Which raw body part labels map to each score category */
export const BODY_PART_TO_CATEGORY = {
    胸:              "胸",
    背中:            "背中",
    四頭:            "脚",
    ハムストリングス: "脚",
    ハム:            "脚",
    肩:              "肩",
    二頭:            "腕",
    三頭:            "腕",
};

/** Rank labels (index 0 = 初級 … 4 = レジェンド) */
export const RANKS = ["初級", "中級", "上級", "エリート", "レジェンド"];

/**
 * Male body-weight-ratio thresholds per category.
 * Format: [中級, 上級, エリート, レジェンド]  (below 中級 = 初級)
 */
export const RANK_THRESHOLDS_MALE = {
    胸:  [0.75, 1.0,  1.5,  2.0],
    背中: [0.75, 1.0,  1.25, 1.5],
    脚:  [1.0,  1.5,  2.0,  2.5],
    肩:  [0.5,  0.75, 1.0,  1.25],
    腕:  [0.3,  0.45, 0.6,  0.75],
};

/** Female thresholds = male × 0.6 */
const FEMALE_COEFFICIENT = 0.6;

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Estimate 1-rep-max using a capped Epley formula.
 * Reps are capped at 12 to prevent high-rep sets from inflating the score.
 */
export function calcCappedE1RM(weightKg, reps) {
    if (!Number.isFinite(weightKg) || weightKg <= 0) return 0;
    const r = Math.min(Math.max(1, Math.round(Number(reps) || 0)), 12);
    if (r <= 0) return 0;
    if (r === 1) return weightKg;
    return weightKg * (1 + r / 30);
}

/**
 * Compute the effective weight in kg for a set, applying equipment coefficient.
 * Returns null if the set should be excluded from weighted scoring.
 *
 * @param {string|number} storedWeight  - stored kg value or "BW"
 * @param {string} equipment            - one of EQUIPMENT values
 * @param {number|null} bodyWeightKg    - user's body weight; required for bodyweight exercises
 * @returns {number|null}
 */
export function calcEffectiveWeightKg(storedWeight, equipment, bodyWeightKg) {
    const isBW = storedWeight === "BW" || String(storedWeight || "").toUpperCase() === "BW";

    if (equipment === "bodyweight") {
        if (bodyWeightKg == null || !Number.isFinite(bodyWeightKg) || bodyWeightKg <= 0) return null;
        const added = isBW ? 0 : (Number(storedWeight) || 0);
        return bodyWeightKg + added;
    }

    if (isBW) return null; // non-bodyweight exercise recorded as BW → skip
    const kg = Number(storedWeight);
    if (!Number.isFinite(kg) || kg <= 0) return null;

    if (equipment === "dumbbell") {
        // stored = per-hand kg; bilateral total × coefficient
        return kg * 2 * EQUIPMENT_COEFFICIENTS.dumbbell;
    }
    return kg * (EQUIPMENT_COEFFICIENTS[equipment] ?? EQUIPMENT_COEFFICIENTS.machine);
}

/**
 * Resolve equipment for an exercise.
 * Checks custom-exercise map first (by name), then preset, then infers.
 *
 * @param {string} name
 * @param {Object} customEquipmentMap  - { exerciseName: equipmentString }
 */
export function resolveEquipment(name, customEquipmentMap = {}) {
    return customEquipmentMap?.[name] || PRESET_EQUIPMENT[name] || inferEquipment(name);
}

/**
 * Get the date 8 weeks ago (inclusive) as "YYYY-MM-DD".
 */
export function getEightWeeksAgoDate() {
    const d = new Date();
    d.setDate(d.getDate() - SCORE_WEEK_WINDOW * 7);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/**
 * Get rank index (0-4) from a body-weight ratio and category + gender.
 */
export function getRankIndex(ratio, category, gender = "male") {
    const baseThresholds = RANK_THRESHOLDS_MALE[category];
    if (!baseThresholds) return 0;
    const coeff = gender === "female" ? FEMALE_COEFFICIENT : 1.0;
    const thresholds = baseThresholds.map((t) => t * coeff);
    if (ratio >= thresholds[3]) return 4; // レジェンド
    if (ratio >= thresholds[2]) return 3; // エリート
    if (ratio >= thresholds[1]) return 2; // 上級
    if (ratio >= thresholds[0]) return 1; // 中級
    return 0;                             // 初級
}

/**
 * Compute normalized radar value (0–100) for a category.
 * Legend threshold = 100.
 */
export function calcRadarValue(ratio, category, gender = "male") {
    const baseThresholds = RANK_THRESHOLDS_MALE[category];
    if (!baseThresholds) return 0;
    const coeff = gender === "female" ? FEMALE_COEFFICIENT : 1.0;
    const legendThreshold = baseThresholds[3] * coeff;
    return Math.min(100, Math.round((ratio / legendThreshold) * 100));
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Compute strength ranks and radar values for all score categories.
 *
 * @param {Object} history              - canonicalDisplayHistory
 * @param {Object} muscleEx             - { bodyPart: [exName | {name}] }
 * @param {Object} exerciseBodyPartOverrides
 * @param {number|null} bodyWeightKg
 * @param {"male"|"female"|string} gender
 * @param {Object} customEquipmentMap   - { exerciseName: equipmentString }
 *
 * @returns {Object} { categories: { [category]: CategoryResult }, radarValues: number[] }
 *
 * CategoryResult:
 *   { scoreKg, scoreRatio, rankIndex, rankLabel, nextThresholdKg, radarValue,
 *     topExercises: [{ name, scoreKg }], hasData: boolean }
 */
export function calcStrengthRanks(
    history,
    muscleEx,
    exerciseBodyPartOverrides,
    bodyWeightKg,
    gender = "male",
    customEquipmentMap = {},
) {
    const genderKey = gender === "女性" ? "female" : "male";
    const cutoffDate = getEightWeeksAgoDate();
    const bwKg = (Number.isFinite(Number(bodyWeightKg)) && Number(bodyWeightKg) > 0)
        ? Number(bodyWeightKg) : null;

    // Build: exerciseName → best (e1RM × coeff) over last 8 weeks
    const exBestScore = {}; // { name: number }
    const exCategory  = {}; // { name: scoreCategory }

    Object.entries(history || {}).forEach(([exName, records]) => {
        // Resolve body part for this exercise
        let rawBodyPart = null;
        if (exerciseBodyPartOverrides?.[exName]) {
            rawBodyPart = exerciseBodyPartOverrides[exName];
        } else {
            // Check muscleEx
            for (const [bp, exList] of Object.entries(muscleEx || {})) {
                const inList = (exList || []).some((e) =>
                    (typeof e === "string" ? e : e?.name) === exName
                );
                if (inList) { rawBodyPart = bp; break; }
            }
            // Fall back: check records' bodyPart field
            if (!rawBodyPart && records?.length) {
                rawBodyPart = records[0]?.bodyPart || null;
            }
        }

        const category = rawBodyPart ? BODY_PART_TO_CATEGORY[rawBodyPart] : null;
        if (!category) return; // excluded body part (腹筋, 尻, etc.)

        const equipment = resolveEquipment(exName, customEquipmentMap);
        let bestScore = 0;

        (records || []).forEach((rec) => {
            const date = String(rec?.date || "").slice(0, 10);
            if (!date || date < cutoffDate) return;

            (rec?.sets || []).forEach((set) => {
                const r = Number(set?.reps ?? 0);
                if (r <= 0) return;
                const storedWeight = set?.weight ?? set?.storedWeight;
                const effectiveKg = calcEffectiveWeightKg(storedWeight, equipment, bwKg);
                if (effectiveKg === null) return;
                const score = calcCappedE1RM(effectiveKg, r);
                if (score > bestScore) bestScore = score;
            });
        });

        if (bestScore > 0) {
            if ((exBestScore[exName] ?? 0) < bestScore) {
                exBestScore[exName] = bestScore;
                exCategory[exName]  = category;
            }
        }
    });

    // Group by category → top 3 exercises → average → ratio
    const result = {};

    for (const category of SCORE_CATEGORIES) {
        const candidates = Object.entries(exBestScore)
            .filter(([name]) => exCategory[name] === category)
            .sort((a, b) => b[1] - a[1]);

        if (candidates.length === 0) {
            result[category] = {
                hasData: false,
                scoreKg: 0,
                scoreRatio: 0,
                rankIndex: 0,
                rankLabel: "未計測",
                nextThresholdKg: null,
                radarValue: 0,
                topExercises: [],
            };
            continue;
        }

        const top3 = candidates.slice(0, 3);
        const avgScore = top3.reduce((s, [, v]) => s + v, 0) / top3.length;
        const ratio = bwKg ? avgScore / bwKg : 0;
        const rankIndex = bwKg ? getRankIndex(ratio, category, genderKey) : 0;
        const rankLabel = bwKg ? RANKS[rankIndex] : "未計測";
        const radarValue = bwKg ? calcRadarValue(ratio, category, genderKey) : 0;

        // Next threshold kg
        let nextThresholdKg = null;
        if (bwKg) {
            const baseThresholds = RANK_THRESHOLDS_MALE[category] || [];
            const coeff = genderKey === "female" ? FEMALE_COEFFICIENT : 1.0;
            const thresholds = baseThresholds.map((t) => t * coeff * bwKg);
            const next = thresholds.find((t) => t > avgScore);
            nextThresholdKg = next != null ? Math.round((next - avgScore) * 10) / 10 : null;
        }

        result[category] = {
            hasData: true,
            scoreKg: Math.round(avgScore * 10) / 10,
            scoreRatio: Math.round(ratio * 100) / 100,
            rankIndex,
            rankLabel,
            nextThresholdKg,
            radarValue,
            topExercises: top3.map(([name, scoreKg]) => ({ name, scoreKg: Math.round(scoreKg * 10) / 10 })),
        };
    }

    const radarValues = SCORE_CATEGORIES.map((c) => result[c]?.radarValue ?? 0);

    // Type diagnosis
    const withData = SCORE_CATEGORIES.filter((c) => result[c]?.hasData);
    let typeLabel = null;
    if (withData.length > 0) {
        const values = withData.map((c) => result[c].radarValue);
        const maxVal = Math.max(...values);
        const minVal = Math.min(...values);
        if (maxVal - minVal < 20) {
            typeLabel = "バランス型";
        } else {
            const topCat = withData[values.indexOf(maxVal)];
            typeLabel = `${topCat}型`;
        }
    }

    return { categories: result, radarValues, typeLabel };
}

/**
 * Compute growth/stagnation summary from prData.allItemsSortedByDate.
 *
 * @param {Array} allItems  - prData.allItemsSortedByDate
 * @returns {{ growing: Array, stagnating: Array }}
 */
export function calcGrowthSummary(allItems) {
    const growing = (allItems || [])
        .filter((item) => item?.isNew === true)
        .slice(0, 3);

    const stagnating = (allItems || [])
        .filter((item) => item?.stagnationWeeks != null && item.stagnationWeeks >= 3)
        .sort((a, b) => (b.stagnationWeeks || 0) - (a.stagnationWeeks || 0))
        .slice(0, 3);

    return { growing, stagnating };
}
