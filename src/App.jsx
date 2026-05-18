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
    `${String(date || "")}::${normalizeExerciseName(exerciseName)}`;

const applyHistoryDeleteMarkers = (historyMap, markers) => {
    const normalizedMarkers = normalizeHistoryDeleteMarkers(markers);
    if (!normalizedMarkers.dates.length && !normalizedMarkers.records.length) {
        return historyMap;
    }

    const deletedDates = new Set(normalizedMarkers.dates);
    const deletedRecords = new Set(normalizedMarkers.records);
    const next = {};

    Object.entries(historyMap || {}).forEach(([exerciseName, records]) => {
        const filtered = (records || []).filter((record) => {
            const recordDate = String(record?.date || "");
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

export default function GymApp() {
    const getTodayKey = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    // ─── State ────────────────────────────────────────
    // eslint-disable-next-line no-unused-vars
    const [user, setUser] = useState(null);

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
        if (!isSupabaseConfigured) {
            setUser(null);
            return undefined;
        }

        let isMounted = true;

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

        supabase.auth.getSession().then(({ data: { session } }) => {
            void syncAuthenticatedUser(session?.user ?? null);
        });
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            void syncAuthenticatedUser(session?.user ?? null);
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
    const [logMode, setLogMode] = useState("today");

    const {
        addSet,
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


    const [exerciseUnits, setExerciseUnits] = useState(() => load("draft_exerciseUnits", {}));
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
    const previousWorkoutActivitySignatureRef = useRef("");
    const previousWorkoutActivityDateRef = useRef("");
    const workoutTimerStateRef = useRef(initialWorkoutTimerState);
    const previousOnlineStateRef = useRef(isOnline);

    // 設定画面用モーダル
    const [showAddEx, setShowAddEx] = useState(false);
    const [addTarget, setAddTarget] = useState(null);
    const [newExName, setNewExName] = useState("");
    const [summary, setSummary] = useState(null);
    const [workoutDayShareTarget, setWorkoutDayShareTarget] = useState(null);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
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
            if (!user?.id || !logDate) return;

            try {
                const [{ data: sessionData }, { data: workoutData }] = await Promise.all([
                    supabase
                        .from("workout_sessions")
                        .select("duration_sec")
                        .eq("user_id", user.id)
                        .eq("workout_date", logDate)
                        .maybeSingle(),
                    supabase
                        .from("workouts")
                        .select("duration_sec")
                        .eq("user_id", user.id)
                        .eq("date", logDate)
                        .maybeSingle(),
                ]);

                const durationSec = Math.max(
                    Math.floor(Number(sessionData?.duration_sec) || 0),
                    Math.floor(Number(workoutData?.duration_sec) || 0)
                );

                if (!cancelled) {
                    setSavedWorkoutDurationSecByDate((prev) => ({
                        ...prev,
                        [logDate]: durationSec,
                    }));
                }
            } catch (error) {
                console.error("load saved workout duration failed", error);
            }
        }

        loadSavedWorkoutDuration();

        return () => {
            cancelled = true;
        };
    }, [user?.id, logDate]);

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
    }, []);

    const clearSyncFailure = useCallback((workoutDate) => {
        const normalizedDate = String(workoutDate || "").trim();
        if (!normalizedDate || !syncFailuresByDateRef.current[normalizedDate]) return;
        const nextFailures = { ...syncFailuresByDateRef.current };
        delete nextFailures[normalizedDate];
        syncFailuresByDateRef.current = nextFailures;
    }, []);

    const syncWorkoutRowsForDates = useCallback(async (userId, historyMap, dates = []) => {
        const normalizedDates = [...new Set((dates || []).map((date) => String(date || "").trim()).filter(Boolean))];
        const results = {
            syncedDates: [],
            failedDates: [],
        };

        if (!userId || !normalizedDates.length) return results;

        await Promise.all(
            normalizedDates.map(async (workoutDate) => {
                try {
                    const { error } = await supabase
                        .from("workouts")
                        .upsert({
                            user_id: userId,
                            date: workoutDate,
                            data: historyMap,
                        }, {
                            onConflict: "user_id,date",
                        });

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
            console.log("[sync] history remote diagnostic", {
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
            .select("id, started_at")
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
            : Math.max(
                0,
                Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000)
            );

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
                const recordDate = String(record?.date || "");
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
                    .select("date, data")
                    .eq("user_id", user.id)
                    .order("date", { ascending: true });

                if (error) throw error;

                const remoteHistory = applyHistoryDeleteMarkers(
                    buildHistoryFromWorkoutRows(data),
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
                    .select("date, data")
                    .eq("user_id", currentUserId)
                    .order("date", { ascending: true });

                if (error) throw error;
                if (latestUserIdRef.current !== currentUserId) return;

                const remoteHistory = applyHistoryDeleteMarkers(
                    buildHistoryFromWorkoutRows(data),
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

                const workoutSyncResults = await syncWorkoutRowsForDates(currentUserId, mergedHistory, syncDates);
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

        const hasDraft =
            sessionEx !== null ||
            Object.keys(logData).length > 0 ||
            Object.keys(exerciseUnits).length > 0 ||
            todayLabels.length > 0;

        if (!hasDraft || logMode !== "today") return;

        save("draft_todayLabels", todayLabels);
        save("draft_logData", logData);
        save("draft_sessionEx", sessionEx);
        save("draft_exerciseUnits", exerciseUnits);
        save("draft_logDate", logDate);
    }, [screen, todayLabels, logData, sessionEx, exerciseUnits, logDate, logMode]);

    useEffect(() => { save("routineOrder", routineOrder); }, [routineOrder]);

    useEffect(() => {
        const d = new Date();
        const today =
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

        setLogMode("today");
        setLogDate(today);
        setTodayLabels([]);
        setSessionEx(null);
        setLogData({});
        setExerciseUnits({});
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
                });
            });

            return nh;
        });
    }, [exercises, logData, logDate, getExUnit, todayLabels, user?.id, queueWorkoutSessionSync]); // ← 依存配列

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
                : 0;

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
    }, [exercises, getExUnit, getPR, getPreviousPR, logData, todayLabels, unit, user?.id]);

    const handleFinishWorkoutTimerAndShowSummary = useCallback(async () => {
        const endedAt = Date.now();
        finishWorkoutTimer(endedAt);
        const nextSummary = await buildDraftWorkoutDaySummary(logDate, {
            title: "今日のワークアウト完了",
            endedAt,
        });
        setSummary(nextSummary);
    }, [buildDraftWorkoutDaySummary, finishWorkoutTimer, logDate]);



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

        appendHistoryDeleteMarkers({
            records: [buildHistoryRecordDeleteKey(logDate, targetName)],
        });
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
        let didAddExercise = false;

        const ex = {
            id: Date.now() + (Math.random() * 1000 | 0),
            name: trimmed,
            label,
            bodyPart: label,
        };

        setSessionEx((p) => {
            const current = p !== null ? p : [...baseExercises];
            if (current.find((e) => e.name === trimmed)) return current;

            didAddExercise = true;
            const next = [...current, ex];
            save("draft_sessionEx", next);
            save("draft_logDate", logDate);
            return next;
        });

        setMuscleEx((prev) => {
            const next = { ...prev };
            const list = next[label] || [];

            if (!list.find((e) => e.name === trimmed)) {
                next[label] = [...list, { id: Date.now(), name: trimmed }];
            }

            return next;
        });

        setExerciseOverrideForLabel(trimmed, label);

        if (didAddExercise) {
            startWorkoutTimerIfNeeded(logDate, { markAsActivity: true });
        }
    };

    const reorderEx = (fromIdx, toIdx) => {
        setSessionEx(p => {
            const current = [...(p !== null ? p : baseExercises)];
            const [moved] = current.splice(fromIdx, 1);
            current.splice(toIdx, 0, moved);
            save("draft_sessionEx", current);
            save("draft_logDate", logDate);
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
        const hasCurrentDraft =
            sessionEx !== null ||
            Object.keys(logData).length > 0 ||
            Object.keys(exerciseUnits).length > 0 ||
            todayLabels.length > 0;

        if (hasCurrentDraft && logMode === "today") {
            save("draft_todayLabels", todayLabels);
            save("draft_logData", logData);
            save("draft_sessionEx", sessionEx);
            save("draft_exerciseUnits", exerciseUnits);
            save("draft_logDate", logDate);
        }
        setSessionEx(null);
        setLogData({});
        setExerciseUnits({});

        setLogMode(dateStr === getTodayKey() ? "today" : "past");
        setLogDate(dateStr);

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
            setLogMode("past");
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
        queueWorkoutSessionSync(updatedRecord?.date);
    };

    const handleDeleteHistory = (exName, historyIdx, recordDate, setIdx) => {
        setHistory(prev => {
            const recs = [...(prev[exName] || [])];
            const idx = historyIdx !== undefined
                ? historyIdx
                : recs.findIndex(r => r.date === recordDate);

            if (idx < 0 || idx >= recs.length) return prev;
            const targetDate = recordDate || recs[idx]?.date;

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
                    return next;
                }

                return { ...prev, [exName]: recs };
            }

            // 記録単位削除
            recs.splice(idx, 1);
            appendHistoryDeleteMarkers({
                records: [buildHistoryRecordDeleteKey(targetDate, exName)],
            });

            if (!recs.length) {
                const next = { ...prev };
                delete next[exName];
                return next;
            }

            return { ...prev, [exName]: recs };
        });
        queueWorkoutSessionSync(recordDate);

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
        const recordMarkers = Object.entries(history || {})
            .filter(([, recs]) => (recs || []).some((record) => record?.date === targetDate))
            .map(([exName]) => buildHistoryRecordDeleteKey(targetDate, exName));

        appendHistoryDeleteMarkers({
            dates: [targetDate],
            records: recordMarkers,
        });

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
        queueWorkoutSessionSync(targetDate);

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
                            workoutElapsedSec={displayedWorkoutElapsedSec}
                            workoutTimerStatus={displayedWorkoutTimerStatus}
                            onFinishWorkoutTimer={handleFinishWorkoutTimerAndShowSummary}
                            resetSession={() => {
                                setSessionEx(null);
                                setLogData({});
                                setExerciseUnits({});
                                save("draft_sessionEx", null);
                                save("draft_logData", {});
                                save("draft_exerciseUnits", {});
                                resetWorkoutElapsedTimer();
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
                            const d = new Date();
                            const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                            setLogMode("today");
                            setLogDate(today);
                            setTodayLabels([]);
                            setSessionEx(null);
                            setLogData({});
                            setExerciseUnits({});
                            setScreen("log");
                        }}
                        user={user}
                    />
                )}

                {screen === "calendar" && (
                    <HistoryScreen
                        history={history}
                        muscleEx={muscleEx}
                        exerciseBodyPartOverrides={exerciseBodyPartOverrides}
                        hiddenBodyParts={hiddenBodyParts}
                        onEditHistory={handleEditHistory}
                        onDeleteHistory={handleDeleteHistory}
                        onDeleteDate={deleteAllHistoryForDate}
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

                <Analytics />
            </div>
        </>
    );
}
