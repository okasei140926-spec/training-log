import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildHistoryFromWorkoutRows,
  calc1RM,
  formatDateKey,
  sanitizeHistoryRecord,
} from "../utils/helpers";
import { normalizeExerciseName } from "../utils/exerciseName";
import { supabase } from "../utils/supabase";
import { extractWorkoutPlanFromText, normalizeWorkoutPlan } from "../utils/aiWorkoutPlan";
import {
  buildRevenueCatPlan,
  configureRevenueCatForUser,
  getRevenueCatAvailability,
  purchaseRevenueCatPro,
  refreshRevenueCatCustomerInfo,
  restoreRevenueCatPurchases,
} from "../lib/revenueCat";

const AI_DAILY_LIMIT = 5;
const AI_USAGE_STORAGE_KEY = "ai_usage_state";
const AI_PRO_STORAGE_KEY = "pump_pro_enabled";
const AI_API_ORIGIN = process.env.REACT_APP_API_ORIGIN || "https://training-log-mu.vercel.app";
const AI_WORKOUTS_SELECT_QUERY = "workouts.select(date,data).eq(user_id).order(date.asc).limit(500)";
const AI_CONTEXT_CANONICAL_SOURCE = "workouts.data";
const INITIAL_AI_MESSAGE = {
  role: "assistant",
  content: "こんにちは！AI Coachです。トレーニングについて何でも聞いてください 💪",
};

const getTodayKey = () => formatDateKey(new Date());
const getAiUsageKey = (dateKey = getTodayKey()) => `ai_usage_${dateKey}`;
const isNativeCapacitorOrigin = () =>
  typeof window !== "undefined" && window.location?.protocol === "capacitor:";
const getAiEnvironment = () => (isNativeCapacitorOrigin() ? "capacitor" : "web");
const getApiUrl = (path) => {
  const normalizedPath = String(path || "").startsWith("/") ? path : `/${path}`;
  if (isNativeCapacitorOrigin()) return `${AI_API_ORIGIN}${normalizedPath}`;
  return normalizedPath;
};

const readApiJson = async (response) => {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch (error) {
    return {
      error: "APIの応答を読み取れませんでした。",
      rawText: text.slice(0, 500),
      parseError: error?.message || String(error),
    };
  }
};

const logAiApiError = (label, details = {}) => {
  console.error(`[AI Coach] ${label}`, {
    env: isNativeCapacitorOrigin() ? "ios-capacitor" : "web",
    origin: typeof window !== "undefined" ? window.location?.origin : "",
    protocol: typeof window !== "undefined" ? window.location?.protocol : "",
    ...details,
  });
};

const normalizeAiUsageCount = (value) => {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.floor(count);
};

const getTodayAiUsage = () => {
  const dateKey = getTodayKey();
  try {
    const stored = JSON.parse(localStorage.getItem(AI_USAGE_STORAGE_KEY) || "{}");
    if (stored?.dateKey === dateKey) {
      return {
        dateKey,
        count: normalizeAiUsageCount(stored.count),
      };
    }

    return {
      dateKey,
      count: normalizeAiUsageCount(localStorage.getItem(getAiUsageKey(dateKey))),
    };
  } catch {
    return { dateKey, count: 0 };
  }
};

const saveAiUsage = ({ dateKey, count }) => {
  const nextUsage = {
    dateKey: dateKey || getTodayKey(),
    count: normalizeAiUsageCount(count),
  };
  try {
    localStorage.setItem(AI_USAGE_STORAGE_KEY, JSON.stringify(nextUsage));
    localStorage.setItem(getAiUsageKey(nextUsage.dateKey), String(nextUsage.count));
  } catch {}
  return nextUsage;
};

