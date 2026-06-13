// src/components/home/homeUtils.js
import { normalizeBodyPartLabel, resolveRecordedBodyPartLabel, resolveVisibleBodyPartLabel } from "../../utils/bodyPartClassification";
import { formatDateKey, sanitizeHistoryRecord } from "../../utils/helpers";

export const DEFAULT_PARTS = ["胸", "背中", "肩", "二頭", "三頭", "四頭", "ハム", "腹筋"];
export const WEEKLY_DEBUG_DATE = "2026-06-03";
export const WEEKLY_CONSISTENCY_DATES = ["2026-06-01", "2026-06-02", "2026-06-03"];

export const getPerfNow = () => (
    typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now()
);

export const shouldLogHomePerfDebug = () => {
    if (typeof window === "undefined") return false;
    try {
        return window.localStorage?.getItem("pump_debug_perf") === "1"
            || window.localStorage?.getItem("pump_debug_history") === "1";
    } catch {
        return false;
    }
};

export const durationDebugSignatures = new Set();

export const FALLBACK_PART_MAP = {
    "ベンチ": "胸",
    "インクライン": "胸",
    "ペック": "胸",
    "チェスト": "胸",
    "ディップス": "胸",
    "フライ": "胸",
    "ラット": "背中",
    "ロウ": "背中",
    "ロー": "背中",
    "デッド": "背中",
    "懸垂": "背中",
    "チンニング": "背中",
    "プル": "背中",
    "ショルダー": "肩",
    "サイドレイズ": "肩",
    "リアレイズ": "肩",
    "フロントレイズ": "肩",
    "カール": "二頭",
    "プレスダウン": "三頭",
    "トライセプス": "三頭",
    "ハイパーエクステンション": "ハム",
    "バックエクステンション": "ハム",
    "エクステンション": "三頭",
    "スクワット": "四頭",
    "レッグプレス": "四頭",
    "レッグエクステンション": "四頭",
    "レッグカール": "ハム",
    "ルーマニアン": "ハム",
    "腹": "腹筋",
    "クランチ": "腹筋",
    "レッグレイズ": "腹筋",
    "プランク": "腹筋",
};

export const RECOVERY_META = {
    excellent: { label: "非常に良好", color: "#16D7D2" },
    good: { label: "良好", color: "#55D89E" },
    tired: { label: "やや疲労", color: "#F6A623" },
    bad: { label: "疲労あり", color: "#FF4D4D" },
};

export function normalizeHomeBodyPart(label) {
    return normalizeBodyPartLabel(label);
}

