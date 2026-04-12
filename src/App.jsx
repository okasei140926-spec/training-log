import { useState, useEffect, useRef } from "react";
import { load, save, calc1RM, storeW, KG_TO_LBS } from "./utils/helpers";
import { QUICK_LABELS, LABEL_COLORS } from "./constants/suggestions";
import { S, css } from "./utils/styles";

import LogScreen     from "./components/LogScreen";
import FriendsScreen from "./components/FriendsScreen";
import HistoryScreen from "./components/HistoryScreen";
import AIScreen      from "./components/AIScreen";

import AddExModal    from "./components/modals/AddExModal";
import SummaryModal  from "./components/modals/SummaryModal";
import OnboardingOverlay from "./components/OnboardingOverlay";

export default function GymApp() {
  // ─── State ────────────────────────────────────────
  const [muscleEx, setMuscleEx]   = useState(() => load("routineEx", {}));
  const [history, setHistory]     = useState(() => load("history", {}));

  const [screen, setScreen]       = useState("log");
  const [todayLabels, setTodayLabels] = useState([]);
  const [logData, setLogData]     = useState({});
  const [sessionEx, setSessionEx] = useState(null);

  const [intervalSec, setIntervalSec] = useState(() => load("intervalSec", 90));
  const [timerLeft, setTimerLeft]     = useState(null);
  const timerRef = useRef(null);

  const [exerciseUnits, setExerciseUnits] = useState({});

  // 設定画面用モーダル
  const [showAddEx, setShowAddEx] = useState(false);
  const [addTarget, setAddTarget] = useState(null);
  const [newExName, setNewExName] = useState("");

  const [summary, setSummary] = useState(null);
  const [isDark, setIsDark]   = useState(() => load("isDark", true));
  // eslint-disable-next-line no-unused-vars
  const [unit, setUnit]       = useState(() => load("unit", "kg"));
  const [showOnboarding, setShowOnboarding] = useState(() => !load("onboardingDone", false));
  const [logDate, setLogDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  });

  const [selectedDateRecord, setSelectedDateRecord] = useState(null);
  const handleSetLogDate = (date) => {
  setLogDate(date);
  // その日に記録があればhistory画面へ
  const hasRecord = Object.values(history).some(recs =>
    recs.some(r => r.date === date)
  );
  if (hasRecord) setSelectedDateRecord(date);
};

  // ─── スワイプバック ────────────────────────────