const getIsPro = () => {
  try {
    return localStorage.getItem(AI_PRO_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

const resetAiUsageIfNewDay = () => {
  const todayKey = getTodayKey();
  const usage = getTodayAiUsage();
  if (usage.dateKey === todayKey) return usage;
  return saveAiUsage({ dateKey: todayKey, count: 0 });
};

const canUseAiChat = ({ isPro = getIsPro(), usage = getTodayAiUsage() } = {}) =>
  Boolean(isPro) || normalizeAiUsageCount(usage?.count) < AI_DAILY_LIMIT;

const incrementAiUsage = () => {
  if (getIsPro()) return getTodayAiUsage();
  const usage = resetAiUsageIfNewDay();
  const nextCount = Math.min(AI_DAILY_LIMIT, normalizeAiUsageCount(usage.count) + 1);
  return saveAiUsage({ dateKey: usage.dateKey, count: nextCount });
};

const createConversationTitle = (message) => {
  const title = String(message || "").replace(/\s+/g, " ").trim();
  if (!title) return "AI相談";
  return title.length > 28 ? `${title.slice(0, 28)}…` : title;
};

const toAiMessage = (message) => ({
  id: message?.id,
  role: message?.role === "user" ? "user" : "assistant",
  content: String(message?.content || ""),
  workoutPlan: normalizeWorkoutPlan(message?.workoutPlan || message?.workout_plan),
  created_at: message?.created_at || message?.createdAt || new Date().toISOString(),
});

const buildConversationPreview = (messages) => {
  const lastAssistant = [...(messages || [])].reverse().find((message) => message.role === "assistant" && message.content);
  const lastMessage = lastAssistant || [...(messages || [])].reverse().find((message) => message.content);
  const preview = String(lastMessage?.content || "").replace(/\s+/g, " ").trim();
  return preview.length > 48 ? `${preview.slice(0, 48)}…` : preview;
};

const ANALYSIS_KEYWORDS = ["分析", "振り返", "レビュー", "見て", "チェック"];
const MENU_KEYWORDS = ["メニュー", "組んで", "作って", "何すれば", "何したら", "どうすれば"];
const BEGINNER_KEYWORDS = ["初心者", "初めて", "はじめて", "まずは", "簡単", "やさしく"];
const ADVANCED_KEYWORDS = ["中級", "上級", "高重量", "高強度"];

const calcSetVolume = (set) => {
  if (!set) return 0;
  if (set.weight === "BW") return 0;
  return Number(set.weight || 0) * Number(set.reps || 0);
};

const roundToNearest = (value, step = 2.5) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(step, Math.round(numeric / step) * step);
};

const normalizeAiBodyPart = (bodyPart) => {
  const value = String(bodyPart || "").trim();
  if (!value) return "その他";
  if (value === "ハムストリングス" || value.toLowerCase().includes("hamstring")) return "ハム";
  return value;
};

const formatSetLabel = (set) => {
  if (!set) return "";
  const weightLabel = set.weight === "BW" ? "自重" : `${Number(set.weight)}kg`;
  return `${weightLabel}×${Number(set.reps)}回`;
};

const flattenHistoryByDate = (history) => {
  const grouped = new Map();

  Object.entries(history || {}).forEach(([exerciseName, records]) => {
    (records || []).forEach((record) => {
      const sanitized = sanitizeHistoryRecord(record, { allowBodyweight: true });
      if (!sanitized?.date || !Array.isArray(sanitized.sets) || !sanitized.sets.length) return;

      const dateKey = String(sanitized.date).slice(0, 10);
      if (!grouped.has(dateKey)) grouped.set(dateKey, []);

      grouped.get(dateKey).push({
        exerciseName,
        normalizedExerciseName: normalizeExerciseName(exerciseName),
        bodyPart: normalizeAiBodyPart(sanitized.bodyPart),
        sets: sanitized.sets,
        setCount: sanitized.sets.length,
        totalVolume: sanitized.sets.reduce((sum, set) => sum + calcSetVolume(set), 0),
        totalReps: sanitized.sets.reduce((sum, set) => sum + Number(set.reps || 0), 0),
        maxWeight: sanitized.sets.reduce((max, set) => {
          if (set.weight === "BW") return max;
          return Math.max(max, Number(set.weight || 0));
        }, 0),
      });
    });
  });

  return grouped;
};

const getHistoryDateRange = (groupedHistory) => {
  const dates = Array.from(groupedHistory.keys()).sort();
  return {
    from: dates[0] || null,
    to: dates[dates.length - 1] || null,
    dates,
  };
};

const getBodyPartCountsByDate = (groupedHistory, dateKey) => {
  return (groupedHistory.get(dateKey) || []).reduce((acc, entry) => {
    const bodyPart = normalizeAiBodyPart(entry.bodyPart);
    acc[bodyPart] = (acc[bodyPart] || 0) + Number(entry.setCount || 0);
    return acc;
  }, {});
};

const getExerciseNamesByDate = (groupedHistory, dateKey) =>
  (groupedHistory.get(dateKey) || []).map((entry) => entry.exerciseName).filter(Boolean);

const logAiContextSnapshot = ({
  source,
  userId,
  groupedHistory,
  appStateUpdated = false,
  readOnly = true,
  extra = {},
}) => {
  const range = getHistoryDateRange(groupedHistory);
  const dates = range.dates;
  const trackedDate = "2026-05-25";

  const exerciseNamesByDate = dates.reduce((acc, dateKey) => {
    acc[dateKey] = getExerciseNamesByDate(groupedHistory, dateKey);
    return acc;
  }, {});

  const bodyPartCountsByDate = dates.reduce((acc, dateKey) => {
    acc[dateKey] = getBodyPartCountsByDate(groupedHistory, dateKey);
    return acc;
  }, {});

  console.log("[AI Coach context]", {
    source,
    environment: getAiEnvironment(),
    user_id: userId || null,
    dateRange: { from: range.from, to: range.to },
    includedWorkoutDates: dates,
    exerciseNamesByDate,
    bodyPartCountsByDate,
    "2026-05-25 ham set count": bodyPartCountsByDate[trackedDate]?.ハム ?? 0,
    "2026-05-25 exercise names": exerciseNamesByDate[trackedDate] || [],
    readOnly,
    appHistoryStateUpdated: Boolean(appStateUpdated),
    appStateUpdated: Boolean(appStateUpdated),
    ...extra,
  });
};

const fetchLatestWorkoutHistoryForAI = async (userId, isPro = false) => {
  if (!userId) {
    return {
      source: "no-user",
      history: {},
      rows: [],
      error: null,
    };
  }

  const threeMonthsAgo = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().slice(0, 10);
  })();

  let query = supabase
    .from("workouts")
    .select("date,data")
    .eq("user_id", userId)
    .order("date", { ascending: true })
    .limit(500);

  if (!isPro) {
    query = query.gte("date", threeMonthsAgo);
  }

  console.log("[AI history-limit]", {
    isPro,
    dateFilter: isPro ? "none (Pro: full history)" : threeMonthsAgo,
  });

  const { data, error } = await query;

  if (error) {
    console.error("[AI Coach context] workouts.data fetch failed", {
      source: AI_CONTEXT_CANONICAL_SOURCE,
      environment: getAiEnvironment(),
      user_id: userId,
      table: "workouts",
      query: AI_WORKOUTS_SELECT_QUERY,
      errorCode: error?.code || null,
      errorMessage: error?.message || null,
      errorDetails: error?.details || null,
      errorHint: error?.hint || null,
      responseData: data || null,
      readOnly: true,
      appHistoryStateUpdated: false,
    });
    return {
      source: "workouts.data.fetch_failed",
      history: {},
      rows: data || [],
      error,
    };
  }

  return {
    source: AI_CONTEXT_CANONICAL_SOURCE,
    history: buildHistoryFromWorkoutRows(data || []),
    rows: data || [],
    error: null,
  };
};

const summarizeWorkoutDay = (groupedHistory, dateKey) => {
  const dayEntries = groupedHistory.get(dateKey) || [];
  if (!dayEntries.length) return null;

  const bodyPartSetMap = {};
  let totalSets = 0;
  let totalVolume = 0;
  let totalReps = 0;

  const exercises = dayEntries.map((entry) => {
    bodyPartSetMap[entry.bodyPart] = (bodyPartSetMap[entry.bodyPart] || 0) + entry.setCount;
    totalSets += entry.setCount;
    totalVolume += entry.totalVolume;
    totalReps += entry.totalReps;
    return {
      name: entry.exerciseName,
      bodyPart: entry.bodyPart,
      setCount: entry.setCount,
      maxWeight: entry.maxWeight,
      totalVolume: entry.totalVolume,
      sets: entry.sets.map((set) => ({
        weight: set.weight,
        reps: Number(set.reps || 0),
        label: formatSetLabel(set),
      })),
    };
  });

  const bodyParts = Object.entries(bodyPartSetMap)
    .map(([bodyPart, setCount]) => ({ bodyPart, setCount }))
    .sort((a, b) => b.setCount - a.setCount);

  return {
    date: dateKey,
    totalSets,
    totalVolume,
    totalReps,
    bodyParts,
    exercises,
  };
};

const getTargetDateKey = (message) => {
  const normalized = String(message || "");
  if (normalized.includes("昨日")) {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return formatDateKey(date);
  }
  if (normalized.includes("今日")) {
    return getTodayKey();
  }
  return "";
};

const detectCoachMode = (message) => {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();

  const wantsMenu = MENU_KEYWORDS.some((keyword) => text.includes(keyword));
  const wantsAnalysis = ANALYSIS_KEYWORDS.some((keyword) => text.includes(keyword));
  const wantsBeginner = BEGINNER_KEYWORDS.some((keyword) => text.includes(keyword));
  const wantsAdvanced = ADVANCED_KEYWORDS.some((keyword) => text.includes(keyword)) || lower.includes("big3");

  const isBeginnerMenu = wantsMenu && !wantsAdvanced;

  return {
    wantsMenu,
    wantsAnalysis,
    wantsBeginner: wantsBeginner || isBeginnerMenu,
    wantsAdvanced,
  };
};

const buildWorkoutContextText = (summary) => {
  if (!summary) return "対象日の記録はありません。";

  const header = [
    `対象日: ${summary.date}`,
    `部位: ${summary.bodyParts.map((item) => `${item.bodyPart}${item.setCount}セット`).join(" / ") || "なし"}`,
    `合計セット: ${summary.totalSets}`,
    `総ボリューム: ${Math.round(summary.totalVolume)}kg`,
  ];

  const exercises = summary.exercises.map((exercise) => {
    const sets = exercise.sets.map((set) => set.label).join(" / ");
    return `${exercise.name} (${exercise.bodyPart}) | ${sets}`;
  });

  return [...header, ...exercises].join("\n");
};

