/**
 * Strength score and rank calculation for the Growth tab.
 * All functions are pure — no side effects, no imports from React.
 */
import { EQUIPMENT_COEFFICIENTS, PRESET_EQUIPMENT, inferEquipment } from "./equipmentTypes";

// ── Constants ────────────────────────────────────────────────────────────────

/** Score is computed from the last N weeks of history */
export const SCORE_WEEK_WINDOW = 8;

/** Weighted average weights for top-N exercises per category */
export const SCORE_TOP_WEIGHTS = {
    3: [0.50, 0.30, 0.20],
    2: [0.60, 0.40],
    1: [0.90],
};

/** Coefficient applied to single-joint exercises to prevent over-inflation */
export const SINGLE_JOINT_COEFFICIENT = 0.9;

/**
 * Exercises classified as single-joint (isolation).
 * Check this list first; if not found, fall through to keyword inference.
 */
export const SINGLE_JOINT_EXERCISES = new Set([
    // Arm curls (二頭)
    "アームカール", "バーベルカール", "ダンベルカール", "ハンマーカール",
    "インクラインカール", "プリーチャーカール", "ケーブルカール",
    // Triceps extensions (三頭) — push-downs and extensions only, not dips/close-grip
    "トライセプスエクステンション", "ライイングエクステンション",
    "トライセプスプッシュダウン", "オーバーヘッドエクステンション",
    "スカルクラッシャー",
    // Chest isolation
    "ペックフライ", "チェストフライ", "ケーブルフライ",
    // Shoulder isolation
    "サイドレイズ", "ケーブルサイドレイズ", "リアデルトフライ", "フロントレイズ",
    // Leg isolation
    "レッグエクステンション", "シーテッドレッグカール", "ライイングレッグカール",
    "ライイングハム", "レッグカール",
    // Calf
    "カーフレイズ", "シーテッドカーフレイズ",
    // Back isolation
    "フェイスプル",
]);

/**
 * Infer single-joint from exercise name if not in the preset list.
 */
export function isSingleJointExercise(name) {
    if (!name) return false;
    if (SINGLE_JOINT_EXERCISES.has(name)) return true;
    const n = String(name);
    return /カール|エクステンション|レイズ|フライ|プッシュダウン|シュラッグ|カーフ/.test(n);
}

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
    背中: [1.0,  1.25, 1.6,  2.0],
    脚:  [1.25, 1.75, 2.25, 2.75],
    肩:  [0.6,  0.85, 1.1,  1.4],
    腕:  [0.5,  0.7,  0.95, 1.2],
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

    // Map: category → Map<exName, bestScore>
    const categoryExBest = {}; // { [category]: { [exName]: number } }
    for (const cat of SCORE_CATEGORIES) {
        categoryExBest[cat] = {};
    }

    Object.entries(history || {}).forEach(([exName, records]) => {
        const equipment = resolveEquipment(exName, customEquipmentMap);
        const sjCoeff = isSingleJointExercise(exName) ? SINGLE_JOINT_COEFFICIENT : 1.0;

        // Resolve fallback category from exerciseBodyPartOverrides or muscleEx
        let fallbackCategory = null;
        if (exerciseBodyPartOverrides?.[exName]) {
            fallbackCategory = BODY_PART_TO_CATEGORY[exerciseBodyPartOverrides[exName]] || null;
        } else {
            for (const [bp, exList] of Object.entries(muscleEx || {})) {
                const inList = (exList || []).some((e) =>
                    (typeof e === "string" ? e : e?.name) === exName
                );
                if (inList) { fallbackCategory = BODY_PART_TO_CATEGORY[bp] || null; break; }
            }
        }

        (records || []).forEach((rec) => {
            const date = String(rec?.date || "").slice(0, 10);
            if (!date || date < cutoffDate) return;

            // Resolve category for THIS specific record
            const recBodyPart = String(rec?.bodyPart || rec?.body_part || "").trim();
            const recCategory = recBodyPart
                ? (BODY_PART_TO_CATEGORY[recBodyPart] || null)
                : fallbackCategory;
            if (!recCategory) return;

            let recBest = 0;
            (rec?.sets || []).forEach((set) => {
                const r = Number(set?.reps ?? 0);
                if (r <= 0) return;
                const storedWeight = set?.weight ?? set?.storedWeight;
                const effectiveKg = calcEffectiveWeightKg(storedWeight, equipment, bwKg);
                if (effectiveKg === null) return;
                const score = calcCappedE1RM(effectiveKg, r) * sjCoeff;
                if (score > recBest) recBest = score;
            });

            if (recBest > 0) {
                const prev = categoryExBest[recCategory][exName] ?? 0;
                if (recBest > prev) {
                    categoryExBest[recCategory][exName] = recBest;
                }
            }
        });
    });

    // Group by category → top exercises → weighted average → ratio
    const result = {};

    for (const category of SCORE_CATEGORIES) {
        const catMap = categoryExBest[category] || {};
        const candidates = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

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
        const weights = SCORE_TOP_WEIGHTS[top3.length] || SCORE_TOP_WEIGHTS[3];
        const avgScore = top3.reduce((s, [, v], i) => s + v * weights[i], 0);
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