export function toNumber(value) {
    const n = parseFloat(String(value ?? "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
}

export function isBodyWeight(value) {
    return String(value ?? "").trim().toUpperCase() === "BW";
}

export function isLbsValue(value) {
    const raw = String(value ?? "").toLowerCase();
    return raw.includes("lbs") || raw.includes("lb");
}

export function weightToKg(value) {
    if (isBodyWeight(value)) return 0;
    const n = toNumber(value);
    return isLbsValue(value) ? n * 0.45359237 : n;
}

export function formatWeightForDisplay(value) {
    if (isBodyWeight(value)) return "自重";

    const raw = String(value ?? "").trim();
    const n = toNumber(value);
    if (!n) return "0kg";

    if (isLbsValue(value)) {
        return raw.toLowerCase().includes("lbs") || raw.toLowerCase().includes("lb")
            ? raw
            : `${n}lbs`;
    }

    if (raw.toLowerCase().includes("kg")) return raw;

    return `${n}kg`;
}

export function resolveBodyPart(exName, muscleEx, overrides, record = null) {
    // 1. 記録に保存された部位を最優先
    if (record) {
        const recorded = resolveRecordedBodyPartLabel(record, exName, {
            muscleEx,
            exerciseBodyPartOverrides: overrides,
        });
        if (recorded && recorded !== "その他") {
            return normalizeHomeBodyPart(recorded);
        }
    }

    // 2. 既存の部位分類ロジックを使う
    const visible = resolveVisibleBodyPartLabel(exName, {
        muscleEx,
        exerciseBodyPartOverrides: overrides,
    });
    if (visible && visible !== "その他") {
        return normalizeHomeBodyPart(visible);
    }

    // 3. 手動override
    if (overrides?.[exName]) {
        return normalizeHomeBodyPart(overrides[exName]);
    }

    // 4. muscleExから直接探す
    const found = Object.entries(muscleEx || {}).find(([, exs]) =>
        Array.isArray(exs) && exs.some(e => {
            const name = typeof e === "string" ? e : e?.name;
            return name === exName;
        })
    );
    if (found?.[0]) {
        return normalizeHomeBodyPart(found[0]);
    }

    // 5. 最後の保険
    const key = Object.keys(FALLBACK_PART_MAP).find(k => String(exName || "").includes(k));
    return key ? normalizeHomeBodyPart(FALLBACK_PART_MAP[key]) : "その他";
}

export function getWeekRange() {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const mon = new Date(now);
    mon.setHours(0, 0, 0, 0);
    mon.setDate(now.getDate() + diff);

    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);

    const fmt = d => `${d.getMonth() + 1}/${d.getDate()}`;
    return {
        label: `${fmt(mon)} - ${fmt(sun)}`,
        start: formatDateKey(mon),
        end: formatDateKey(sun),
    };
}

export function getRecordSets(record) {
    return sanitizeHistoryRecord(record, { allowBodyweight: true })?.sets || [];
}

export function getRecordSetCount(record) {
    return getRecordSets(record).length;
}

export function getRecordVolume(record) {
    return getRecordSets(record).reduce((sum, s) => {
        const weight = weightToKg(s?.weight);
        const reps = toNumber(s?.reps);
        return sum + weight * reps;
    }, 0);
}

export function resolveRecordDuration(record, workoutDurationSecByDate, dateKey) {
    const candidates = [
        { source: "duration_sec", value: Number(record?.duration_sec) / 60 },
        { source: "durationSec", value: Number(record?.durationSec) / 60 },
        { source: "savedWorkoutDurationSecByDate", value: Number(workoutDurationSecByDate?.[dateKey]) / 60 },
        { source: "elapsedMinutes", value: Number(record?.elapsedMinutes) },
        { source: "durationMinutes", value: Number(record?.durationMinutes) },
    ].filter((candidate) => Number.isFinite(candidate.value) && candidate.value > 0);

    if (!candidates.length) {
        return {
            minutes: null,
            source: null,
            rawDuration: null,
            rawDurationCandidates: [],
        };
    }

    const best = candidates.reduce((max, candidate) => (
        candidate.value > max.value ? candidate : max
    ), candidates[0]);

    return {
        minutes: Math.max(1, Math.round(best.value)),
        source: best.source,
        rawDuration: best.value,
        rawDurationCandidates: candidates,
    };
}

export function getExerciseFatigueCoeff(exName) {
    const name = String(exName || "");

    if (name.includes("スクワット")) return 2.4;
    if (name.includes("デッド") || name.includes("ルーマニアン")) return 2.5;
    if (name.includes("レッグプレス")) return 2.0;
    if (name.includes("ベンチ")) return 1.8;
    if (name.includes("ショルダー") || name.includes("オーバーヘッド")) return 1.6;
    if (name.includes("ラット") || name.includes("ロウ") || name.includes("ロー") || name.includes("懸垂")) return 1.5;
    if (name.includes("カール") || name.includes("プレスダウン") || name.includes("レイズ")) return 1.1;
    if (name.includes("フライ") || name.includes("フェイスプル")) return 1.0;
    if (name.includes("腹") || name.includes("クランチ") || name.includes("プランク")) return 0.8;

    return 1.2;
}

export function getSetFatigueScore(exName, set) {
    const coeff = getExerciseFatigueCoeff(exName);
    const weight = weightToKg(set?.weight);
    const reps = toNumber(set?.reps);

    if (reps <= 0) return 0;

    let intensity = 1.0;

    if (weight >= 180) intensity = 2.4;
    else if (weight >= 140) intensity = 2.0;
    else if (weight >= 100) intensity = 1.65;
    else if (weight >= 60) intensity = 1.3;
    else if (weight >= 30) intensity = 1.1;

    let repFactor = 1.0;
    if (reps <= 5) repFactor = 1.18;
    else if (reps <= 8) repFactor = 1.08;
    else if (reps >= 15) repFactor = 0.92;

    return coeff * intensity * repFactor;
}

export function getRecordFatigueScore(exName, record) {
    const sets = getRecordSets(record);
    if (sets.length === 0) return 0;

    return sets.reduce((sum, set) => sum + getSetFatigueScore(exName, set), 0);
}

export function calcRecovery(history, bodyPart, muscleEx, overrides) {
    const now = Date.now();
    let lastMs = null;
    let fatigueScore = 0;

    Object.entries(history || {}).forEach(([exName, records]) => {
        (records || []).forEach(record => {
            if (!getRecordSets(record).length) return;
            const bp = resolveBodyPart(exName, muscleEx, overrides, record);
            if (bp !== bodyPart) return;

            const d = new Date(record.date + "T00:00:00");
            if (Number.isNaN(d.getTime())) return;

            const ms = d.getTime();
            if (!lastMs || ms > lastMs) lastMs = ms;

            const hoursAgo = (now - ms) / 3600000;
            if (hoursAgo <= 168) {
                const decay = Math.max(0, 1 - hoursAgo / 168);
                fatigueScore += getRecordFatigueScore(exName, record) * decay;
            }
        });
    });

    if (!lastMs) return { pct: 100, status: "excellent" };

    const lastHours = Math.max(0, (now - lastMs) / 3600000);

    // 疲労が大きいほど、最大低下量と回復に必要な時間が増える
    const maxPenalty = Math.max(18, Math.min(82, 12 + fatigueScore * 8));
    const recoveryHours = Math.max(24, Math.min(120, 18 + fatigueScore * 8));

    const recoveredRatio = Math.min(1, lastHours / recoveryHours);
    let pct = 100 - maxPenalty * (1 - recoveredRatio);

    pct = Math.max(18, Math.min(100, Math.round(pct)));

    const status = pct >= 80 ? "excellent"
        : pct >= 60 ? "good"
        : pct >= 40 ? "tired"
        : "bad";

    return { pct, status };
}

export function collectWeeklySets(history, muscleEx, overrides) {
    const { start, end } = getWeekRange();
    const map = {};

    Object.entries(history || {}).forEach(([exName, records]) => {
        (records || []).forEach(record => {
            if (!record.date || record.date < start || record.date > end) return;
            const setCount = getRecordSetCount(record);
            if (setCount <= 0) return;
            const bp = resolveBodyPart(exName, muscleEx, overrides, record);
            if (bp === "その他") return;
            map[bp] = (map[bp] || 0) + setCount;
        });
    });

    return map;
}

export function collectWeeklyAggregationDebug(history, muscleEx, overrides) {
    const { start, end } = getWeekRange();
    const exerciseNames = [];
    const bodyPartCounts = {};
    const setCountByExercise = {};
    const loadedDates = new Set();
    const debugDateExerciseNames = [];
    const debugDateShoulderExercises = [];
    const debugDateSetCountByExercise = {};
    let debugDateShoulderSetCount = 0;

    Object.entries(history || {}).forEach(([exName, records]) => {
        (records || []).forEach(record => {
            if (!record.date || record.date < start || record.date > end) return;
            const setCount = getRecordSetCount(record);
            if (setCount <= 0) return;

            const bp = resolveBodyPart(exName, muscleEx, overrides, record);
            loadedDates.add(record.date);
            exerciseNames.push(exName);
            setCountByExercise[exName] = (setCountByExercise[exName] || 0) + setCount;
            if (bp !== "その他") {
                bodyPartCounts[bp] = (bodyPartCounts[bp] || 0) + setCount;
            }
            if (record.date === WEEKLY_DEBUG_DATE) {
                debugDateExerciseNames.push(exName);
                debugDateSetCountByExercise[exName] = (debugDateSetCountByExercise[exName] || 0) + setCount;
                if (bp === "肩") {
                    debugDateShoulderExercises.push(exName);
                    debugDateShoulderSetCount += setCount;
                }
            }
        });
    });

    return {
        source: "App history (workouts.data priority)",
        week: { start, end },
        loadedDates: [...loadedDates].sort(),
        debugDate: WEEKLY_DEBUG_DATE,
        debugDateExerciseNames: [...new Set(debugDateExerciseNames)],
        debugDateShoulderExercises: [...new Set(debugDateShoulderExercises)],
        debugDateShoulderSetCount,
        debugDateSetCountByExercise,
        exerciseNames: [...new Set(exerciseNames)],
        setCountByExercise,
        bodyPartCounts,
        finalShoulderSetCount: bodyPartCounts["肩"] || 0,
    };
}

export function collectRecentSessions(history, muscleEx, overrides, workoutDurationSecByDate = {}) {
    const sessions = {};

    Object.entries(history || {}).forEach(([exName, records]) => {
        (records || []).forEach(record => {
            if (!record.date) return;
            const setCount = getRecordSetCount(record);
            if (setCount <= 0) return;
            const dateKey = String(record.date || "").slice(0, 10);
            const durationInfo = resolveRecordDuration(record, workoutDurationSecByDate, dateKey);
            const recordMinutes = durationInfo.minutes;

            if (!sessions[dateKey]) {
                sessions[dateKey] = {
                    date: dateKey,
                    parts: new Set(),
                    sets: 0,
                    volume: 0,
                    minutes: recordMinutes,
                    durationSource: durationInfo.source,
                    rawDuration: durationInfo.rawDuration,
                    rawDurationCandidates: durationInfo.rawDurationCandidates || [],
                    exercises: [],
                };
            } else if (!sessions[dateKey].minutes && recordMinutes) {
                sessions[dateKey].minutes = recordMinutes;
                sessions[dateKey].durationSource = durationInfo.source;
                sessions[dateKey].rawDuration = durationInfo.rawDuration;
                sessions[dateKey].rawDurationCandidates = durationInfo.rawDurationCandidates || [];
            } else if (recordMinutes && sessions[dateKey].minutes && recordMinutes > sessions[dateKey].minutes) {
                sessions[dateKey].minutes = recordMinutes;
                sessions[dateKey].durationSource = durationInfo.source;
                sessions[dateKey].rawDuration = durationInfo.rawDuration;
                sessions[dateKey].rawDurationCandidates = durationInfo.rawDurationCandidates || [];
            }

            const bp = resolveBodyPart(exName, muscleEx, overrides, record);
            if (bp !== "その他") sessions[dateKey].parts.add(bp);

            const volume = getRecordVolume(record);

            sessions[dateKey].sets += setCount;
            sessions[dateKey].volume += volume;

            sessions[dateKey].exercises.push({
                name: exName,
                bodyPart: bp,
                setCount,
                volume: Math.round(volume),
                order: Number.isFinite(Number(record.order)) ? Number(record.order)
                    : Number.isFinite(Number(record.exerciseOrder)) ? Number(record.exerciseOrder)
                    : Number.isFinite(Number(record.sortOrder)) ? Number(record.sortOrder)
                    : sessions[dateKey].exercises.length,
                sets: getRecordSets(record).map(s => ({
                    weight: formatWeightForDisplay(s.weight),
                    reps: s.reps,
                })),
            });
        });
    });

    return Object.values(sessions)
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(s => {
            const normalized = {
                ...s,
                parts: [...s.parts].slice(0, 3),
                volume: Number.isFinite(s.volume) ? Math.round(s.volume) : 0,
                exercises: (s.exercises || []).sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999)),
            };

            if (normalized.sets >= 5 && Number(normalized.minutes || 0) <= 1) {
                const signature = `${normalized.date}:${normalized.sets}:${normalized.minutes}:${normalized.durationSource}`;
                if (!durationDebugSignatures.has(signature)) {
                    durationDebugSignatures.add(signature);
                    console.warn("[home duration]", {
                        action: "workout_duration_debug",
                        date: normalized.date,
                        sessionId: normalized.date,
                        exerciseNames: normalized.exercises.map((exercise) => exercise.name),
                        setCount: normalized.sets,
                        startTime: null,
                        endTime: null,
                        rawDurationCandidates: normalized.rawDurationCandidates || [],
                        chosenDuration: normalized.minutes,
                        rejectedDurationCandidates: normalized.rawDurationCandidates || [],
                        displayedDuration: null,
                        source: normalized.durationSource,
                        reasonIfOneMinute: "recent session has 5+ sets but only suspicious 1-minute duration candidates",
                    });
                }
                normalized.minutes = null;
                normalized.durationSource = null;
                normalized.rawDuration = null;
            }

            return normalized;
        });
}