const buildRecentSummaryText = (groupedHistory) => {
  const recentDates = Array.from(groupedHistory.keys()).sort().slice(-3).reverse();
  if (!recentDates.length) return "最近の記録はありません。";

  return recentDates
    .map((dateKey) => {
      const summary = summarizeWorkoutDay(groupedHistory, dateKey);
      if (!summary) return null;
      const topParts = summary.bodyParts.slice(0, 2).map((item) => `${item.bodyPart}${item.setCount}セット`).join(" / ");
      return `${dateKey}: ${topParts} / ${summary.totalSets}セット / ${Math.round(summary.totalVolume)}kg`;
    })
    .filter(Boolean)
    .join("\n");
};

const getPriorityBodyPartsForMessage = (message) => {
  const text = String(message || "").toLowerCase();
  const parts = [];
  if (text.includes("胸") || text.includes("ベンチ") || text.includes("bench") || text.includes("チェスト")) {
    parts.push("胸");
  }
  if (text.includes("肩") || text.includes("ショルダー")) parts.push("肩");
  if (text.includes("背中") || text.includes("背") || text.includes("懸垂") || text.includes("ラット")) {
    parts.push("背中");
  }
  if (text.includes("脚") || text.includes("足") || text.includes("スクワット")) parts.push("脚");
  if (text.includes("ハム") || text.includes("ルーマニアン") || text.includes("レッグカール")) parts.push("ハム");
  if (text.includes("腕") || text.includes("二頭") || text.includes("三頭")) parts.push("腕");
  return [...new Set(parts)];
};

const getPriorityExerciseNameHints = (message) => {
  const text = String(message || "").toLowerCase();
  const hints = [];
  const wantsBig3 = text.includes("big3") || text.includes("big 3") || text.includes("ビッグ3") || text.includes("big３");
  if (wantsBig3) hints.push("ベンチプレス", "スクワット", "デッドリフト", "ルーマニアンデッドリフト");
  if (text.includes("ベンチ") || text.includes("bench")) hints.push("ベンチプレス");
  if (text.includes("スクワット") || text.includes("squat")) hints.push("スクワット");
  if (text.includes("デッド") || text.includes("deadlift") || text.includes("dead lift")) hints.push("デッドリフト");
  if (text.includes("rdl") || text.includes("ルーマニアン") || text.includes("romanian")) hints.push("ルーマニアンデッドリフト");
  if (text.includes("インクライン")) hints.push("インクライン");
  if (text.includes("フライ")) hints.push("フライ");
  if (text.includes("ハイパー")) hints.push("ハイパーエクステンション");
  if (text.includes("レッグカール")) hints.push("レッグカール");
  return hints;
};

const getBig3QueryTargets = (message) => {
  const text = String(message || "").toLowerCase();
  const wantsBig3 = text.includes("big3") || text.includes("big 3") || text.includes("ビッグ3") || text.includes("big３");
  return {
    bench: wantsBig3 || text.includes("ベンチ") || text.includes("bench"),
    squat: wantsBig3 || text.includes("スクワット") || text.includes("squat"),
    deadlift: wantsBig3 || text.includes("デッド") || text.includes("deadlift") || text.includes("dead lift") || text.includes("rdl") || text.includes("ルーマニアン"),
    any: wantsBig3,
  };
};

const classifyBig3ExerciseName = (exerciseName) => {
  const normalizedName = normalizeExerciseName(exerciseName);
  const compactName = normalizedName.replace(/[\s　_\-・]/g, "").toLowerCase();
  const rawCompactName = String(exerciseName || "").replace(/[\s　_\-・]/g, "").toLowerCase();
  const combined = `${compactName} ${rawCompactName}`;

  const isRdl = (
    combined.includes("ルーマニアン") ||
    combined.includes("romanian") ||
    combined.includes("rdl")
  );
  if (isRdl) {
    return {
      group: "deadlift",
      category: "variation",
      strictBig3: false,
      matchType: "alias",
      aliasMatched: "RDL / Romanian Deadlift",
    };
  }

  if (combined.includes("デッドリフト") || combined.includes("deadlift") || combined.includes("deadlift") || compactName === "dl") {
    return {
      group: "deadlift",
      category: "deadlift",
      strictBig3: true,
      matchType: normalizedName === "デッドリフト" ? "exact" : "alias",
      aliasMatched: "Deadlift",
    };
  }

  if (combined.includes("ベンチプレス") || combined.includes("benchpress")) {
    const isVariation = combined.includes("インクライン") || combined.includes("incline") || combined.includes("ダンベル") || combined.includes("dumbbell");
    return {
      group: "bench",
      category: isVariation ? "variation" : "bench",
      strictBig3: !isVariation,
      matchType: normalizedName === "ベンチプレス" ? "exact" : "alias",
      aliasMatched: "Bench Press",
    };
  }

  if (combined.includes("スクワット") || combined.includes("squat")) {
    const isVariation = combined.includes("ハック") || combined.includes("hack") || combined.includes("スミス") || combined.includes("smith");
    return {
      group: "squat",
      category: isVariation ? "variation" : "squat",
      strictBig3: !isVariation,
      matchType: normalizedName === "スクワット" ? "exact" : "alias",
      aliasMatched: "Squat",
    };
  }

  return null;
};

const getExercisePriorityScore = (exerciseName, bodyPart, message) => {
  const normalizedName = normalizeExerciseName(exerciseName);
  const lowerName = normalizedName.toLowerCase();
  const text = String(message || "").toLowerCase();
  const bodyParts = getPriorityBodyPartsForMessage(message);
  const hints = getPriorityExerciseNameHints(message);

  let score = 0;
  if (text && (text.includes(lowerName) || lowerName.includes(text))) score += 20;
  if (bodyParts.includes(normalizeAiBodyPart(bodyPart))) score += 12;
  if (hints.some((hint) => normalizedName.includes(hint) || hint.includes(normalizedName))) score += 16;

  const big3Targets = getBig3QueryTargets(message);
  const big3Match = classifyBig3ExerciseName(exerciseName);
  if (big3Match && big3Targets[big3Match.group]) {
    score += 34;
    if (big3Match.strictBig3) score += 4;
  }
  if (big3Match && big3Targets.any) score += 18;

  if (bodyParts.includes("胸")) {
    if (normalizedName.includes("ベンチプレス")) score += 10;
    if (normalizedName.includes("インクライン")) score += 8;
    if (normalizedName.includes("フライ")) score += 7;
    if (normalizedName.includes("チェスト")) score += 6;
  }

  return score;
};

