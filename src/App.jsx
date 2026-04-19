import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./utils/supabase";
import { load, save, storeW, KG_TO_LBS } from "./utils/helpers";
import { QUICK_LABELS, LABEL_COLORS, SUGGESTIONS } from "./constants/suggestions";
import { S, css } from "./utils/styles";
import { Analytics } from "@vercel/analytics/react";

// eslint-disable-next-line no-unused-vars
import Auth from "./components/Auth";

import { useAI } from "./hooks/useAI";
import { useSettings } from "./hooks/useSettings";

import LogScreen from "./components/LogScreen";
import FriendsScreen from "./components/FriendsScreen";
import HistoryScreen from "./components/HistoryScreen";
import AIScreen from "./components/AIScreen";

import AddExModal from "./components/modals/AddExModal";
import SummaryModal from "./components/modals/SummaryModal";
import OnboardingOverlay from "./components/OnboardingOverlay";
import {
    buildBaseExercises,
    getExSetsHelper,
} from "./utils/workoutHelpers";

import { useWorkout } from "./hooks/useWorkout";
import { useTimer } from "./hooks/useTimer";
import { useLogLogic } from "./hooks/useLogLogic";


const EX_TO_LABEL = {};
Object.entries(SUGGESTIONS).forEach(([label, names]) => {
    names.forEach((n) => {
        EX_TO_LABEL[n] = label;
    });
});

