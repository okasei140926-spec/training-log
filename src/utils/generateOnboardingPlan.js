import { save, load } from "./helpers";
import { getEightWeeksAgoDate } from "./strengthScore";

/**
 * Calculate current age from an ISO birth date string ("YYYY-MM-DD").
 * Returns null if the input is invalid.
 */
export function calcAgeFromBirthDate(birthDateStr) {
    if (!birthDateStr) return null;
    const birth = new Date(birthDateStr);
    if (isNaN(birth.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age >= 0 ? age : null;
}

export const ONBOARDING_PLAN_KEY = "onboardingPlanGenerated";
const ROUTINE_KEY = "routineEx";

// exercises per body part by level (used for onboarding muscleEx setup)
const PART_COUNT = { 初心者: 2, 中級者: 3, 上級者: 3 };

// Default sets/reps surfaced for potential future use
export const DEFAULT_PLAN_PARAMS = {
    初心者:  { sets: 3, reps: 12 },
    中級者:  { sets: 4, reps: 10 },
    上級者:  { sets: 4, reps:  8 },
};

const TEMPLATES = {
    gym: {
        胸:              ["ベンチプレス", "インクラインベンチプレス", "ペックフライ", "ダンベルプレス"],
        背中:            ["ラットプルダウン", "シーテッドロウ", "ベントオーバーロウ", "懸垂"],
        四頭:            ["スクワット", "レッグプレス", "レッグエクステンション", "ハックスクワット"],
        ハムストリングス: ["ルーマニアンデッドリフト", "シーテッドレッグカール", "ライイングレッグカール"],
        尻:              ["ヒップスラスト", "アブダクション", "グルートブリッジ"],
        肩:              ["ショルダープレス", "サイドレイズ", "リアデルトフライ", "アップライトロウ"],
        二頭:            ["バーベルカール", "ハンマーカール", "インクラインカール"],
        三頭:            ["トライセプスプッシュダウン", "ライイングエクステンション", "オーバーヘッドエクステンション"],
        腹筋:            ["レッグレイズ", "ケーブルクランチ", "プランク"],
    },
    home_db: {
        胸:              ["ダンベルプレス", "インクラインダンベルプレス", "ディップス"],
        背中:            ["ダンベルロウ", "懸垂"],
        四頭:            ["スクワット", "ブルガリアンスクワット"],
        ハムストリングス: ["ルーマニアンデッドリフト", "ブルガリアンスクワット"],
        尻:              ["グルートブリッジ", "ヒップスラスト"],
        肩:              ["ショルダープレス", "サイドレイズ"],
        二頭:            ["ダンベルカール", "ハンマーカール"],
        三頭:            ["トライセプスエクステンション", "ディップス"],
        腹筋:            ["レッグレイズ", "プランク"],
    },
    home_bw: {
        胸:              ["プッシュアップ", "ディップス"],
        背中:            ["懸垂"],
        四頭:            ["スクワット", "ブルガリアンスクワット"],
        ハムストリングス: ["ブルガリアンスクワット", "バックエクステンション"],
        尻:              ["グルートブリッジ"],
        肩:              ["プッシュアップ"],
        二頭:            ["懸垂"],
        三頭:            ["ディップス"],
        腹筋:            ["レッグレイズ", "プランク"],
    },
};

const BODY_PARTS = ["胸", "背中", "四頭", "ハムストリングス", "尻", "肩", "二頭", "三頭", "腹筋"];

// Day-by-day sequence for each split type
export const SPLIT_SEQUENCES = {
    fullbody: [
        { label: "全身", bodyParts: ["胸", "背中", "四頭", "ハムストリングス", "尻", "肩", "二頭", "三頭", "腹筋"] },
    ],
    ppl3: [
        { label: "上半身A", bodyParts: ["胸", "肩", "三頭", "背中", "二頭"] },
        { label: "下半身",   bodyParts: ["四頭", "ハムストリングス", "尻", "腹筋"] },
        { label: "上半身B",  bodyParts: ["胸", "背中", "四頭", "腹筋"] },
    ],
    upper_lower: [
        { label: "上半身", bodyParts: ["胸", "背中", "肩", "二頭", "三頭"] },
        { label: "下半身", bodyParts: ["四頭", "ハムストリングス", "尻", "腹筋"] },
    ],
    ppl: [
        { label: "Push", bodyParts: ["胸", "肩", "三頭"] },
        { label: "Pull", bodyParts: ["背中", "二頭"] },
        { label: "Legs", bodyParts: ["四頭", "ハムストリングス", "尻", "腹筋"] },
    ],
    body_part_3: [
        { label: "胸・三頭",   bodyParts: ["胸", "三頭"] },
        { label: "背中・二頭", bodyParts: ["背中", "二頭"] },
        { label: "脚・肩・腹", bodyParts: ["四頭", "ハムストリングス", "尻", "肩", "腹筋"] },
    ],
    body_part_4: [
        { label: "胸",   bodyParts: ["胸", "三頭"] },
        { label: "背中", bodyParts: ["背中", "二頭"] },
        { label: "脚",   bodyParts: ["四頭", "ハムストリングス", "尻"] },
        { label: "肩・腹", bodyParts: ["肩", "腹筋"] },
    ],
    body_part_5: [
        { label: "胸・三頭",   bodyParts: ["胸", "三頭"] },
        { label: "背中・二頭", bodyParts: ["背中", "二頭"] },
        { label: "脚",         bodyParts: ["四頭", "ハムストリングス", "尻"] },
        { label: "肩",         bodyParts: ["肩"] },
        { label: "腹筋",       bodyParts: ["腹筋"] },
    ],
    arnold: [
        { label: "胸・背中", bodyParts: ["胸", "背中"] },
        { label: "肩・腕",   bodyParts: ["肩", "二頭", "三頭"] },
        { label: "脚",       bodyParts: ["四頭", "ハムストリングス", "尻"] },
    ],
};

export const CUSTOM_SPLIT_KEY = "customSplitSequence";

/**
 * Build the plan day sequence for a given split type.
 * For splitType "custom", pass the customSequence explicitly (or load from localStorage).
 * Returns an array of {label, bodyParts} objects.
 */
export function buildPlanDaySequence(splitType, customSequence = null) {
    if (splitType === "custom") {
        if (customSequence?.length) return customSequence;
        // Fallback: try to load from localStorage
        try {
            const stored = JSON.parse(localStorage.getItem(CUSTOM_SPLIT_KEY) || "null");
            if (stored?.length) return stored;
        } catch {}
        return SPLIT_SEQUENCES.ppl3;
    }
    return SPLIT_SEQUENCES[splitType] || SPLIT_SEQUENCES.ppl3;
}

/**
 * Find the index in the sequence that best matches the recorded body parts.
 * Scoring: intersection size (number of matching body parts).
 * Tie-break: prefer the sequence day with fewer unmatched body parts (closer match).
 *
 * @param {string[]} recordedBodyParts - Body parts the user actually recorded today
 * @param {{ label: string, bodyParts: string[] }[]} sequence
 * @returns {number} Best matching index, or -1 if no overlap found (fallback)
 */
export function findBestMatchingPlanDayIndex(recordedBodyParts, sequence) {
    if (!recordedBodyParts?.length || !sequence?.length) return -1;

    const recordedSet = new Set(recordedBodyParts);
    let bestIdx = -1;
    let bestScore = 0;       // intersection size
    let bestExtra = Infinity; // unmatched parts on sequence side (lower = better)

    sequence.forEach(({ bodyParts }, idx) => {
        const intersection = (bodyParts || []).filter(bp => recordedSet.has(bp)).length;
        const extra = (bodyParts || []).length - intersection;

        if (
            intersection > bestScore ||
            (intersection === bestScore && intersection > 0 && extra < bestExtra)
        ) {
            bestScore = intersection;
            bestExtra = extra;
            bestIdx = idx;
        }
    });

    return bestScore > 0 ? bestIdx : -1;
}

/**
 * Given completedDates ({ "YYYY-MM-DD": sequenceIndex }), return
 * the next sequence index to show.
 */
export function getNextPlanDayIndex(completedDates, sequence) {
    if (!sequence?.length) return 0;
    const dates = Object.keys(completedDates || {}).sort();
    if (dates.length === 0) return 0;
    const lastIndex = completedDates[dates[dates.length - 1]];
    return (lastIndex + 1) % sequence.length;
}

function getLocationType(answers) {
    if (answers.location === "ジム") return "gym";
    if (answers.hasDumbbells === "ある") return "home_db";
    return "home_bw";
}

export function determineSplitType(frequency) {
    const n = Number(frequency) || 3;
    if (n <= 2) return "fullbody";
    if (n === 3) return "ppl3";
    if (n === 4) return "upper_lower";
    return "ppl";
}

export const SPLIT_TYPE_LABELS = {
    fullbody:     "全身法",
    ppl3:         "上半身・下半身・全身",
    upper_lower:  "上半身・下半身分割",
    ppl:          "PPL（プッシュ・プル・レッグ）",
    body_part_3:  "部位別分割（3日）",
    body_part_4:  "部位別分割（4日）",
    body_part_5:  "部位別分割（5日）",
    arnold:       "アーノルド分割",
    custom:       "自分でカスタム",
};

/**
 * Descriptions for each user-facing split preference value.
 * Keyed by the value used in onboarding / settings (not the internal splitType).
 */
export const SPLIT_TYPE_DESCRIPTIONS = {
    upper_lower: "上半身の日と下半身の日を交互に行う2分割。1回あたりの部位数が絞られるので集中しやすく、各部位を週2回刺激できるのが強み。週2〜4回トレーニングする人に向いた、初〜中級者に扱いやすい分割です。",
    ppl:         "「押す種目の日（胸・肩・三頭）」「引く種目の日（背中・二頭）」「脚の日」の3分割。動作の方向で分けるため、同じ筋肉を使う種目がまとまり、効率よく追い込めます。週3〜6回の人に向く、中級者以上に人気の王道分割です。",
    body_part:   "1日に1〜2部位をじっくり追い込む分割（例：胸の日、背中の日、肩の日…）。1部位に多くの種目・セットを使えるので、特定の部位を重点的に育てたい人向け。週5回以上しっかり通える中〜上級者に向いています。",
    arnold:      "「胸・背中」「肩・腕」「脚」の3分割を週2周する高頻度分割（週6日）。相反する筋肉（胸と背中など）を同じ日に組み合わせるのが特徴で、各部位を週2回、高いボリュームで鍛えられます。アーノルド・シュワルツェネッガーが実践したことで有名。トレーニングに多くの時間を割ける上級者向けで、週6日通える人におすすめです。",
    fullbody:    "毎回、全身の主要部位をまんべんなく行う方法。1回で全身を刺激できるので、トレーニング頻度が少なくても各部位を鍛えられます。週1〜2回の人や、始めたばかりの初心者に特におすすめです。",
    none:        "あなたのトレーニング頻度に合わせて、最適な分割を自動で提案します。迷ったらこれを選んでおけば大丈夫です。",
};

/**
 * Resolve split type from the user's stated preference + weekly frequency.
 * "preferredSplit" values: "upper_lower" | "ppl" | "body_part" | "fullbody" | null
 * Falls back to determineSplitType when preference is null/unknown.
 */
export function getSplitTypeFromPreference(preferredSplit, frequency) {
    const freq = Number(frequency) || 3;
    // Low-frequency override: always fullbody regardless of preference
    if (freq <= 2) return "fullbody";
    switch (preferredSplit) {
        case "upper_lower": return "upper_lower";
        case "ppl":         return freq >= 5 ? "ppl" : "ppl3";
        case "body_part":
            if (freq === 3) return "body_part_3";
            if (freq === 4) return "body_part_4";
            return "body_part_5";
        case "fullbody":    return "fullbody";
        case "arnold":      return "arnold";
        case "custom":      return "custom";
        default:            return determineSplitType(freq);
    }
}

// Build muscleEx-format object from answers + favorites
export function buildMuscleExFromAnswers(answers) {
    const { level = "初心者", favorites = [] } = answers;
    const locationType = getLocationType(answers);
    const templates = TEMPLATES[locationType];
    const count = PART_COUNT[level] || 2;
    const muscleEx = {};

    BODY_PARTS.forEach((part) => {
        const partTemplates = templates[part] || [];
        const favsForPart = favorites.filter(f => f.bodyPart === part).map(f => f.name);

        const names = [...favsForPart];
        for (const name of partTemplates) {
            if (names.length >= count) break;
            if (!names.includes(name)) names.push(name);
        }
        if (names.length === 0) return;

        muscleEx[part] = names.map((name) => ({
            id: `ob_${part}_${name}`,
            name,
            label: part,
            bodyPart: part,
        }));
    });

    return muscleEx;
}

/**
 * Returns true if changing this profile field should reset AI plan progress
 * (completedDates cleared).
 * @param {string} fieldId
 * @returns {boolean}
 */
const PLAN_PROGRESS_RESET_FIELDS = new Set(["level", "frequency", "location", "hasDumbbells", "preferredSplit"]);
export function shouldResetPlanProgress(fieldId) {
    return PLAN_PROGRESS_RESET_FIELDS.has(fieldId);
}

/**
 * Returns true if changing this profile field should trigger a muscleEx template
 * rebuild (buildMuscleExFromAnswers is affected by level, location, hasDumbbells only).
 * frequency and preferredSplit affect split routing, not template content.
 * @param {string} fieldId
 * @returns {boolean}
 */
const MUSCLE_EX_REBUILD_FIELDS = new Set(["level", "location", "hasDumbbells"]);
export function shouldRebuildMuscleEx(fieldId) {
    return MUSCLE_EX_REBUILD_FIELDS.has(fieldId);
}

/**
 * Merge two muscleEx objects: newMuscleEx exercises come first (template result),
 * then any extra exercises from prevMuscleEx that are not already present (custom additions).
 * No duplicates by exercise id. All body parts from both objects are preserved.
 *
 * @param {object} newMuscleEx - freshly built (e.g. from buildMuscleExFromAnswers)
 * @param {object} prevMuscleEx - existing muscleEx (may contain post-onboarding custom exercises)
 * @returns {object} merged muscleEx
 */
export function mergeMuscleEx(newMuscleEx, prevMuscleEx) {
    if (!prevMuscleEx || typeof prevMuscleEx !== "object") return newMuscleEx;
    const result = {};
    const allParts = new Set([...Object.keys(newMuscleEx), ...Object.keys(prevMuscleEx)]);
    for (const part of allParts) {
        const newExs = newMuscleEx[part] || [];
        const prevExs = prevMuscleEx[part] || [];
        const newIds = new Set(newExs.map((e) => e.id));
        const extras = prevExs.filter((e) => !newIds.has(e.id));
        result[part] = [...newExs, ...extras];
    }
    return result;
}

/**
 * Build the exercise list for a single AI plan session using weekly set targets.
 *
 * @param {object} params
 * @param {string[]} params.bodyParts - Body parts for this plan day
 * @param {object|null} params.answers - onboardingAnswers from localStorage
 * @param {object} params.history - trustedHistory ({ exName: [{ date, bodyPart, sets, order }] })
 * @param {object} [params.weeklySetTargets={}] - { [bp]: number } weekly set targets per body part
 * @param {string|null} [params.splitType=null] - resolved split type; if null, derived from answers
 * @returns {{ name: string, bodyPart: string, label: string }[]}
 */
/** 直近8週の履歴から1種目あたりの平均完了セット数を算出する。
 *  出現回数が MIN_OCCURRENCES 未満のとき、または履歴がないときは
 *  DEFAULT_PLAN_PARAMS[level].sets にフォールバックする。
 *  算出値は [SPS_MIN, SPS_MAX] にクランプする。
 *
 * @param {object} history  trustedHistory { exName: [{ date, sets:[{done}] }] }
 * @param {string} level    "初心者" | "中級者" | "上級者"
 * @returns {{ value: number, source: "history"|"default", totalSets: number,
 *             totalOccurrences: number, raw: number|null }}
 */
const SPS_MIN_OCCURRENCES = 10;
const SPS_MIN = 2;
const SPS_MAX = 5;

export function computeSetsPerExerciseFromHistory(history, level = "初心者") {
    const cutoff = getEightWeeksAgoDate();
    const fallback = DEFAULT_PLAN_PARAMS[level]?.sets ?? 3;
    let totalSets = 0;
    let totalOccurrences = 0;

    Object.values(history || {}).forEach((records) => {
        (records || []).forEach((record) => {
            if (!record || record.date < cutoff) return;
            const doneSets = (record.sets || []).filter((s) => s?.done).length;
            if (doneSets === 0) return; // 完了セットなし → 出現回数にも含めない
            totalSets += doneSets;
            totalOccurrences++;
        });
    });

    if (totalOccurrences < SPS_MIN_OCCURRENCES) {
        return { value: fallback, source: "default", totalSets, totalOccurrences, raw: null };
    }

    const raw = totalSets / totalOccurrences;
    const value = Math.min(SPS_MAX, Math.max(SPS_MIN, raw));
    return { value, source: "history", totalSets, totalOccurrences, raw };
}

export function buildSessionExercisesForPlanDay({ bodyParts, answers, history, weeklySetTargets = {}, splitType = null }) {
    const { level = "初心者", favorites = [], frequency = 3 } = answers || {};
    const locationType = getLocationType(answers || {});
    const templates = TEMPLATES[locationType];
    const spsResult = computeSetsPerExerciseFromHistory(history, level);
    const setsPerExercise = spsResult.value;

    // ── Step 1: Compute per-body-part exercise count ──────────────────────────
    const resolvedSplitType = splitType ?? getSplitTypeFromPreference(answers?.preferredSplit ?? null, frequency);
    const sequence = buildPlanDaySequence(resolvedSplitType);
    const cycleLength = Math.max(1, sequence.length);
    const sessionsPerWeek = Number(frequency) || 3;
    const cyclesPerWeek = Math.max(sessionsPerWeek / cycleLength, 0.01);

    const rawCountByPart = {};
    const setsThisSessionByPart = {};

    for (const bp of bodyParts) {
        const weeklyTarget = weeklySetTargets[bp] ?? 10;
        if (weeklyTarget === 0) {
            rawCountByPart[bp] = 0;
            setsThisSessionByPart[bp] = 0;
            continue;
        }
        const stsSession = weeklyTarget / cyclesPerWeek;
        setsThisSessionByPart[bp] = stsSession;
        rawCountByPart[bp] = Math.min(Math.round(stsSession / setsPerExercise), 3);
    }

    // ── Step 2: Apply 8-exercise day cap (priority = most setsThisSession) ───
    const activeParts = bodyParts.filter(bp => rawCountByPart[bp] > 0);
    const totalRaw = activeParts.reduce((sum, bp) => sum + rawCountByPart[bp], 0);

    const finalCountByPart = { ...rawCountByPart };

    if (totalRaw > 8) {
        // Sort by setsThisSession descending (stable — Array.sort is stable in V8)
        const sorted = [...activeParts].sort((a, b) => setsThisSessionByPart[b] - setsThisSessionByPart[a]);
        let remaining = 8;
        // Zero out all first
        sorted.forEach(bp => { finalCountByPart[bp] = 0; });
        for (const bp of sorted) {
            if (remaining <= 0) break;
            const give = Math.min(rawCountByPart[bp], remaining);
            finalCountByPart[bp] = give;
            remaining -= give;
        }
    }

    // ── Step 3: Build 8-week history structures ───────────────────────────────
    const cutoff = getEightWeeksAgoDate();
    const relevantBpSet = new Set(bodyParts);

    // histFreqByPart[bp][exName] = count of records within 8 weeks
    const histFreqByPart = {};
    // avgOrderByPart[bp][exName] = { sum, count } → will convert to avg
    const avgOrderAccByPart = {};

    for (const bp of bodyParts) {
        histFreqByPart[bp] = {};
        avgOrderAccByPart[bp] = {};
    }

    Object.entries(history || {}).forEach(([exName, records]) => {
        (records || []).forEach(record => {
            if (!record || record.date < cutoff) return;
            const bp = String(record.bodyPart || record.body_part || "").trim();
            if (!relevantBpSet.has(bp)) return;

            histFreqByPart[bp][exName] = (histFreqByPart[bp][exName] || 0) + 1;

            const orderVal = record.order;
            if (Number.isFinite(orderVal)) {
                if (!avgOrderAccByPart[bp][exName]) {
                    avgOrderAccByPart[bp][exName] = { sum: 0, count: 0 };
                }
                avgOrderAccByPart[bp][exName].sum += orderVal;
                avgOrderAccByPart[bp][exName].count += 1;
            }
        });
    });

    // Convert accumulator to avg
    const avgOrderByPart = {};
    for (const bp of bodyParts) {
        avgOrderByPart[bp] = {};
        for (const [exName, acc] of Object.entries(avgOrderAccByPart[bp])) {
            avgOrderByPart[bp][exName] = acc.sum / acc.count;
        }
    }

    // ── Step 4: Select and order exercises per body part ─────────────────────
    const result = [];
    const intermediates = {};

    for (const bp of bodyParts) {
        const count = finalCountByPart[bp] ?? 0;
        const weeklyTarget = weeklySetTargets[bp] ?? 10;

        intermediates[bp] = {
            weeklyTarget,
            setsThisSession: +( setsThisSessionByPart[bp] ?? 0).toFixed(1),
            rawCount: rawCountByPart[bp] ?? 0,
            finalCount: count,
        };

        if (count === 0) continue;

        // candidates: history (sorted by freq desc) → favorites (not in hist) → templates (not in hist/favs)
        const histSorted = Object.entries(histFreqByPart[bp])
            .sort((a, b) => b[1] - a[1])
            .map(([name]) => name);

        const histSet = new Set(histSorted);
        const favNames = (favorites || [])
            .filter(f => f.bodyPart === bp)
            .map(f => f.name)
            .filter(name => !histSet.has(name));

        const favSet = new Set(favNames);
        const tmplNames = (templates[bp] || [])
            .filter(name => !histSet.has(name) && !favSet.has(name));

        const candidates = [...histSorted, ...favNames, ...tmplNames];
        const selected = candidates.slice(0, count);

        // Sort by avg order ascending (no-history → Infinity → goes last)
        selected.sort((a, b) => {
            const aAvg = avgOrderByPart[bp][a] ?? Infinity;
            const bAvg = avgOrderByPart[bp][b] ?? Infinity;
            return aAvg - bAvg;
        });

        result.push(...selected.map(name => ({ name, bodyPart: bp, label: bp })));
    }

    return result;
}

/**
 * Applies the onboarding plan to localStorage.
 * - If muscleEx (routineEx) is empty, writes the generated plan directly.
 * - If it already has data, saves plan to aiPlanExercises without overwriting.
 * Always marks onboardingPlanGenerated = true.
 */
export function applyOnboardingPlan(answers) {
    const generated = buildMuscleExFromAnswers(answers);
    const existing = load(ROUTINE_KEY, {});
    const hasExisting = Object.keys(existing).some(k => (existing[k] || []).length > 0);

    if (!hasExisting) {
        save(ROUTINE_KEY, generated);
    } else {
        // Preserve existing routine; keep generated plan available for reference
        save("aiPlanExercises", generated);
    }

    save(ONBOARDING_PLAN_KEY, true);

    return {
        muscleEx: hasExisting ? existing : generated,
        aiPlanExercises: generated,
        splitType: getSplitTypeFromPreference(answers.preferredSplit ?? null, answers.frequency),
        hasExisting,
    };
}