const buildExerciseHistoryStats = (history, message) => {
  const stats = [];

  Object.entries(history || {}).forEach(([exerciseName, records]) => {
    const sanitizedRecords = (records || [])
      .map((record) => sanitizeHistoryRecord(record, { allowBodyweight: true }))
      .filter((record) => record?.date && Array.isArray(record.sets) && record.sets.length)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    if (!sanitizedRecords.length) return;

    const allSets = sanitizedRecords.flatMap((record) =>
      record.sets.map((set) => ({
        ...set,
        date: record.date,
      }))
    );
    const weightedSets = allSets.filter((set) => set.weight !== "BW" && Number(set.weight) > 0 && Number(set.reps) > 0);
    const bestSet = weightedSets.reduce((best, set) => {
      const estimated1RM = calc1RM([set]);
      if (!best || estimated1RM > best.estimated1RM) {
        return {
          date: set.date,
          weight: Number(set.weight),
          reps: Number(set.reps),
          estimated1RM,
        };
      }
      return best;
    }, null);
    const latestRecord = sanitizedRecords[0];
    const latestWeightedSets = latestRecord.sets.filter((set) => set.weight !== "BW" && Number(set.weight) > 0);
    const latestMaxWeight = latestWeightedSets.reduce((max, set) => Math.max(max, Number(set.weight || 0)), 0);
    const bodyPart = normalizeAiBodyPart(
      latestRecord.bodyPart ||
      sanitizedRecords.find((record) => normalizeAiBodyPart(record.bodyPart) !== "その他")?.bodyPart ||
      "その他"
    );
    const estimated1RM = Number(bestSet?.estimated1RM || 0);
    const recommendations = estimated1RM > 0
      ? {
          hypertrophy: {
            weight: roundToNearest(estimated1RM * 0.8),
            reps: "6〜8",
            sets: 3,
          },
          light: {
            weight: roundToNearest(estimated1RM * 0.72),
            reps: "8〜10",
            sets: 3,
          },
          highIntensity: {
            weight: roundToNearest(estimated1RM * 0.87),
            reps: "4〜6",
            sets: 3,
          },
        }
      : null;

    stats.push({
      exerciseName,
      normalizedExerciseName: normalizeExerciseName(exerciseName),
      bodyPart,
      latestDate: latestRecord.date,
      latestSetCount: latestRecord.sets.length,
      latestSets: latestRecord.sets.map((set) => ({
        weight: set.weight,
        reps: Number(set.reps || 0),
        label: formatSetLabel(set),
      })),
      recentRecords: sanitizedRecords.slice(0, 3).map((record) => ({
        date: record.date,
        setCount: record.sets.length,
        maxWeight: record.sets.reduce((max, set) => (
          set.weight === "BW" ? max : Math.max(max, Number(set.weight || 0))
        ), 0),
        sets: record.sets.map((set) => ({
          weight: set.weight,
          reps: Number(set.reps || 0),
          label: formatSetLabel(set),
        })),
      })),
      pr: bestSet
        ? {
            date: bestSet.date,
            weight: bestSet.weight,
            reps: bestSet.reps,
            estimated1RM: Math.round(bestSet.estimated1RM * 10) / 10,
          }
        : null,
      recentMaxWeight: latestMaxWeight,
      estimated1RM: Math.round(estimated1RM * 10) / 10,
      recommendedWorkingSets: recommendations,
      priorityScore: getExercisePriorityScore(exerciseName, bodyPart, message),
    });
  });

  return stats.sort((a, b) => (
    b.priorityScore - a.priorityScore ||
    String(b.latestDate).localeCompare(String(a.latestDate)) ||
    (b.estimated1RM || 0) - (a.estimated1RM || 0)
  ));
};

const summarizeBig3Matches = (stats, message) => {
  const targets = getBig3QueryTargets(message);
  const shouldInclude = targets.any || targets.bench || targets.squat || targets.deadlift;
  const empty = {
    targets,
    bench: [],
    squat: [],
    deadlift: [],
    deadliftVariations: [],
    all: [],
  };
  if (!shouldInclude) return empty;

  const matched = (stats || [])
    .map((item) => {
      const classification = classifyBig3ExerciseName(item.exerciseName);
      if (!classification || !targets[classification.group]) return null;
      return {
        exerciseName: item.exerciseName,
        normalizedExerciseName: item.normalizedExerciseName,
        bodyPart: item.bodyPart,
        category: classification.category,
        group: classification.group,
        strictBig3: classification.strictBig3,
        matchType: classification.matchType,
        aliasMatched: classification.aliasMatched,
        latestDate: item.latestDate,
        latestSetCount: item.latestSetCount,
        latestSets: item.latestSets,
        recentRecords: item.recentRecords,
        pr: item.pr,
        recentMaxWeight: item.recentMaxWeight,
        estimated1RM: item.estimated1RM,
        recommendedWorkingSets: item.recommendedWorkingSets,
      };
    })
    .filter(Boolean);

  return {
    targets,
    bench: matched.filter((item) => item.group === "bench"),
    squat: matched.filter((item) => item.group === "squat"),
    deadlift: matched.filter((item) => item.group === "deadlift" && item.strictBig3),
    deadliftVariations: matched.filter((item) => item.group === "deadlift" && !item.strictBig3),
    all: matched,
  };
};

const formatBig3MatchedExercise = (item) => {
  const latestSets = (item.latestSets || []).map((set) => set.label).join(" / ");
  const prText = item.pr
    ? `PR ${item.pr.weight}kg×${item.pr.reps}回 推定1RM${item.pr.estimated1RM}kg (${item.pr.date})`
    : "PRなし";
  const rec = item.recommendedWorkingSets;
  const recommendationText = rec
    ? `推奨目安 筋肥大${rec.hypertrophy.weight}kg×${rec.hypertrophy.reps}回×${rec.hypertrophy.sets}セット / 軽め${rec.light.weight}kg×${rec.light.reps}回×${rec.light.sets}セット / 高強度${rec.highIntensity.weight}kg×${rec.highIntensity.reps}回×${rec.highIntensity.sets}セット`
    : "推奨目安なし";

  return `${item.exerciseName} [${item.category}, ${item.matchType}:${item.aliasMatched}] 最新 ${item.latestDate} ${item.latestSetCount}セット ${latestSets} | ${prText} | 直近最高重量 ${item.recentMaxWeight || 0}kg | ${recommendationText}`;
};

const buildBig3HistoryContextText = (big3Summary) => {
  if (!big3Summary?.all?.length) return "";

  const benchText = big3Summary.bench.length
    ? big3Summary.bench.map(formatBig3MatchedExercise).join("\n")
    : "ベンチ系: 記録なし";
  const squatText = big3Summary.squat.length
    ? big3Summary.squat.map(formatBig3MatchedExercise).join("\n")
    : "スクワット系: 記録なし";
  const strictDeadliftText = big3Summary.deadlift.length
    ? big3Summary.deadlift.map(formatBig3MatchedExercise).join("\n")
    : "通常デッドリフト: 記録なし";
  const deadliftVariationText = big3Summary.deadliftVariations.length
    ? big3Summary.deadliftVariations.map(formatBig3MatchedExercise).join("\n")
    : "デッドリフト系バリエーション: 記録なし";

  const rdlNote = !big3Summary.deadlift.length && big3Summary.deadliftVariations.length
    ? "注意: 通常デッドリフトの記録は見当たりませんが、RDL/ルーマニアンデッドリフトなどのデッドリフト系バリエーション記録があります。通常デッドリフトとRDLは区別して答えてください。"
    : "注意: 通常デッドリフトとRDL/ルーマニアンデッドリフトは区別して答えてください。";

  return [
    "BIG3/主要種目の過去記録（workouts.data正本、summary_jsonではない）:",
    benchText,
    squatText,
    strictDeadliftText,
    deadliftVariationText,
    rdlNote,
  ].join("\n");
};

