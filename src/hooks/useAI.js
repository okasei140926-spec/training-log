import { useEffect, useMemo, useRef, useState } from "react";
import { formatDateKey, sanitizeHistoryRecord } from "../utils/helpers";
import { normalizeExerciseName } from "../utils/exerciseName";
import { supabase } from "../utils/supabase";
import { extractWorkoutPlanFromText, normalizeWorkoutPlan } from "../utils/aiWorkoutPlan";

const AI_DAILY_LIMIT = 5;
const AI_USAGE_STORAGE_KEY = "ai_usage_state";
const AI_PRO_STORAGE_KEY = "pump_pro_enabled";

const getTodayKey = () => formatDateKey(new Date());
const getAiUsageKey = (dateKey = getTodayKey()) => `ai_usage_${dateKey}`;

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

const ANALYSIS_KEYWORDS = ["分析", "振り返", "レビュー", "見て", "チェック"];
const MENU_KEYWORDS = ["メニュー", "組んで", "作って", "何すれば", "何したら", "どうすれば"];
const BEGINNER_KEYWORDS = ["初心者", "初めて", "はじめて", "まずは", "簡単", "やさしく"];
const ADVANCED_KEYWORDS = ["中級", "上級", "高重量", "高強度"];

const calcSetVolume = (set) => {
  if (!set) return 0;
  if (set.weight === "BW") return 0;
  return Number(set.weight || 0) * Number(set.reps || 0);
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
        bodyPart: sanitized.bodyPart || "その他",
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

export function useAI(history) {
  const initialAiUsageDate = getTodayKey();
  const [aiMsgs, setAiMsgs] = useState([
    {
      role: "assistant",
      content: "こんにちは！AI Coachです。トレーニングについて何でも聞いてください 💪",
    },
  ]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoad, setAiLoad] = useState(false);
  const aiEnd = useRef(null);
  const aiLoadRef = useRef(false);
  const aiUsageDateRef = useRef(initialAiUsageDate);
  const aiUsageCountRef = useRef(0);
  const isProRef = useRef(getIsPro());
  const [isPro, setIsPro] = useState(() => getIsPro());
  const [aiUsageDate, setAiUsageDate] = useState(initialAiUsageDate);
  const [aiUsageCount, setAiUsageCount] = useState(() => {
    const usage = resetAiUsageIfNewDay();
    aiUsageDateRef.current = usage.dateKey || initialAiUsageDate;
    aiUsageCountRef.current = usage.count;
    return usage.count;
  });

  const groupedHistory = useMemo(() => flattenHistoryByDate(history), [history]);

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
    const serverDateKey = serverUsage.usageDate || getTodayKey();
    const serverCount = normalizeAiUsageCount(serverUsage.usageCount);

    isProRef.current = serverIsPro;
    setIsPro(serverIsPro);
    aiUsageDateRef.current = serverDateKey;
    aiUsageCountRef.current = serverCount;
    setAiUsageDate(serverDateKey);
    setAiUsageCount(serverCount);

    try {
      localStorage.setItem(AI_PRO_STORAGE_KEY, serverIsPro ? "true" : "false");
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

      if (!accessToken) return false;

      const res = await fetch("/api/activate-pro-dev", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const data = await res.json();

      if (!res.ok) return false;

      applyServerAiUsage(data?.aiUsage);
      return true;
    } catch {
      return false;
    }
  };

  const sendAI = async (overrideMsg) => {
    const userMsg = (typeof overrideMsg === "string" ? overrideMsg : aiInput).trim();
    const currentUsage = resetAiUsageIfNewDay();
    const currentIsPro = getIsPro();
    isProRef.current = currentIsPro;
    setIsPro(currentIsPro);
    aiUsageDateRef.current = currentUsage.dateKey;
    aiUsageCountRef.current = currentUsage.count;
    setAiUsageDate(currentUsage.dateKey);
    setAiUsageCount(currentUsage.count);

    if (!userMsg || aiLoadRef.current || !canUseAiChat({ isPro: currentIsPro, usage: currentUsage })) return false;

    aiLoadRef.current = true;

    const mode = detectCoachMode(userMsg);
    const targetDateKey = getTargetDateKey(userMsg);
    const targetWorkoutSummary = targetDateKey ? summarizeWorkoutDay(groupedHistory, targetDateKey) : null;
    const latestDateKey = Array.from(groupedHistory.keys()).sort().slice(-1)[0] || "";
    const latestWorkoutSummary = latestDateKey ? summarizeWorkoutDay(groupedHistory, latestDateKey) : null;

    setAiInput("");
    const newMsgs = [...aiMsgs, { role: "user", content: userMsg }];
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

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          messages: newMsgs.map((m) => ({ role: m.role, content: m.content })),
          coachContext: {
            mode: mode.wantsAnalysis ? "analysis" : mode.wantsMenu ? "menu" : "general",
            level: mode.wantsBeginner ? "beginner" : mode.wantsAdvanced ? "advanced" : "standard",
            targetDate: targetDateKey || null,
            targetWorkoutContext: buildWorkoutContextText(targetWorkoutSummary),
            latestWorkoutContext: buildWorkoutContextText(latestWorkoutSummary),
            recentSummaryContext: buildRecentSummaryText(groupedHistory),
            hasTargetWorkout: Boolean(targetWorkoutSummary),
          },
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        applyServerAiUsage(data?.aiUsage);
        const errorMessage =
          res.status === 401
            ? "ログインが必要です。"
            : res.status === 403
              ? "今日の無料AI相談回数を使い切りました。Pump ProでAI Coachを無制限に使えます。"
              : data?.error || "AI Coachの応答に失敗しました。";
        setAiMsgs((p) => [...p, { role: "assistant", content: errorMessage }]);
        return;
      }

      const reply = data.content?.[0]?.text || "AI Coachの応答に失敗しました。";
      const structuredWorkoutPlan = normalizeWorkoutPlan(data.workoutPlan);
      const workoutPlan = mode.wantsMenu
        ? structuredWorkoutPlan.length
          ? structuredWorkoutPlan
          : extractWorkoutPlanFromText(reply)
        : [];
      if (!applyServerAiUsage(data?.aiUsage) && !currentIsPro) {
        const nextUsage = incrementAiUsage();
        aiUsageDateRef.current = nextUsage.dateKey;
        aiUsageCountRef.current = nextUsage.count;
        setAiUsageDate(nextUsage.dateKey);
        setAiUsageCount(nextUsage.count);
      }
      setAiMsgs((p) => [...p, { role: "assistant", content: reply, workoutPlan }]);
      return true;
    } catch {
      setAiMsgs((p) => [...p, { role: "assistant", content: "AI Coachの応答に失敗しました。" }]);
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
    activatePumpPro,
    dailyFreeAiLimit: AI_DAILY_LIMIT,
    aiUsageDate,
    aiRemaining: isPro ? Infinity : Math.max(0, AI_DAILY_LIMIT - aiUsageCount),
    aiUsageCount,
  };
}
