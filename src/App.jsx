import { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { isSupabaseConfigured, missingSupabaseEnvKeys, supabase, supabaseConfigError } from "./utils/supabase";
import {
    load,
    save,
    storeW,
    KG_TO_LBS,
    buildHistoryFromWorkoutRows,
    calc1RM,
    formatDateKey,
    getValidWorkoutDatesFromHistory,
    hasMeaningfulPRIncrease,
    hasValidWorkoutOnDate,
    mergeHistoryMaps,
    PR_UPDATE_TOLERANCE_KG,
    sanitizeHistoryRecord,
    sanitizeWorkoutSets,
} from "./utils/helpers";
import { QUICK_LABELS, LABEL_COLORS, SUGGESTIONS } from "./constants/suggestions";
import { S, css } from "./utils/styles";
import { Analytics } from "@vercel/analytics/react";
import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import AnalyticsScreen from "./components/AnalyticsScreen";
import PhotoScreen from "./components/PhotoScreen";
// eslint-disable-next-line no-unused-vars
import Auth from "./components/Auth";

import { useAI } from "./hooks/useAI";
import { useSettings } from "./hooks/useSettings";

import LogScreen from "./components/LogScreen";
import FriendsScreen from "./components/FriendsScreen";
import HistoryScreen from "./components/HistoryScreen";
import HomeScreen from "./components/HomeScreen";
import AIScreen from "./components/AIScreen";
import AppHeader from "./components/layout/AppHeader";
import BottomNav from "./components/layout/BottomNav";
import PushPromptModal from "./components/PushPromptModal";
import SplashScreen from "./components/SplashScreen";

import AddExModal from "./components/modals/AddExModal";
import WorkoutDaySummaryModal from "./components/modals/WorkoutDaySummaryModal";
import OnboardingOverlay from "./components/OnboardingOverlay";
import {
    buildBaseExercises,
    getExSetsHelper,
} from "./utils/workoutHelpers";
import {
    buildWorkoutSessionPayloadFromDraft,
    buildWorkoutSessionPayloadFromHistory,
} from "./utils/workoutSessions";
import { getPrimaryDefaultBodyPartLabel } from "./utils/bodyPartClassification";
import WorkoutSessionShareModal from "./components/modals/WorkoutSessionShareModal";
import SettingsModal from "./components/modals/SettingsModal";
import {
    buildWorkoutDaySummary,
    buildWorkoutDaySummaryPrKey,
} from "./utils/workoutDaySummary";

import { useWorkout } from "./hooks/useWorkout";
import { useTimer } from "./hooks/useTimer";
import { useLogLogic } from "./hooks/useLogLogic";
import {
    enablePushNotificationsForUser,
    getNotificationPermission,
    getPushSupportState,
    syncPushSubscriptionState,
} from "./lib/pushNotifications";
import { normalizeExerciseName } from "./utils/exerciseName";
import { isNativeApp, isNativeOAuthCallbackUrl } from "./utils/oauth";
import {
    clearWorkoutTimerState,
    computeWorkoutDisplayElapsedSec,
    createEmptyWorkoutTimerState,
    getWorkoutAutoFinishState,
    getWorkoutTimerPersistence,
    getWorkoutTimerStatus,
    normalizeWorkoutTimerState,
    persistWorkoutTimerState,
    readWorkoutTimerState,
} from "./utils/workoutTimer";


const debugLog = (...args) => {
    if (process.env.NODE_ENV !== "production") console.debug(...args);
};

const EX_TO_LABEL = {};
Object.entries(SUGGESTIONS).forEach(([label, names]) => {
    names.forEach((n) => {
        EX_TO_LABEL[n] = label;
    });
});

const getExerciseRecordBodyPart = (exercise, fallbackLabel) =>
    exercise?.bodyPart || exercise?.label || fallbackLabel || EX_TO_LABEL[exercise?.name] || null;

const HISTORY_OWNER_KEY = "historyOwnerUserId";
const getUserHistoryCacheKey = (userId) => `history_cache_${userId}`;
const getHistoryDeleteMarkersKey = (userId) => `historyDeleteMarkers_${userId}`;
const EXERCISE_BODY_PART_OVERRIDES_KEY = "exerciseBodyPartOverrides";
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

const createEmptyHistoryDeleteMarkers = () => ({
    dates: [],
    records: [],
});

const normalizeHistoryDeleteMarkers = (markers) => {
    const base = createEmptyHistoryDeleteMarkers();
    if (!isPlainObject(markers)) return base;

    return {
        dates: [...new Set((markers.dates || []).map((date) => String(date || "")).filter(Boolean))],
        records: [...new Set(
            (markers.records || [])
                .map((key) => {
                    const rawKey = String(key || "");
                    if (!rawKey) return "";
                    const [date, exerciseName = ""] = rawKey.split("::");
                    return buildHistoryRecordDeleteKey(date, exerciseName);
                })
                .filter(Boolean)
        )],
    };
};

const buildHistoryRecordDeleteKey = (date, exerciseName) =>
    `${String(date || "").slice(0, 10)}::${normalizeExerciseName(exerciseName)}`;

const applyHistoryDeleteMarkers = (historyMap, markers) => {
    const normalizedMarkers = normalizeHistoryDeleteMarkers(markers);
    if (!normalizedMarkers.dates.length && !normalizedMarkers.records.length) {
        return historyMap;
    }

    const deletedDates = new Set(normalizedMarkers.dates.map((date) => String(date || "").slice(0, 10)));
    const deletedRecords = new Set(normalizedMarkers.records);
    const next = {};

    Object.entries(historyMap || {}).forEach(([exerciseName, records]) => {
        const filtered = (records || []).filter((record) => {
            const recordDate = String(record?.date || "").slice(0, 10);
            if (!recordDate) return false;
            if (deletedDates.has(recordDate)) return false;
            if (deletedRecords.has(buildHistoryRecordDeleteKey(recordDate, exerciseName))) return false;
            return true;
        });

        if (filtered.length > 0) {
            next[exerciseName] = filtered;
        }
    });

    return next;
};

const attachWorkoutDurationsToHistory = (historyMap, workoutRows = []) => {
    const durationByDate = {};
    (workoutRows || []).forEach((row) => {
        const date = String(row?.date || "").slice(0, 10);
        const durationSec = Math.floor(Number(row?.duration_sec) || 0);
        if (date && durationSec > 0 && durationSec < 86400) {
            durationByDate[date] = Math.max(durationByDate[date] || 0, durationSec);
        }
    });

    if (!Object.keys(durationByDate).length) return historyMap;

    const next = {};
    Object.entries(historyMap || {}).forEach(([exerciseName, records]) => {
        next[exerciseName] = (records || []).map((record) => {
            const recordDate = String(record?.date || "").slice(0, 10);
            const durationSec = durationByDate[recordDate];
            if (!durationSec) return record;

            const durationMinutes = Math.max(1, Math.round(durationSec / 60));
            return {
                ...record,
                duration_sec: durationSec,
                durationSec,
                durationMinutes,
                elapsedMinutes: durationMinutes,
            };
        });
    });

    return next;
};

const attachWorkoutDurationToHistoryDate = (historyMap, targetDate, durationSecValue) => {
    const normalizedDate = String(targetDate || "").slice(0, 10);
    const durationSec = Math.floor(Number(durationSecValue) || 0);
    if (!normalizedDate || durationSec <= 0) return historyMap || {};

    const durationMinutes = Math.max(1, Math.round(durationSec / 60));
    const next = {};
    Object.entries(historyMap || {}).forEach(([exerciseName, records]) => {
        next[exerciseName] = (records || []).map((record) => (
            String(record?.date || "").slice(0, 10) === normalizedDate
                ? {
                    ...record,
                    duration_sec: durationSec,
                    durationSec,
                    durationMinutes,
                    elapsedMinutes: durationMinutes,
                }
                : record
        ));
    });

    return next;
};

const getHistoryDurationSecForDate = (historyMap, targetDate) => {
    const normalizedDate = String(targetDate || "").slice(0, 10);
    if (!normalizedDate) return 0;

    let durationSec = 0;
    Object.values(historyMap || {}).forEach((records) => {
        (records || []).forEach((record) => {
            if (String(record?.date || "").slice(0, 10) !== normalizedDate) return;
            const candidates = [
                Number(record?.duration_sec),
                Number(record?.durationSec),
                Number(record?.durationMinutes) * 60,
                Number(record?.elapsedMinutes) * 60,
            ];
            candidates.forEach((value) => {
                if (Number.isFinite(value) && value > durationSec) {
                    durationSec = Math.floor(value);
                }
            });
        });
    });

    return durationSec;
};

export default function GymApp() {
    const getTodayKey = useCallback(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }, []);

    const getDraftKey = useCallback((baseKey, dateStr) => `${baseKey}_${dateStr}`, []);

    const loadDraftForDate = useCallback((dateStr) => {
        const legacyDraftDate = load("draft_logDate", "");
        const useLegacyFallback = legacyDraftDate === dateStr;
        const legacyLogData = useLegacyFallback ? load("draft_logData", {}) : {};
        const datedLogData = load(getDraftKey("draft_logData", dateStr), null);
        const countDraftSets = (draftLogData) => Object.values(draftLogData || {})
            .reduce((count, sets) => count + (Array.isArray(sets) ? sets.length : 0), 0);
        const logData =
            datedLogData === null
                ? legacyLogData
                : countDraftSets(datedLogData) < countDraftSets(legacyLogData)
                    ? legacyLogData
                    : datedLogData;

        return {
            todayLabels: load(
                getDraftKey("draft_todayLabels", dateStr),
                useLegacyFallback ? load("draft_todayLabels", []) : []
            ),
            logData,
            sessionEx: load(
                getDraftKey("draft_sessionEx", dateStr),
                useLegacyFallback ? load("draft_sessionEx", null) : null
            ),
            exerciseUnits: load(
                getDraftKey("draft_exerciseUnits", dateStr),
                useLegacyFallback ? load("draft_exerciseUnits", {}) : {}
            ),
        };
    }, [getDraftKey]);

    const hasDraftContent = useCallback((draft) => (
        draft.sessionEx !== null ||
        Object.keys(draft.logData || {}).length > 0 ||
        Object.keys(draft.exerciseUnits || {}).length > 0 ||
        (draft.todayLabels || []).length > 0
    ), []);

    const makeDefaultDraftSets = useCallback(() => ([
        { weight: "", reps: "", done: false },
        { weight: "", reps: "", done: false },
        { weight: "", reps: "", done: false },
    ]), []);

    const saveDraftForDate = useCallback((dateStr, draft) => {
        if (!dateStr) return;

        save(getDraftKey("draft_todayLabels", dateStr), draft.todayLabels || []);
        save(getDraftKey("draft_logData", dateStr), draft.logData || {});
        save(getDraftKey("draft_sessionEx", dateStr), draft.sessionEx ?? null);
        save(getDraftKey("draft_exerciseUnits", dateStr), draft.exerciseUnits || {});

        save("draft_todayLabels", draft.todayLabels || []);
        save("draft_logData", draft.logData || {});
        save("draft_sessionEx", draft.sessionEx ?? null);
        save("draft_exerciseUnits", draft.exerciseUnits || {});
        save("draft_logDate", dateStr);
    }, [getDraftKey]);

    const clearDraftForDate = useCallback((dateStr) => {
        if (!dateStr) return;

        [
            getDraftKey("draft_todayLabels", dateStr),
            getDraftKey("draft_logData", dateStr),
            getDraftKey("draft_sessionEx", dateStr),
            getDraftKey("draft_exerciseUnits", dateStr),
            getDraftKey("draft_exercises", dateStr),
        ].forEach((key) => {
            try {
                localStorage.removeItem(key);
            } catch {}
        });

        if (load("draft_logDate", "") === dateStr) {
            save("draft_todayLabels", []);
            save("draft_logData", {});
            save("draft_sessionEx", null);
            save("draft_exerciseUnits", {});
            save("draft_logDate", "");
        }
    }, [getDraftKey]);

    const removeHistoryDate = useCallback((historyMap, targetDate) => {
        const normalizedDate = String(targetDate || "").slice(0, 10);
        if (!normalizedDate) return historyMap || {};

        const next = {};
        Object.entries(historyMap || {}).forEach(([exName, recs]) => {
            const filtered = (recs || []).filter((record) => String(record?.date || "").slice(0, 10) !== normalizedDate);
            if (filtered.length > 0) {
                next[exName] = filtered;
            }
        });

        return next;
    }, []);

    // ─── State ────────────────────────────────────────
    // eslint-disable-next-line no-unused-vars
    const [user, setUser] = useState(null);
    const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
    const [splashMinElapsed, setSplashMinElapsed] = useState(false);
    const [splashForceDone, setSplashForceDone] = useState(false);

    const ensureProfileForUser = useCallback(async (nextUser) => {
        if (!nextUser?.id) return;

        const { data: existingProfile, error: profileError } = await supabase
            .from("profiles")
            .select("id")
            .eq("id", nextUser.id)
            .maybeSingle();

        if (profileError) throw profileError;
        if (existingProfile?.id) return;

        const metadata = nextUser.user_metadata || {};
        const emailPrefix = String(nextUser.email || "").split("@")[0] || "";
        const baseUsername = String(
            metadata.user_name ||
            metadata.preferred_username ||
            metadata.username ||
            metadata.full_name ||
            metadata.name ||
            emailPrefix ||
            "pump-user"
        )
            .trim()
            .replace(/\s+/g, "")
            .slice(0, 20);

        const candidates = [
            baseUsername,
            `${baseUsername || "pumpuser"}-${nextUser.id.slice(0, 4)}`,
            `${baseUsername || "pumpuser"}-${nextUser.id.slice(4, 8)}`,
        ].filter(Boolean);

        for (const candidate of candidates) {
            const { error } = await supabase.from("profiles").insert({
                id: nextUser.id,
                username: candidate,
            });

            if (!error) return;
            if (error.code !== "23505") {
                throw error;
            }
        }

        throw new Error("プロフィールの初期作成に失敗しました。");
    }, []);

    const connectPendingFriendForUser = useCallback(async (nextUser) => {
        if (!nextUser?.id) return;
        const pending = localStorage.getItem("pendingFriendId");
        if (!pending || pending === nextUser.id) return;

        const { error } = await supabase.from("friendships").upsert({
            requester_id: nextUser.id,
            receiver_id: pending,
            status: "accepted",
        });

        if (error) throw error;
        localStorage.removeItem("pendingFriendId");
    }, []);

    useEffect(() => {
        const minTimerId = window.setTimeout(() => setSplashMinElapsed(true), 620);
        const maxTimerId = window.setTimeout(() => setSplashForceDone(true), 1500);

        return () => {
            window.clearTimeout(minTimerId);
            window.clearTimeout(maxTimerId);
        };
    }, []);

    useEffect(() => {
        if (!isSupabaseConfigured) {
            setUser(null);
            setAuthReady(true);
            return undefined;
        }

        let isMounted = true;
        setAuthReady(false);

        const syncAuthenticatedUser = async (nextUser) => {
            if (!isMounted) return;
            setUser(nextUser ?? null);

            if (!nextUser) return;

            setShowAuth(false);

            try {
                await ensureProfileForUser(nextUser);
            } catch (error) {
                console.error("ensure oauth profile failed", error);
            }

            try {
                await connectPendingFriendForUser(nextUser);
            } catch (error) {
                console.error("connect pending friend failed", error);
            }
        };

        supabase.auth.getSession()
            .then(({ data: { session } }) => syncAuthenticatedUser(session?.user ?? null))
            .catch((error) => {
                console.error("initial auth session load failed", error);
                if (isMounted) setUser(null);
            })
            .finally(() => {
                if (isMounted) setAuthReady(true);
            });
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            void syncAuthenticatedUser(session?.user ?? null);
            if (isMounted) setAuthReady(true);
        });

        return () => {
            isMounted = false;
            subscription.unsubscribe();
        };
    }, [connectPendingFriendForUser, ensureProfileForUser]);

    useEffect(() => {
        if (!isSupabaseConfigured || !isNativeApp()) return undefined;

        let listenerHandle;
        let isCancelled = false;

        const setupNativeOAuthListener = async () => {
            listenerHandle = await CapacitorApp.addListener("appUrlOpen", async ({ url }) => {
                if (!url || !isNativeOAuthCallbackUrl(url)) return;

                try {
                    const parsedUrl = new URL(url);
                    const hashParams = new URLSearchParams(String(parsedUrl.hash || "").replace(/^#/, ""));
                    const searchParams = parsedUrl.searchParams;
                    const providerError = searchParams.get("error_description")
                        || hashParams.get("error_description")
                        || searchParams.get("error")
                        || hashParams.get("error");

                    if (providerError) {
                        throw new Error(decodeURIComponent(providerError));
                    }

                    const accessToken = hashParams.get("access_token");
                    const refreshToken = hashParams.get("refresh_token");

                    if (accessToken && refreshToken) {
                        const { error } = await supabase.auth.setSession({
                            access_token: accessToken,
                            refresh_token: refreshToken,
                        });
                        if (error) throw error;
                    } else {
                        const code = searchParams.get("code");
                        if (code) {
                            const { error } = await supabase.auth.exchangeCodeForSession(code);
                            if (error) throw error;
                        } else {
                            throw new Error("認証結果を受け取れませんでした。");
                        }
                    }

                    if (!isCancelled) {
                        window.dispatchEvent(new CustomEvent("pump-oauth-complete"));
                    }
                } catch (error) {
                    console.error("native oauth callback failed", error);
                    if (!isCancelled) {
                        window.dispatchEvent(new CustomEvent("pump-oauth-error", {
                            detail: {
                                message: `OAuthログインに失敗しました。${error?.message ? ` ${error.message}` : ""}`.trim(),
                            },
                        }));
                    }
                } finally {
                    Browser.close().catch(() => { });
                }
            });
        };

        void setupNativeOAuthListener();

        return () => {
            isCancelled = true;
            listenerHandle?.remove?.();
        };
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const ref = params.get("ref");
        if (ref) {
            localStorage.setItem("pendingFriendId", ref);
            setScreen("ranking");
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
    const [exerciseBodyPartOverrides, setExerciseBodyPartOverrides] = useState(() => {
        const saved = load(EXERCISE_BODY_PART_OVERRIDES_KEY, {});
        return isPlainObject(saved) ? saved : {};
    });
    const [hiddenBodyParts, setHiddenBodyParts] = useState(() => {
        const saved = load("hiddenBodyParts", []);
        return [...new Set((saved || []).map((part) => String(part || "").trim()).filter(Boolean))];
    });


    const [screen, setScreen] = useState("history");
    const [isOnline, setIsOnline] = useState(() =>
        typeof navigator === "undefined" ? true : navigator.onLine
    );
    const [showAuth, setShowAuth] = useState(false);
    const [showPushPrompt, setShowPushPrompt] = useState(false);
    const [pushPromptBusy, setPushPromptBusy] = useState(false);
    const [pushPromptMessage, setPushPromptMessage] = useState("");
    const [pushStatus, setPushStatus] = useState({
        enabled: false,
        permission: getNotificationPermission(),
        support: getPushSupportState(),
    });

    useEffect(() => {
        if (screen === "friends") {
            setScreen("ranking");
        }
    }, [screen]);

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);

        return () => {
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
        };
    }, []);

    useEffect(() => () => {
        if (pendingDeleteUndoRef.current?.timeoutId) {
            window.clearTimeout(pendingDeleteUndoRef.current.timeoutId);
        }
    }, []);

    const [todayLabels, setTodayLabels] = useState(() => loadDraftForDate(getTodayKey()).todayLabels);
    const updateTodayLabels = (nextOrUpdater) => {
        setTodayLabels((prev) => {
            const next =
                typeof nextOrUpdater === "function"
                    ? nextOrUpdater(prev)
                    : nextOrUpdater;

            saveDraftForDate(logDate, {
                todayLabels: next,
                logData,
                sessionEx,
                exerciseUnits,
            });
            return next;
        });
    };
    const [logData, setLogData] = useState(() => loadDraftForDate(getTodayKey()).logData);
    const [sessionHistory, setSessionHistory] = useState(null);
    const [sessionEx, setSessionEx] = useState(() => loadDraftForDate(getTodayKey()).sessionEx);

    const [routineOrder, setRoutineOrder] = useState(() => load("routineOrder", {}));

    const getExSets = (ex) => {
        return getExSetsHelper({
            logData,
            history,
            name: ex.name,
            logDate,
        });
    };

    const [logDate, setLogDate] = useState(() => getTodayKey());
    const [logMode, setLogMode] = useState("today");
    const [exerciseUnits, setExerciseUnits] = useState(() => loadDraftForDate(getTodayKey()).exerciseUnits);

    const setLogDataAndSaveDraft = useCallback((nextOrUpdater) => {
        setLogData((prev) => {
            const next =
                typeof nextOrUpdater === "function"
                    ? nextOrUpdater(prev)
                    : nextOrUpdater;

            saveDraftForDate(logDate, {
                todayLabels,
                logData: next || {},
                sessionEx,
                exerciseUnits,
            });

            return next;
        });
    }, [exerciseUnits, logDate, saveDraftForDate, sessionEx, todayLabels]);

    const {
        addSet,
        setField,
        saveLog,
    } = useLogLogic({
        logData,
        setLogData: setLogDataAndSaveDraft,
        history,
        setHistory,
        routineOrder,
        setRoutineOrder,
        todayLabels,
        sessionEx,
        getExSets,
        logDate,
    });

    const handleSaveLog = useCallback(() => {
        saveLog();
        clearDraftForDate(logDate);
    }, [saveLog, clearDraftForDate, logDate]);

    // GymApp()の中に追加
    const {
        intervalSec, setIntervalSec,
        timerLeft,
        showTimerMenu, setShowTimerMenu,
        startTimer, stopTimer,
    } = useTimer();

    // eslint-disable-next-line no-unused-vars
    const { isDark, setIsDark, unit, setUnit, showOnboarding, completeOnboarding } = useSettings();
    const appThemeClassName = isDark ? "app-shell" : "theme-light app-shell";

    useLayoutEffect(() => {
        if (typeof window === "undefined" || typeof document === "undefined") return undefined;

        const root = document.documentElement;
        let rafId = 0;
        let timeoutId = 0;

        const applyViewportHeight = () => {
            const viewportHeight = window.visualViewport?.height || window.innerHeight;
            root.style.setProperty("--app-height", `${Math.round(viewportHeight)}px`);
        };

        const scheduleViewportHeightUpdate = () => {
            cancelAnimationFrame(rafId);
            clearTimeout(timeoutId);
            rafId = window.requestAnimationFrame(() => {
                applyViewportHeight();
                timeoutId = window.setTimeout(applyViewportHeight, 80);
            });
        };

        applyViewportHeight();
        scheduleViewportHeightUpdate();

        window.addEventListener("resize", scheduleViewportHeightUpdate);
        window.addEventListener("orientationchange", scheduleViewportHeightUpdate);
        window.visualViewport?.addEventListener("resize", scheduleViewportHeightUpdate);
        window.visualViewport?.addEventListener("scroll", scheduleViewportHeightUpdate);

        return () => {
            cancelAnimationFrame(rafId);
            clearTimeout(timeoutId);
            window.removeEventListener("resize", scheduleViewportHeightUpdate);
            window.removeEventListener("orientationchange", scheduleViewportHeightUpdate);
            window.visualViewport?.removeEventListener("resize", scheduleViewportHeightUpdate);
            window.visualViewport?.removeEventListener("scroll", scheduleViewportHeightUpdate);
        };
    }, []);


    const [sessionSyncVersion, setSessionSyncVersion] = useState(0);
    const initialWorkoutTimerState = readWorkoutTimerState();
    const [workoutStartedAt, setWorkoutStartedAt] = useState(initialWorkoutTimerState.startedAt);
    const [workoutStartedForDate, setWorkoutStartedForDate] = useState(initialWorkoutTimerState.startedForDate);
    const [workoutLastActivityAt, setWorkoutLastActivityAt] = useState(initialWorkoutTimerState.lastActivityAt);
    const [workoutIsFinished, setWorkoutIsFinished] = useState(initialWorkoutTimerState.isFinished);
    const [workoutFinishedAt, setWorkoutFinishedAt] = useState(initialWorkoutTimerState.finishedAt);
    const [savedWorkoutDurationSecByDate, setSavedWorkoutDurationSecByDate] = useState({});
    const [workoutElapsedSec, setWorkoutElapsedSec] = useState(() =>
        computeWorkoutDisplayElapsedSec(initialWorkoutTimerState)
    );

    const touchStartX = useRef(null);
    const touchStartY = useRef(null);
    const latestUserIdRef = useRef(null);
    const latestHistoryRef = useRef(history);
    const historyRevisionRef = useRef(0);
    const historySaveQueueRef = useRef(Promise.resolve());
    const pendingWorkoutNotificationRef = useRef(null);
    const historyDeleteMarkersRef = useRef(createEmptyHistoryDeleteMarkers());
    const pendingWorkoutSessionSyncDatesRef = useRef(new Set());
    const syncFailuresByDateRef = useRef({});
    const dismissedSyncFailureSignaturesRef = useRef(new Set());
    const pendingDeleteUndoRef = useRef(null);
    const previousWorkoutActivitySignatureRef = useRef("");
    const previousWorkoutActivityDateRef = useRef("");
    const workoutTimerStateRef = useRef(initialWorkoutTimerState);
    const previousOnlineStateRef = useRef(isOnline);
    const undoToastTouchStartYRef = useRef(null);
    const syncBannerTouchStartYRef = useRef(null);

    // 設定画面用モーダル
    const [showAddEx, setShowAddEx] = useState(false);
    const [addTarget, setAddTarget] = useState(null);
    const [newExName, setNewExName] = useState("");
    const [summary, setSummary] = useState(null);
    const [workoutDayShareTarget, setWorkoutDayShareTarget] = useState(null);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [syncFailuresByDate, setSyncFailuresByDate] = useState({});
    const [syncRetrying, setSyncRetrying] = useState(false);
    const [pendingDeleteUndo, setPendingDeleteUndo] = useState(null);
    const [accountActionBusy, setAccountActionBusy] = useState(false);
    const [historySyncDiagnostic, setHistorySyncDiagnostic] = useState({
        localHistoryDates: [],
        remoteWorkoutDates: [],
        sessionDates: [],
        missingFromRemoteWorkouts: [],
        missingFromWorkoutSessions: [],
        syncFailedDates: [],
        lastSyncErrorByDate: {},
    });

    useEffect(() => {
        const wasOnline = previousOnlineStateRef.current;
        if (!wasOnline && isOnline) {
            setSessionSyncVersion((prev) => prev + 1);
        }
        previousOnlineStateRef.current = isOnline;
    }, [isOnline]);


    // ─── AI Coach ─────────────────────────────────────
    const { aiMsgs, aiInput, setAiInput, aiLoad, aiEnd, sendAI, aiRemaining } = useAI(history);

    useEffect(() => {
        latestUserIdRef.current = user?.id ?? null;
    }, [user?.id]);

    useEffect(() => {
        const root = document.documentElement;
        const body = document.body;
        root.classList.toggle("theme-light", !isDark);
        body.classList.toggle("theme-light", !isDark);

        return () => {
            root.classList.remove("theme-light");
            body.classList.remove("theme-light");
        };
    }, [isDark]);

    useEffect(() => {
        latestHistoryRef.current = history;
        historyRevisionRef.current += 1;
    }, [history]);

    const applyWorkoutTimerState = useCallback((nextState) => {
        const normalizedState = normalizeWorkoutTimerState(nextState);
        workoutTimerStateRef.current = normalizedState;
        setWorkoutStartedAt(normalizedState.startedAt);
        setWorkoutStartedForDate(normalizedState.startedForDate);
        setWorkoutLastActivityAt(normalizedState.lastActivityAt);
        setWorkoutIsFinished(normalizedState.isFinished);
        setWorkoutFinishedAt(normalizedState.finishedAt);
        setWorkoutElapsedSec(computeWorkoutDisplayElapsedSec(normalizedState));

        if (normalizedState.startedAt) {
            persistWorkoutTimerState(normalizedState);
        } else {
            clearWorkoutTimerState();
        }
    }, []);

    const resetWorkoutElapsedTimer = useCallback(() => {
        applyWorkoutTimerState(createEmptyWorkoutTimerState());
    }, [applyWorkoutTimerState]);

    const finishWorkoutTimer = useCallback((endedAt = Date.now()) => {
        const currentState = workoutTimerStateRef.current;
        if (!currentState?.startedAt || !currentState.startedForDate) return;

        applyWorkoutTimerState({
            ...currentState,
            isFinished: true,
            finishedAt: endedAt,
            lastActivityAt: currentState.lastActivityAt || endedAt,
        });
    }, [applyWorkoutTimerState]);

    const startWorkoutTimerIfNeeded = useCallback((targetDate, options = {}) => {
        const { markAsActivity = true } = options;
        const normalizedDate = String(targetDate || "").trim();
        if (!normalizedDate) return;

        const now = Date.now();
        const currentState = workoutTimerStateRef.current;

        if (
            currentState?.startedAt &&
            currentState.startedForDate === normalizedDate &&
            !currentState.isFinished
        ) {
            if (markAsActivity) {
                applyWorkoutTimerState({
                    ...workoutTimerStateRef.current,
                    lastActivityAt: now,
                });
            }
            return;
        }

        applyWorkoutTimerState({
            startedAt: now,
            startedForDate: normalizedDate,
            lastActivityAt: markAsActivity ? now : null,
            pausedDurationSec: 0,
            pauseStartedAt: null,
            isPaused: false,
            isFinished: false,
            finishedAt: null,
        });
    }, [applyWorkoutTimerState]);

    const markWorkoutActivity = useCallback((targetDate) => {
        const normalizedDate = String(targetDate || "").trim();
        if (!normalizedDate) return;

        startWorkoutTimerIfNeeded(normalizedDate, { markAsActivity: true });
    }, [startWorkoutTimerIfNeeded]);

    useEffect(() => {
        applyWorkoutTimerState(readWorkoutTimerState());
    }, [applyWorkoutTimerState]);

    useEffect(() => {
        const currentState = workoutTimerStateRef.current;
        if (!currentState?.startedAt || !currentState.startedForDate) {
            setWorkoutElapsedSec(0);
            return undefined;
        }

        const syncElapsed = () => {
            const activeDateKey = formatDateKey(new Date());
            const autoFinishState = getWorkoutAutoFinishState(workoutTimerStateRef.current, activeDateKey, Date.now());
            if (autoFinishState.shouldAutoFinish && autoFinishState.endedAt) {
                finishWorkoutTimer(autoFinishState.endedAt);
                return;
            }
            setWorkoutElapsedSec(
                computeWorkoutDisplayElapsedSec(workoutTimerStateRef.current, Date.now())
            );
        };

        syncElapsed();
        if (currentState.isFinished) {
            return undefined;
        }

        const timerId = window.setInterval(syncElapsed, 1000);

        return () => {
            window.clearInterval(timerId);
        };
    }, [
        workoutFinishedAt,
        workoutIsFinished,
        workoutLastActivityAt,
        workoutStartedAt,
        workoutStartedForDate,
        finishWorkoutTimer,
    ]);

    useEffect(() => {
        let cancelled = false;

        async function loadSavedWorkoutDuration() {
            if (!user?.id) return;

            try {
                const [{ data: sessionRows }, { data: workoutRows }] = await Promise.all([
                    supabase
                        .from("workout_sessions")
                        .select("workout_date, duration_sec")
                        .eq("user_id", user.id),
                    supabase
                        .from("workouts")
                        .select("date, duration_sec")
                        .eq("user_id", user.id),
                ]);

                const map = {};
                (sessionRows || []).forEach(({ workout_date, duration_sec }) => {
                    const sec = Math.floor(Number(duration_sec));
                    if (workout_date && sec > 0 && sec < 86400) {
                        map[workout_date] = Math.max(map[workout_date] || 0, sec);
                    }
                });
                (workoutRows || []).forEach(({ date, duration_sec }) => {
                    const sec = Math.floor(Number(duration_sec));
                    if (date && sec > 0 && sec < 86400) {
                        map[date] = Math.max(map[date] || 0, sec);
                    }
                });

                if (!cancelled) {
                    setSavedWorkoutDurationSecByDate(map);
                }
            } catch (error) {
                console.error("load saved workout duration failed", error);
            }
        }

        loadSavedWorkoutDuration();

        return () => {
            cancelled = true;
        };
    }, [user?.id]);

    const workoutTimerStatus = getWorkoutTimerStatus(workoutTimerStateRef.current);

    const closeWorkoutDaySummary = useCallback(() => {
        setSummary(null);
    }, []);

    const closeWorkoutDayShareModal = useCallback(() => {
        setWorkoutDayShareTarget(null);
    }, []);

    const openWorkoutDayShareModal = useCallback((target) => {
        if (!target?.workoutDate || !target?.sessionPayload) return;
        setWorkoutDayShareTarget(target);
    }, []);

    const handleLogout = useCallback(async () => {
        await supabase.auth.signOut();
    }, []);

    const handleExportData = useCallback(() => {
        const localStorageSnapshot = {};
        try {
            for (let i = 0; i < localStorage.length; i += 1) {
                const key = localStorage.key(i);
                if (!key) continue;
                if (
                    key.startsWith("draft_") ||
                    key.startsWith("history") ||
                    key.startsWith("history_cache_") ||
                    key.startsWith("historyDeleteMarkers_") ||
                    [
                        "routineEx",
                        "routineOrder",
                        "manualBests",
                        "customBodyParts",
                        "hiddenBodyParts",
                        EXERCISE_BODY_PART_OVERRIDES_KEY,
                    ].includes(key)
                ) {
                    localStorageSnapshot[key] = localStorage.getItem(key);
                }
            }
        } catch (error) {
            console.error("data export localStorage snapshot failed", error);
        }

        const payload = {
            exportedAt: new Date().toISOString(),
            userId: user?.id || null,
            history,
            routineEx: muscleEx,
            routineOrder,
            manualBests,
            customBodyParts,
            hiddenBodyParts,
            exerciseBodyPartOverrides,
            savedWorkoutDurationSecByDate,
            localStorage: localStorageSnapshot,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], {
            type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `pump-backup-${formatDateKey(new Date())}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }, [
        customBodyParts,
        exerciseBodyPartOverrides,
        hiddenBodyParts,
        history,
        manualBests,
        muscleEx,
        routineOrder,
        savedWorkoutDurationSecByDate,
        user?.id,
    ]);

    const clearLocalAppState = useCallback(() => {
        try {
            const removableKeys = [];
            for (let i = 0; i < localStorage.length; i += 1) {
                const key = localStorage.key(i);
                if (!key) continue;
                if (
                    key.startsWith("draft_") ||
                    key.startsWith("history") ||
                    key.startsWith("history_cache_") ||
                    key.startsWith("historyDeleteMarkers_") ||
                    key.startsWith("pushPrompt") ||
                    [
                        "routineEx",
                        "routineOrder",
                        "manualBests",
                        "customBodyParts",
                        "hiddenBodyParts",
                        "onboardingDone",
                        HISTORY_OWNER_KEY,
                        EXERCISE_BODY_PART_OVERRIDES_KEY,
                    ].includes(key)
                ) {
                    removableKeys.push(key);
                }
            }
            removableKeys.forEach((key) => localStorage.removeItem(key));
        } catch (error) {
            console.error("local app data clear failed", error);
        }

        setHistory({});
        latestHistoryRef.current = {};
        setManualBests([]);
        setMuscleEx({});
        setRoutineOrder({});
        setCustomBodyParts([]);
        setHiddenBodyParts([]);
        setExerciseBodyPartOverrides({});
        setSavedWorkoutDurationSecByDate({});
        setTodayLabels([]);
        setLogData({});
        setSessionEx(null);
        setExerciseUnits({});
        setSummary(null);
        setWorkoutDayShareTarget(null);
        setSyncFailuresByDate({});
        syncFailuresByDateRef.current = {};
        resetWorkoutElapsedTimer();
    }, [resetWorkoutElapsedTimer]);

    const handleDeleteAccount = useCallback(async () => {
        if (!user?.id || accountActionBusy) return;
        const confirmed = window.confirm("アカウントとPUMP上のデータを完全に削除します。元に戻せません。続行しますか？");
        if (!confirmed) return;

        setAccountActionBusy(true);
        try {
            const {
                data: { session },
            } = await supabase.auth.getSession();
            const accessToken = session?.access_token;
            if (!accessToken) throw new Error("ログインが必要です。");

            const response = await fetch("/api/delete-account", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${accessToken}`,
                },
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data?.error || "アカウント削除に失敗しました。");
            }

            clearLocalAppState();
            await supabase.auth.signOut();
            setShowSettingsModal(false);
            setShowAuth(true);
        } catch (error) {
            window.alert(error?.message || "アカウント削除に失敗しました。");
        } finally {
            setAccountActionBusy(false);
        }
    }, [accountActionBusy, clearLocalAppState, user?.id]);

    const queueWorkoutSessionSync = useCallback((date) => {
        const normalizedDate = String(date || "").trim();
        if (!normalizedDate) return;
        pendingWorkoutSessionSyncDatesRef.current.add(normalizedDate);
    }, []);

    const recordSyncFailure = useCallback((workoutDate, error, stage) => {
        const normalizedDate = String(workoutDate || "").trim();
        if (!normalizedDate) return;

        syncFailuresByDateRef.current = {
            ...syncFailuresByDateRef.current,
            [normalizedDate]: {
                stage: String(stage || "").trim() || "unknown",
                message: error?.message || String(error || "unknown error"),
                code: error?.code || null,
                details: error?.details || null,
                hint: error?.hint || null,
                updatedAt: new Date().toISOString(),
            },
        };
        setSyncFailuresByDate(syncFailuresByDateRef.current);
    }, []);

    const clearSyncFailure = useCallback((workoutDate) => {
        const normalizedDate = String(workoutDate || "").trim();
        if (!normalizedDate || !syncFailuresByDateRef.current[normalizedDate]) return;
        const nextFailures = { ...syncFailuresByDateRef.current };
        delete nextFailures[normalizedDate];
        syncFailuresByDateRef.current = nextFailures;
        setSyncFailuresByDate(nextFailures);
    }, []);

    const dismissPendingDeleteUndo = useCallback(() => {
        const pending = pendingDeleteUndoRef.current;
        if (pending?.timeoutId) window.clearTimeout(pending.timeoutId);
        pendingDeleteUndoRef.current = null;
        setPendingDeleteUndo(null);
    }, []);

    const getSyncFailureSignature = useCallback((failures) => (
        Object.entries(failures || {})
            .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
            .map(([date, failure]) => [
                date,
                failure?.stage || "",
                failure?.code || "",
                failure?.message || "",
            ].join(":"))
            .join("|")
    ), []);

    const dismissSyncFailureBanner = useCallback(() => {
        const signature = getSyncFailureSignature(syncFailuresByDateRef.current);
        if (signature) dismissedSyncFailureSignaturesRef.current.add(signature);
        setSyncFailuresByDate({ ...syncFailuresByDateRef.current });
    }, [getSyncFailureSignature]);

    const syncWorkoutRowsForDates = useCallback(async (userId, historyMap, dates = [], durationSecByDate = {}) => {
        const normalizedDates = [...new Set((dates || []).map((date) => String(date || "").trim()).filter(Boolean))];
        const results = {
            syncedDates: [],
            failedDates: [],
        };

        if (!userId || !normalizedDates.length) return results;

        await Promise.all(
            normalizedDates.map(async (workoutDate) => {
                try {
                    const hasWorkoutForDate = hasValidWorkoutOnDate(historyMap, workoutDate);
                    const durationSec = Math.max(
                        Math.floor(Number(durationSecByDate?.[workoutDate]) || 0),
                        getHistoryDurationSecForDate(historyMap, workoutDate)
                    );
                    const { error } = hasWorkoutForDate
                        ? await supabase
                            .from("workouts")
                            .upsert({
                                user_id: userId,
                                date: workoutDate,
                                data: historyMap,
                                ...(durationSec > 0 ? { duration_sec: durationSec } : {}),
                            }, {
                                onConflict: "user_id,date",
                            })
                        : await supabase
                            .from("workouts")
                            .delete()
                            .eq("user_id", userId)
                            .eq("date", workoutDate);

                    if (error) throw error;
                    clearSyncFailure(workoutDate);
                    results.syncedDates.push(workoutDate);
                } catch (error) {
                    recordSyncFailure(workoutDate, error, "workouts");
                    console.error("workout remote sync failed", {
                        error,
                        message: error?.message,
                        code: error?.code,
                        userId,
                        workoutDate,
                    });
                    results.failedDates.push(workoutDate);
                }
            })
        );

        return results;
    }, [clearSyncFailure, recordSyncFailure]);

    const deleteRemoteWorkoutArtifactsForDate = useCallback(async (userId, workoutDate, nextHistoryMap = null) => {
        const normalizedDate = String(workoutDate || "").trim();
        if (!userId || !normalizedDate) return;

        const { data: sessionRows, error: sessionFetchError } = await supabase
            .from("workout_sessions")
            .select("id")
            .eq("user_id", userId)
            .eq("workout_date", normalizedDate);

        if (sessionFetchError) throw sessionFetchError;

        const sessionIds = (sessionRows || []).map((session) => session.id).filter(Boolean);

        if (sessionIds.length > 0) {
            const { error: deleteExercisesError } = await supabase
                .from("workout_session_exercises")
                .delete()
                .in("session_id", sessionIds);

            if (deleteExercisesError) throw deleteExercisesError;

            const { error: deleteSessionsError } = await supabase
                .from("workout_sessions")
                .delete()
                .in("id", sessionIds);

            if (deleteSessionsError) throw deleteSessionsError;
        }

        const { error: deleteWorkoutError } = await supabase
            .from("workouts")
            .delete()
            .eq("user_id", userId)
            .eq("date", normalizedDate);

        if (deleteWorkoutError) throw deleteWorkoutError;

        if (nextHistoryMap) {
            const remainingDates = getValidWorkoutDatesFromHistory(nextHistoryMap);
            if (remainingDates.length > 0) {
                const { error: updateRemainingError } = await supabase
                    .from("workouts")
                    .upsert(
                        remainingDates.map((date) => ({
                            user_id: userId,
                            date,
                            data: nextHistoryMap,
                        })),
                        { onConflict: "user_id,date" }
                    );

                if (updateRemainingError) throw updateRemainingError;
            }
        }
    }, []);

    const refreshHistorySyncDiagnostic = useCallback(async (userId, historyMap, { prefix = "" } = {}) => {
        if (!userId) {
            setHistorySyncDiagnostic({
                localHistoryDates: [],
                remoteWorkoutDates: [],
                sessionDates: [],
                missingFromRemoteWorkouts: [],
                missingFromWorkoutSessions: [],
                syncFailedDates: [],
                lastSyncErrorByDate: {},
            });
            return;
        }

        try {
            const localHistoryDates = getValidWorkoutDatesFromHistory(historyMap || {}, { prefix });

            const [remoteWorkoutsRes, remoteSessionsRes] = await Promise.all([
                supabase
                    .from("workouts")
                    .select("date, data")
                    .eq("user_id", userId)
                    .order("date", { ascending: true }),
                supabase
                    .from("workout_sessions")
                    .select("workout_date")
                    .eq("user_id", userId)
                    .order("workout_date", { ascending: true }),
            ]);

            if (remoteWorkoutsRes.error) throw remoteWorkoutsRes.error;
            if (remoteSessionsRes.error) throw remoteSessionsRes.error;

            const remoteHistory = buildHistoryFromWorkoutRows(remoteWorkoutsRes.data || []);
            const remoteWorkoutDates = getValidWorkoutDatesFromHistory(remoteHistory, { prefix });
            const sessionDates = [...new Set(
                (remoteSessionsRes.data || [])
                    .map((row) => String(row?.workout_date || "").slice(0, 10))
                    .filter((date) => !prefix || date.startsWith(prefix))
            )].sort();

            const localOrRemoteDates = [...new Set([...localHistoryDates, ...remoteWorkoutDates])].sort();
            const missingFromRemoteWorkouts = localHistoryDates.filter((date) => !remoteWorkoutDates.includes(date));
            const missingFromWorkoutSessions = localOrRemoteDates.filter((date) => !sessionDates.includes(date));
            const syncFailedDates = [...new Set(
                Object.keys(syncFailuresByDateRef.current).filter((date) => !prefix || date.startsWith(prefix))
            )].sort();
            const lastSyncErrorByDate = syncFailedDates.reduce((acc, date) => {
                acc[date] = syncFailuresByDateRef.current[date];
                return acc;
            }, {});

            const diagnosticPayload = {
                localHistoryDates,
                remoteWorkoutDates,
                sessionDates,
                missingFromRemoteWorkouts,
                missingFromWorkoutSessions,
                syncFailedDates,
                lastSyncErrorByDate,
            };

            setHistorySyncDiagnostic(diagnosticPayload);
            debugLog("[sync] history remote diagnostic", {
                userId,
                prefix,
                ...diagnosticPayload,
            });
        } catch (error) {
            console.error("[sync] history remote diagnostic failed", {
                error,
                message: error?.message,
                code: error?.code,
                userId,
                prefix,
            });
        }
    }, []);

    const syncWorkoutSessionSnapshot = useCallback(async (userId, historyMap, workoutDate, timing = null) => {
        const normalizedDate = String(workoutDate || "").trim();
        if (!userId || !normalizedDate) return;

        const payload = buildWorkoutSessionPayloadFromHistory(historyMap, normalizedDate);
        const { data: existingSession, error: existingSessionError } = await supabase
            .from("workout_sessions")
            .select("id, started_at, duration_sec")
            .eq("user_id", userId)
            .eq("workout_date", normalizedDate)
            .maybeSingle();

        if (existingSessionError) throw existingSessionError;

        if (!payload) {
            if (existingSession?.id) {
                const { error: deleteExercisesError } = await supabase
                    .from("workout_session_exercises")
                    .delete()
                    .eq("session_id", existingSession.id);
                if (deleteExercisesError) throw deleteExercisesError;

                const { error: deleteSessionError } = await supabase
                    .from("workout_sessions")
                    .delete()
                    .eq("id", existingSession.id);
                if (deleteSessionError) throw deleteSessionError;
            }
            return;
        }

        let latestPhotoId = null;
        try {
            const { data: latestPhotoRows } = await supabase
                .from("progress_photos")
                .select("id")
                .eq("user_id", userId)
                .eq("workout_date", normalizedDate)
                .order("created_at", { ascending: false })
                .limit(1);
            latestPhotoId = latestPhotoRows?.[0]?.id ?? null;
        } catch (error) {
            console.error("workout session latest photo fetch failed", error);
        }

        const startedAt = timing?.startedAtIso || existingSession?.started_at || new Date().toISOString();
        const endedAt = timing?.endedAtIso || new Date().toISOString();
        const durationSec = Number.isFinite(timing?.durationSec)
            ? Math.max(0, Math.floor(timing.durationSec))
            : Number.isFinite(Number(existingSession?.duration_sec)) && Number(existingSession?.duration_sec) > 0
                ? Math.floor(Number(existingSession.duration_sec))
                : 0;

        const { data: upsertedSession, error: sessionUpsertError } = await supabase
            .from("workout_sessions")
            .upsert({
                user_id: userId,
                workout_date: normalizedDate,
                started_at: startedAt,
                ended_at: endedAt,
                duration_sec: durationSec,
                total_volume: payload.session.total_volume,
                exercise_count: payload.session.exercise_count,
                summary_json: payload.session.summary_json,
                photo_id: latestPhotoId,
                visibility: payload.session.visibility,
                photo_visibility: payload.session.photo_visibility,
            }, {
                onConflict: "user_id,workout_date",
            })
            .select("id")
            .single();

        if (sessionUpsertError) throw sessionUpsertError;

        const sessionId = upsertedSession?.id;
        if (!sessionId) throw new Error("workout session id is missing");

        const { error: deleteExercisesError } = await supabase
            .from("workout_session_exercises")
            .delete()
            .eq("session_id", sessionId);
        if (deleteExercisesError) throw deleteExercisesError;

        if (payload.exercises.length > 0) {
            const { error: insertExercisesError } = await supabase
                .from("workout_session_exercises")
                .insert(
                    payload.exercises.map((exercise) => ({
                        session_id: sessionId,
                        exercise_name: exercise.exercise_name,
                        body_part: exercise.body_part,
                        set_count: exercise.set_count,
                        max_weight: exercise.max_weight,
                        volume: exercise.volume,
                        best_set_json: exercise.best_set_json,
                    }))
                );

            if (insertExercisesError) throw insertExercisesError;
        }
    }, []);

    const cleanupWorkoutSessionsForHistory = useCallback(async (userId, historyMap) => {
        if (!userId) return;

        const activeDates = new Set(
            Object.values(historyMap || {})
                .flatMap((records) => (records || []).map((record) => String(record?.date || "").trim()))
                .filter(Boolean)
        );

        const { data: existingSessions, error } = await supabase
            .from("workout_sessions")
            .select("id, workout_date")
            .eq("user_id", userId);

        if (error) throw error;

        const staleSessionIds = (existingSessions || [])
            .filter((session) => !activeDates.has(String(session.workout_date || "").trim()))
            .map((session) => session.id)
            .filter(Boolean);

        if (!staleSessionIds.length) return;

        const { error: deleteError } = await supabase
            .from("workout_sessions")
            .delete()
            .in("id", staleSessionIds);

        if (deleteError) throw deleteError;
    }, []);

    const retryFailedSync = useCallback(async () => {
        if (!user?.id || syncRetrying) return;

        const failedDates = Object.keys(syncFailuresByDateRef.current);
        if (!failedDates.length) return;

        setSyncRetrying(true);
        try {
            const currentHistory = latestHistoryRef.current || history || {};
            await Promise.all(failedDates.map(async (date) => {
                const hasWorkoutForDate = hasValidWorkoutOnDate(currentHistory, date);
                if (hasWorkoutForDate) {
                    await syncWorkoutRowsForDates(
                        user.id,
                        currentHistory,
                        [date],
                        savedWorkoutDurationSecByDate
                    );
                    await syncWorkoutSessionSnapshot(user.id, currentHistory, date);
                } else {
                    await deleteRemoteWorkoutArtifactsForDate(user.id, date, currentHistory);
                }
                clearSyncFailure(date);
            }));

            await refreshHistorySyncDiagnostic(user.id, currentHistory, {
                prefix: failedDates[0]?.slice(0, 7) || "",
            });
            setSessionSyncVersion((prev) => prev + 1);
            if (Object.keys(syncFailuresByDateRef.current).length === 0) {
                setSyncFailuresByDate({});
            }
        } finally {
            setSyncRetrying(false);
        }
    }, [
        clearSyncFailure,
        deleteRemoteWorkoutArtifactsForDate,
        history,
        refreshHistorySyncDiagnostic,
        savedWorkoutDurationSecByDate,
        syncRetrying,
        syncWorkoutRowsForDates,
        syncWorkoutSessionSnapshot,
        user?.id,
    ]);

    // ─── Persist ──────────────────────────────────────
    useEffect(() => { save("routineEx", muscleEx); }, [muscleEx]);
    useEffect(() => {
        persistHistoryForUser(user?.id, history);
    }, [history, user]);
    useEffect(() => { save("customBodyParts", customBodyParts); }, [customBodyParts]);
    useEffect(() => { save(EXERCISE_BODY_PART_OVERRIDES_KEY, exerciseBodyPartOverrides); }, [exerciseBodyPartOverrides]);
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

    const commitHistoryDeleteMarkers = useCallback((nextMarkers) => {
        const normalizedMarkers = normalizeHistoryDeleteMarkers(nextMarkers);
        historyDeleteMarkersRef.current = normalizedMarkers;

        const userId = latestUserIdRef.current;
        if (userId) {
            save(getHistoryDeleteMarkersKey(userId), normalizedMarkers);
        }

        return normalizedMarkers;
    }, []);

    const appendHistoryDeleteMarkers = useCallback((nextMarkers) => {
        return commitHistoryDeleteMarkers({
            dates: [
                ...(historyDeleteMarkersRef.current?.dates || []),
                ...(nextMarkers?.dates || []),
            ],
            records: [
                ...(historyDeleteMarkersRef.current?.records || []),
                ...(nextMarkers?.records || []),
            ],
        });
    }, [commitHistoryDeleteMarkers]);

    const pruneHistoryDeleteMarkersForHistory = useCallback((historyMap) => {
        const normalizedMarkers = normalizeHistoryDeleteMarkers(historyDeleteMarkersRef.current);
        if (!normalizedMarkers.dates.length && !normalizedMarkers.records.length) {
            return normalizedMarkers;
        }

        const restoredDates = new Set();
        const restoredRecords = new Set();

        Object.entries(historyMap || {}).forEach(([exerciseName, records]) => {
            (records || []).forEach((record) => {
                const recordDate = String(record?.date || "").slice(0, 10);
                if (!recordDate) return;
                restoredDates.add(recordDate);
                restoredRecords.add(buildHistoryRecordDeleteKey(recordDate, exerciseName));
            });
        });

        const prunedMarkers = {
            dates: normalizedMarkers.dates.filter((date) => !restoredDates.has(date)),
            records: normalizedMarkers.records.filter((key) => !restoredRecords.has(key)),
        };

        return serializeHistoryMap(prunedMarkers) === serializeHistoryMap(normalizedMarkers)
            ? normalizedMarkers
            : commitHistoryDeleteMarkers(prunedMarkers);
    }, [commitHistoryDeleteMarkers]);

    useEffect(() => {
        let isActive = true;

        const syncHistoryFromSupabase = async () => {
            if (!user?.id) {
                historyDeleteMarkersRef.current = createEmptyHistoryDeleteMarkers();
                if (isActive) setHistorySyncReady(true);
                return;
            }

            if (isActive) setHistorySyncReady(false);

            const rawLocalHistory = load("history", {});
            const localOwnerUserId = load(HISTORY_OWNER_KEY, null);
            const scopedLocalHistory = load(getUserHistoryCacheKey(user.id), null);
            const persistedDeleteMarkers = normalizeHistoryDeleteMarkers(
                load(getHistoryDeleteMarkersKey(user.id), createEmptyHistoryDeleteMarkers())
            );
            historyDeleteMarkersRef.current = persistedDeleteMarkers;

            let localMergeCandidate = {};

            if (isPlainObject(scopedLocalHistory)) {
                localMergeCandidate = scopedLocalHistory;
            } else if (!localOwnerUserId || localOwnerUserId === user.id) {
                localMergeCandidate = rawLocalHistory;
            } else {
                save(getUserHistoryCacheKey(localOwnerUserId), rawLocalHistory);
            }

            const effectiveDeleteMarkers = pruneHistoryDeleteMarkersForHistory(localMergeCandidate);

            try {
                const { data, error } = await supabase
                    .from("workouts")
                    .select("date, data, duration_sec")
                    .eq("user_id", user.id)
                    .order("date", { ascending: true });

                if (error) throw error;

                const remoteHistory = applyHistoryDeleteMarkers(
                    attachWorkoutDurationsToHistory(buildHistoryFromWorkoutRows(data), data),
                    effectiveDeleteMarkers
                );
                const mergedHistory = applyHistoryDeleteMarkers(
                    mergeHistoryMaps(remoteHistory, localMergeCandidate),
                    effectiveDeleteMarkers
                );

                if (!isActive) return;

                setHistory(mergedHistory);
                persistHistoryForUser(user.id, mergedHistory);
            } catch (error) {
                console.error("history sync load failed", error);

                if (!isActive) return;

                const fallbackHistory = applyHistoryDeleteMarkers(localMergeCandidate, effectiveDeleteMarkers);
                setHistory(fallbackHistory);
                persistHistoryForUser(user.id, fallbackHistory);
            } finally {
                if (isActive) setHistorySyncReady(true);
            }
        };

        syncHistoryFromSupabase();

        return () => {
            isActive = false;
        };
    }, [user, pruneHistoryDeleteMarkersForHistory]);

    useEffect(() => {
        if (!user || !historySyncReady) return;
        const currentUserId = user.id;
        const pendingWorkoutNotification = pendingWorkoutNotificationRef.current;

        historySaveQueueRef.current = historySaveQueueRef.current
            .catch(() => {})
            .then(async () => {
                if (latestUserIdRef.current !== currentUserId) return;
                const saveRevision = historyRevisionRef.current;
                const baseLocalHistory = mergeHistoryMaps(latestHistoryRef.current);
                const effectiveDeleteMarkers = pruneHistoryDeleteMarkersForHistory(baseLocalHistory);
                const localHistorySnapshot = applyHistoryDeleteMarkers(
                    baseLocalHistory,
                    effectiveDeleteMarkers
                );

                const { data, error } = await supabase
                    .from("workouts")
                    .select("date, data, duration_sec")
                    .eq("user_id", currentUserId)
                    .order("date", { ascending: true });

                if (error) throw error;
                if (latestUserIdRef.current !== currentUserId) return;

                const remoteHistory = applyHistoryDeleteMarkers(
                    attachWorkoutDurationsToHistory(buildHistoryFromWorkoutRows(data), data),
                    effectiveDeleteMarkers
                );
                const mergedHistory = applyHistoryDeleteMarkers(
                    mergeHistoryMaps(remoteHistory, localHistorySnapshot),
                    effectiveDeleteMarkers
                );
                const validHistoryDates = getValidWorkoutDatesFromHistory(mergedHistory);
                const syncDates = [
                    ...new Set([
                        ...(data || []).map((row) => String(row?.date || "")).filter(Boolean),
                        ...validHistoryDates,
                        String(logDate || "").trim(),
                        formatDateKey(new Date()),
                    ]),
                ];
                const currentTimerPersistence = workoutStartedForDate
                    ? getWorkoutTimerPersistence(workoutTimerStateRef.current, Date.now())
                    : null;
                const currentTimerDurationSec = workoutStartedForDate
                    ? Math.max(
                        Math.floor(Number(currentTimerPersistence?.durationSec) || 0),
                        computeWorkoutDisplayElapsedSec(workoutTimerStateRef.current)
                    )
                    : 0;
                const durationSecByDate = {
                    ...savedWorkoutDurationSecByDate,
                    ...(workoutStartedForDate && currentTimerDurationSec > 0
                        ? { [workoutStartedForDate]: currentTimerDurationSec }
                        : {}),
                };

                const workoutSyncResults = await syncWorkoutRowsForDates(currentUserId, mergedHistory, syncDates, durationSecByDate);
                if (workoutSyncResults.failedDates.length > 0) {
                    throw new Error(`workouts sync failed for ${workoutSyncResults.failedDates.join(", ")}`);
                }

                if (latestUserIdRef.current !== currentUserId) return;
                if (historyRevisionRef.current !== saveRevision) return;

                persistHistoryForUser(currentUserId, mergedHistory);
                setHistory((prev) => {
                    const reconciledHistory = applyHistoryDeleteMarkers(
                        mergeHistoryMaps(mergedHistory, prev),
                        effectiveDeleteMarkers
                    );
                    return serializeHistoryMap(reconciledHistory) === serializeHistoryMap(prev)
                        ? prev
                        : reconciledHistory;
                });

                const pendingSessionSyncDates = Array.from(pendingWorkoutSessionSyncDatesRef.current);
                pendingWorkoutSessionSyncDatesRef.current = new Set();

                if (pendingSessionSyncDates.length > 0) {
                    await Promise.all(
                        pendingSessionSyncDates.map(async (date) => {
                            try {
                                const hasValidWorkoutForDate = hasValidWorkoutOnDate(mergedHistory, date);
                                const shouldPersistWorkoutTiming =
                                    hasValidWorkoutForDate &&
                                    workoutStartedAt &&
                                    workoutStartedForDate === date;
                                const timing = shouldPersistWorkoutTiming
                                    ? getWorkoutTimerPersistence(workoutTimerStateRef.current)
                                    : null;
                                await syncWorkoutSessionSnapshot(currentUserId, mergedHistory, date, timing);
                                clearSyncFailure(date);
                            } catch (error) {
                                recordSyncFailure(date, error, "workout_sessions");
                                console.error("workout session sync failed", { error, userId: currentUserId, date });
                                pendingWorkoutSessionSyncDatesRef.current.add(date);
                            }
                        })
                    );
                }

                try {
                    await cleanupWorkoutSessionsForHistory(currentUserId, mergedHistory);
                    await refreshHistorySyncDiagnostic(currentUserId, mergedHistory, {
                        prefix: formatDateKey(new Date()).slice(0, 7),
                    });
                    setSessionSyncVersion((prev) => prev + 1);
                } catch (error) {
                    console.error("workout session cleanup failed", { error, userId: currentUserId });
                }

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
    }, [
        history,
        user,
        historySyncReady,
        logDate,
        screen,
        clearSyncFailure,
        pruneHistoryDeleteMarkersForHistory,
        recordSyncFailure,
        refreshHistorySyncDiagnostic,
        savedWorkoutDurationSecByDate,
        syncWorkoutSessionSnapshot,
        syncWorkoutRowsForDates,
        cleanupWorkoutSessionsForHistory,
        workoutFinishedAt,
        workoutIsFinished,
        workoutLastActivityAt,
        workoutStartedAt,
        workoutStartedForDate,
    ]);

    useEffect(() => {
        if (!isOnline || !user?.id || !historySyncReady) return;

        let cancelled = false;

        const backfillCurrentMonthWorkoutSessions = async () => {
            const todayKey = formatDateKey(new Date());
            const currentMonthStart = `${todayKey.slice(0, 7)}-01`;
            const targetDates = getValidWorkoutDatesFromHistory(history, { prefix: todayKey.slice(0, 7) });
            if (!targetDates.length) return;

            try {
                await syncWorkoutRowsForDates(user.id, history, targetDates);
                await Promise.all(
                    targetDates.map(async (dateKey) => {
                        if (cancelled) return;
                        try {
                            await syncWorkoutSessionSnapshot(user.id, history, dateKey, null);
                            clearSyncFailure(dateKey);
                        } catch (error) {
                            recordSyncFailure(dateKey, error, "workout_sessions");
                            console.error("workout session month backfill failed", {
                                error,
                                userId: user.id,
                                workoutDate: dateKey,
                                currentMonthStart,
                            });
                        }
                    })
                );

                if (!cancelled) {
                    await refreshHistorySyncDiagnostic(user.id, history, { prefix: todayKey.slice(0, 7) });
                    setSessionSyncVersion((prev) => prev + 1);
                }
            } catch (error) {
                console.error("workout session month backfill batch failed", {
                    error,
                    userId: user.id,
                    currentMonthStart,
                    targetDates,
                });
            }
        };

        backfillCurrentMonthWorkoutSessions();

        return () => {
            cancelled = true;
        };
    }, [
        clearSyncFailure,
        history,
        historySyncReady,
        recordSyncFailure,
        refreshHistorySyncDiagnostic,
        syncWorkoutSessionSnapshot,
        syncWorkoutRowsForDates,
        isOnline,
        user?.id,
    ]);

    useEffect(() => {
        if (!user?.id || !historySyncReady) return;
        const monthPrefix = formatDateKey(new Date()).slice(0, 7);
        refreshHistorySyncDiagnostic(user.id, history, { prefix: monthPrefix });
    }, [history, historySyncReady, refreshHistorySyncDiagnostic, sessionSyncVersion, user?.id]);

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

        const draft = {
            todayLabels,
            logData,
            sessionEx,
            exerciseUnits,
        };

        if (!hasDraftContent(draft)) return;

        saveDraftForDate(logDate, draft);
    }, [screen, todayLabels, logData, sessionEx, exerciseUnits, logDate, logMode, hasDraftContent, saveDraftForDate]);

    useEffect(() => { save("routineOrder", routineOrder); }, [routineOrder]);

    useEffect(() => {
        const today = getTodayKey();
        const todayDraft = loadDraftForDate(today);

        setLogMode("today");
        setLogDate(today);
        if (hasDraftContent(todayDraft)) {
            setTodayLabels(todayDraft.todayLabels);
            setSessionEx(todayDraft.sessionEx);
            setLogData(todayDraft.logData);
            setExerciseUnits(todayDraft.exerciseUnits);
        } else {
            setTodayLabels([]);
            setSessionEx(null);
            setLogData({});
            setExerciseUnits({});
        }
        if (!new URLSearchParams(window.location.search).get("ref")) {
            setScreen("history");
        }
    }, [getTodayKey, hasDraftContent, loadDraftForDate]);

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
            saveDraftForDate(logDate, {
                todayLabels,
                logData,
                sessionEx,
                exerciseUnits: next,
            });
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

    useEffect(() => {
        if (screen !== "log") return;

        const activitySignature = JSON.stringify(
            exercises
                .map((ex, index) => {
                    const exUnit = getExUnit(ex.name);
                    const validSets = sanitizeWorkoutSets(
                        (logData[ex.name] || []).map((set) => ({
                            ...set,
                            weight: storeW(set.weight, exUnit),
                        })),
                        { allowBodyweight: true }
                    );

                    if (!validSets.length) return null;

                    return {
                        name: ex.name,
                        order: index,
                        sets: validSets.map((set) => ({
                            weight: set.weight === "BW" ? "BW" : Number(set.weight),
                            reps: Number(set.reps),
                        })),
                    };
                })
                .filter(Boolean)
        );

        if (previousWorkoutActivityDateRef.current !== logDate) {
            previousWorkoutActivityDateRef.current = logDate;
            previousWorkoutActivitySignatureRef.current = activitySignature;
            return;
        }

        if (
            activitySignature !== "[]" &&
            activitySignature !== previousWorkoutActivitySignatureRef.current
        ) {
            markWorkoutActivity(logDate);
        }

        previousWorkoutActivitySignatureRef.current = activitySignature;
    }, [screen, exercises, logData, getExUnit, logDate, markWorkoutActivity]);

    useEffect(() => {
        const hasValidDraftWorkout = exercises.some((ex) => {
            const exUnit = getExUnit(ex.name);
            const validSets = sanitizeWorkoutSets(
                (logData[ex.name] || []).map((set) => ({
                    ...set,
                    weight: storeW(set.weight, exUnit),
                })),
                { allowBodyweight: true }
            );
            return validSets.length > 0;
        });

        const hasValidSavedWorkout = hasValidWorkoutOnDate(history, logDate);

        if (
            workoutStartedForDate === logDate &&
            !hasValidDraftWorkout &&
            !hasValidSavedWorkout
        ) {
            resetWorkoutElapsedTimer();
            previousWorkoutActivitySignatureRef.current = "[]";
            previousWorkoutActivityDateRef.current = logDate;
        }
    }, [exercises, getExUnit, history, logData, logDate, resetWorkoutElapsedTimer, workoutStartedForDate]);

    // useEffectより前に定義
    const persistCurrentLog = useCallback(() => {
        pendingWorkoutNotificationRef.current = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            userId: user?.id || null,
            logDate,
        };
        queueWorkoutSessionSync(logDate);
        const timerPersistence =
            workoutStartedForDate === logDate
                ? getWorkoutTimerPersistence(workoutTimerStateRef.current, Date.now())
                : null;
        const timerDurationSec =
            workoutStartedForDate === logDate
                ? Math.max(
                    Math.floor(Number(timerPersistence?.durationSec) || 0),
                    computeWorkoutDisplayElapsedSec(workoutTimerStateRef.current)
                )
                : 0;
        const durationSec = Math.max(
            0,
            timerDurationSec,
            Math.floor(Number(savedWorkoutDurationSecByDate[logDate]) || 0)
        );
        const durationMinutes = durationSec > 0 ? Math.max(1, Math.round(durationSec / 60)) : 0;

        setHistory((prev) => {
            const nh = { ...prev };

            Object.keys(nh).forEach((name) => {
                nh[name] = (nh[name] || []).filter((r) => r.date !== logDate);
                if (nh[name].length === 0) delete nh[name];
            });

            exercises.forEach((ex, index) => {
                const sets = logData[ex.name] || [];
                const exUnit = getExUnit(ex.name);
                const bodyPart = getExerciseRecordBodyPart(ex, todayLabels[0] || null);
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
                    bodyPart,
                    ...(durationSec > 0
                        ? {
                            duration_sec: durationSec,
                            durationSec,
                            durationMinutes,
                            elapsedMinutes: durationMinutes,
                        }
                        : {}),
                });
            });

            return nh;
        });
    }, [exercises, logData, logDate, getExUnit, todayLabels, user?.id, queueWorkoutSessionSync, savedWorkoutDurationSecByDate, workoutStartedForDate]); // ← 依存配列

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
        setLogData: setLogDataAndSaveDraft,
        getExSets,
        getExUnit,
        KG_TO_LBS,
        muscleEx,
        exerciseBodyPartOverrides,
    });

    const buildDraftWorkoutDaySummary = useCallback(async (targetDate, options = {}) => {
        const normalizedDate = String(targetDate || "").trim();
        if (!normalizedDate) return null;

        const entries = exercises
            .map((exercise, index) => {
                const exerciseName = String(exercise?.name || "").trim();
                if (!exerciseName) return null;

                const exUnit = typeof getExUnit === "function" ? getExUnit(exerciseName) : unit;
                const sets = sanitizeWorkoutSets(
                    (logData[exerciseName] || []).map((set) => ({
                        ...set,
                        weight: storeW(set.weight, exUnit),
                    })),
                    { allowBodyweight: true }
                );

                if (!sets.length) return null;

                const bodyPart = getExerciseRecordBodyPart(exercise, todayLabels[0] || null);
                const volume = sets.reduce((sum, set) => {
                    const weight = Number(set?.weight);
                    const reps = Number(set?.reps);
                    if (!Number.isFinite(weight) || weight <= 0) return sum;
                    if (!Number.isFinite(reps) || reps <= 0) return sum;
                    return sum + weight * reps;
                }, 0);

                const validNumericSets = sets.filter((set) => {
                    const weight = Number(set?.weight);
                    const reps = Number(set?.reps);
                    return Number.isFinite(weight) && weight > 0 && Number.isFinite(reps) && reps > 0;
                });

                const previousPr = getPreviousPR
                    ? getPreviousPR(exercise, { excludeDate: normalizedDate })
                    : (getPR ? getPR(exercise) : null);
                const previousSets = previousPr?.sets || [];
                const previousRm = previousPr?.rm ?? calc1RM(previousSets);
                const isPr = Boolean(
                    validNumericSets.length
                    && hasMeaningfulPRIncrease(
                        validNumericSets,
                        previousSets,
                        previousRm,
                        PR_UPDATE_TOLERANCE_KG
                    )
                );

                return {
                    id: `${exerciseName}-${normalizedDate}-${index}`,
                    name: exerciseName,
                    bodyPart,
                    sets,
                    setCount: sets.length,
                    volume,
                    isPr,
                };
            })
            .filter(Boolean);

        const prKeys = entries
            .filter((entry) => entry.isPr)
            .map((entry) => buildWorkoutDaySummaryPrKey(entry.bodyPart, entry.name));

        const currentTimerState = workoutTimerStateRef.current;
        const timerEndedAt =
            options.endedAt
            || currentTimerState.finishedAt
            || currentTimerState.lastActivityAt
            || Date.now();
        const durationSec =
            currentTimerState.startedForDate === normalizedDate && currentTimerState.startedAt
                ? Math.max(0, Math.floor((timerEndedAt - currentTimerState.startedAt) / 1000))
                : (savedWorkoutDurationSecByDate[normalizedDate] || 0);

        const sessionPayload = buildWorkoutSessionPayloadFromDraft({
            exercises,
            logData,
            getExUnit,
            workoutDate: normalizedDate,
        });

        let isShared = false;
        if (user?.id) {
            try {
                const { data } = await supabase
                    .from("workout_sessions")
                    .select("id")
                    .eq("user_id", user.id)
                    .eq("workout_date", normalizedDate)
                    .maybeSingle();
                isShared = Boolean(data?.id);
            } catch (error) {
                console.error("workout day summary shared state fetch failed", error);
            }
        }

        return buildWorkoutDaySummary({
            title: options.title || "今日のワークアウト完了",
            date: normalizedDate,
            entries,
            getExUnit,
            fallbackUnit: unit,
            prKeys,
            durationSec,
            isShared,
            shareTarget: sessionPayload
                ? {
                    workoutDate: normalizedDate,
                    sessionPayload,
                  }
                : null,
        });
    }, [exercises, getExUnit, getPR, getPreviousPR, logData, savedWorkoutDurationSecByDate, todayLabels, unit, user?.id]);

    const handleFinishWorkoutTimerAndShowSummary = useCallback(async () => {
        const endedAt = Date.now();
        finishWorkoutTimer(endedAt);
        const nextSummary = await buildDraftWorkoutDaySummary(logDate, {
            title: "今日のワークアウト完了",
            endedAt,
        });
        const durationSec = Math.max(0, Math.floor(Number(nextSummary?.durationSec) || 0));
        if (durationSec > 0) {
            setSavedWorkoutDurationSecByDate((prev) => ({
                ...prev,
                [logDate]: Math.max(prev[logDate] || 0, durationSec),
            }));
            setHistory((prev) => {
                const next = attachWorkoutDurationToHistoryDate(prev, logDate, durationSec);
                latestHistoryRef.current = next;
                historyRevisionRef.current += 1;
                persistHistoryForUser(user?.id, next);
                return next;
            });
            queueWorkoutSessionSync(logDate);
        }
        setSummary(nextSummary);
    }, [buildDraftWorkoutDaySummary, finishWorkoutTimer, logDate, queueWorkoutSessionSync, user?.id]);



    const removeEx = (idOrName, maybeName) => {
        const isNameOnly = maybeName === undefined;
        const targetId = isNameOnly ? null : idOrName;
        const targetName = isNameOnly ? idOrName : maybeName;
        let shouldClearDateArtifacts = false;

        setSessionEx(p =>
            (p !== null ? p : [...baseExercises]).filter(e => {
                if (targetId !== null) return e.id !== targetId;
                return e.name !== targetName;
            })
        );

        setLogData(p => {
            const n = { ...p };
            delete n[targetName];
            saveDraftForDate(logDate, {
                todayLabels,
                logData: n,
                sessionEx,
                exerciseUnits,
            });
            return n;
        });

        setExerciseUnits(p => {
            const n = { ...p };
            delete n[targetName];
            saveDraftForDate(logDate, {
                todayLabels,
                logData,
                sessionEx,
                exerciseUnits: n,
            });
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

            shouldClearDateArtifacts = !Object.values(next).some((records) =>
                (records || []).some((record) => record?.date === logDate)
            );

            return next;
        });

        appendHistoryDeleteMarkers({
            records: [buildHistoryRecordDeleteKey(logDate, targetName)],
        });

        if (shouldClearDateArtifacts) {
            appendHistoryDeleteMarkers({ dates: [logDate] });
            clearDraftForDate(logDate);
            setSavedWorkoutDurationSecByDate((prev) => {
                if (!prev[logDate]) return prev;
                const next = { ...prev };
                delete next[logDate];
                return next;
            });
            if (summary?.date === logDate) setSummary(null);
            if (workoutDayShareTarget?.workoutDate === logDate) setWorkoutDayShareTarget(null);
            if (workoutStartedForDate === logDate) resetWorkoutElapsedTimer();
            if (user?.id) {
                deleteRemoteWorkoutArtifactsForDate(user.id, logDate)
                    .then(() => {
                        clearSyncFailure(logDate);
                        setSessionSyncVersion((prev) => prev + 1);
                    })
                    .catch((error) => {
                        recordSyncFailure(logDate, error, "delete_workout_artifacts");
                        console.error("workout date artifact delete failed", {
                            error,
                            userId: user.id,
                            workoutDate: logDate,
                        });
                    });
            }
        }

        queueWorkoutSessionSync(logDate);
    };

    const setExerciseOverrideForLabel = useCallback((exerciseName, label) => {
        const normalizedName = normalizeExerciseName(exerciseName);
        if (!normalizedName) return;

        const primaryDefaultLabel = getPrimaryDefaultBodyPartLabel(normalizedName);

        setExerciseBodyPartOverrides((prev) => {
            const next = { ...prev };

            if (!label || label === primaryDefaultLabel) {
                delete next[normalizedName];
                return next;
            }

            next[normalizedName] = label;
            return next;
        });
    }, []);

    const clearExerciseOverrideForLabel = useCallback((exerciseName, label) => {
        const normalizedName = normalizeExerciseName(exerciseName);
        if (!normalizedName) return;

        setExerciseBodyPartOverrides((prev) => {
            if (prev[normalizedName] !== label) return prev;
            const next = { ...prev };
            delete next[normalizedName];
            return next;
        });
    }, []);

    const addExToSession = (name, labelOverride) => {
        const trimmed = name.trim();
        if (!trimmed) return;

        const label = labelOverride || todayLabels[0];
        if (!label) return;
        const currentSessionExercises = sessionEx !== null ? sessionEx : baseExercises;
        const alreadyInSession = currentSessionExercises.some((e) => e.name === trimmed);

        const ex = {
            id: Date.now() + (Math.random() * 1000 | 0),
            name: trimmed,
            label,
            bodyPart: label,
        };
        const nextSessionForDraft = alreadyInSession
            ? currentSessionExercises
            : [...currentSessionExercises, ex];

        setSessionEx((p) => {
            const current = p !== null ? p : [...baseExercises];
            if (current.find((e) => e.name === trimmed)) return current;

            const next = [...current, ex];
            saveDraftForDate(logDate, {
                todayLabels,
                logData: logData[trimmed] ? logData : { ...logData, [trimmed]: makeDefaultDraftSets() },
                sessionEx: next,
                exerciseUnits,
            });
            return next;
        });

        if (!alreadyInSession) {
            setLogData((prev) => {
                const next = prev[trimmed]
                    ? prev
                    : { ...prev, [trimmed]: makeDefaultDraftSets() };

                saveDraftForDate(logDate, {
                    todayLabels,
                    logData: next,
                    sessionEx: nextSessionForDraft,
                    exerciseUnits,
                });

                return next;
            });
        }

        setMuscleEx((prev) => {
            const next = { ...prev };
            const list = next[label] || [];

            if (!list.find((e) => e.name === trimmed)) {
                next[label] = [...list, { id: Date.now(), name: trimmed }];
            }

            return next;
        });

        setExerciseOverrideForLabel(trimmed, label);

        if (!alreadyInSession) {
            startWorkoutTimerIfNeeded(logDate, { markAsActivity: true });
        }
    };

    const reorderEx = (fromIdx, toIdx) => {
        setSessionEx(p => {
            const current = [...(p !== null ? p : baseExercises)];
            const [moved] = current.splice(fromIdx, 1);
            current.splice(toIdx, 0, moved);
            saveDraftForDate(logDate, {
                todayLabels,
                logData,
                sessionEx: current,
                exerciseUnits,
            });
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

        setExerciseBodyPartOverrides((prev) => {
            const oldKey = normalizeExerciseName(oldEx.name);
            if (!prev[oldKey]) return prev;
            const next = { ...prev };
            next[normalizeExerciseName(trimmed)] = prev[oldKey];
            delete next[oldKey];
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
                    clearExerciseOverrideForLabel(name, label);
                } else {
                    if (!list.find((e) => e.name === name)) {
                        next[label] = [...list, { id: Date.now(), name }];
                    }
                    setExerciseOverrideForLabel(name, label);
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
        const currentDraft = {
            todayLabels,
            logData,
            sessionEx,
            exerciseUnits,
        };

        if (hasDraftContent(currentDraft)) {
            saveDraftForDate(logDate, currentDraft);
        }

        setLogMode(dateStr === getTodayKey() ? "today" : "past");
        setLogDate(dateStr);

        const draftForDate = loadDraftForDate(dateStr);
        if (hasDraftContent(draftForDate)) {
            setTodayLabels(draftForDate.todayLabels);
            setSessionEx(draftForDate.sessionEx);
            setLogData(draftForDate.logData);
            setExerciseUnits(draftForDate.exerciseUnits);
            setScreen("log");
            return;
        }

        const dayExercises = Object.entries(history)
            .map(([name, recs]) => {
                const rec = recs.find(r => r.date === dateStr);
                if (!rec) return null;
                const recordBodyPart = String(rec.bodyPart || rec.body_part || "").trim();
                return {
                    id: name,
                    name,
                    label: recordBodyPart || EX_TO_LABEL[name] || null,
                    bodyPart: recordBodyPart || EX_TO_LABEL[name] || null,
                    order: typeof rec.order === "number" ? rec.order : 999,
                    rec,
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.order - b.order);

        const inferredLabels = [...new Set(
            dayExercises
                .map(({ bodyPart, name }) => bodyPart || EX_TO_LABEL[name])
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
            setSessionEx(dayExercises.map(({ id, name, label, bodyPart }) => ({ id, name, label, bodyPart })));
            setLogData(dayLogData);
        } else {
            setTodayLabels([]);
            setSessionEx(null);
            setLogData({});
        }
        setExerciseUnits({});

        setScreen("log");
    };


    // ② カレンダークリック用（分岐だけ）
    const handleCalendarDayOpen = (dateStr) => {
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
        queueWorkoutSessionSync(updatedRecord?.date);
    };

    const handleDeleteHistory = (exName, historyIdx, recordDate, setIdx) => {
        let shouldClearDateArtifacts = false;
        let deletedTargetDate = recordDate;

        setHistory(prev => {
            const recs = [...(prev[exName] || [])];
            const idx = historyIdx !== undefined
                ? historyIdx
                : recs.findIndex(r => r.date === recordDate);

            if (idx < 0 || idx >= recs.length) return prev;
            const targetDate = recordDate || recs[idx]?.date;
            deletedTargetDate = targetDate;

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
                appendHistoryDeleteMarkers({
                    records: [buildHistoryRecordDeleteKey(targetDate, exName)],
                });

                if (!recs.length) {
                    const next = { ...prev };
                    delete next[exName];
                    shouldClearDateArtifacts = !Object.values(next).some((records) =>
                        (records || []).some((record) => record?.date === targetDate)
                    );
                    return next;
                }

                const next = { ...prev, [exName]: recs };
                shouldClearDateArtifacts = !Object.values(next).some((records) =>
                    (records || []).some((record) => record?.date === targetDate)
                );
                return next;
            }

            // 記録単位削除
            recs.splice(idx, 1);
            appendHistoryDeleteMarkers({
                records: [buildHistoryRecordDeleteKey(targetDate, exName)],
            });

            if (!recs.length) {
                const next = { ...prev };
                delete next[exName];
                shouldClearDateArtifacts = !Object.values(next).some((records) =>
                    (records || []).some((record) => record?.date === targetDate)
                );
                return next;
            }

            const next = { ...prev, [exName]: recs };
            shouldClearDateArtifacts = !Object.values(next).some((records) =>
                (records || []).some((record) => record?.date === targetDate)
            );
            return next;
        });

        if (shouldClearDateArtifacts && deletedTargetDate) {
            appendHistoryDeleteMarkers({ dates: [deletedTargetDate] });
            clearDraftForDate(deletedTargetDate);
            setSavedWorkoutDurationSecByDate((prev) => {
                if (!prev[deletedTargetDate]) return prev;
                const next = { ...prev };
                delete next[deletedTargetDate];
                return next;
            });
            if (summary?.date === deletedTargetDate) setSummary(null);
            if (workoutDayShareTarget?.workoutDate === deletedTargetDate) setWorkoutDayShareTarget(null);
            if (workoutStartedForDate === deletedTargetDate) resetWorkoutElapsedTimer();
            if (user?.id) {
                deleteRemoteWorkoutArtifactsForDate(user.id, deletedTargetDate)
                    .then(() => {
                        clearSyncFailure(deletedTargetDate);
                        setSessionSyncVersion((prev) => prev + 1);
                    })
                    .catch((error) => {
                        recordSyncFailure(deletedTargetDate, error, "delete_workout_artifacts");
                        console.error("workout date artifact delete failed", {
                            error,
                            userId: user.id,
                            workoutDate: deletedTargetDate,
                        });
                    });
            }
        }

        queueWorkoutSessionSync(recordDate);

        // ===== draft側も更新する =====
        const dateDraft = loadDraftForDate(recordDate);
        if (!hasDraftContent(dateDraft)) return;

        const draftLog = dateDraft.logData || {};
        const draftSession = dateDraft.sessionEx;
        const draftUnits = dateDraft.exerciseUnits || {};

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

        saveDraftForDate(recordDate, {
            todayLabels: dateDraft.todayLabels,
            logData: nextDraftLog,
            sessionEx: nextDraftSession,
            exerciseUnits: nextDraftUnits,
        });

        // 今まさにその日を編集中なら画面状態にも反映
        if (logDate === recordDate) {
            setLogData(nextDraftLog);
            setSessionEx(nextDraftSession);
            setExerciseUnits(nextDraftUnits);
        }
    };

    const deleteAllHistoryForDate = (targetDate) => {
        const normalizedTargetDate = String(targetDate || "").trim();
        if (!normalizedTargetDate) return;

        const currentHistory = latestHistoryRef.current || history || {};
        const nextHistory = removeHistoryDate(currentHistory, normalizedTargetDate);
        const previousDraft = loadDraftForDate(normalizedTargetDate);
        const previousDurationSec = savedWorkoutDurationSecByDate[normalizedTargetDate] || 0;

        if (pendingDeleteUndoRef.current?.timeoutId) {
            window.clearTimeout(pendingDeleteUndoRef.current.timeoutId);
        }

        latestHistoryRef.current = nextHistory;
        historyRevisionRef.current += 1;
        persistHistoryForUser(user?.id, nextHistory);

        const recordMarkers = Object.entries(currentHistory || {})
            .filter(([, recs]) => (recs || []).some((record) => String(record?.date || "").slice(0, 10) === normalizedTargetDate))
            .map(([exName]) => buildHistoryRecordDeleteKey(normalizedTargetDate, exName));

        appendHistoryDeleteMarkers({
            dates: [normalizedTargetDate],
            records: recordMarkers,
        });

        setHistory(nextHistory);
        queueWorkoutSessionSync(normalizedTargetDate);
        pendingWorkoutSessionSyncDatesRef.current.delete(normalizedTargetDate);

        // その日が今の編集中なら画面上の状態も消す
        if (logDate === normalizedTargetDate) {
            setTodayLabels([]);
            setLogData({});
            setSessionEx(null);
            setExerciseUnits({});
        }

        // その日のdraftも消す
        clearDraftForDate(normalizedTargetDate);
        setSavedWorkoutDurationSecByDate((prev) => {
            if (!prev[normalizedTargetDate]) return prev;
            const next = { ...prev };
            delete next[normalizedTargetDate];
            return next;
        });
        if (summary?.date === normalizedTargetDate) setSummary(null);
        if (workoutDayShareTarget?.workoutDate === normalizedTargetDate) setWorkoutDayShareTarget(null);
        if (workoutStartedForDate === normalizedTargetDate) resetWorkoutElapsedTimer();

        const remoteDelete = () => {
            if (!user?.id) return;

            deleteRemoteWorkoutArtifactsForDate(user.id, normalizedTargetDate, nextHistory)
                .then(() => {
                    clearSyncFailure(normalizedTargetDate);
                    refreshHistorySyncDiagnostic(user.id, nextHistory, {
                        prefix: normalizedTargetDate.slice(0, 7),
                    });
                    setSessionSyncVersion((prev) => prev + 1);
                })
                .catch((error) => {
                    recordSyncFailure(normalizedTargetDate, error, "delete_workout_artifacts");
                    console.error("workout date artifact delete failed", {
                        error,
                        userId: user.id,
                        workoutDate: normalizedTargetDate,
                    });
                });
        };

        remoteDelete();
        const timeoutId = window.setTimeout(() => {
            pendingDeleteUndoRef.current = null;
            setPendingDeleteUndo(null);
        }, 6500);
        const undoState = {
            date: normalizedTargetDate,
            previousHistory: currentHistory,
            previousDraft,
            previousDurationSec,
            timeoutId,
        };
        pendingDeleteUndoRef.current = undoState;
        setPendingDeleteUndo({
            date: normalizedTargetDate,
        });
    };

    const undoDeleteAllHistoryForDate = useCallback(() => {
        const pending = pendingDeleteUndoRef.current;
        if (!pending?.date) return;

        if (pending.timeoutId) window.clearTimeout(pending.timeoutId);
        pendingDeleteUndoRef.current = null;
        setPendingDeleteUndo(null);

        latestHistoryRef.current = pending.previousHistory || {};
        historyRevisionRef.current += 1;
        persistHistoryForUser(user?.id, latestHistoryRef.current);
        setHistory(latestHistoryRef.current);

        saveDraftForDate(pending.date, pending.previousDraft || {});
        if (logDate === pending.date) {
            setTodayLabels(pending.previousDraft?.todayLabels || []);
            setLogData(pending.previousDraft?.logData || {});
            setSessionEx(pending.previousDraft?.sessionEx ?? null);
            setExerciseUnits(pending.previousDraft?.exerciseUnits || {});
        }

        if (pending.previousDurationSec > 0) {
            setSavedWorkoutDurationSecByDate((prev) => ({
                ...prev,
                [pending.date]: pending.previousDurationSec,
            }));
        }
        queueWorkoutSessionSync(pending.date);
        if (user?.id) {
            syncWorkoutRowsForDates(user.id, latestHistoryRef.current, [pending.date], {
                [pending.date]: pending.previousDurationSec,
            })
                .then(() => syncWorkoutSessionSnapshot(user.id, latestHistoryRef.current, pending.date))
                .then(() => clearSyncFailure(pending.date))
                .catch((error) => {
                    recordSyncFailure(pending.date, error, "undo_delete_restore");
                    console.error("undo delete restore sync failed", error);
                });
        }
    }, [
        clearSyncFailure,
        logDate,
        queueWorkoutSessionSync,
        recordSyncFailure,
        saveDraftForDate,
        syncWorkoutRowsForDates,
        syncWorkoutSessionSnapshot,
        user?.id,
    ]);

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
            <div className={appThemeClassName} style={S.root}><style>{css}</style>
                <div style={S.header}>
                    <div><div style={S.appLabel}>PUMP</div><div style={S.headerTitle}>種目設定</div></div>
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
        screen === "log" ? "ワークアウト記録"
            : screen === "analytics" ? "分析"
                : screen === "photos" ? "写真比較"
                : screen === "feed" ? "フィード"
                : screen === "calendar" ? "カレンダー"
                : screen === "ai" ? "AI"
                    : "ホーム";

    const isRecording = false;
    const bottomTabs = [
        { id: "history", icon: "🏠", label: "ホーム" },
        { id: "analytics", icon: "📊", label: "分析" },
        { id: "log", icon: null, label: "" },
        { id: "feed", icon: "💬", label: "フィード" },
        { id: "ai", icon: "🤖", label: "AI" },
    ];
    const showOfflineOnlyCard = !isOnline && ["feed", "ai"].includes(screen);
    const syncFailureDates = Object.keys(syncFailuresByDate);
    const syncFailureSignature = getSyncFailureSignature(syncFailuresByDate);
    const shouldShowSyncFailureBanner =
        isOnline &&
        syncFailureDates.length > 0 &&
        Boolean(syncFailureSignature) &&
        !dismissedSyncFailureSignaturesRef.current.has(syncFailureSignature);
    const showSplashScreen =
        !splashForceDone &&
        (!splashMinElapsed || !authReady || !historySyncReady);

    if (!isSupabaseConfigured) {
        return (
            <div style={{
                minHeight: "100dvh",
                background: "var(--bg)",
                color: "var(--text)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 24,
            }}>
                <div style={{
                    width: "100%",
                    maxWidth: 520,
                    background: "var(--card)",
                    border: "1px solid var(--border2)",
                    borderRadius: 24,
                    boxShadow: "var(--shadow-card)",
                    padding: 24,
                }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text3)", letterSpacing: 2, marginBottom: 10 }}>
                        PUMP
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 12 }}>
                        環境変数が不足しています
                    </div>
                    <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.7, marginBottom: 14 }}>
                        Capacitor のローカル build では、Vercel 本番の環境変数は自動では入りません。` .env.local ` を作成してから `npm run build` と `npm run cap:sync` を実行してください。
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 8 }}>
                        不足している項目
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                        {missingSupabaseEnvKeys.map((key) => (
                            <div key={key} style={{
                                padding: "10px 12px",
                                borderRadius: 14,
                                background: "var(--card2)",
                                border: "1px solid var(--border2)",
                                fontFamily: "monospace",
                                fontSize: 13,
                            }}>
                                {key}
                            </div>
                        ))}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.7 }}>
                        {supabaseConfigError}
                        <br />
                        `.env.example` と README の Capacitor セクションを参考に設定してください。
                    </div>
                </div>
            </div>
        );
    }

    return (
        <>
            <div className={appThemeClassName} style={S.root}>
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
                    showSettingsButton={true}
                    onOpenSettings={() => setShowSettingsModal(true)}
                    showCalendarButton={true}
                    onOpenCalendar={() => setScreen("calendar")}
                />

                {!isOnline && (
                    <div style={{ padding: "10px 18px 0" }}>
                        <div style={{
                            background: "var(--info-soft)",
                            color: "var(--text)",
                            border: "1px solid var(--info-border)",
                            borderRadius: 18,
                            padding: "12px 14px",
                            fontSize: 13,
                            lineHeight: 1.6,
                        }}>
                            オフラインです。端末内の記録は表示できます。通信が戻ると自動で同期します。
                        </div>
                    </div>
                )}

                {shouldShowSyncFailureBanner && (
                    <div
                        onTouchStart={(event) => {
                            syncBannerTouchStartYRef.current = event.touches[0].clientY;
                        }}
                        onTouchEnd={(event) => {
                            if (syncBannerTouchStartYRef.current == null) return;
                            const dy = event.changedTouches[0].clientY - syncBannerTouchStartYRef.current;
                            syncBannerTouchStartYRef.current = null;
                            if (dy < -28 || dy > 28) dismissSyncFailureBanner();
                        }}
                        style={{ padding: "10px 18px 0" }}
                    >
                        <div style={{
                            background: "rgba(245, 158, 11, 0.10)",
                            color: "var(--text)",
                            border: "1px solid rgba(245, 158, 11, 0.28)",
                            borderRadius: 18,
                            padding: "12px 14px",
                            fontSize: 13,
                            lineHeight: 1.6,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                        }}>
                            <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 900 }}>同期できていない記録があります</div>
                                <div style={{ color: "var(--text2)", fontSize: 12 }}>
                                    {syncFailureDates.slice(0, 3).join(" / ")}
                                    {syncFailureDates.length > 3 ? ` ほか${syncFailureDates.length - 3}件` : ""}
                                </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                                <button
                                    type="button"
                                    onClick={retryFailedSync}
                                    disabled={syncRetrying}
                                    style={{
                                        border: "none",
                                        borderRadius: 999,
                                        padding: "9px 12px",
                                        background: "linear-gradient(135deg, #F59E0B, #FACC15)",
                                        color: "#fff",
                                        fontSize: 12,
                                        fontWeight: 900,
                                        opacity: syncRetrying ? 0.7 : 1,
                                    }}
                                >
                                    {syncRetrying ? "再同期中" : "再同期"}
                                </button>
                                <button
                                    type="button"
                                    onClick={dismissSyncFailureBanner}
                                    aria-label="同期失敗バナーを閉じる"
                                    style={{
                                        width: 34,
                                        height: 34,
                                        borderRadius: 999,
                                        border: "1px solid rgba(245, 158, 11, 0.24)",
                                        background: "rgba(255,255,255,0.50)",
                                        color: "var(--text2)",
                                        fontSize: 20,
                                        lineHeight: 1,
                                        fontWeight: 800,
                                    }}
                                >
                                    ×
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {pendingDeleteUndo && (
                    <div
                        onTouchStart={(event) => {
                            undoToastTouchStartYRef.current = event.touches[0].clientY;
                        }}
                        onTouchEnd={(event) => {
                            if (undoToastTouchStartYRef.current == null) return;
                            const dy = event.changedTouches[0].clientY - undoToastTouchStartYRef.current;
                            undoToastTouchStartYRef.current = null;
                            if (dy > 32) dismissPendingDeleteUndo();
                        }}
                        style={{
                        position: "fixed",
                        left: 18,
                        right: 18,
                        bottom: "calc(92px + var(--safe-bottom, 0px))",
                        zIndex: 250,
                        display: "flex",
                        justifyContent: "center",
                    }}>
                        <div style={{
                            width: "100%",
                            maxWidth: 430,
                            background: "rgba(15, 94, 99, 0.96)",
                            color: "#fff",
                            borderRadius: 18,
                            padding: "12px 14px",
                            boxShadow: "0 18px 36px rgba(15, 23, 42, 0.22)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                            fontSize: 13,
                            fontWeight: 800,
                        }}>
                            <span>{pendingDeleteUndo.date} の記録を削除しました</span>
                            <button
                                type="button"
                                onClick={undoDeleteAllHistoryForDate}
                                style={{
                                    border: "1px solid rgba(255,255,255,0.3)",
                                    borderRadius: 999,
                                    background: "rgba(255,255,255,0.12)",
                                    color: "#fff",
                                    padding: "8px 12px",
                                    fontSize: 12,
                                    fontWeight: 900,
                                }}
                            >
                                元に戻す
                            </button>
                        </div>
                    </div>
                )}


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
                        {(() => {
                            const showCurrentLogWorkoutTimer = workoutStartedForDate === logDate;
                            const displayedWorkoutTimerStatus = showCurrentLogWorkoutTimer
                                ? workoutTimerStatus
                                : "idle";
                            const displayedWorkoutElapsedSec = showCurrentLogWorkoutTimer
                                ? workoutElapsedSec
                                : (savedWorkoutDurationSecByDate[logDate] || 0);

                            return (
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
                            removeEx={removeEx}
                            timerLeft={timerLeft}
                            intervalSec={intervalSec}
                            setIntervalSec={setIntervalSec}
                            startTimer={startTimer}
                            stopTimer={stopTimer}
                            saveLog={handleSaveLog}
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
                            workoutElapsedSec={displayedWorkoutElapsedSec}
                            workoutTimerStatus={displayedWorkoutTimerStatus}
                            onFinishWorkoutTimer={handleFinishWorkoutTimerAndShowSummary}
                            resetSession={() => {
                                deleteAllHistoryForDate(logDate);
                            }}
                        />
                            );
                        })()}
                    </div>
                )}

                {screen === "analytics" && (
                    <AnalyticsScreen
                        history={history}
                        manualBests={manualBests}
                        muscleEx={muscleEx}
                        hiddenBodyParts={hiddenBodyParts}
                        exerciseBodyPartOverrides={exerciseBodyPartOverrides}
                        onOpenPhotoCompare={() => setScreen("photos")}
                    />

                )}

                {screen === "photos" && (
                    <PhotoScreen user={user} />
                )}


                {screen === "feed" && !showOfflineOnlyCard && (
                    <FriendsScreen
                        mode="feed"
                        history={history}
                        historySyncDiagnostic={historySyncDiagnostic}
                        manualBests={manualBests}
                        sessionSyncVersion={sessionSyncVersion}
                        user={user}
                        onLogin={() => setShowAuth(true)}
                        onOpenRecord={() => setScreen("history")}
                        onLogout={handleLogout}

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
                            setLogMode("today");
                            setScreen("log");
                        }}
                    />
                )}

                {screen === "ranking" && !showOfflineOnlyCard && (
                    <FriendsScreen
                        mode="ranking"
                        history={history}
                        historySyncDiagnostic={historySyncDiagnostic}
                        manualBests={manualBests}
                        sessionSyncVersion={sessionSyncVersion}
                        user={user}
                        onLogin={() => setShowAuth(true)}
                        onOpenRecord={() => setScreen("history")}
                        onLogout={handleLogout}
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
                            setLogMode("today");
                            setScreen("log");
                        }}
                    />
                )}

                {screen === "history" && (
                    <HomeScreen
                        history={history}
                        muscleEx={muscleEx}
                        exerciseBodyPartOverrides={exerciseBodyPartOverrides}
                        hiddenBodyParts={hiddenBodyParts}
                        onStartLog={() => {
                            handleLogForDate(getTodayKey());
                        }}
                        user={user}
                        workoutDurationSecByDate={savedWorkoutDurationSecByDate}
                    />
                )}

                {screen === "calendar" && (
                    <HistoryScreen
                        history={history}
                        todayWorkoutDurationSec={workoutElapsedSec || savedWorkoutDurationSecByDate[logDate] || 0}
                        muscleEx={muscleEx}
                        exerciseBodyPartOverrides={exerciseBodyPartOverrides}
                        hiddenBodyParts={hiddenBodyParts}
                        onEditHistory={handleEditHistory}
                        onDeleteHistory={handleDeleteHistory}
                        onDeleteDate={deleteAllHistoryForDate}
                        workoutDurationSecByDate={savedWorkoutDurationSecByDate}
                        unit={unit}
                        getExUnit={getExUnit}
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
                        onOpenWorkoutDaySummary={(nextSummary) => {
                            setSummary(nextSummary);
                        }}
                    />
                )}

                {screen === "ai" && !showOfflineOnlyCard && (
                    <AIScreen
                        aiMsgs={aiMsgs}
                        aiInput={aiInput}
                        setAiInput={setAiInput}
                        sendAI={sendAI}
                        aiLoad={aiLoad}
                        aiEnd={aiEnd}
                        history={history}
                        aiRemaining={aiRemaining}
                    />
                )}

                {showOfflineOnlyCard && (
                    <div style={{ padding: "18px" }}>
                        <div style={{
                            ...S.sectionCard,
                            display: "flex",
                            flexDirection: "column",
                            gap: 14,
                        }}>
                            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: "var(--text3)" }}>
                                PUMP
                            </div>
                            <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.1 }}>
                                オフラインです
                            </div>
                            <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.7 }}>
                                {screen === "feed"
                                    ? "フィードはオンライン時に表示できます。通信が戻ると最新の記録を取得します。"
                                    : screen === "ranking"
                                        ? "ランキングはオンライン時に表示できます。通信が戻ると最新順位を取得します。"
                                        : "AI Coach はオンライン時に利用できます。"}
                            </div>
                            <div style={{
                                ...S.subtleCard,
                                background: "var(--success-soft)",
                                borderColor: "var(--success-border)",
                                fontSize: 13,
                                color: "var(--text2)",
                                lineHeight: 1.7,
                            }}>
                                記録、今日のワークアウト、カレンダーはオフラインでも確認できます。
                            </div>
                            <button
                                onClick={() => setScreen("history")}
                                style={{
                                    ...S.pillBtn,
                                    alignSelf: "flex-start",
                                    background: "linear-gradient(135deg, var(--accent), var(--accent2))",
                                    color: "#fff",
                                    padding: "12px 18px",
                                }}
                            >
                                記録を見る
                            </button>
                        </div>
                    </div>
                )}

                <BottomNav
                    tabs={bottomTabs}
                    activeTab={screen === "photos" ? "analytics" : screen === "ranking" ? "feed" : screen === "calendar" ? "history" : screen}
                    onSelectTab={(nextScreen) => {
                        if (nextScreen === "log") {
                            handleLogForDate(getTodayKey());
                            return;
                        }
                        setScreen(nextScreen);
                    }}
                    isRecording={isRecording}
                />

                {showOnboarding && <OnboardingOverlay onDone={() => completeOnboarding()} />}
                <WorkoutDaySummaryModal
                    isOpen={Boolean(summary)}
                    summary={summary}
                    onClose={closeWorkoutDaySummary}
                    onOpenWorkout={
                        summary?.openWorkoutDate
                            ? () => {
                                const targetDate = summary.openWorkoutDate;
                                setSummary(null);
                                handleCalendarDayOpen(targetDate);
                              }
                            : undefined
                    }
                    onShare={
                        summary?.shareTarget && !summary?.isShared
                            ? () => openWorkoutDayShareModal(summary.shareTarget)
                            : undefined
                    }
                />
                <WorkoutSessionShareModal
                    isOpen={Boolean(workoutDayShareTarget)}
                    onClose={closeWorkoutDayShareModal}
                    workoutDate={workoutDayShareTarget?.workoutDate}
                    sessionPayload={workoutDayShareTarget?.sessionPayload || null}
                />
                <SettingsModal
                    isOpen={showSettingsModal}
                    onClose={() => setShowSettingsModal(false)}
                    user={user}
                    onLogout={handleLogout}
                    onExportData={handleExportData}
                    onDeleteAccount={handleDeleteAccount}
                    accountActionBusy={accountActionBusy}
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
                            ? "iPhoneの設定でPUMPの通知を許可すると、友達の記録やトレーニングのリマインドを受け取れます。"
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

                <SplashScreen visible={showSplashScreen} />
                <Analytics />
            </div>
        </>
    );
}