const buildExerciseHistoryContextTextFromStats = (stats, message, big3Summary = summarizeBig3Matches(stats, message)) => {
  const big3Context = buildBig3HistoryContextText(big3Summary);
  if (!stats.length) return big3Context || "種目別の過去記録はありません。";

  const exerciseContext = stats.slice(0, 18).map((item) => {
    const latestSets = item.latestSets.map((set) => set.label).join(" / ");
    const recentRecords = item.recentRecords
      .map((record) => `${record.date} ${record.setCount}セット ${record.sets.map((set) => set.label).join(" / ")}`)
      .join(" ; ");
    const prText = item.pr
      ? `PR ${item.pr.weight}kg×${item.pr.reps}回 推定1RM${item.pr.estimated1RM}kg (${item.pr.date})`
      : "PRなし";
    const rec = item.recommendedWorkingSets;
    const recommendationText = rec
      ? `推奨: 筋肥大${rec.hypertrophy.weight}kg×${rec.hypertrophy.reps}回×${rec.hypertrophy.sets}セット / 軽め${rec.light.weight}kg×${rec.light.reps}回×${rec.light.sets}セット / 高強度${rec.highIntensity.weight}kg×${rec.highIntensity.reps}回×${rec.highIntensity.sets}セット`
      : "推奨重量: 自重または重量履歴なし";

    return [
      `${item.exerciseName} (${item.bodyPart})`,
      `最新 ${item.latestDate} ${item.latestSetCount}セット ${latestSets}`,
      prText,
      `直近最高重量 ${item.recentMaxWeight || 0}kg`,
      recommendationText,
      `最近: ${recentRecords}`,
    ].join(" | ");
  }).join("\n");

  return [big3Context, exerciseContext].filter(Boolean).join("\n");
};

