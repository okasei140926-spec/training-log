import { useState, useRef, useEffect } from "react";
import { supabase } from "../utils/supabase";

const AI_DAILY_LIMIT = 3;
const getTodayKey = () => new Date().toISOString().slice(0, 10);
const getAiUsageKey = () => `ai_usage_${getTodayKey()}`;

export function useAI(history) {
  const [aiMsgs, setAiMsgs] = useState([{
    role: "assistant",
    content: "こんにちは！AI Coachです。トレーニングについて何でも聞いてください 💪"
  }]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoad, setAiLoad] = useState(false);
  const aiEnd = useRef(null);
  const [aiUsageCount, setAiUsageCount] = useState(() => {
    try {
      return Number(localStorage.getItem(getAiUsageKey()) || 0) || 0;
    } catch {
      return 0;
    }
  });

  useEffect(() => {
    aiEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [aiMsgs]);

  useEffect(() => {
    try {
      setAiUsageCount(Number(localStorage.getItem(getAiUsageKey()) || 0) || 0);
    } catch {
      setAiUsageCount(0);
    }
  }, []);

  const sendAI = async (overrideMsg) => {
    const userMsg = (typeof overrideMsg === "string" ? overrideMsg : aiInput).trim();
    if (!userMsg || aiLoad) return;
    setAiInput("");
    const newMsgs = [...aiMsgs, { role: "user", content: userMsg }];
    setAiMsgs(newMsgs);
    setAiLoad(true);
    try {
      const nextUsageCount = aiUsageCount + 1;
      setAiUsageCount(nextUsageCount);
      localStorage.setItem(getAiUsageKey(), String(nextUsageCount));
    } catch {}
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;

      if (!accessToken) {
        setAiMsgs(p => [...p, { role: "assistant", content: "ログインが必要です。" }]);
        return;
      }

      const historyContext = Object.entries(history).slice(-8).map(([name, recs]) => {
        const last = recs[recs.length - 1];
        return `${name}: ${last.sets?.map(s => `${s.weight}kg×${s.reps}rep`).join(", ")}`;
      }).join("\n");
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          messages: newMsgs.map(m => ({ role: m.role, content: m.content })),
          historyContext,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        const errorMessage =
          res.status === 401
            ? "ログインが必要です。"
            : data?.error || "AI Coachの応答に失敗しました。";
        setAiMsgs(p => [...p, { role: "assistant", content: errorMessage }]);
        return;
      }

      const reply = data.content?.[0]?.text || "AI Coachの応答に失敗しました。";
      setAiMsgs(p => [...p, { role: "assistant", content: reply }]);
    } catch {
      setAiMsgs(p => [...p, { role: "assistant", content: "AI Coachの応答に失敗しました。" }]);
    } finally {
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
    aiRemaining: Math.max(0, AI_DAILY_LIMIT - aiUsageCount),
    aiUsageCount,
  };
}
