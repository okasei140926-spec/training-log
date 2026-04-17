import { useState, useEffect, useRef, useCallback } from "react";
import { load, save, calc1RM, storeW, KG_TO_LBS } from "./utils/helpers";
import { QUICK_LABELS, LABEL_COLORS, SUGGESTIONS } from "./constants/suggestions";
import { S, css } from "./utils/styles";
import { Analytics } from "@vercel/analytics/react";

import LogScreen from "./components/LogScreen";
import FriendsScreen from "./components/FriendsScreen";
import HistoryScreen from "./components/HistoryScreen";
import AIScreen from "./components/AIScreen";

import AddExModal from "./components/modals/AddExModal";
import SummaryModal from "./components/modals/SummaryModal";
import OnboardingOverlay from "./components/OnboardingOverlay";

const EX_TO_LABEL = {};
Object.entries(SUGGESTIONS).forEach(([label, names]) => {
    names.forEach((n) => {
        EX_TO_LABEL[n] = label;
    });
});

export default function GymApp() {
    // ─── State ────────────────────────────────────────
    const [muscleEx, setMuscleEx] = useState(() => load("routineEx", {}));
    const [history, setHistory] = useState(() => load("history", {}));


    const [screen, setScreen] = useState("history");

    const [todayLabels, setTodayLabels] = useState(() => load("draft_todayLabels", []));
    const updateTodayLabels = (nextOrUpdater) => {
        setTodayLabels((prev) => {
            const next =
                typeof nextOrUpdater === "function"
                    ? nextOrUpdater(prev)
                    : nextOrUpdater;

            save("draft_todayLabels", next);
            save("draft_logDate", logDate);
            return next;
        });
    };
    const [logData, setLogData] = useState(() => load("draft_logData", {}));
    const [sessionEx, setSessionEx] = useState(() => load("draft_sessionEx", null));

    const [intervalSec, setIntervalSec] = useState(() => load("intervalSec", 90));
    const [timerLeft, setTimerLeft] = useState(null);
    const timerRef = useRef(null);
    const [showTimerMenu, setShowTimerMenu] = useState(false);

    const [exerciseUnits, setExerciseUnits] = useState(() => load("draft_exerciseUnits", {}));

    const touchStartX = useRef(null);
    const touchStartY = useRef(null);

    // 設定画面用モーダル
    const [showAddEx, setShowAddEx] = useState(false);
    const [addTarget, setAddTarget] = useState(null);
    const [newExName, setNewExName] = useState("");
    const [routineOrder, setRoutineOrder] = useState(() => load("routineOrder", {}));

    const [summary, setSummary] = useState(null);
    const [isDark, setIsDark] = useState(() => load("isDark", true));
    // eslint-disable-next-line no-unused-vars
    const [unit, setUnit] = useState(() => load("unit", "kg"));
    const [showOnboarding, setShowOnboarding] = useState(() => !load("onboardingDone", false));

    const [logDate, setLogDate] = useState(() =>
        load("draft_logDate", (() => {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        })())
    );




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

    useEffect(() => {
        if (screen !== "log") return;

        const hasDraft =
            sessionEx !== null ||
            Object.keys(logData).length > 0 ||
            Object.keys(exerciseUnits).length > 0 ||
            todayLabels.length > 0;

        if (!hasDraft) return;

        save("draft_todayLabels", todayLabels);
        save("draft_logData", logData);
        save("draft_sessionEx", sessionEx);
        save("draft_exerciseUnits", exerciseUnits);
        save("draft_logDate", logDate);
    }, [screen, todayLabels, logData, sessionEx, exerciseUnits, logDate]);

    useEffect(() => () => {
        if (timerRef.current) clearInterval(timerRef.current);
    }, []);

    useEffect(() => {
        aiEnd.current?.scrollIntoView({ behavior: "smooth" });
    }, [aiMsgs]);

    useEffect(() => { save("routineOrder", routineOrder); }, [routineOrder]);

    useEffect(() => {
        const d = new Date();
        const today =
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

        setLogDate(today);
        setScreen("history");
    }, []);

    // ─── Per-exercise unit ────────────────────────────
    const getExUnit = (name) => exerciseUnits[name] ?? unit;

    const toggleExUnit = (name) => {
        const currentUnit = getExUnit(name);
        const CYCLE = { kg: "lbs", lbs: "BW", BW: "kg" };
        const newUnit = CYCLE[currentUnit] || "kg";

        const makeBaseSets = () => ([
            { weight: "", reps: "", done: false },
            { weight: "", reps: "", done: false },
            { weight: "", reps: "", done: false },
        ]);

        const currentSets = logData[name]
            ? logData[name].map(s => ({ ...s }))
            : makeBaseSets();

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

        setExerciseUnits((p) => {
            const next = { ...p, [name]: newUnit };
            save("draft_exerciseUnits", next);
            save("draft_logDate", logDate);
            return next;
        });
    };

    // ─── Derived ──────────────────────────────────────
    const getRoutineKey = (labels) => [...labels].sort().join("|");
    const dayColor = LABEL_COLORS[todayLabels[0]] || null;
    const routineKey = getRoutineKey(todayLabels);

    const baseExercisesRaw = todayLabels.flatMap(label =>
        (muscleEx[label] || []).map(ex => ({ ...ex, label }))
    );

    const baseExercises = (() => {
        const savedOrder = routineOrder[routineKey] || [];
        if (!savedOrder.length) return baseExercisesRaw;

        return savedOrder
            .map(name => baseExercisesRaw.find(ex => ex.name === name))
            .filter(Boolean)
            .concat(
                baseExercisesRaw.filter(ex => !savedOrder.includes(ex.name))
            );
    })();

    const exercises = sessionEx !== null ? sessionEx : baseExercises;

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (screen !== "log") return;

        const hasAnyValidSet = exercises.some((ex) =>
            (logData[ex.name] || []).some((s) => s.weight && s.reps)
        );

        if (!hasAnyValidSet) return;

        const t = setTimeout(() => {
            persistCurrentLog();
        }, 400);

        return () => clearTimeout(t);
    }, [screen, logData, exercises, logDate, exerciseUnits, persistCurrentLog]);

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
    const startTimer = (sec) => {
        const s = sec || intervalSec;
        if (!s) return;
        if (timerRef.current) clearInterval(timerRef.current);
        setTimerLeft(s);
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
            const base = getExSets({ name }); // ←ここ重要
            const current = [...(p[name] || base)];

            if (idx >= current.length - 1) return p;

            current[idx + 1] = {
                ...current[idx + 1],
                weight: current[idx].weight
            };

            return { ...p, [name]: current };
        });
    };

    const copyRepDown = (name, idx) => {
        setLogData(p => {
            const base = getExSets({ name }); // ←ここ重要
            const current = [...(p[name] || base)];

            if (idx >= current.length - 1) return p;

            current[idx + 1] = {
                ...current[idx + 1],
                reps: current[idx].reps
            };

            return { ...p, [name]: current };
        });
    };

    const getExistingSets = (name) => {
        const records = history[name];
        if (!records) return null;
        const existing = records.find(r => r.date === logDate);
        if (!existing || !existing.sets)
            return null;
        return existing.sets.map(s => ({ ...s, done: true }));
    };

    const makeBaseSets = () => ([
        { weight: "", reps: "", done: false },
        { weight: "", reps: "", done: false },
        { weight: "", reps: "", done: false },
    ]);

    const getExSets = (ex) => {
        if (logData[ex.name]) {
            return logData[ex.name].map(s => ({ ...s }));
        }

        const existing = getExistingSets(ex.name);
        if (existing && existing.length > 0) {
            return existing.map(s => ({ ...s }));
        }

        return makeBaseSets();
    };

    const setField = (ex, idx, field, val) => {
        const key = ex.name;

        setLogData(p => {
            const s = [...(p[key] || getExSets(ex))];
            const updated = { ...s[idx], [field]: val };

            if (field !== "done") {
                const isDone = (updated.weight || updated.weight === "BW") && updated.reps;
                updated.done = isDone;
            }

            s[idx] = updated;

            const next = { ...p, [key]: s };

            save("draft_logData", next);
            save("draft_logDate", logDate);

            return next;
        });
    };


    const addSet = (ex) => {
        setLogData(p => {
            const key = ex.name;
            const s = [...(p[key] || getExSets(ex))];
            return { ...p, [key]: [...s, { weight: "", reps: "", done: false }] };
        });
    };

    const removeSet = (ex, idx) => {
        setLogData(p => {
            const key = ex.name
            const s = (p[key] || getExSets(ex)).filter((_, i) => i !== idx);
            return { ...p, [key]: s };
        });
    };

    const removeEx = (idOrName, maybeName) => {
        const isNameOnly = maybeName === undefined;
        const targetId = isNameOnly ? null : idOrName;
        const targetName = isNameOnly ? idOrName : maybeName;

        setSessionEx(p =>
            (p !== null ? p : [...baseExercises]).filter(e => {
                if (targetId !== null) return e.id !== targetId;
                return e.name !== targetName;
            })
        );

        setLogData(p => {
            const n = { ...p };
            delete n[targetName];
            return n;
        });

        setExerciseUnits(p => {
            const n = { ...p };
            delete n[targetName];
            return n;
        });
    };


    const addExToSession = (name, labelOverride) => {
        const trimmed = name.trim();
        if (!trimmed) return;

        const ex = {
            id: Date.now() + (Math.random() * 1000 | 0),
            name: trimmed
        };

        setSessionEx((p) => {
            const current = p !== null ? p : [...baseExercises];
            if (current.find((e) => e.name === trimmed)) return current;

            const next = [...current, ex];
            save("draft_sessionEx", next);
            save("draft_logDate", logDate);
            return next;
        });

        // 👇 ここに入れる
        const label = labelOverride || todayLabels[0];
        if (!label) return;

        setMuscleEx((prev) => {
            const next = { ...prev };
            const list = next[label] || [];

            if (!list.find((e) => e.name === trimmed)) {
                next[label] = [
                    ...list,
                    { id: Date.now(), name: trimmed }
                ];
            }

            return next;
        });
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

        const oldEx = exercises.find((e) => e.id === id);
        if (!oldEx || oldEx.name === trimmed) return;

        setSessionEx((p) =>
            (p !== null ? p : [...baseExercises]).map((e) =>
                e.id === id ? { ...e, name: trimmed } : e
            )
        );

        setLogData((p) => {
            // logData は id ベースで持つ
            if (!p[id]) return p;
            return { ...p, [id]: p[id] };
        });

        setExerciseUnits((p) => {
            // ここはまだ name ベースなので移し替える
            if (!p[oldEx.name]) return p;
            const n = { ...p };
            n[trimmed] = n[oldEx.name];
            delete n[oldEx.name];
            return n;
        });
    };

    const quickAdd = (name, remove, labelOverride) => {
        console.log("保存先ラベル", labelOverride);

        const tgts = labelOverride
            ? [labelOverride]
            : Array.isArray(addTarget)
                ? addTarget
                : (addTarget ? [addTarget] : []);

        console.log("最終ターゲット", tgts);

        setMuscleEx((prev) => {
            const next = { ...prev };

            tgts.forEach((label) => {
                const list = next[label] || [];

                if (remove) {
                    next[label] = list.filter((e) => e.name !== name);
                } else {
                    if (!list.find((e) => e.name === name)) {
                        next[label] = [...list, { id: Date.now(), name }];
                    }
                }
            });

            return next;
        });

        if (!remove) {
            addExToSession(name);
        }
    };

    const quickAddToSession = (name, remove, labelOverride) => {
        quickAdd(name, remove, labelOverride);
    };

    // useEffectより前に定義
    const persistCurrentLog = useCallback(() => {
        setHistory((prev) => {
            const nh = { ...prev };

            Object.keys(nh).forEach((name) => {
                nh[name] = (nh[name] || []).filter((r) => r.date !== logDate);
                if (nh[name].length === 0) delete nh[name];
            });

            exercises.forEach((ex, index) => {
                const sets = logData[ex.name] || [];
                const valid = sets.filter((s) => s.weight && s.reps);

                if (!valid.length) return;

                if (!nh[ex.name]) nh[ex.name] = [];

                const exUnit = getExUnit(ex.name);
                const stored = valid.map((s) => ({
                    ...s,
                    weight: storeW(s.weight, exUnit),
                }));

                nh[ex.name].push({
                    sets: stored,
                    weight: Number(stored[0].weight),
                    reps: Number(valid[0].reps),
                    date: logDate,
                    order: index,
                });
            });

            return nh;
        });
    }, [exercises, logData, logDate, getExUnit]); // ← 依存配列


    const saveLog = () => {
        // 種目の順番をmuscleExに保存
        if (sessionEx && sessionEx.length > 0) {
            const key = getRoutineKey(todayLabels);
            if (key) {
                setRoutineOrder(prev => ({
                    ...prev,
                    [key]: sessionEx.map(ex => ex.name),
                }));
            }
        }


        const nh = { ...history };
        Object.keys(nh).forEach((name) => {
            nh[name] = (nh[name] || []).filter((r) => r.date !== logDate);
            if (nh[name].length === 0) {
                delete nh[name];
            }
        });
        let exCount = 0, setCount = 0, prs = [];
        exercises.forEach((ex, index) => {
            const sets = logData[ex.name] || getExSets(ex);
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
                nh[ex.name][existingIdx] = { sets: stored, weight: Number(stored[0].weight), reps: Number(valid[0].reps), date: logDate, order: index };
            } else {
                nh[ex.name].push({ sets: stored, weight: Number(stored[0].weight), reps: Number(valid[0].reps), date: logDate, order: index });
            }
        });
        setHistory(nh);
        setTodayLabels([]);
        setLogData({});
        setSessionEx(null);
        setExerciseUnits({});
        save("draft_todayLabels", []);
        save("draft_logData", {});
        save("draft_sessionEx", null);
        save("draft_exerciseUnits", {});
        save("draft_logDate", "");
        const d = new Date();
        setLogDate(
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
        stopTimer();
        setSummary({ exCount, setCount, prs });
        setScreen("log");
    };

    const handleLogForDate = (dateStr) => {
        const hasCurrentDraft =
            sessionEx !== null ||
            Object.keys(logData).length > 0 ||
            Object.keys(exerciseUnits).length > 0 ||
            todayLabels.length > 0;

        if (hasCurrentDraft) {
            save("draft_todayLabels", todayLabels);
            save("draft_logData", logData);
            save("draft_sessionEx", sessionEx);
            save("draft_exerciseUnits", exerciseUnits);
            save("draft_logDate", logDate);
        }
        setSessionEx(null);
        setLogData({});
        setExerciseUnits({});

        setLogDate(dateStr);

        const dayExercises = Object.entries(history)
            .map(([name, recs]) => {
                const rec = recs.find(r => r.date === dateStr);
                if (!rec) return null;
                return {
                    id: name,
                    name,
                    order: typeof rec.order === "number" ? rec.order : 999,
                    rec,
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.order - b.order);

        const inferredLabels = [...new Set(
            dayExercises
                .map(({ name }) => EX_TO_LABEL[name])
                .filter(Boolean)
        )];

        if (dayExercises.length > 0) {
            const dayLogData = {};
            dayExercises.forEach(({ name, rec }) => {
                if (rec?.sets) {
                    dayLogData[name] = rec.sets.map(s => ({ ...s, done: true }));
                }
            });

            setTodayLabels(inferredLabels);
            setSessionEx(dayExercises.map(({ id, name }) => ({ id, name })));
            setLogData(dayLogData);
        } else {
            setTodayLabels([]);
            setSessionEx(null);
            setLogData({});
        }

        setScreen("log");
    };


    // ② カレンダークリック用（分岐だけ）
    const handleCalendarDayOpen = (dateStr) => {
        const draftDate = load("draft_logDate", "");
        const draftSession = load("draft_sessionEx", null);
        const draftLog = load("draft_logData", {});
        const draftUnits = load("draft_exerciseUnits", {});
        const draftLabels = load("draft_todayLabels", []);

        const hasRealDraftForDate =
            draftDate === dateStr &&
            Object.values(draftLog).some((sets) =>
                (sets || []).some((s) => s.weight || s.reps)
            );

        if (hasRealDraftForDate) {
            setLogDate(dateStr);
            setSessionEx(draftSession);
            setLogData(draftLog);
            setExerciseUnits(draftUnits);
            setTodayLabels(draftLabels);
            setScreen("log");
            return;
        }

        handleLogForDate(dateStr);
    };

    const handleEditHistory = (exName, updatedRecord, historyIdx) => {
        setHistory(prev => {
            const recs = [...(prev[exName] || [])];
            const idx = historyIdx !== undefined
                ? historyIdx
                : recs.findIndex(r => r.date === updatedRecord.date);

            if (idx >= 0 && idx < recs.length) {
                recs[idx] = updatedRecord;
            }

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
                const next = { ...prev };
                delete next[exName];
                return next;
            }

            return { ...prev, [exName]: recs };
        });
    };

    const deleteAllHistoryForDate = (targetDate) => {
        setHistory((prev) => {
            const next = {};

            Object.entries(prev).forEach(([exName, recs]) => {
                const filtered = (recs || []).filter((r) => r.date !== targetDate);
                if (filtered.length > 0) {
                    next[exName] = filtered;
                }
            });

            return next;
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
        quickAdd(name, false, Array.isArray(addTarget) ? addTarget[0] : addTarget);
        setNewExName("");
    };

    // ─── 設定画面 ──────────────────────────────────────
    if (screen === "setup_routine") {
        return (
            <div className={isDark ? "" : "theme-light"} style={S.root}><style>{css}</style>
                <div style={S.header}>
                    <div><div style={S.appLabel}>IRON LOG</div><div style={S.headerTitle}>種目設定</div></div>
                    <button onClick={() => setScreen("log")} style={S.pillBtn}>完了</button>
                </div>
                <div style={{ padding: "20px" }}>
                    <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 20, lineHeight: 1.6 }}>
                        部位ごとに種目を登録しておくと、ホームから一発で呼び出せます
                    </div>
                    {QUICK_LABELS.map(lbl => {
                        const col = LABEL_COLORS[lbl];
                        const exList = muscleEx[lbl] || [];
                        return (
                            <div key={lbl} style={{ marginBottom: 20 }}>
                                <div style={{ padding: "8px 14px", borderRadius: "10px 10px 0 0", background: col + "22", borderBottom: `2px solid ${col}`, fontSize: 13, fontWeight: 800, color: col }}>{lbl}</div>
                                <div style={{ background: "var(--card)", borderRadius: "0 0 10px 10px", overflow: "hidden" }}>
                                    {!exList.length && <div style={{ padding: "12px 14px", fontSize: 13, color: "var(--text4)" }}>種目なし</div>}
                                    {exList.map((ex, i) => (
                                        <div key={ex.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: i < exList.length - 1 ? "1px solid var(--card2)" : "none" }}>
                                            <span style={{ fontSize: 14, color: "var(--text)" }}>{ex.name}</span>
                                            <button onClick={() => setMuscleEx(p => ({ ...p, [lbl]: p[lbl].filter(e => e.id !== ex.name) }))} style={{ background: "none", color: "var(--text3)", fontSize: 18 }}>×</button>
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
                                : screen === "log" ? "Log"
                                    : screen === "friends" ? "Friends"
                                        : screen === "ai" ? "AI Coach"
                                            : "記録"}
                    </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {screen === "log" && (
                        <button onClick={() => {
                            if (timerLeft !== null) {
                                stopTimer();
                            } else {
                                setShowTimerMenu(p => !p);
                            }
                        }}
                            style={{
                                padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700, border: "none",
                                background: timerLeft !== null ? (timerLeft === 0 ? "#4ade80" : timerLeft <= 10 ? "#FF4D4D" : "var(--text)") : "var(--card2)",
                                color: timerLeft !== null ? (timerLeft === 0 ? "#000" : "var(--bg)") : "var(--text2)"
                            }}>
                            {timerLeft !== null ? (timerLeft === 0 ? "GO!💪" : `⏱ ${Math.floor(timerLeft / 60)}:${String(timerLeft % 60).padStart(2, "0")}`) : "⏱"}
                        </button>
                    )}
                    <button onClick={() => setIsDark(p => !p)} style={S.pillBtn}>{isDark ? "☀️" : "🌙"}</button>
                </div>

            </div>


            {showTimerMenu && screen === "log" && (
                <div style={{ position: "fixed", top: 70, right: 20, zIndex: 200, background: "var(--card)", borderRadius: 12, padding: 12, border: "1px solid var(--border2)", display: "flex", gap: 6 }}>
                    {[30, 60, 90, 120].map(s => (
                        <button key={s} onClick={() => { setIntervalSec(s); setShowTimerMenu(false); startTimer(s); }}
                            style={{
                                padding: "6px 12px", borderRadius: 10, fontSize: 12, fontWeight: 700, border: "none",
                                background: intervalSec === s ? "var(--text)" : "var(--card2)",
                                color: intervalSec === s ? "var(--bg)" : "var(--text2)"
                            }}>
                            {s < 60 ? `${s}s` : `${s / 60}m`}
                        </button>
                    ))}
                </div>
            )}



            {screen === "log" && (
                <div
                    onTouchStart={(e) => {
                        touchStartX.current = e.touches[0].clientX;
                        touchStartY.current = e.touches[0].clientY;
                    }}
                    onTouchEnd={(e) => {
                        if (touchStartX.current == null || touchStartY.current == null) return;

                        const endX = e.changedTouches[0].clientX;
                        const endY = e.changedTouches[0].clientY;

                        const dx = endX - touchStartX.current;
                        const dy = Math.abs(endY - touchStartY.current);

                        const startedFromLeftEdge = touchStartX.current <= 24;
                        const isRightSwipe = dx >= 80;
                        const isHorizontal = dy < 40;

                        if (startedFromLeftEdge && isRightSwipe && isHorizontal) {
                            setScreen("history");
                        }

                        touchStartX.current = null;
                        touchStartY.current = null;
                    }}
                >
                    <LogScreen
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
                        setTodayLabels={updateTodayLabels}
                        history={history}
                        logDate={logDate}
                        resetSession={() => {
                            setSessionEx(null);
                            setLogData({});
                            setExerciseUnits({});
                            save("draft_sessionEx", null);
                            save("draft_logData", {});
                            save("draft_exerciseUnits", {});
                        }}
                    />
                </div>
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

            {screen === "history" && (<HistoryScreen history={history} muscleEx={muscleEx} onEditHistory={handleEditHistory} onDeleteHistory={handleDeleteHistory} onDeleteDate={deleteAllHistoryForDate} unit={unit} onLogForDate={handleCalendarDayOpen} />)}

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
                    { id: "history", icon: "📊", label: "記録" },
                    { id: "friends", icon: "👥", label: "Friends" },
                    { id: "ai", icon: "🤖", label: "AI" },
                ].map(tab => (
                    <button key={tab.id} onClick={() => setScreen(tab.id)}
                        style={{ flex: 1, background: "none", color: screen === tab.id ? "var(--text)" : "var(--text3)", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "4px 0" }}>
                        <div style={{ fontSize: 20 }}>{tab.icon}</div>
                        <div style={{ fontSize: 9, fontWeight: screen === tab.id ? 700 : 400 }}>{tab.label}</div>
                    </button>
                ))}
            </div>

            {showOnboarding && <OnboardingOverlay onDone={() => setShowOnboarding(false)} />}
            <SummaryModal
                summary={summary}
                onClose={() => {
                    setSummary(null);
                    setScreen("history");
                }}
            />

            <Analytics />
        </div>
    );
}