export function collectWeeklySetsFromSessions(sessions = []) {
    return (sessions || []).reduce((acc, session) => {
        (session.exercises || []).forEach((exercise) => {
            const bp = normalizeHomeBodyPart(exercise.bodyPart);
            const setCount = Number(exercise.setCount || 0);
            if (!bp || bp === "その他" || setCount <= 0) return;
            acc[bp] = (acc[bp] || 0) + setCount;
        });
        return acc;
    }, {});
}

export function collectWeeklyPartDetailFromSessions(sessions = [], targetPart) {
    const exerciseMap = {};
    let totalSets = 0;
    let totalVolume = 0;
    let lastDate = null;

    (sessions || []).forEach((session) => {
        (session.exercises || []).forEach((exercise) => {
            const bp = normalizeHomeBodyPart(exercise.bodyPart);
            if (bp !== targetPart) return;

            const sets = Number(exercise.setCount || 0);
            if (sets <= 0) return;

            const volume = Number(exercise.volume || 0);
            if (!exerciseMap[exercise.name]) {
                exerciseMap[exercise.name] = {
                    name: exercise.name,
                    sets: 0,
                    volume: 0,
                    dates: new Set(),
                };
            }

            exerciseMap[exercise.name].sets += sets;
            exerciseMap[exercise.name].volume += volume;
            exerciseMap[exercise.name].dates.add(session.date);
            totalSets += sets;
            totalVolume += volume;

            if (!lastDate || session.date > lastDate) {
                lastDate = session.date;
            }
        });
    });

    return {
        part: targetPart,
        totalSets,
        totalVolume: Math.round(totalVolume),
        lastDate,
        exercises: Object.values(exerciseMap)
            .map(item => ({
                ...item,
                dates: [...item.dates].sort((a, b) => b.localeCompare(a)),
            }))
            .sort((a, b) => {
                if (b.sets !== a.sets) return b.sets - a.sets;
                return String(a.name).localeCompare(String(b.name), "ja");
            }),
    };
}