export function useAI({ loadConversationsOnMount = false } = {}) {
  const initialAiUsageDate = getTodayKey();
  const [aiMsgs, setAiMsgs] = useState([INITIAL_AI_MESSAGE]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoad, setAiLoad] = useState(false);
  const aiEnd = useRef(null);
  const aiLoadRef = useRef(false);
  const aiMsgsRef = useRef([INITIAL_AI_MESSAGE]);
  const aiUsageDateRef = useRef(initialAiUsageDate);
  const aiUsageCountRef = useRef(0);
  const isProRef = useRef(getIsPro());
  const revenueCatPlanRef = useRef(null);
  const activeConversationIdRef = useRef(null);
  const [isPro, setIsPro] = useState(() => getIsPro());
  const [proPlan, setProPlan] = useState(null);
  const [aiConversations, setAiConversations] = useState([]);
  const [aiConversationLoading, setAiConversationLoading] = useState(false);
  const [aiConversationError, setAiConversationError] = useState("");
  const [activeConversationId, setActiveConversationIdState] = useState(null);
  const [aiUsageDate, setAiUsageDate] = useState(initialAiUsageDate);
  const [aiUsageCount, setAiUsageCount] = useState(() => {
    const usage = resetAiUsageIfNewDay();
    aiUsageDateRef.current = usage.dateKey || initialAiUsageDate;
    aiUsageCountRef.current = usage.count;
    return usage.count;
  });

  const setActiveConversationId = useCallback((conversationId) => {
    activeConversationIdRef.current = conversationId || null;
    setActiveConversationIdState(conversationId || null);
  }, []);

  const applyRevenueCatCustomerInfo = useCallback((customerInfo) => {
    const plan = buildRevenueCatPlan(customerInfo);
    revenueCatPlanRef.current = plan;
    setProPlan(plan);
    isProRef.current = Boolean(plan.isPro);
    setIsPro(Boolean(plan.isPro));
    try {
      localStorage.setItem(AI_PRO_STORAGE_KEY, plan.isPro ? "true" : "false");
    } catch {}
    console.log("[RevenueCat] customer info applied", {
      source: "revenuecat",
      entitlementId: plan.entitlementId,
      isPro: plan.isPro,
      status: plan.status,
      expiresAt: plan.expiresAt,
      managementURL: plan.managementURL,
      productIdentifier: plan.productIdentifier,
      isSandbox: plan.isSandbox,
      appHistoryStateUpdated: false,
    });
    return plan;
  }, []);

  const getEffectiveProStatus = useCallback(() => {
    const availability = getRevenueCatAvailability();
    if (availability.native && availability.configured) {
      return Boolean(revenueCatPlanRef.current?.isPro);
    }
    return Boolean(revenueCatPlanRef.current?.isPro || isProRef.current || getIsPro());
  }, []);

  const loadAiConversations = useCallback(async () => {
    setAiConversationLoading(true);
    setAiConversationError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;

      if (!userId) {
        setAiConversations([]);
        return [];
      }

      const { data: conversations, error: conversationsError } = await supabase
        .from("ai_conversations")
        .select("id,title,created_at,updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(20);

      if (conversationsError) throw conversationsError;

      const ids = (conversations || []).map((conversation) => conversation.id).filter(Boolean);
      let messages = [];

      if (ids.length) {
        const { data: messageRows, error: messagesError } = await supabase
          .from("ai_messages")
          .select("id,conversation_id,role,content,workout_plan,created_at")
          .eq("user_id", userId)
          .in("conversation_id", ids)
          .order("created_at", { ascending: true });

        if (messagesError) throw messagesError;
        messages = messageRows || [];
      }

      const messageMap = messages.reduce((acc, message) => {
        if (!acc[message.conversation_id]) acc[message.conversation_id] = [];
        acc[message.conversation_id].push(toAiMessage(message));
        return acc;
      }, {});

      const nextConversations = (conversations || []).map((conversation) => {
        const conversationMessages = messageMap[conversation.id] || [];
        return {
          ...conversation,
          messages: conversationMessages,
          preview: buildConversationPreview(conversationMessages),
        };
      });

      setAiConversations(nextConversations);
      return nextConversations;
    } catch (error) {
      console.warn("ai conversation history load failed", error);
      setAiConversationError("会話履歴を読み込めませんでした。");
      return [];
    } finally {
      setAiConversationLoading(false);
    }
  }, []);

  const saveAiConversationTurn = useCallback(
    async ({ conversationId, userMessage, assistantMessage }) => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const userId = session?.user?.id;

        if (!userId) return null;

        let nextConversationId = conversationId || activeConversationIdRef.current;

        if (!nextConversationId) {
          const now = new Date().toISOString();
          const { data: conversation, error: conversationError } = await supabase
            .from("ai_conversations")
            .insert({
              user_id: userId,
              title: createConversationTitle(userMessage?.content),
              created_at: now,
              updated_at: now,
            })
            .select("id")
            .single();

          if (conversationError) throw conversationError;
          nextConversationId = conversation?.id || null;
        }

        if (!nextConversationId) return null;

        const rows = [userMessage, assistantMessage]
          .map(toAiMessage)
          .map((message) => ({
            conversation_id: nextConversationId,
            user_id: userId,
            role: message.role,
            content: message.content,
            workout_plan:
              message.role === "assistant" && message.workoutPlan?.length
                ? message.workoutPlan
                : null,
            created_at: message.created_at,
          }));

        const { error: messagesError } = await supabase.from("ai_messages").insert(rows);
        if (messagesError) throw messagesError;

        const { error: updateError } = await supabase
          .from("ai_conversations")
          .update({ updated_at: assistantMessage?.created_at || new Date().toISOString() })
          .eq("id", nextConversationId)
          .eq("user_id", userId);

        if (updateError) throw updateError;

        setActiveConversationId(nextConversationId);
        await loadAiConversations();
        return nextConversationId;
      } catch (error) {
        console.warn("ai conversation history save failed", error);
        setAiConversationError("会話履歴を保存できませんでした。");
        return null;
      }
    },
    [loadAiConversations, setActiveConversationId]
  );

  const openAiConversation = useCallback(
    (conversationId) => {
      const conversation = aiConversations.find((item) => item.id === conversationId);
      if (!conversation) return false;

      const messages = (conversation.messages || []).map(toAiMessage);
      setActiveConversationId(conversation.id);
      setAiMsgs(messages.length ? messages : [INITIAL_AI_MESSAGE]);
      return true;
    },
    [aiConversations, setActiveConversationId]
  );

  const startNewAiConversation = useCallback(() => {
    setActiveConversationId(null);
    setAiMsgs([INITIAL_AI_MESSAGE]);
    setAiInput("");
  }, [setActiveConversationId]);

  const deleteAiConversation = useCallback(
    async (conversationId) => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId || !conversationId) return false;

        const { error } = await supabase
          .from("ai_conversations")
          .delete()
          .eq("id", conversationId)
          .eq("user_id", userId);

        if (error) throw error;

        setAiConversations((prev) => prev.filter((conversation) => conversation.id !== conversationId));
        if (activeConversationIdRef.current === conversationId) {
          startNewAiConversation();
        }
        return true;
      } catch (error) {
        console.warn("ai conversation history delete failed", error);
        setAiConversationError("会話履歴を削除できませんでした。");
        return false;
      }
    },
    [startNewAiConversation]
  );

  useEffect(() => {
    if (!loadConversationsOnMount) {
      console.log("[home fetch] ai_conversations skipped on home initial load", {
        reason: "AI screen is not active",
      });
      return;
    }
    loadAiConversations();
  }, [loadAiConversations, loadConversationsOnMount]);

  useEffect(() => {
    aiMsgsRef.current = aiMsgs;
  }, [aiMsgs]);

  useEffect(() => {
    aiEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [aiMsgs]);

  useEffect(() => {
    const usage = resetAiUsageIfNewDay();
    aiUsageDateRef.current = usage.dateKey;
    aiUsageCountRef.current = usage.count;
    setAiUsageDate(usage.dateKey);
    setAiUsageCount(usage.count);
    const currentIsPro = getIsPro();
    isProRef.current = currentIsPro;
    setIsPro(currentIsPro);
  }, []);

  useEffect(() => {
    let isActive = true;

    const configureForSession = async (session) => {
      const user = session?.user;
      if (!user?.id) return;
      const result = await configureRevenueCatForUser(user, (customerInfo) => {
        if (!isActive) return;
        applyRevenueCatCustomerInfo(customerInfo);
      });
      if (!isActive) return;
      if (result?.plan) {
        revenueCatPlanRef.current = result.plan;
        setProPlan(result.plan);
      }
      console.log("[RevenueCat] session sync", {
        user_id: user.id,
        availability: getRevenueCatAvailability(),
        configured: Boolean(result?.configured),
        reason: result?.reason || null,
        isPro: Boolean(result?.plan?.isPro),
      });
    };

    supabase.auth.getSession()
      .then(({ data }) => configureForSession(data?.session))
      .catch((error) => {
        console.warn("[RevenueCat] initial session sync failed", {
          message: error?.message || String(error),
        });
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      configureForSession(session).catch((error) => {
        console.warn("[RevenueCat] auth session sync failed", {
          message: error?.message || String(error),
        });
      });
    });

    return () => {
      isActive = false;
      subscription?.unsubscribe?.();
    };
  }, [applyRevenueCatCustomerInfo]);

  useEffect(() => {
    const refreshUsageDate = () => {
      const todayKey = getTodayKey();
      if (aiUsageDateRef.current === todayKey) return;

      const usage = resetAiUsageIfNewDay();
      aiUsageDateRef.current = usage.dateKey;
      aiUsageCountRef.current = usage.count;
      setAiUsageDate(usage.dateKey);
      setAiUsageCount(usage.count);
      const currentIsPro = getIsPro();
      isProRef.current = currentIsPro;
      setIsPro(currentIsPro);
    };

    const intervalId = window.setInterval(refreshUsageDate, 60 * 1000);
    document.addEventListener("visibilitychange", refreshUsageDate);
    window.addEventListener("focus", refreshUsageDate);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshUsageDate);
      window.removeEventListener("focus", refreshUsageDate);
    };
  }, []);

  const applyServerAiUsage = (serverUsage) => {
    if (!serverUsage || typeof serverUsage !== "object") return false;

    const serverIsPro = Boolean(serverUsage.isPro);
    const revenueCatIsPro = Boolean(revenueCatPlanRef.current?.isPro);
    const effectiveIsPro = Boolean(revenueCatIsPro || serverIsPro);
    const serverDateKey = serverUsage.usageDate || getTodayKey();
    const serverCount = normalizeAiUsageCount(serverUsage.usageCount);

    isProRef.current = effectiveIsPro;
    setIsPro(effectiveIsPro);
    aiUsageDateRef.current = serverDateKey;
    aiUsageCountRef.current = serverCount;
    setAiUsageDate(serverDateKey);
    setAiUsageCount(serverCount);

    try {
      localStorage.setItem(AI_PRO_STORAGE_KEY, effectiveIsPro ? "true" : "false");
      saveAiUsage({ dateKey: serverDateKey, count: serverCount });
    } catch {}

    return true;
  };

  const activatePumpPro = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      const user = session?.user;

      if (user?.id) {
        const purchaseResult = await purchaseRevenueCatPro(user, applyRevenueCatCustomerInfo);
        if (purchaseResult?.success) return true;
        if (purchaseResult?.available && purchaseResult?.reason !== "not-native") {
          return false;
        }
      }

      if (!accessToken) return false;

      if (!isNativeCapacitorOrigin()) {
        try {
          const apiUrl = getApiUrl("/api/stripe?action=create-checkout");
          const checkoutRes = await fetch(apiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
          });
          const checkoutData = await readApiJson(checkoutRes);
          if (checkoutData?.url) {
            window.location.href = checkoutData.url;
            return true;
          }
          logAiApiError("create checkout session failed", {
            apiUrl,
            status: checkoutRes.status,
            response: checkoutData,
          });
          return false;
        } catch (error) {
          logAiApiError("create checkout session request failed", {
            apiUrl: getApiUrl("/api/stripe?action=create-checkout"),
            error,
            message: error?.message,
          });
          return false;
        }
      }

      if (process.env.NODE_ENV === "production") return false;

      const apiUrl = getApiUrl("/api/pro?action=activate-dev");
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const data = await readApiJson(res);

      if (!res.ok) {
        logAiApiError("activate pro failed", {
          apiUrl,
          status: res.status,
          statusText: res.statusText,
          response: data,
        });
        return false;
      }

      applyServerAiUsage(data?.aiUsage);
      return true;
    } catch (error) {
      logAiApiError("activate pro request failed", {
        apiUrl: getApiUrl("/api/pro?action=activate-dev"),
        error,
        message: error?.message,
      });
      return false;
    }
  };

  const restorePumpPro = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user?.id) return null;

      const restoreResult = await restoreRevenueCatPurchases(user, applyRevenueCatCustomerInfo);
      if (restoreResult?.plan) {
        const usage = resetAiUsageIfNewDay();
        return {
          success: restoreResult.success,
          plan: restoreResult.plan,
          aiUsage: {
            usageDate: usage.dateKey,
            isPro: restoreResult.plan.isPro,
            usageCount: usage.count,
            remaining: restoreResult.plan.isPro ? null : Math.max(0, AI_DAILY_LIMIT - usage.count),
            dailyLimit: AI_DAILY_LIMIT,
          },
        };
      }
      return restoreResult;
    } catch (error) {
      logAiApiError("restore RevenueCat purchases failed", {
        error,
        message: error?.message,
      });
      return null;
    }
  };

  const deactivatePumpProDev = async () => {
    if (process.env.NODE_ENV === "production") return false;

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;

      if (!accessToken) return false;

      const apiUrl = getApiUrl("/api/pro?action=deactivate-dev");
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const data = await readApiJson(res);

      if (!res.ok) {
        logAiApiError("deactivate pro failed", {
          apiUrl,
          status: res.status,
          statusText: res.statusText,
          response: data,
        });
        return false;
      }

      applyServerAiUsage(data?.aiUsage);
      return true;
    } catch (error) {
      logAiApiError("deactivate pro request failed", {
        apiUrl: getApiUrl("/api/pro?action=deactivate-dev"),
        error,
        message: error?.message,
      });
      return false;
    }
  };

  const activateStripeCheckoutSession = async (sessionId) => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;

      if (!accessToken) return false;

      const apiUrl = getApiUrl("/api/stripe?action=activate");
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = await readApiJson(res);

      if (!res.ok) {
        logAiApiError("activate stripe checkout failed", {
          apiUrl,
          status: res.status,
          statusText: res.statusText,
          response: data,
        });
        return false;
      }

      applyServerAiUsage(data?.aiUsage);
      return true;
    } catch (error) {
      logAiApiError("activate stripe checkout request failed", {
        apiUrl: getApiUrl("/api/stripe?action=activate"),
        error,
        message: error?.message,
      });
      return false;
    }
  };

  const openStripePortal = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;

      if (!accessToken) return false;

      const apiUrl = getApiUrl("/api/stripe?action=portal");
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const data = await readApiJson(res);

      if (!res.ok) {
        logAiApiError("stripe portal failed", {
          apiUrl,
          status: res.status,
          statusText: res.statusText,
          response: data,
        });
        return false;
      }

      if (data?.url) {
        window.location.href = data.url;
        return true;
      }
      console.warn("[stripe portal] no URL in response", { data });
      return false;
    } catch (error) {
      logAiApiError("stripe portal request failed", {
        apiUrl: getApiUrl("/api/stripe?action=portal"),
        error,
        message: error?.message,
      });
      return false;
    }
  };

  const refreshPumpProStatus = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      const user = session?.user;

      if (user?.id) {
        const revenueCatResult = await refreshRevenueCatCustomerInfo(user, applyRevenueCatCustomerInfo);
        if (revenueCatResult?.plan) {
          const usage = resetAiUsageIfNewDay();
          return {
            success: true,
            plan: revenueCatResult.plan,
            aiUsage: {
              usageDate: usage.dateKey,
              isPro: revenueCatResult.plan.isPro,
              usageCount: usage.count,
              remaining: revenueCatResult.plan.isPro ? null : Math.max(0, AI_DAILY_LIMIT - usage.count),
              dailyLimit: AI_DAILY_LIMIT,
            },
          };
        }
      }

      if (!accessToken) return null;

      const apiUrl = getApiUrl("/api/pro");
      const res = await fetch(apiUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const data = await readApiJson(res);

      if (!res.ok) {
        logAiApiError("pro status failed", {
          apiUrl,
          status: res.status,
          statusText: res.statusText,
          response: data,
        });
        return null;
      }

      applyServerAiUsage(data?.aiUsage);
      return data;
    } catch (error) {
      logAiApiError("pro status request failed", {
        apiUrl: getApiUrl("/api/pro"),
        error,
        message: error?.message,
      });
      return null;
    }
  };

  const sendAI = async (overrideMsg) => {
    const userMsg = (typeof overrideMsg === "string" ? overrideMsg : aiInput).trim();
    const currentIsPro = Boolean(getEffectiveProStatus() || isPro);
    const currentUsage = currentIsPro
      ? {
          dateKey: aiUsageDateRef.current || getTodayKey(),
          count: normalizeAiUsageCount(aiUsageCountRef.current),
        }
      : resetAiUsageIfNewDay();
    isProRef.current = currentIsPro;
    setIsPro(currentIsPro);
    aiUsageDateRef.current = currentUsage.dateKey;
    aiUsageCountRef.current = currentUsage.count;
    setAiUsageDate(currentUsage.dateKey);
    setAiUsageCount(currentUsage.count);

    if (!userMsg || aiLoadRef.current) return false;
    if (!currentIsPro && !canUseAiChat({ isPro: false, usage: currentUsage })) return false;

    aiLoadRef.current = true;

    const mode = detectCoachMode(userMsg);
    const targetDateKey = getTargetDateKey(userMsg);

    setAiInput("");
    const userMessage = {
      role: "user",
      content: userMsg,
      created_at: new Date().toISOString(),
    };
    const newMsgs = [...aiMsgsRef.current, userMessage];
    setAiMsgs(newMsgs);
    setAiLoad(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;

      if (!accessToken) {
        setAiMsgs((p) => [...p, { role: "assistant", content: "ログインが必要です。" }]);
        return;
      }

      const latestWorkoutFetch = await fetchLatestWorkoutHistoryForAI(session?.user?.id, currentIsPro);
      if (latestWorkoutFetch.error) {
        logAiContextSnapshot({
          source: latestWorkoutFetch.source,
          userId: session?.user?.id,
          groupedHistory: flattenHistoryByDate({}),
          readOnly: true,
          appStateUpdated: false,
          extra: {
            table: "workouts",
            query: AI_WORKOUTS_SELECT_QUERY,
            rowCount: latestWorkoutFetch.rows?.length ?? 0,
            blockedReason: "workouts.data fetch failed; stale local history was not used",
            targetDate: targetDateKey || null,
            aiQuery: userMsg,
            totalWorkoutsCount: latestWorkoutFetch.rows?.length ?? 0,
            exerciseNamesIncluded: [],
            benchMatchedRecords: [],
            squatMatchedRecords: [],
            deadliftMatchedRecords: [],
            deadliftVariationMatchedRecords: [],
            matchedByExactOrAlias: [],
            recordContextSource: AI_CONTEXT_CANONICAL_SOURCE,
            coachMode: mode.wantsAnalysis ? "analysis" : mode.wantsMenu ? "menu" : "general",
          },
        });
        setAiMsgs((p) => [...p, { role: "assistant", content: "最新の記録を取得できませんでした。時間をおいて再試行してください。" }]);
        return false;
      }

      const aiHistory = latestWorkoutFetch.history;
      const contextSource = latestWorkoutFetch.source;
      const requestGroupedHistory = flattenHistoryByDate(aiHistory);
      const targetWorkoutSummary = targetDateKey ? summarizeWorkoutDay(requestGroupedHistory, targetDateKey) : null;
      const latestDateKey = Array.from(requestGroupedHistory.keys()).sort().slice(-1)[0] || "";
      const latestWorkoutSummary = latestDateKey ? summarizeWorkoutDay(requestGroupedHistory, latestDateKey) : null;
      const exerciseHistoryStats = buildExerciseHistoryStats(aiHistory, userMsg);
      const big3MatchSummary = summarizeBig3Matches(exerciseHistoryStats, userMsg);
      const exerciseHistoryContext = buildExerciseHistoryContextTextFromStats(exerciseHistoryStats, userMsg, big3MatchSummary);
      const allExerciseNames = Object.keys(aiHistory || {}).sort((a, b) => a.localeCompare(b, "ja"));

      logAiContextSnapshot({
        source: contextSource,
        userId: session?.user?.id,
        groupedHistory: requestGroupedHistory,
        readOnly: true,
        appStateUpdated: false,
        extra: {
          table: "workouts",
          query: AI_WORKOUTS_SELECT_QUERY,
          rowCount: latestWorkoutFetch.rows?.length ?? 0,
          fallbackUsed: Boolean(latestWorkoutFetch.error),
          targetDate: targetDateKey || null,
          latestDate: latestDateKey || null,
          aiQuery: userMsg,
          totalWorkoutsCount: latestWorkoutFetch.rows?.length ?? 0,
          totalWorkoutDatesCount: requestGroupedHistory.size,
          exerciseNamesIncluded: allExerciseNames,
          benchMatchedRecords: big3MatchSummary.bench,
          squatMatchedRecords: big3MatchSummary.squat,
          deadliftMatchedRecords: big3MatchSummary.deadlift,
          deadliftVariationMatchedRecords: big3MatchSummary.deadliftVariations,
          matchedByExactOrAlias: big3MatchSummary.all.map((item) => ({
            exerciseName: item.exerciseName,
            group: item.group,
            category: item.category,
            strictBig3: item.strictBig3,
            matchType: item.matchType,
            aliasMatched: item.aliasMatched,
          })),
          recordContextSource: AI_CONTEXT_CANONICAL_SOURCE,
          coachMode: mode.wantsAnalysis ? "analysis" : mode.wantsMenu ? "menu" : "general",
          exerciseHistoryNames: exerciseHistoryStats
            .slice(0, 18)
            .map((item) => item.exerciseName),
        },
      });

      const apiUrl = getApiUrl("/api/chat");
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          messages: newMsgs
            .filter((m) => m?.role === "user" || m?.role === "assistant")
            .slice(-10)
            .map((m) => ({ role: m.role, content: m.content })),
          clientState: {
            isPro: currentIsPro,
          },
          coachContext: {
            mode: mode.wantsAnalysis ? "analysis" : mode.wantsMenu ? "menu" : "general",
            level: mode.wantsBeginner ? "beginner" : mode.wantsAdvanced ? "advanced" : "standard",
            source: contextSource,
            readOnly: true,
            appStateUpdated: false,
            targetDate: targetDateKey || null,
            targetWorkoutContext: buildWorkoutContextText(targetWorkoutSummary),
            latestWorkoutContext: buildWorkoutContextText(latestWorkoutSummary),
            recentSummaryContext: buildRecentSummaryText(requestGroupedHistory),
            exerciseHistoryContext,
            hasTargetWorkout: Boolean(targetWorkoutSummary),
          },
        }),
      });
      const data = await readApiJson(res);

      if (!res.ok) {
        applyServerAiUsage(data?.aiUsage);
        logAiApiError("chat api failed", {
          apiUrl,
          status: res.status,
          statusText: res.statusText,
          response: data,
          userMessage: userMsg,
          targetDate: targetDateKey || null,
          coachMode: mode,
        });
        const errorMessage =
          res.status === 401
            ? "ログインが必要です。"
            : res.status === 403
              ? "今日の無料AI相談回数を使い切りました。Pump ProでAI Coachを無制限に使えます。"
              : res.status === 429
                ? data?.error || "AI Coachの利用が集中しています。少し待ってからお試しください。"
                : "通信に失敗しました。時間をおいて再試行してください。";
        setAiMsgs((p) => [...p, { role: "assistant", content: errorMessage }]);
        return;
      }

      const reply = data.content?.[0]?.text || "";
      if (!reply) {
        logAiApiError("chat api returned empty reply", {
          apiUrl,
          status: res.status,
          statusText: res.statusText,
          response: data,
          userMessage: userMsg,
          targetDate: targetDateKey || null,
          coachMode: mode,
        });
        applyServerAiUsage(data?.aiUsage);
        setAiMsgs((p) => [...p, { role: "assistant", content: "通信に失敗しました。時間をおいて再試行してください。" }]);
        return false;
      }
      const structuredWorkoutPlan = normalizeWorkoutPlan(data.workoutPlan);
      const workoutPlan = mode.wantsMenu
        ? structuredWorkoutPlan.length
          ? structuredWorkoutPlan
          : extractWorkoutPlanFromText(reply)
        : [];
      const assistantMessage = {
        role: "assistant",
        content: reply,
        workoutPlan,
        created_at: new Date().toISOString(),
      };
      if (!applyServerAiUsage(data?.aiUsage) && !currentIsPro) {
        const nextUsage = incrementAiUsage();
        aiUsageDateRef.current = nextUsage.dateKey;
        aiUsageCountRef.current = nextUsage.count;
        setAiUsageDate(nextUsage.dateKey);
        setAiUsageCount(nextUsage.count);
      }
      setAiMsgs((p) => [...p, assistantMessage]);
      void saveAiConversationTurn({
        conversationId: activeConversationIdRef.current,
        userMessage,
        assistantMessage,
      }).catch((error) => {
        console.error("AI conversation save failed", {
          error,
          message: error?.message,
          code: error?.code,
          details: error?.details,
          hint: error?.hint,
        });
      });
      return true;
    } catch (error) {
      logAiApiError("chat request failed", {
        apiUrl: getApiUrl("/api/chat"),
        error,
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint,
        userMessage: userMsg,
        targetDate: targetDateKey || null,
        coachMode: mode,
      });
      setAiMsgs((p) => [...p, { role: "assistant", content: "通信に失敗しました。時間をおいて再試行してください。" }]);
      return false;
    } finally {
      aiLoadRef.current = false;
      setAiLoad(false);
    }
  };

  return {
    aiMsgs,
    aiInput,
    setAiInput,
    aiLoad,
    aiEnd,
    sendAI,
    isPro,
    proPlan,
    activatePumpPro,
    activateStripeCheckoutSession,
    openStripePortal,
    restorePumpPro,
    deactivatePumpProDev,
    refreshPumpProStatus,
    dailyFreeAiLimit: AI_DAILY_LIMIT,
    aiUsageDate,
    aiRemaining: isPro ? Infinity : Math.max(0, AI_DAILY_LIMIT - aiUsageCount),
    aiUsageCount,
    aiConversations,
    aiConversationLoading,
    aiConversationError,
    activeConversationId,
    loadAiConversations,
    openAiConversation,
    startNewAiConversation,
    deleteAiConversation,
  };
}