useEffect(() => {
  const BACK_MAP = {
    prep: "home",
    log: "home",
    setup_routine: "home",
    history: "home",
  };

  let startX = 0;
  let startY = 0;

  const onTouchStart = (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  };

  const onTouchEnd = (e) => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    // 横スワイプ（右方向50px以上、縦ズレが横より小さい）
    if (dx > 50 && Math.abs(dy) < Math.abs(dx)) {
      const dest = BACK_MAP[screen];
      if (dest) setScreen(dest);
    }
  };

  window.addEventListener("touchstart", onTouchStart);
  window.addEventListener("touchend", onTouchEnd);
  return () => {
    window.removeEventListener("touchstart", onTouchStart);
    window.removeEventListener("touchend", onTouchEnd);
  };
}, [screen]);


  // ─── AI Coach ─────────────────────────────────────
  const [aiMsgs, setAiMsgs] = useState([{ role: "assistant", content: "こんにちは！AI Coachです。トレーニングについて何でも聞いてください 💪" }]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoad, setAiLoad] = useState(false);
  const aiEnd = useRef(null);

  // ─── Persist ──────────────────────────────────────
  useEffect(() => { save("routineEx", muscleEx); }, [muscleEx]);
  useEffect(() => { save("history", history); }, [history]);
  useEffect(() => { save("intervalSec", intervalSec); }, [intervalSec]);
  useEffect(() => { save("isDark", isDark); }, [isDark]);
  useEffect(() => { save("unit", unit); }, [unit]);
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);
  useEffect(() => { aiEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [aiMsgs]);

  // ─── Per-exercise unit ────────────────────────────
  const getExUnit = (name) => exerciseUnits[name] ?? unit;

  const toggleExUnit = (name) => {
    const currentUnit = getExUnit(name);
    const CYCLE = { kg: "lbs", lbs: "BW", BW: "kg" };
    const newUnit = CYCLE[currentUnit] || "kg";

    const baseSets = [
      { weight: "", reps: "", done: false },
      { weight: "", reps: "", done: false },
      { weight: "", reps: "", done: false },
    ];
    const currentSets = logData[name] || baseSets;

    if (newUnit === "BW") {
      setLogData(p => ({
        ...p,
        [name]: currentSets.map(s => ({ ...s, weight: "BW" })),
      }));
    } else if (currentUnit === "BW") {
      setLogData(p => ({
        ...p,
        [name]: currentSets.map(s => ({ ...s, weight: "" })),
      }));
    } else if (logData[name]) {
      setLogData(p => ({
        ...p,
        [name]: p[name].map(s => {
          if (!s.weight || s.weight === "BW") return s;
          const n = Number(s.weight);
          if (isNaN(n) || n === 0) return s;
          const converted = newUnit === "lbs"
            ? String(Math.round(n * KG_TO_LBS * 10) / 10)
            : String(Math.round(n / KG_TO_LBS * 100) / 100);
          return { ...s, weight: converted };
        }),
      }));
    }

    setExerciseUnits(p => ({ ...p, [name]: newUnit }));
  };

  // ─── Derived ──────────────────────────────────────
  const dayColor      = LABEL_COLORS[todayLabels[0]] || null;
  const baseExercises = todayLabels.flatMap(l => (muscleEx[l] || []).map(ex => ({ ...ex, label: l })));
  const exercises     = sessionEx !== null ? sessionEx : baseExercises;

  // eslint-disable-next-line no-unused-vars
  const lastWorkoutExercises = (() => {
    if (!Object.keys(history).length) return [];
    const allDates = Object.values(history).flatMap(recs => recs.map(r => r.date));
    const lastDate = [...allDates].sort().reverse()[0];
    return Object.entries(history)
      .filter(([, recs]) => recs[recs.length - 1]?.date === lastDate)
      .map(([name], i) => ({ id: Date.now() + i, name }));
  })();

  // ─── Timer ────────────────────────────────────────
  const startTimer = () => {
    if (!intervalSec) return;
    if (timerRef.current) clearInterval(timerRef.current);
    setTimerLeft(intervalSec);
    timerRef.current = setInterval(() => {
      setTimerLeft(p => {
        if (p <= 1) {
          clearInterval(timerRef.current);
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
          return 0;
        }
        return p - 1;
      });
    }, 1000);
  };
  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimerLeft(null);
  };

  // ─── Log data ─────────────────────────────────────
  const getPrev = (name) => { const r = history[name]; return r ? r[r.length - 1] : null; };

  const getPR = (name) => {
    const recs = history[name];
    if (!recs || !recs.length) return null;
    let best = null, bestRM = 0;
    recs.forEach(r => {
      const rm = calc1RM(r.sets);
      if (rm > bestRM) { bestRM = rm; best = { ...r, rm: Math.round(rm) }; }
    });
    return best;
  };

  const copySetDown = (name, idx) => {
    setLogData(p => {
      const current = [...(p[name] || [
        { weight: "", reps: "", done: false },
        { weight: "", reps: "", done: false },
        { weight: "", reps: "", done: false },
      ])];
      if (idx >= current.length - 1) return p;
      current[idx + 1] = { ...current[idx + 1], weight: current[idx].weight };
      return { ...p, [name]: current };
    });
  };

  const copyRepDown = (name, idx) => {
    setLogData(p => {
      const current = [...(p[name] || [
        { weight: "", reps: "", done: false },
        { weight: "", reps: "", done: false },
        { weight: "", reps: "", done: false },
      ])];
      if (idx >= current.length - 1) return p;
      current[idx + 1] = { ...current[idx + 1], reps: current[idx].reps };
      return { ...p, [name]: current };
    });
  };
  
  const getExistingSets = (name) => {
    const records = history[name];
    if (!records) return null;
    const existing = records.find(r => r.date === logDate);
    if (!existing || !existing.sets)
    return null;
    return existing.sets.map(s => ({ ...s, done: true}));
    };

  const getExSets = (name) => {
    if (logData[name]) return logData[name];
    const existing = getExistingSets(name);
    if (existing && existing.length > 0)
    return existing;
    return [
        { weight: "", reps: "", done: false },
        { weight: "", reps: "", done: false },
        { weight: "", reps: "", done: false },
    ];
  };

  const setField = (name, idx, field, val) => {
  setLogData(p => {
    const s = [...(p[name] || getExSets(name))];
    const updated = { ...s[idx], [field]: val };
    if (field !== "done") {
        const isDone = (updated.weight || updated.weight === "BW") && updated.reps;
        updated.done = isDone;
    }
    s[idx] = updated;
    return { ...p, [name]: s };
  });
};
  

  const addSet = (name) => {
    setLogData(p => {
      const s = [...(p[name] || getExSets(name))];
      return { ...p, [name]: [...s, { weight: "", reps: "", done: false }] };
    });
  };

  const removeSet = (name, idx) => {
    setLogData(p => {
      const s = (p[name] || getExSets(name)).filter((_, i) => i !== idx);
      return { ...p, [name]: s };
    });
  };

  const removeEx = (name) => {
    setSessionEx(p => (p !== null ? p : [...baseExercises]).filter(e => e.name !== name));
    setLogData(p => { const n = { ...p }; delete n[name]; return n; });
    setExerciseUnits(p => { const n = { ...p }; delete n[name]; return n; });
  };

  const [insertIndex, setInsertIndex] = useState(null);

  const addExToSession = (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const ex = { id: Date.now() + (Math.random() * 1000 | 0), name: trimmed };
    setSessionEx(p => {
      const current = p !== null ? p : [...baseExercises];
      if (current.find(e => e.name === trimmed)) return current;
      if (insertIndex !== null) {
        const next = [...current];
        next.splice(insertIndex + 1, 0, ex);
        return next;
      }
      return [...current, ex];
    });
    setInsertIndex(null);
  };

  const reorderEx = (fromIdx, toIdx) => {
    setSessionEx(p => {
      const current = [...(p !== null ? p : baseExercises)];
      const [moved] = current.splice(fromIdx, 1);
      current.splice(toIdx, 0, moved);
      return current;
    });
  };

  const renameEx = (id, newName) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const oldEx = exercises.find(e => e.id === id);
    if (!oldEx || oldEx.name === trimmed) return;
    setSessionEx(p => (p !== null ? p : [...baseExercises]).map(e => e.id === id ? { ...e, name: trimmed } : e));
    setLogData(p => {
      if (!p[oldEx.name]) return p;
      const n = { ...p };
      n[trimmed] = n[oldEx.name];
      delete n[oldEx.name];
      return n;
    });
    setExerciseUnits(p => {
      if (!p[oldEx.name]) return p;
      const n = { ...p };
      n[trimmed] = n[oldEx.name];
      delete n[oldEx.name];
      return n;
    });
  };

  const quickAddToSession = (name, remove) => {
    if (remove) {
      setSessionEx(p => (p !== null ? p : [...baseExercises]).filter(e => e.name !== name));
    } else {
      addExToSession(name);
    }
  };

  const saveLog = () => {
    const nh = { ...history };
    let exCount = 0, setCount = 0, prs = [];
    exercises.forEach(ex => {
      const sets = logData[ex.name] || getExSets(ex.name);
      const valid = sets.filter(s => s.weight && s.reps);
      if (!valid.length) return;
      exCount++;
      setCount += valid.length;
      if (!nh[ex.name]) nh[ex.name] = [];
      const prev = nh[ex.name].length ? nh[ex.name][nh[ex.name].length - 1] : null;
      // lbs 入力の場合は kg に変換して保存
      const exUnit = getExUnit(ex.name);
      const stored = valid.map(s => ({ ...s, weight: storeW(s.weight, exUnit) }));
      const new1RM = calc1RM(stored);
      const old1RM = prev ? calc1RM(prev.sets) : 0;
      if (new1RM > old1RM) prs.push({ name: ex.name, diff: Math.round((new1RM - old1RM) * (exUnit === "lbs" ? KG_TO_LBS : 1)) });
      const existingIdx = nh[ex.name].findIndex(r => r.date === logDate);
      if (existingIdx >= 0) {
        nh[ex.name][existingIdx] = { sets: stored, weight: Number(stored[0].weight), reps: Number(valid[0].reps), date: logDate };
      } else {
        nh[ex.name].push({ sets: stored, weight: Number(stored[0].weight), reps: Number(valid[0].reps), date: logDate });
      }
    });
    setHistory(nh);
    setLogData({});
    setSessionEx(null);
    setExerciseUnits({});
    const d = new Date();
    setLogDate(`${d.getFullYear()}-$
    {String(d.getMonth()
    +1).padStart(2,"0")}-$
    {String(d.getDate()).padStart(2,"0")}`);
    stopTimer();
    setSummary({ exCount, setCount, prs });
    setScreen("home");
  };

  const handleLogForDate = (dateStr) => {
    setLogDate(dateStr);
    setTodayLabels([]);
    setSessionEx(null);
    setLogData({});
    setExerciseUnits({});
    setScreen("home");
  };

  const handlePrepStart = (preparedExercises) => {
    setSessionEx(preparedExercises);
    setScreen("log");
  };

  const handleStartFree = () => {
    setSessionEx([]);
    setScreen("prep");
  };

  const handleEditHistory = (exName, updatedRecord, historyIdx) => {
    setHistory(prev => {
      const recs = [...(prev[exName] || [])];
      const idx = historyIdx !== undefined
        ? historyIdx
        : recs.findIndex(r => r.date === updatedRecord.date);
      if (idx >= 0 && idx < recs.length) recs[idx] = updatedRecord;
      return { ...prev, [exName]: recs };
    });
  };

  const handleDeleteHistory = (exName, historyIdx, recordDate) => {
    setHistory(prev => {
      const recs = [...(prev[exName] || [])];
      const idx = historyIdx !== undefined
        ? historyIdx
        : recs.findIndex(r => r.date === recordDate);
      if (idx < 0 || idx >= recs.length) return prev;
      recs.splice(idx, 1);
      if (!recs.length) {
        const n = { ...prev };
        delete n[exName];
        return n;
      }
      return { ...prev, [exName]: recs };
    });
  };

  // ─── AI Coach ─────────────────────────────────────
  const sendAI = async (overrideMsg) => {
    const userMsg = (typeof overrideMsg === "string" ? overrideMsg : aiInput).trim();
    if (!userMsg || aiLoad) return;
    setAiInput("");
    const newMsgs = [...aiMsgs, { role: "user", content: userMsg }];
    setAiMsgs(newMsgs);
    setAiLoad(true);
    try {
      const historyContext = Object.entries(history).slice(-8).map(([name, recs]) => {
        const last = recs[recs.length - 1];
        return `${name}: ${last.sets?.map(s => `${s.weight}kg×${s.reps}rep`).join(", ")}`;
      }).join("\n");
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMsgs.map(m => ({ role: m.role, content: m.content })),
          historyContext,
        }),
      });
      const data = await res.json();
      const reply = data.content?.[0]?.text || "すみません、エラーが発生しました。";
      setAiMsgs(p => [...p, { role: "assistant", content: reply }]);
    } catch {
      setAiMsgs(p => [...p, { role: "assistant", content: "接続エラーが発生しました。" }]);
    } finally {
      setAiLoad(false);
    }
  };

  // ─── 設定画面用 exercise 追加 ──────────────────────
  const openAddEx = (target) => { setAddTarget(target); setNewExName(""); setShowAddEx(true); };

  const confirmAdd = () => {
    const name = newExName.trim();
    if (!name) return;
    quickAdd(name, false);
    setNewExName("");
    // modal stays open so user can add multiple exercises in a row
  };

  const quickAdd = (name, remove) => {
    const tgts = Array.isArray(addTarget) ? addTarget : (addTarget ? [addTarget] : []);
    setMuscleEx(p => {
      const n = { ...p };
      tgts.forEach(t => {
        if (remove) {
          if (n[t]) n[t] = n[t].filter(e => e.name !== name);
        } else {
          const ex = { id: Date.now() + (Math.random() * 1000 | 0), name };
          if (!n[t]) n[t] = [];
          if (!n[t].find(e => e.name === name)) n[t] = [...n[t], ex];
        }
      });
      return n;
    });
  };

  // ─── 設定画面 ──────────────────────────────────────
  if (screen === "setup_routine") {
    return (
      <div className={isDark ? "" : "theme-light"} style={S.root}><style>{css}</style>
        <div style={S.header}>
          <div><div style={S.appLabel}>IRON LOG</div><div style={S.headerTitle}>種目設定</div></div>
          <button onClick={() => setScreen("home")} style={S.pillBtn}>完了</button>
        </div>
        <div style={{ padding: "20px" }}>
          <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 20, lineHeight: 1.6 }}>
            部位ごとに種目を登録しておくと、ホームから一発で呼び出せます
          </div>
          {QUICK_LABELS.map(lbl => {
            const col    = LABEL_COLORS[lbl];
            const exList = muscleEx[lbl] || [];
            return (
              <div key={lbl} style={{ marginBottom: 20 }}>
                <div style={{ padding: "8px 14px", borderRadius: "10px 10px 0 0", background: col + "22", borderBottom: `2px solid ${col}`, fontSize: 13, fontWeight: 800, color: col }}>{lbl}</div>
                <div style={{ background: "var(--card)", borderRadius: "0 0 10px 10px", overflow: "hidden" }}>
                  {!exList.length && <div style={{ padding: "12px 14px", fontSize: 13, color: "var(--text4)" }}>種目なし</div>}
                  {exList.map((ex, i) => (
                    <div key={ex.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: i < exList.length - 1 ? "1px solid var(--card2)" : "none" }}>
                      <span style={{ fontSize: 14, color: "var(--text)" }}>{ex.name}</span>
                      <button onClick={() => setMuscleEx(p => ({ ...p, [lbl]: p[lbl].filter(e => e.id !== ex.id) }))} style={{ background: "none", color: "var(--text3)", fontSize: 18 }}>×</button>
                    </div>
                  ))}
                  <button onClick={() => openAddEx(lbl)} style={{ width: "100%", padding: "12px 14px", background: "transparent", border: "none", color: col, fontSize: 13, textAlign: "left", fontWeight: 700 }}>＋ 種目を追加</button>
                </div>
              </div>
            );
          })}
        </div>
        {showAddEx && <AddExModal name={newExName} setName={setNewExName} onConfirm={confirmAdd} onClose={() => setShowAddEx(false)} target={addTarget} onQuickAdd={quickAdd} />}
      </div>
    );
  }

  // ─── Main render ──────────────────────────────────
  return (
    <div className={isDark ? "" : "theme-light"} style={S.root}>
      <style>{css}</style>

      <div style={S.header}>
        <div>
          <div style={S.appLabel}>IRON LOG</div>
          <div style={S.headerTitle}>
            {screen === "home" ? "Today"
              : screen === "prep" ? "Menu"
              : screen === "log"  ? "Log"
              : screen === "friends" ? "Friends"
              : screen === "ai" ? "AI Coach"
              : "記録"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setIsDark(p => !p)} style={S.pillBtn}>{isDark ? "☀️" : "🌙"}</button>
          <button onClick={() => setScreen("setup_routine")} style={S.pillBtn}>⚙</button>
        </div>
      </div>

      {screen === "log" && (
        <LogScreen
          onBack={() => setScreen("home")}
          todayLabels={todayLabels}
          dayColor={dayColor}
          exercises={exercises}
          logData={logData}
          getExSets={getExSets}
          setField={setField}
          addSet={addSet}
          removeSet={removeSet}
          removeEx={removeEx}
          timerLeft={timerLeft}
          intervalSec={intervalSec}
          setIntervalSec={setIntervalSec}
          startTimer={startTimer}
          stopTimer={stopTimer}
          saveLog={saveLog}
          onAddEx={addExToSession}
          onSetInsertIndex={setInsertIndex}
          onQuickAddEx={quickAddToSession}
          onReorderEx={reorderEx}
          onRenameEx={renameEx}
          getPrev={getPrev}
          getPR={getPR}
          onCopyDown={copySetDown}
          onCopyDownReps={copyRepDown}
          unit={unit}
          getExUnit={getExUnit}
          onToggleExUnit={toggleExUnit}
          muscleEx={muscleEx}
          setTodayLabels={setTodayLabels}
          history={history}
        />
      )}

      {screen === "friends" && (
        <FriendsScreen
          history={history}
          onCopyMenu={(exs) => {
            setSessionEx(exs.map(ex => ({ id: Date.now() + Math.random(), name: ex.name })));
            setLogData(exs.reduce((acc, ex) => ({
              ...acc,
              [ex.name]: [
                { weight: String(ex.weight || ""), reps: String(ex.reps || ""), done: false },
                { weight: String(ex.weight || ""), reps: String(ex.reps || ""), done: false },
                { weight: String(ex.weight || ""), reps: String(ex.reps || ""), done: false },
              ],
            }), {}));
            setScreen("log");
          }}
        />
      )}

      {screen === "history" && <HistoryScreen history={history} onEditHistory={handleEditHistory} onDeleteHistory={handleDeleteHistory} unit={unit} onLogForDate={handleLogForDate} />}

      {screen === "ai" && (
        <AIScreen
          aiMsgs={aiMsgs}
          aiInput={aiInput}
          setAiInput={setAiInput}
          sendAI={sendAI}
          aiLoad={aiLoad}
          aiEnd={aiEnd}
        />
      )}

      <div style={S.bottomNav}>
        {[
          { id: "log",     icon: "✏️", label: "Log" },
          { id: "friends", icon: "👥", label: "Friends" },
          { id: "history", icon: "📊", label: "記録" },
          { id: "ai",      icon: "🤖", label: "AI" },
        ].map(tab => (
          <button key={tab.id} onClick={() => setScreen(tab.id)}
            style={{ flex: 1, background: "none", color: screen === tab.id ? "var(--text)" : "var(--text3)", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "4px 0" }}>
            <div style={{ fontSize: 20 }}>{tab.icon}</div>
            <div style={{ fontSize: 9, fontWeight: screen === tab.id ? 700 : 400 }}>{tab.label}</div>
          </button>
        ))}
      </div>

      {showOnboarding && <OnboardingOverlay onDone={() => setShowOnboarding(false)} />}
      <SummaryModal summary={summary} onClose={() => setSummary(null)} />
    </div>
  );
}
