import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./utils/supabase";
import {
    load,
    save,
    storeW,
    KG_TO_LBS,
    buildHistoryFromWorkoutRows,
    mergeHistoryMaps,
    sanitizeHistoryRecord,
    sanitizeWorkoutSets,
} from "./utils/helpers";
import { QUICK_LABELS, LABEL_COLORS, SUGGESTIONS } from "./constants/suggestions";
import { S, css } from "./utils/styles";
import { Analytics } from "@vercel/analytics/react";
import AnalyticsScreen from "./components/AnalyticsScreen";

// eslint-disable-next-line no-unused-vars
import Auth from "./components/Auth";

import { useAI } from "./hooks/useAI";
import { useSettings } from "./hooks/useSettings";

import LogScreen from "./components/LogScreen";
import FriendsScreen from "./components/FriendsScreen";
import HistoryScreen from "./components/HistoryScreen";
import AIScreen from "./components/AIScreen";
import PhotoScreen from "./components/PhotoScreen";
import AppHeader from "./components/layout/AppHeader";
import BottomNav from "./components/layout/BottomNav";
import PushPromptModal from "./components/PushPromptModal";

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
import {
    enablePushNotificationsForUser,
    getNotificationPermission,
    getPushSupportState,
    syncPushSubscriptionState,
} from "./lib/pushNotifications";


const EX_TO_LABEL = {};
Object.entries(SUGGESTIONS).forEach(([label, names]) => {
    names.forEach((n) => {
        EX_TO_LABEL[n] = label;
    });
});

const HISTORY_OWNER_KEY = "historyOwnerUserId";
const getUserHistoryCacheKey = (userId) => `history_cache_${userId}`;

const isPlainObject = (value) =>
    !!value && typeof value === "object" && !Array.isArray(value);

const serializeHistoryMap = (historyMap) => JSON.stringify(historyMap || {});
const PUSH_PROMPT_LATER_KEY = "pushPromptLaterDate";