export default function GymApp() {
    // ─── State ────────────────────────────────────────
    // eslint-disable-next-line no-unused-vars
    const [user, setUser] = useState(null);

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setUser(session?.user ?? null);
        });
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
        });
        return () => subscription.unsubscribe();
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const ref = params.get("ref");
        if (ref) {
            localStorage.setItem("pendingFriendId", ref);
            setScreen("friends");
            setShowAuth(true);
        }
    }, []);


    const [muscleEx, setMuscleEx] = useState(() => load("routineEx", {}));
    const [history, setHistory] = useState(() => load("history", {}));


    const [screen, setScreen] = useState("history");
    const [showAuth, setShowAuth] = useState(false);

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
    const [sessionHistory, setSessionHistory] = useState(null);
    const [sessionEx, setSessionEx] = useState(() => load("draft_sessionEx", null));

    const [routineOrder, setRoutineOrder] = useState(() => load("routineOrder", {}));

    const getExSets = (ex) => {
        return getExSetsHelper({
            logData,
            history,
            name: ex.name,
            logDate,
        });
    };

    const [logDate, setLogDate] = useState(() =>
        load("draft_logDate", (() => {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        })())
    );

    const {
        addSet,
        removeSet,
        setField,
        saveLog,
    } = useLogLogic({
        logData,
        setLogData,
        history,
        setHistory,
        routineOrder,
        setRoutineOrder,
        todayLabels,
        sessionEx,
        getExSets,
        logDate,
    });

    // GymApp()の中に追加
    const {
        intervalSec, setIntervalSec,
        timerLeft,
        showTimerMenu, setShowTimerMenu,
        startTimer, stopTimer,
    } = useTimer();

    // eslint-disable-next-line no-unused-vars
    const { isDark, setIsDark, unit, setUnit, showOnboarding, completeOnboarding } = useSettings();


    const [exerciseUnits, setExerciseUnits] = useState(() => load("draft_exerciseUnits", {}));

    const touchStartX = useRef(null);
    const touchStartY = useRef(null);

    // 設定画面用モーダル
    const [showAddEx, setShowAddEx] = useState(false);
    const [addTarget, setAddTarget] = useState(null);
    const [newExName, setNewExName] = useState("");
    const [summary, setSummary] = useState(null);


    // ─── AI Coach ─────────────────────────────────────
    const { aiMsgs, aiInput, setAiInput, aiLoad, aiEnd, sendAI } = useAI(history);

    // ─── Persist ──────────────────────────────────────
    useEffect(() => { save("routineEx", muscleEx); }, [muscleEx]);
    useEffect(() => { save("history", history); }, [history]);
    useEffect(() => {
        if (!user) return;
        const saveToSupabase = async () => {
            await supabase.from("workouts").upsert({
                user_id: user.id,
                date: new Date().toISOString().split("T")[0],
                data: history,
            }, { onConflict: "user_id,date" });
        };
        saveToSupabase();
    }, [history, user]);



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

    useEffect(() => { save("routineOrder", routineOrder); }, [routineOrder]);

    useEffect(() => {
        const d = new Date();
        const today =
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

        setLogDate(today);
        setScreen("history");
    }, []);

    useEffect(() => {
        if (screen !== "log") {
            setSessionHistory(null);
            return;
        }

        const snapshot = {};
        Object.entries(history).forEach(([name, recs]) => {
            const filtered = recs.filter((r) => r.date !== logDate);
            if (filtered.length) snapshot[name] = filtered;
        });

        setSessionHistory(snapshot);
    }, [screen, logDate, history]);



    // ─── Per-exercise unit ────────────────────────────
    const getExUnit = useCallback((name) => {
        return exerciseUnits[name] ?? unit;
    }, [exerciseUnits, unit]);

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
    const dayColor = LABEL_COLORS[todayLabels[0]] || null;

    const baseExercises = buildBaseExercises({
        todayLabels,
        muscleEx,
        routineOrder,
    });

    const exercises = sessionEx !== null ? sessionEx : baseExercises;

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



    // ─── Log data ─────────────────────────────────────





    const { getPrev, getPR, copySetDown, copyRepDown } = useWorkout({
        history,
        sessionHistory,
        setLogData,
        getExSets,
    });


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
            save("draft_logData", n);
            save("draft_logDate", logDate);
            return n;
        });

        setExerciseUnits(p => {
            const n = { ...p };
            delete n[targetName];
            save("draft_exerciseUnits", n);
            save("draft_logDate", logDate);
            return n;
        });

        setHistory(prev => {
            if (!prev[targetName]) return prev;

            const next = { ...prev };
            const filtered = (next[targetName] || []).filter(r => r.date !== logDate);

            if (filtered.length > 0) {
                next[targetName] = filtered;
            } else {
                delete next[targetName];
            }

            return next;
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

        const label = labelOverride || todayLabels[0];
        if (!label) return;

        setMuscleEx((prev) => {
            const next = { ...prev };
            const list = next[label] || [];

            if (!list.find((e) => e.name === trimmed)) {
                next[label] = [...list, { id: Date.now(), name: trimmed }];
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
            addExToSession(name, labelOverride);
        }
    };

    const quickAddToSession = (name, remove, labelOverride) => {
        quickAdd(name, remove, labelOverride);
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

    const handleDeleteHistory = (exName, historyIdx, recordDate, setIdx) => {
        setHistory(prev => {
            const recs = [...(prev[exName] || [])];
            const idx = historyIdx !== undefined
                ? historyIdx
                : recs.findIndex(r => r.date === recordDate);

            if (idx < 0 || idx >= recs.length) return prev;

            // セット単位削除
            if (setIdx !== undefined) {
                const target = recs[idx];
                const nextSets = (target.sets || []).filter((_, i) => i !== setIdx);

                if (nextSets.length > 0) {
                    recs[idx] = {
                        ...target,
                        sets: nextSets,
                        weight: Number(nextSets[0]?.weight || 0),
                        reps: Number(nextSets[0]?.reps || 0),
                    };
                    return { ...prev, [exName]: recs };
                }

                // セット全部消えたらその種目のその日記録ごと削除
                recs.splice(idx, 1);

                if (!recs.length) {
                    const next = { ...prev };
                    delete next[exName];
                    return next;
                }

                return { ...prev, [exName]: recs };
            }

            // 記録単位削除
            recs.splice(idx, 1);

            if (!recs.length) {
                const next = { ...prev };
                delete next[exName];
                return next;
            }

            return { ...prev, [exName]: recs };
        });

        // ===== draft側も更新する =====
        const draftDate = load("draft_logDate", "");
        if (draftDate !== recordDate) return;

        const draftLog = load("draft_logData", {});
        const draftSession = load("draft_sessionEx", null);
        const draftUnits = load("draft_exerciseUnits", {});

        // その種目のdraftが無ければ終了
        if (!draftLog[exName]) return;

        let nextDraftLog = { ...draftLog };

        if (setIdx !== undefined) {
            const nextSets = (nextDraftLog[exName] || []).filter((_, i) => i !== setIdx);

            if (nextSets.length > 0) {
                nextDraftLog[exName] = nextSets;
            } else {
                delete nextDraftLog[exName];
            }
        } else {
            delete nextDraftLog[exName];
        }

        let nextDraftSession = draftSession;
        let nextDraftUnits = draftUnits;

        // その種目のセットが0になったら sessionEx / units からも消す
        if (!nextDraftLog[exName]) {
            if (Array.isArray(draftSession)) {
                nextDraftSession = draftSession.filter((ex) => ex.name !== exName);
            }

            if (draftUnits[exName] !== undefined) {
                nextDraftUnits = { ...draftUnits };
                delete nextDraftUnits[exName];
            }
        }

        save("draft_logData", nextDraftLog);
        save("draft_sessionEx", nextDraftSession);
        save("draft_exerciseUnits", nextDraftUnits);

        // 今まさにその日を編集中なら画面状態にも反映
        if (logDate === recordDate) {
            setLogData(nextDraftLog);
            setSessionEx(nextDraftSession);
            setExerciseUnits(nextDraftUnits);
        }
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

        // その日が今の編集中なら画面上の状態も消す
        if (logDate === targetDate) {
            setTodayLabels([]);
            setLogData({});
            setSessionEx(null);
            setExerciseUnits({});
        }

        // その日のdraftも消す
        const draftDate = load("draft_logDate", "");
        if (draftDate === targetDate) {
            save("draft_todayLabels", []);
            save("draft_logData", {});
            save("draft_sessionEx", null);
            save("draft_exerciseUnits", {});
            save("draft_logDate", "");
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
        <>
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

                {screen === "analytics" && (
                    <div style={{ padding: 20 }}>
                        <div style={{ fontSize: 14, color: "var(--text2)", marginBottom: 16 }}>種目を選択</div>
                        <div style={{ fontSize: 13, color: "var(--text3)", textAlign: "center", marginTop: 40 }}>
                            🚧 準備中
                        </div>
                    </div>
                )}


                {screen === "friends" && (
                    <FriendsScreen
                        history={history}
                        user={user}
                        onLogin={() => setShowAuth(true)}
                        onLogout={async () => {
                            await supabase.auth.signOut();
                        }}

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
                        { id: "analytics", icon: "📈", label: "分析" },
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

                {showOnboarding && <OnboardingOverlay onDone={() => completeOnboarding()} />}
                <SummaryModal
                    summary={summary}
                    onClose={() => {
                        setSummary(null);
                        setScreen("history");
                    }}
                />
                {showAuth && (
                    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "var(--bg)", zIndex: 100 }}>
                        <Auth onClose={() => setShowAuth(false)} isDark={isDark} />
                    </div>
                )}

                <Analytics />
            </div>
        </>
    );
}