export function summarizeSessionsByDate(sessions = []) {
    return (sessions || []).reduce((acc, session) => {
        acc[session.date] = Number(session.sets || 0);
        return acc;
    }, {});
}

export function summarizeExercisesForDates(sessions = [], targetDates = []) {
    const dateSet = new Set(targetDates);
    return (sessions || []).reduce((acc, session) => {
        if (!dateSet.has(session.date)) return acc;
        acc[session.date] = (session.exercises || []).map((exercise) => ({
            name: exercise.name,
            bodyPart: exercise.bodyPart,
            setCount: exercise.setCount,
        }));
        return acc;
    }, {});
}

export function sumBodyPartCounts(counts = {}) {
    return Object.values(counts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

export function getRegressedBodyParts(previous = {}, next = {}) {
    const keys = new Set([
        ...Object.keys(previous || {}),
        ...Object.keys(next || {}),
        "肩",
        "三頭",
        "二頭",
    ]);

    return [...keys].filter((key) => Number(next?.[key] || 0) < Number(previous?.[key] || 0));
}

export function bodyPartCountsSignature(counts = {}) {
    return JSON.stringify(
        Object.keys(counts || {})
            .sort()
            .reduce((acc, key) => {
                acc[key] = Number(counts[key] || 0);
                return acc;
            }, {})
    );
}

export function formatDate(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    const days = ["日", "月", "火", "水", "木", "金", "土"];
    return `${d.getMonth() + 1}/${d.getDate()} (${days[d.getDay()]})`;
}

export function collectPartDetail(history, muscleEx, overrides, targetPart) {
    const now = Date.now();
    const recent = [];
    let totalSets7d = 0;
    let totalVolume7d = 0;
    let lastDate = null;
    let lastExercise = null;

    Object.entries(history || {}).forEach(([exName, records]) => {
        (records || []).forEach(record => {
            const sets = getRecordSetCount(record);
            if (sets <= 0) return;
            const bp = resolveBodyPart(exName, muscleEx, overrides, record);
            if (bp !== targetPart) return;

            const d = new Date(record.date + "T00:00:00");
            if (Number.isNaN(d.getTime())) return;

            const volume = getRecordVolume(record);
            const hoursAgo = (now - d.getTime()) / 3600000;

            if (hoursAgo <= 168) {
                totalSets7d += sets;
                totalVolume7d += volume;
            }

            if (!lastDate || record.date > lastDate) {
                lastDate = record.date;
                lastExercise = exName;
            }

            recent.push({
                date: record.date,
                name: exName,
                sets,
                volume: Math.round(volume),
            });
        });
    });

    recent.sort((a, b) => b.date.localeCompare(a.date));

    const lastHours = lastDate
        ? Math.round((now - new Date(lastDate + "T00:00:00").getTime()) / 3600000)
        : null;

    return {
        totalSets7d,
        totalVolume7d: Math.round(totalVolume7d),
        lastDate,
        lastExercise,
        lastHours,
        recent: recent.slice(0, 5),
    };
}

export function getRecoveryAdvice(part, pct, detail) {
    if (!detail.lastDate) {
        return `${part}は最近の記録がないので、今日は狙いやすい部位です。`;
    }

    if (pct >= 80) {
        return `${part}は回復状態が良いです。高重量やメイン種目を入れても良さそうです。`;
    }

    if (pct >= 60) {
        return `${part}はある程度回復しています。通常メニューでもOKですが、疲労感があれば少し軽めにしましょう。`;
    }

    if (pct >= 40) {
        return `${part}はまだ疲労が残っています。やるなら軽め・少なめのセットがおすすめです。`;
    }

    return `${part}は疲労が強めです。今日は休ませるか、別部位を優先するのが良さそうです。`;
}