const persistHistoryForUser = (userId, nextHistory) => {
    save("history", nextHistory);

    if (userId) {
        save(getUserHistoryCacheKey(userId), nextHistory);
        save(HISTORY_OWNER_KEY, userId);
    }
};

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
    const [history, setHistory] = useState(() => mergeHistoryMaps(load("history", {})));
    const [manualBests, setManualBests] = useState([]);
    const [historySyncReady, setHistorySyncReady] = useState(false);
    const [customBodyParts, setCustomBodyParts] = useState(() => {
        const saved = load("customBodyParts", []);
        return [...new Set((saved || []).map((part) => String(part || "").trim()).filter(Boolean))];
    });
    const [hiddenBodyParts, setHiddenBodyParts] = useState(() => {
        const saved = load("hiddenBodyParts", []);
        return [...new Set((saved || []).map((part) => String(part || "").trim()).filter(Boolean))];
    });


    const [screen, setScreen] = useState("history");
    const [showAuth, setShowAuth] = useState(false);
    const [showPushPrompt, setShowPushPrompt] = useState(false);
    const [pushPromptBusy, setPushPromptBusy] = useState(false);
    const [pushPromptMessage, setPushPromptMessage] = useState("");
    const [pushStatus, setPushStatus] = useState({
        enabled: false,
        permission: getNotificationPermission(),
        support: getPushSupportState(),
    });

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
    const latestUserIdRef = useRef(null);
    const historySaveQueueRef = useRef(Promise.resolve());
    const pendingWorkoutNotificationRef = useRef(null);

    // 設定画面用モーダル
    const [showAddEx, setShowAddEx] = useState(false);
    const [addTarget, setAddTarget] = useState(null);
    const [newExName, setNewExName] = useState("");
    const [summary, setSummary] = useState(null);


    // ─── AI Coach ─────────────────────────────────────
    const { aiMsgs, aiInput, setAiInput, aiLoad, aiEnd, sendAI } = useAI(history);

    useEffect(() => {
        latestUserIdRef.current = user?.id ?? null;
    }, [user?.id]);

    // ─── Persist ──────────────────────────────────────
    useEffect(() => { save("routineEx", muscleEx); }, [muscleEx]);
    useEffect(() => {
        persistHistoryForUser(user?.id, history);
    }, [history, user]);
    useEffect(() => { save("customBodyParts", customBodyParts); }, [customBodyParts]);
    useEffect(() => { save("hiddenBodyParts", hiddenBodyParts); }, [hiddenBodyParts]);

    useEffect(() => {
        let isActive = true;

        const syncPushPromptState = async () => {
            if (!user?.id) {
                if (isActive) {
                    setShowPushPrompt(false);
                    setPushPromptMessage("");
                    setPushStatus({
                        enabled: false,
                        permission: getNotificationPermission(),
                        support: getPushSupportState(),
                    });
                }
                return;
            }

            const support = getPushSupportState();
            const permission = getNotificationPermission();
            const todayStr = new Date().toISOString().split("T")[0];
            const laterDate = load(PUSH_PROMPT_LATER_KEY, "");

            try {
                let nextStatus = {
                    enabled: false,
                    permission,
                    support,
                };

                if (support.supported) {
                    nextStatus = await syncPushSubscriptionState(user.id);
                }

                if (!isActive) return;

                setPushStatus(nextStatus);

                const shouldShow =
                    screen === "history" &&
                    !showAuth &&
                    !nextStatus.enabled &&
                    laterDate !== todayStr;

                setShowPushPrompt(shouldShow);
            } catch (error) {
                if (!isActive) return;

                console.error("push prompt state sync failed", {
                    error,
                    message: error?.message,
                    userId: user?.id,
                });

                setPushStatus({
                    enabled: false,
                    permission,
                    support,
                });
                setShowPushPrompt(screen === "history" && !showAuth && laterDate !== todayStr);
            }
        };

        syncPushPromptState();

        return () => {
            isActive = false;
        };
    }, [user?.id, screen, showAuth]);

    const dismissPushPromptForToday = useCallback(() => {
        const todayStr = new Date().toISOString().split("T")[0];
        save(PUSH_PROMPT_LATER_KEY, todayStr);
        setShowPushPrompt(false);
        setPushPromptMessage("");
    }, []);

    const enablePushFromPrompt = useCallback(async () => {
        if (!user?.id || pushPromptBusy) return;

        setPushPromptBusy(true);
        setPushPromptMessage("");

        try {
            const result = await enablePushNotificationsForUser(user.id);

            setPushStatus({
                enabled: result.enabled,
                permission: result.permission,
                support: result.support,
            });

            if (result.enabled) {
                save(PUSH_PROMPT_LATER_KEY, "");
                setShowPushPrompt(false);
                setPushPromptMessage("");
                return;
            }

            setPushPromptMessage(result.message || "");
        } catch (error) {
            console.error("push prompt enable failed", {
                error,
                message: error?.message,
                userId: user?.id,
            });
            setPushPromptMessage(error?.message || "通知の有効化に失敗しました。");
        } finally {
            setPushPromptBusy(false);
        }
    }, [pushPromptBusy, user?.id]);

    useEffect(() => {
        let isActive = true;

        const syncHistoryFromSupabase = async () => {
            if (!user?.id) {
                if (isActive) setHistorySyncReady(true);
                return;
            }

            if (isActive) setHistorySyncReady(false);

            const rawLocalHistory = load("history", {});
            const localOwnerUserId = load(HISTORY_OWNER_KEY, null);
            const scopedLocalHistory = load(getUserHistoryCacheKey(user.id), null);

            let localMergeCandidate = {};

            if (isPlainObject(scopedLocalHistory)) {
                localMergeCandidate = scopedLocalHistory;
            } else if (!localOwnerUserId || localOwnerUserId === user.id) {
                localMergeCandidate = rawLocalHistory;
            } else {
                save(getUserHistoryCacheKey(localOwnerUserId), rawLocalHistory);
            }

            try {
                const { data, error } = await supabase
                    .from("workouts")
                    .select("date, data")
                    .eq("user_id", user.id)
                    .order("date", { ascending: true });

                if (error) throw error;

                const remoteHistory = buildHistoryFromWorkoutRows(data);
                const mergedHistory = mergeHistoryMaps(remoteHistory, localMergeCandidate);

                if (!isActive) return;

                setHistory(mergedHistory);
                persistHistoryForUser(user.id, mergedHistory);
            } catch (error) {
                console.error("history sync load failed", error);

                if (!isActive) return;

                setHistory(localMergeCandidate);
                persistHistoryForUser(user.id, localMergeCandidate);
            } finally {
                if (isActive) setHistorySyncReady(true);
            }
        };

        syncHistoryFromSupabase();

        return () => {
            isActive = false;
        };
    }, [user]);

    useEffect(() => {
        if (!user || !historySyncReady) return;
        const currentUserId = user.id;
        const localHistorySnapshot = mergeHistoryMaps(history);
        const pendingWorkoutNotification = pendingWorkoutNotificationRef.current;

        historySaveQueueRef.current = historySaveQueueRef.current
            .catch(() => {})
            .then(async () => {
                if (latestUserIdRef.current !== currentUserId) return;

                const { data, error } = await supabase
                    .from("workouts")
                    .select("date, data")
                    .eq("user_id", currentUserId)
                    .order("date", { ascending: true });

                if (error) throw error;
                if (latestUserIdRef.current !== currentUserId) return;

                const remoteHistory = buildHistoryFromWorkoutRows(data);
                const mergedHistory = mergeHistoryMaps(remoteHistory, localHistorySnapshot);

                await supabase.from("workouts").upsert({
                    user_id: currentUserId,
                    date: new Date().toISOString().split("T")[0],
                    data: mergedHistory,
                }, { onConflict: "user_id,date" });

                if (latestUserIdRef.current !== currentUserId) return;

                persistHistoryForUser(currentUserId, mergedHistory);
                setHistory((prev) => {
                    const reconciledHistory = mergeHistoryMaps(mergedHistory, prev);
                    return serializeHistoryMap(reconciledHistory) === serializeHistoryMap(prev)
                        ? prev
                        : reconciledHistory;
                });

                const todayStr = new Date().toISOString().split("T")[0];
                const shouldSendWorkoutNotification =
                    pendingWorkoutNotification &&
                    pendingWorkoutNotification.id === pendingWorkoutNotificationRef.current?.id &&
                    pendingWorkoutNotification.userId === currentUserId &&
                    pendingWorkoutNotification.logDate === logDate &&
                    logDate === todayStr &&
                    screen === "log";

                if (shouldSendWorkoutNotification) {
                    pendingWorkoutNotificationRef.current = null;

                    try {
                        const {
                            data: { session },
                        } = await supabase.auth.getSession();
                        const accessToken = session?.access_token;

                        if (accessToken) {
                            fetch("/api/notify-workout-save", {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                    Authorization: `Bearer ${accessToken}`,
                                },
                                body: JSON.stringify({ workoutDate: logDate }),
                            }).catch((error) => {
                                console.error("notify workout save request failed", error);
                            });
                        }
                    } catch (error) {
                        console.error("notify workout save setup failed", error);
                    }
                }
            })
            .catch((error) => {
                console.error("history sync save failed", error);
            });
    }, [history, user, historySyncReady, logDate, screen]);

    useEffect(() => {
        let isActive = true;

        const loadManualBests = async () => {
            if (!user?.id) {
                if (isActive) setManualBests([]);
                return;
            }

            const { data, error } = await supabase
                .from("manual_bests")
                .select("id, exercise_name, weight, reps, best_date, body_part, created_at")
                .eq("user_id", user.id)
                .order("created_at", { ascending: false });

            if (error) {
                console.error(error);
                if (isActive) setManualBests([]);
                return;
            }

            if (isActive) {
                setManualBests(data || []);
            }
        };

        loadManualBests();

        return () => {
            isActive = false;
        };
    }, [user]);



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
        if (!new URLSearchParams(window.location.search).get("ref")) {
            setScreen("history");
        }
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
        pendingWorkoutNotificationRef.current = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            userId: user?.id || null,
            logDate,
        };

        setHistory((prev) => {
            const nh = { ...prev };

            Object.keys(nh).forEach((name) => {
                nh[name] = (nh[name] || []).filter((r) => r.date !== logDate);
                if (nh[name].length === 0) delete nh[name];
            });

            exercises.forEach((ex, index) => {
                const sets = logData[ex.name] || [];
                const exUnit = getExUnit(ex.name);
                const stored = sanitizeWorkoutSets(sets.map((s) => ({
                    ...s,
                    weight: storeW(s.weight, exUnit),
                })), { allowBodyweight: true });

                if (!stored.length) return;

                if (!nh[ex.name]) nh[ex.name] = [];

                nh[ex.name].push({
                    sets: stored,
                    weight: stored[0].weight === "BW" ? "BW" : Number(stored[0].weight),
                    reps: Number(stored[0].reps),
                    date: logDate,
                    order: index,
                });
            });

            return nh;
        });
    }, [exercises, logData, logDate, getExUnit, user?.id]); // ← 依存配列

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

    // ─── Log data ─────────────────────────────────────





    const { getPrev, getPR, getPreviousPR, copySetDown, copyRepDown } = useWorkout({
        history,
        manualBests,
        sessionHistory,
        setLogData,
        getExSets,
        getExUnit,
        KG_TO_LBS,
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

        // muscleExも更新
        setMuscleEx((p) => {
            const next = { ...p };
            Object.keys(next).forEach((label) => {
                next[label] = next[label].map((e) =>
                    e.name === oldEx.name ? { ...e, name: trimmed } : e
                );
            });
            return next;
        });

    };

    const quickAdd = (name, remove, labelOverride) => {
        const tgts = labelOverride
            ? [labelOverride]
            : Array.isArray(addTarget)
                ? addTarget
                : (addTarget ? [addTarget] : []);

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
        } else {
            // sessionExからも削除
            setSessionEx(prev => prev ? prev.filter(ex => ex.name !== name) : prev);
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
            const sanitizedRecord = sanitizeHistoryRecord(updatedRecord, { allowBodyweight: true });

            if (!sanitizedRecord) return prev;

            if (idx >= 0 && idx < recs.length) {
                recs[idx] = sanitizedRecord;
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
                const nextSets = sanitizeWorkoutSets(
                    (target.sets || []).filter((_, i) => i !== setIdx),
                    { allowBodyweight: true }
                );

                if (nextSets.length > 0) {
                    recs[idx] = {
                        ...target,
                        sets: nextSets,
                        weight: nextSets[0]?.weight === "BW" ? "BW" : Number(nextSets[0]?.weight || 0),
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
                    <button onClick={() => setScreen("history")} style={S.pillBtn}>完了</button>
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
                {showAddEx && <AddExModal name={newExName} setName={setNewExName} onConfirm={confirmAdd} onClose={() => setShowAddEx(false)} target={addTarget} onQuickAdd={quickAdd} history={history} />}
            </div>
        );
    }

    // ─── Main render ──────────────────────────────────
    const headerTitle =
        screen === "log" ? "Log"
            : screen === "photos" ? "比較"
                : screen === "analytics" ? "PR"
                : screen === "friends" ? "Friends"
                    : screen === "ai" ? "AI Coach"
                        : "記録";

    const bottomTabs = [
        { id: "history", icon: "📊", label: "記録" },
        { id: "photos", icon: "📷", label: "比較" },
        { id: "analytics", icon: "📈", label: "PR" },
        { id: "friends", icon: "👥", label: "Friends" },
        { id: "ai", icon: "🤖", label: "AI" },
    ];

    return (
        <>
            <div className={isDark ? "" : "theme-light"} style={S.root}>
                <style>{css}</style>

                <AppHeader
                    title={headerTitle}
                    showLogTimer={screen === "log"}
                    timerLeft={timerLeft}
                    onTimerClick={() => {
                        if (timerLeft !== null) {
                            stopTimer();
                        } else {
                            setShowTimerMenu(p => !p);
                        }
                    }}
                    isDark={isDark}
                    onToggleTheme={() => setIsDark(p => !p)}
                />


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
                            user={user}
                            manualBests={manualBests}
                            customBodyParts={customBodyParts}
                            hiddenBodyParts={hiddenBodyParts}
                            onAddCustomBodyPart={(bodyPart) => {
                                setCustomBodyParts((prev) =>
                                    prev.includes(bodyPart) ? prev : [...prev, bodyPart]
                                );
                            }}
                            onUpdateHiddenBodyParts={setHiddenBodyParts}
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
                            getPreviousPR={getPreviousPR}
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
                    <AnalyticsScreen history={history} manualBests={manualBests} muscleEx={muscleEx} />

                )}

                {screen === "photos" && (
                    <PhotoScreen user={user} />
                )}


                {screen === "friends" && (
                    <FriendsScreen
                        history={history}
                        manualBests={manualBests}
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

                {screen === "history" && (
                    <HistoryScreen
                        history={history}
                        muscleEx={muscleEx}
                        hiddenBodyParts={hiddenBodyParts}
                        onEditHistory={handleEditHistory}
                        onDeleteHistory={handleDeleteHistory}
                        onDeleteDate={deleteAllHistoryForDate}
                        unit={unit}
                        onLogForDate={handleCalendarDayOpen}
                        user={user}
                        manualBests={manualBests}
                        customBodyParts={customBodyParts}
                        onAddManualBest={(best) => {
                            setManualBests((prev) => [best, ...prev]);
                        }}
                        onUpdateManualBest={(updatedBest) => {
                            setManualBests((prev) =>
                                prev.map((item) => (item.id === updatedBest.id ? updatedBest : item))
                            );
                        }}
                        onDeleteManualBest={(id) => {
                            setManualBests((prev) => prev.filter((item) => item.id !== id));
                        }}
                        onAddCustomBodyPart={(bodyPart) => {
                            setCustomBodyParts((prev) =>
                                prev.includes(bodyPart) ? prev : [...prev, bodyPart]
                            );
                        }}
                    />
                )}

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

                <BottomNav tabs={bottomTabs} activeTab={screen} onSelectTab={setScreen} />

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

                <PushPromptModal
                    isOpen={showPushPrompt}
                    title={
                        pushStatus.permission === "denied"
                            ? "通知を有効にできません"
                            : pushStatus.support.supported
                                ? "通知をオンにしますか？"
                                : "通知を使うには準備が必要です"
                    }
                    body={
                        pushStatus.permission === "denied"
                            ? "iPhoneの設定でIRON LOGの通知を許可すると、友達の記録やトレーニングのリマインドを受け取れます。"
                            : pushStatus.support.supported
                                ? "友達の記録や、トレーニングのリマインドをお知らせします。"
                                : pushStatus.support.message || "この環境では通知を利用できません。"
                    }
                    note={
                        pushPromptMessage ||
                        "iPhoneではホーム画面に追加したアプリで通知を受け取れます。"
                    }
                    onPrimary={enablePushFromPrompt}
                    onSecondary={dismissPushPromptForToday}
                    busy={pushPromptBusy}
                    showPrimary={pushStatus.support.supported && pushStatus.permission !== "denied"}
                />

                <Analytics />
            </div>
        </>
    );
}
