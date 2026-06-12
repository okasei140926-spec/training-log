import { lazy, Suspense, useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo } from "react";
import { isSupabaseConfigured, missingSupabaseEnvKeys, supabase, supabaseConfigError } from "./utils/supabase";
import {
    load,
    save,
    KG_TO_LBS,
    formatDateKey,
    getValidWorkoutDatesFromHistory,
    hasValidWorkoutOnDate,
    mergeHistoryMaps,
    sanitizeHistoryRecord,
    sanitizeWorkoutSets,
} from "./utils/helpers";
// useWorkoutLog → useWorkoutLogBridge
import { QUICK_LABELS, LABEL_COLORS } from "./constants/suggestions";
import { S, css } from "./utils/styles";
import { Analytics } from "@vercel/analytics/react";
// eslint-disable-next-line no-unused-vars

import { useAI } from "./hooks/useAI";
import { useSettings } from "./hooks/useSettings";

import LogScreenView from "./components/LogScreenView";
import CalendarScreenView from "./components/CalendarScreenView";
import FeedScreenView from "./components/FeedScreenView";
import RankingScreenView from "./components/RankingScreenView";
import HomeScreen from "./components/HomeScreen";
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
// buildWorkoutSessionPayloadFromDraft → useWorkoutDaySummaryBuilder
import WorkoutSessionShareModal from "./components/modals/WorkoutSessionShareModal";
import SettingsModal from "./components/modals/SettingsModal";
// buildWorkoutDaySummary, buildWorkoutDaySummaryPrKey → useWorkoutDaySummaryBuilder

import { useWorkout } from "./hooks/useWorkout";
import { useTimer } from "./hooks/useTimer";
import { useLogLogic } from "./hooks/useLogLogic";
import { useDisplayHistory } from "./hooks/useDisplayHistory";
import { useWorkoutSession } from "./hooks/useWorkoutSession";
// enablePushNotificationsForUser, getNotificationPermission, getPushSupportState, syncPushSubscriptionState → usePushNotifications
import {
    cancelRestTimerNotification,
    scheduleRestTimerNotification,
} from "./lib/restTimerNotifications";
import { normalizeExerciseName } from "./utils/exerciseName";
import { convertPlanWeight, normalizePlanUnit, normalizeWorkoutPlan } from "./utils/aiWorkoutPlan";
// computeWorkoutDisplayElapsedSec, getWorkoutTimerPersistence → usePersistCurrentLog
// APP_VERSION and HISTORY_CACHE_SCHEMA_VERSION are used only in appHelpers.js
import { useHistorySync } from "./hooks/useHistorySync";
import { useHistorySave } from "./hooks/useHistorySave";
import { useWorkoutSummary } from "./hooks/useWorkoutSummary";
import { useHistoryHandlers } from "./hooks/useHistoryHandlers";
import { useWorkoutHandlers } from "./hooks/useWorkoutHandlers";
import { useUIHandlers } from "./hooks/useUIHandlers";
import { useLogDateRefresh } from "./hooks/useLogDateRefresh";
import { usePushNotifications } from "./hooks/usePushNotifications";
import { useDraftRestore } from "./hooks/useDraftRestore";
import { useHistoryAutoSave } from "./hooks/useHistoryAutoSave";
import { useRetrySyncCallback } from "./hooks/useRetrySyncCallback";
import { usePersistCurrentLog } from "./hooks/usePersistCurrentLog";
import { useWorkoutLogBridge } from "./hooks/useWorkoutLogBridge";
import { useWorkoutDaySummaryBuilder } from "./hooks/useWorkoutDaySummaryBuilder";
import { useAccountActions } from "./hooks/useAccountActions";
import { useWorkoutSyncHelpers } from "./hooks/useWorkoutSyncHelpers";
import { useDraftStore } from "./hooks/useDraftStore";
import { useLogDraftApplicator } from "./hooks/useLogDraftApplicator";
import { useWorkoutsDataHistorySync } from "./hooks/useWorkoutsDataHistorySync";
import { useAuthSetup } from "./hooks/useAuthSetup";
import {
    applyHistoryDeleteMarkers,
    applyPreferredHistoryDates,
    attachRecordFetchContext,
    buildDraftHistoryForDate,
    buildHistoryFromWorkoutSessionRows,
    buildHistoryRecordDeleteKey,
    buildRemoteHistoryWithWorkoutRowsPriority,
    buildTrustedRowSignatureMap,
    buildVersionedHistoryCache,
    buildWorkoutDraftForDateFromHistory,
    clearVersionedAppCachesIfNeeded,
    createEmptyHistoryDeleteMarkers,
    describeHistoryRecordsForDate,
    EX_TO_LABEL,
    EXERCISE_BODY_PART_OVERRIDES_KEY,
    EXPLICIT_SET_EDIT_REASONS,
    EXPLICIT_WORKOUT_EDIT_REASONS,
    findEditedSetInHistory,
    getCurrentWeekRangeForHomeSummary,
    getDateDaysAgoKey,
    getDraftDateValidation,
    getDraftMetricsForDate,
    getDraftPayloadDate,
    getEmptyWorkoutMetrics,
    getHistoryDatesInRange,
    getHistoryDebugDiffForDate,
    getHistoryDebugSummaryForDate,
    getHistoryDeleteMarkersKey,
    getHistoryLoadErrorMessage,
    getHistoryMetricsForDate,
    getHistoryOverallMetrics,
    getHomePropsDateDebug,
    getHomeWeeklySourceDebug,
    getHomeWeeklySummaryDebug,
    getNextMonthPrefix,
    getPerfNow,
    getRawDraftSetMetrics,
    HISTORY_OWNER_KEY,
    getRuntimeEnvironmentLabel,
    getSetDisplayUnit,
    getSetEditSummary,
    getSetEditUnit,
    getUserHistoryCacheKey,
    getWorkoutDraftSignature,
    getWorkoutPayloadMetrics,
    getWorkoutRowsDebugSummary,
    getWorkoutSaveGuardDecision,
    getWorkoutSessionRowsDebugSummary,
    getWorkoutSummaryMetrics,
    isCleanPersistedDraft,
    isDestructiveWorkoutRegression,
    isEditedSetPersisted,
    isExplicitWorkoutEditChange,
    isMetricPersistenceMismatch,
    isPlainObject,
    isTransientSupabaseFetchError,
    isUnsavedUserWorkoutDraft,
    loadTrustedHistoryCache,
    logRecordFetchError,
    logWorkoutPersistenceDecision,
    makeDraftMeta,
    mergeDraftExercisesWithLogData,
    mergeTrustedRowsByDate,
    normalizeDraftDateKey,
    normalizeDraftSetFromRecord,
    normalizeHistoryDeleteMarkers,
    normalizeLogDraftState,
    normalizeTrustedSessionRowDate,
    normalizeTrustedWorkoutRowDate,
    persistHistoryForUser,
    serializeHistoryMap,
    serializeTrustedRow,
    serializeTrustedRows,
    shouldLogPerfDebug,
    shouldPreserveRawDraftOverIncoming,
    sortTrustedRowsByDate,
    storeSetWeightForUnit,
    withDraftDateMeta,
    withDraftMeta,
} from "./utils/appHelpers";

const AnalyticsScreen = lazy(() => import("./components/AnalyticsScreen"));
const PhotoScreen = lazy(() => import("./components/PhotoScreen"));
const AIScreen = lazy(() => import("./components/AIScreen"));
const Auth = lazy(() => import("./components/Auth"));

clearVersionedAppCachesIfNeeded();

export default function GymApp() {
    const getTodayKey = useCallback(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }, []);

    const { getDraftKey, loadDraftForDate, hasDraftContent, makeDefaultDraftSets, saveDraftForDate, clearDraftForDate } = useDraftStore();

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

    const applyLocalHistoryDates = useCallback((baseHistory, localHistory, dates = []) => {
        const normalizedDates = [...new Set((dates || []).map((date) => String(date || "").slice(0, 10)).filter(Boolean))];
        let nextHistory = mergeHistoryMaps(baseHistory || {});

        normalizedDates.forEach((date) => {
            nextHistory = removeHistoryDate(nextHistory, date);
            const dateRecords = {};
            Object.entries(localHistory || {}).forEach(([exName, recs]) => {
                const filtered = (recs || []).filter((record) => String(record?.date || "").slice(0, 10) === date);
                if (filtered.length > 0) dateRecords[exName] = filtered;
            });
            nextHistory = mergeHistoryMaps(nextHistory, dateRecords);
        });

        return nextHistory;
    }, [removeHistoryDate]);

    // ─── State ────────────────────────────────────────
    // eslint-disable-next-line no-unused-vars
    const [user, setUser] = useState(null);
    const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
    const [splashMinElapsed, setSplashMinElapsed] = useState(false);
    const [splashForceDone, setSplashForceDone] = useState(false);

    const [muscleEx, setMuscleEx] = useState(() => load("routineEx", {}));
    const [history, setHistory] = useState({});
    const [workoutsDataHistory, setWorkoutsDataHistory] = useState({});
    const [manualBests, setManualBests] = useState([]);
    const [historyReloadNonce, setHistoryReloadNonce] = useState(0);
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

    useEffect(() => {
        const minTimerId = window.setTimeout(() => setSplashMinElapsed(true), 120);
        const maxTimerId = window.setTimeout(() => setSplashForceDone(true), 500);

        return () => {
            window.clearTimeout(minTimerId);
            window.clearTimeout(maxTimerId);
        };
    }, []);

    useAuthSetup({
        user,
        setUser,
        setAuthReady,
        setShowAuth,
        setScreen,
    });

    const {
        showPushPrompt,
        pushPromptBusy,
        pushPromptMessage,
        pushStatus,
        enablePushFromPrompt,
        setShowPushPrompt,
        setPushPromptMessage,
    } = usePushNotifications({ user, screen, showAuth });

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

            saveDraftForDate(logDate, withDraftDateMeta(logDate, {
                todayLabels: next,
                logData,
                sessionEx,
                exerciseUnits,
                meta: makeDraftMeta(latestLogDraftRef.current?.meta || {}, {
                    source: "user_edit",
                    hasUnsavedChanges: true,
                }),
            }));
            return next;
        });
    };
    const [logData, setLogData] = useState(() => loadDraftForDate(getTodayKey()).logData);
    const [sessionHistory, setSessionHistory] = useState(null);
    const [sessionEx, setSessionEx] = useState(() => loadDraftForDate(getTodayKey()).sessionEx);
    const latestLogDraftRef = useRef({
        todayLabels: [],
        logData: {},
        sessionEx: null,
        exerciseUnits: {},
    });

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
    const [, setLogMode] = useState("today");
    const [exerciseUnits, setExerciseUnits] = useState(() => loadDraftForDate(getTodayKey()).exerciseUnits);

    // eslint-disable-next-line no-unused-vars
    const { isDark, setIsDark, unit, setUnit, showOnboarding, completeOnboarding } = useSettings();
    const appThemeClassName = isDark ? "app-shell" : "theme-light app-shell";

    const getExUnit = useCallback((name) => {
        return exerciseUnits[name] ?? unit;
    }, [exerciseUnits, unit]);

    const pendingWorkoutContentChangeDatesRef = useRef(new Map());
    const explicitWorkoutEditDatesRef = useRef(new Map());
    const lastAppliedLogDataHashRef = useRef("");
    const lastAutosavedDraftSignatureRef = useRef("");
    const initialDraftLoadRanRef = useRef(false);

    const getCurrentLogDraftSnapshot = useCallback(() => {
        const latestDraft = latestLogDraftRef.current || {};
        const useLatestDraft = hasDraftContent(latestDraft);
        return normalizeLogDraftState(useLatestDraft
            ? latestDraft
            : { todayLabels, logData, sessionEx, exerciseUnits }
        );
    }, [exerciseUnits, hasDraftContent, logData, sessionEx, todayLabels]);

    const { applyLogDraftState, applyCurrentLogDraft, setLogDataAndSaveDraft } = useLogDraftApplicator({        logDate,        screen,        exerciseUnits,        logData,        sessionEx,        todayLabels,        user,        latestLogDraftRef,        pendingWorkoutContentChangeDatesRef,        lastAppliedLogDataHashRef,        lastAutosavedDraftSignatureRef,        hasDraftContent,        saveDraftForDate,        getCurrentLogDraftSnapshot,        setTodayLabels,        setLogData,        setSessionEx,        setExerciseUnits,    });
    const markLogWorkoutContentChanged = useCallback((reason = "set_update", details = {}) => {
        const normalizedDate = String(logDate || "").slice(0, 10);
        if (!normalizedDate) return;

        const previous = pendingWorkoutContentChangeDatesRef.current.get(normalizedDate) || {};
        const explicitEdit = Boolean(previous.explicitEdit || details.explicitEdit || EXPLICIT_WORKOUT_EDIT_REASONS.has(reason));
        pendingWorkoutContentChangeDatesRef.current.set(normalizedDate, {
            ...previous,
            reason,
            explicitDelete: Boolean(previous.explicitDelete),
            explicitEdit,
            details,
            updatedAt: new Date().toISOString(),
        });
        if (explicitEdit) {
            explicitWorkoutEditDatesRef.current.set(normalizedDate, {
                reason,
                updatedAt: Date.now(),
            });
        }
        pendingWorkoutSessionSyncDatesRef.current.add(normalizedDate);

        if (EXPLICIT_SET_EDIT_REASONS.has(reason)) {
            console.log("[workout edit] explicit set edit", {
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                date: normalizedDate,
                exerciseName: details.exerciseName || null,
                setIndex: details.setIndex ?? null,
                before: details.beforeSet || null,
                after: details.afterSet || null,
                saveReason: reason,
                explicitEdit: true,
            });
        }
    }, [logDate, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const { saveLog } = useLogLogic({
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
        getExUnit,
        onWorkoutContentChange: markLogWorkoutContentChanged,
        userId: user?.id || null,
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
    const [timerMenuAnchor, setTimerMenuAnchor] = useState(null);

    const resetDocumentInteractionLocks = useCallback(() => {
        const body = document.body;
        const html = document.documentElement;
        if (!body || !html) return;

        body.style.overflow = "";
        body.style.position = "";
        body.style.top = "";
        body.style.width = "";
        body.style.touchAction = "";
        html.style.overflow = "";
        html.style.overscrollBehavior = "";
    }, []);

    useEffect(() => {
        setShowTimerMenu(false);
        setTimerMenuAnchor(null);
        setFocusedLogSetInputId(null);
        setIsLogKeyboardOpen(false);
        setFocusedAiChatInput(false);
        setIsAiKeyboardOpen(false);
        const id = window.setTimeout(resetDocumentInteractionLocks, 0);
        return () => window.clearTimeout(id);
    }, [screen, setShowTimerMenu, resetDocumentInteractionLocks]);

    useEffect(() => {
        if (typeof window === "undefined" || typeof document === "undefined") return undefined;
        if (screen !== "log" && screen !== "ai") {
            setIsLogKeyboardOpen(false);
            setIsAiKeyboardOpen(false);
            return undefined;
        }

        let timeoutId = 0;
        const updateKeyboardState = () => {
            const viewport = window.visualViewport;
            const keyboardInset = viewport
                ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
                : 0;
            const activeElement = document.activeElement;
            const setInputFocused = activeElement?.getAttribute?.("data-log-set-input") === "true";
            const aiInputFocused = activeElement?.getAttribute?.("data-ai-chat-input") === "true";
            const keyboardOpen = keyboardInset > 120;
            if (screen === "log") {
                setIsLogKeyboardOpen(keyboardOpen);
                if (setInputFocused) {
                    setFocusedLogSetInputId(
                        activeElement?.getAttribute?.("data-log-set-input-id") || "__log_set_input__"
                    );
                } else if (!keyboardOpen) {
                    setFocusedLogSetInputId(null);
                }
            }
            if (screen === "ai") setIsAiKeyboardOpen(keyboardOpen);
            if (setInputFocused && !keyboardOpen) {
                window.setTimeout(() => {
                    const nextViewport = window.visualViewport;
                    const nextKeyboardInset = nextViewport
                        ? Math.max(0, window.innerHeight - nextViewport.height - nextViewport.offsetTop)
                        : 0;
                    if (nextKeyboardInset <= 80) setFocusedLogSetInputId(null);
                }, 450);
            }
            if (aiInputFocused && !keyboardOpen) {
                window.setTimeout(() => {
                    const nextViewport = window.visualViewport;
                    const nextKeyboardInset = nextViewport
                        ? Math.max(0, window.innerHeight - nextViewport.height - nextViewport.offsetTop)
                        : 0;
                    if (nextKeyboardInset <= 80) setFocusedAiChatInput(false);
                }, 450);
            }
        };
        const scheduleKeyboardStateUpdate = () => {
            window.clearTimeout(timeoutId);
            updateKeyboardState();
            timeoutId = window.setTimeout(updateKeyboardState, 120);
        };

        scheduleKeyboardStateUpdate();
        window.addEventListener("focusin", scheduleKeyboardStateUpdate);
        window.addEventListener("focusout", scheduleKeyboardStateUpdate);
        window.addEventListener("resize", scheduleKeyboardStateUpdate);
        window.visualViewport?.addEventListener("resize", scheduleKeyboardStateUpdate);
        window.visualViewport?.addEventListener("scroll", scheduleKeyboardStateUpdate);

        return () => {
            window.clearTimeout(timeoutId);
            window.removeEventListener("focusin", scheduleKeyboardStateUpdate);
            window.removeEventListener("focusout", scheduleKeyboardStateUpdate);
            window.removeEventListener("resize", scheduleKeyboardStateUpdate);
            window.visualViewport?.removeEventListener("resize", scheduleKeyboardStateUpdate);
            window.visualViewport?.removeEventListener("scroll", scheduleKeyboardStateUpdate);
        };
    }, [screen]);

    useEffect(() => {
        if (!showTimerMenu) return undefined;
        const closeTimerMenu = () => setShowTimerMenu(false);
        window.addEventListener("scroll", closeTimerMenu, true);
        return () => window.removeEventListener("scroll", closeTimerMenu, true);
    }, [showTimerMenu, setShowTimerMenu]);

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
    const {
        workoutStartedAt,
        workoutFinishedAt,
        workoutStartedForDate,
        workoutIsFinished,
        workoutLastActivityAt,
        workoutTimerStateRef,
        workoutElapsedSec,
        savedWorkoutDurationSecByDate,
        setSavedWorkoutDurationSecByDate,
        workoutTimerStatus,
        resetWorkoutElapsedTimer,
        finishWorkoutTimer,
        startWorkoutTimerIfNeeded,
        markWorkoutActivity,
    } = useWorkoutSession({ getTodayKey, user });

    const touchStartX = useRef(null);
    const touchStartY = useRef(null);
    const latestUserIdRef = useRef(null);
    const latestHistoryRef = useRef(history);
    const pendingWorkoutNotificationRef = useRef(null);
    const historyDeleteMarkersRef = useRef(createEmptyHistoryDeleteMarkers());
    const dismissedSyncFailureSignaturesRef = useRef(new Set());
    const pendingDeleteUndoRef = useRef(null);
    const workoutsDataHistoryRef = useRef(workoutsDataHistory);
    const homePropsDebugSignatureRef = useRef("");
    const logScreenRenderDebugSignatureRef = useRef("");

    const previousWorkoutActivitySignatureRef = useRef("");
    const previousWorkoutActivityDateRef = useRef("");
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
    const [focusedLogSetInputId, setFocusedLogSetInputId] = useState(null);
    const [isLogKeyboardOpen, setIsLogKeyboardOpen] = useState(false);
    const [logExerciseFocusRequest, setLogExerciseFocusRequest] = useState(null);
    const [lastActiveLogExerciseByDate, setLastActiveLogExerciseByDate] = useState(() =>
        load("lastActiveLogExerciseByDate", {})
    );
    const [focusedAiChatInput, setFocusedAiChatInput] = useState(false);
    const [isAiKeyboardOpen, setIsAiKeyboardOpen] = useState(false);
    // historySyncDiagnostic state and refreshHistorySyncDiagnostic are provided by useWorkoutSummary (called below)

    // handleLogSetInputFocusChange, requestLogExerciseFocus, handleLogExerciseActiveChange,
    // markLogSetInputActive, clearLogSetInputActiveIfClosed, handleLogScreenFocusCapture,
    // handleLogScreenInputPointerDownCapture, handleLogScreenBlurCapture, handleAiInputFocusChange
    // → all extracted to useUIHandlers (called below)
    // The useEffect that depends on markLogSetInputActive / clearLogSetInputActiveIfClosed
    // is placed after the useUIHandlers call (search: "log set input activation useEffect")

    useEffect(() => {
        const wasOnline = previousOnlineStateRef.current;
        if (!wasOnline && isOnline) {
            setSessionSyncVersion((prev) => prev + 1);
        }
        previousOnlineStateRef.current = isOnline;
    }, [isOnline]);


    // ─── AI Coach ─────────────────────────────────────
    const {
        aiMsgs,
        aiInput,
        setAiInput,
        aiLoad,
        aiEnd,
        sendAI,
        isPro,
        proPlan,
        activatePumpPro,
        restorePumpPro,
        deactivatePumpProDev,
        refreshPumpProStatus,
        dailyFreeAiLimit,
        aiUsageDate,
        aiUsageCount,
        aiRemaining,
        aiConversations,
        aiConversationLoading,
        aiConversationError,
        activeConversationId,
        openAiConversation,
        startNewAiConversation,
        deleteAiConversation,
    } = useAI({ loadConversationsOnMount: screen === "ai" });

    useEffect(() => {
        latestUserIdRef.current = user?.id ?? null;
    }, [user?.id]);

    useEffect(() => {
        const previousMeta = latestLogDraftRef.current?.meta || null;
        latestLogDraftRef.current = {
            todayLabels,
            logData,
            sessionEx,
            exerciseUnits,
            meta: previousMeta,
        };
    }, [exerciseUnits, logData, sessionEx, todayLabels]);

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
        const hasAppModalOpen =
            showAddEx ||
            Boolean(summary) ||
            Boolean(workoutDayShareTarget) ||
            showSettingsModal ||
            showAuth ||
            showPushPrompt ||
            showOnboarding;

        if (hasAppModalOpen) return undefined;

        const id = window.setTimeout(resetDocumentInteractionLocks, 0);
        return () => window.clearTimeout(id);
    }, [
        resetDocumentInteractionLocks,
        screen,
        showAddEx,
        summary,
        workoutDayShareTarget,
        showSettingsModal,
        showAuth,
        showPushPrompt,
        showOnboarding,
    ]);

    useEffect(() => {
        latestHistoryRef.current = history;
        historyRevisionRef.current += 1;
    }, [history]); // eslint-disable-line react-hooks/exhaustive-deps

    const { applyWorkoutsDataHistorySnapshot } = useWorkoutsDataHistorySync({        workoutsDataHistory,        workoutsDataHistoryRef,        user,        setWorkoutsDataHistory,    });
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

    const getCurrentHistoryDeleteMarkers = useCallback(() => (
        normalizeHistoryDeleteMarkers(historyDeleteMarkersRef.current)
    ), []);

    const {
        trustedWorkoutRows,
        trustedSessionRows,
        historyRemoteReady,
        historyLoadError,
        setHistoryLoadError,
        historySyncReady,
        historyRemoteLoadFailedRef,
        applyTrustedWorkoutRowsSnapshot,
        applyTrustedSessionRowsSnapshot,
        runDedupeSupabaseFetch,
    } = useHistorySync({
        user,
        latestHistoryRef,
        workoutsDataHistoryRef,
        workoutsDataHistory,
        setHistory,
        setWorkoutsDataHistory,
        applyWorkoutsDataHistorySnapshot,
        historyDeleteMarkersRef,
        getCurrentHistoryDeleteMarkers,
        historyReloadNonce,
        persistHistoryForUser,
        screen,
        sessionSyncVersion,
        applyLocalHistoryDates,
        pendingWorkoutContentChangeDatesRef,
        // module-level helpers
        shouldLogPerfDebug,
        getRuntimeEnvironmentLabel,
        isTransientSupabaseFetchError,
        logRecordFetchError,
        attachRecordFetchContext,
        getHistoryLoadErrorMessage,
        getCurrentWeekRangeForHomeSummary,
        getHistoryOverallMetrics,
        getHistoryMetricsForDate,
        getWorkoutRowsDebugSummary,
        getWorkoutSessionRowsDebugSummary,
        getNextMonthPrefix,
        getHomeWeeklySummaryDebug,
        getHomeWeeklySourceDebug,
        getDateDaysAgoKey,
        isPlainObject,
        serializeHistoryMap,
        buildHistoryFromWorkoutSessionRows,
        buildRemoteHistoryWithWorkoutRowsPriority,
        normalizeTrustedWorkoutRowDate,
        normalizeTrustedSessionRowDate,
        sortTrustedRowsByDate,
        mergeTrustedRowsByDate,
        serializeTrustedRows,
        serializeTrustedRow,
        buildTrustedRowSignatureMap,
        applyHistoryDeleteMarkers,
        loadTrustedHistoryCache,
        buildVersionedHistoryCache,
        getUserHistoryCacheKey,
        HISTORY_OWNER_KEY,
        getHistoryDeleteMarkersKey,
        normalizeHistoryDeleteMarkers,
        createEmptyHistoryDeleteMarkers,
    });

    const {
        historyRevisionRef,
        historySaveQueueRef,
        pendingWorkoutSessionSyncDatesRef,
        syncFailuresByDateRef,
        queueWorkoutSessionSync,
        markWorkoutContentChanged,
        recordSyncFailure,
        clearSyncFailure,
        syncWorkoutRowsForDates,
        syncWorkoutSessionSnapshot,
        cleanupWorkoutSessionsForHistory,
    } = useHistorySave({
        pendingWorkoutContentChangeDatesRef,
        explicitWorkoutEditDatesRef,
        user,
        latestUserIdRef,
        applyTrustedWorkoutRowsSnapshot,
        setSyncFailuresByDate,
        getTodayKey,
        // module-level helpers
        getRuntimeEnvironmentLabel,
        EXPLICIT_SET_EDIT_REASONS,
        EXPLICIT_WORKOUT_EDIT_REASONS,
        isExplicitWorkoutEditChange,
        logRecordFetchError,
        logWorkoutPersistenceDecision,
        getWorkoutSaveGuardDecision,
        getHistoryMetricsForDate,
        getEmptyWorkoutMetrics,
        getWorkoutSummaryMetrics,
        getWorkoutPayloadMetrics,
        isMetricPersistenceMismatch,
        getHistoryDebugSummaryForDate,
        getHistoryDebugDiffForDate,
        applyPreferredHistoryDates,
        normalizeExerciseName,
        mergeHistoryMaps,
        hasValidWorkoutOnDate,
        findEditedSetInHistory,
        isEditedSetPersisted,
        getSetEditSummary,
        getSetEditUnit,
        buildHistoryFromWorkoutSessionRows,
        describeHistoryRecordsForDate,
    });

    const {
        historySyncDiagnostic,
        refreshHistorySyncDiagnostic,
    } = useWorkoutSummary({
        runDedupeSupabaseFetch,
        syncFailuresByDateRef,
        getDateDaysAgoKey,
        getNextMonthPrefix,
        logRecordFetchError,
    });

    // closeWorkoutDaySummary, closeWorkoutDayShareModal, openWorkoutDayShareModal → useUIHandlers

    const { handleLogout, handleExportData, handleDeleteAccount } = useAccountActions({
        user,
        history,
        muscleEx,
        routineOrder,
        manualBests,
        customBodyParts,
        hiddenBodyParts,
        exerciseBodyPartOverrides,
        savedWorkoutDurationSecByDate,
        accountActionBusy,
        latestHistoryRef,
        syncFailuresByDateRef,
        resetWorkoutElapsedTimer,
        setHistory,
        setManualBests,
        setMuscleEx,
        setRoutineOrder,
        setCustomBodyParts,
        setHiddenBodyParts,
        setExerciseBodyPartOverrides,
        setSavedWorkoutDurationSecByDate,
        setTodayLabels,
        setLogData,
        setSessionEx,
        setExerciseUnits,
        setSummary,
        setWorkoutDayShareTarget,
        setSyncFailuresByDate,
        setAccountActionBusy,
        setShowSettingsModal,
        setShowAuth,
    });

    const { fetchRemoteWorkoutRowsForDates, hasRemoteWorkoutForDate, buildLatestLocalHistoryForRetryDate, deleteRemoteWorkoutArtifactsForDate } = useWorkoutSyncHelpers({
        applyTrustedWorkoutRowsSnapshot,
        loadDraftForDate,
        hasDraftContent,
        getExUnit,
        savedWorkoutDurationSecByDate,
    });

    // refreshHistorySyncDiagnostic is provided by useWorkoutSummary (called above)



    const { retryFailedSync } = useRetrySyncCallback({
        user,
        history,
        syncRetrying,
        syncFailuresByDateRef,
        latestHistoryRef,
        workoutsDataHistoryRef,
        explicitWorkoutEditDatesRef,
        pendingWorkoutContentChangeDatesRef,
        pendingWorkoutSessionSyncDatesRef,
        buildLatestLocalHistoryForRetryDate,
        fetchRemoteWorkoutRowsForDates,
        hasRemoteWorkoutForDate,
        syncWorkoutRowsForDates,
        syncWorkoutSessionSnapshot,
        deleteRemoteWorkoutArtifactsForDate,
        applyWorkoutsDataHistorySnapshot,
        saveDraftForDate,
        savedWorkoutDurationSecByDate,
        clearSyncFailure,
        recordSyncFailure,
        refreshHistorySyncDiagnostic,
        setHistory,
        setSyncRetrying,
        setSyncFailuresByDate,
        setSessionSyncVersion,
    });

    // ─── Persist ──────────────────────────────────────
    useEffect(() => { save("routineEx", muscleEx); }, [muscleEx]);
    useEffect(() => {
        if (!authReady) {
            console.warn("[restore] skip local history persistence before auth is ready", {
                env: getRuntimeEnvironmentLabel(),
                currentDisplayed: getHistoryOverallMetrics(history),
            });
            return;
        }
        if (user?.id && (!historySyncReady || !historyRemoteReady || historyRemoteLoadFailedRef.current)) {
            console.warn("[restore] skip local history persistence while remote history is not trusted", {
                env: getRuntimeEnvironmentLabel(),
                user_id: user.id,
                historySyncReady,
                historyRemoteReady,
                remoteLoadFailed: historyRemoteLoadFailedRef.current,
                currentDisplayed: getHistoryOverallMetrics(history),
            });
            return;
        }
        if (user?.id && getValidWorkoutDatesFromHistory(history).length === 0) {
            console.warn("[restore] skip empty history persistence for logged-in user", {
                env: getRuntimeEnvironmentLabel(),
                user_id: user.id,
                reason: "empty history must not overwrite Supabase-backed cache",
            });
            return;
        }
        if (!user?.id && getValidWorkoutDatesFromHistory(history).length === 0) {
            return;
        }
        persistHistoryForUser(user?.id, history);
    }, [authReady, history, historyRemoteLoadFailedRef, historyRemoteReady, historySyncReady, user]);
    useEffect(() => {
        save("lastActiveLogExerciseByDate", lastActiveLogExerciseByDate || {});
    }, [lastActiveLogExerciseByDate]);
    useEffect(() => { save("customBodyParts", customBodyParts); }, [customBodyParts]);
    useEffect(() => { save(EXERCISE_BODY_PART_OVERRIDES_KEY, exerciseBodyPartOverrides); }, [exerciseBodyPartOverrides]);
    useEffect(() => { save("hiddenBodyParts", hiddenBodyParts); }, [hiddenBodyParts]);

    // dismissPushPromptForToday → useUIHandlers

    useHistoryAutoSave({
        history,
        user,
        historySyncReady,
        logDate,
        screen,
        clearSyncFailure,
        getCurrentHistoryDeleteMarkers,
        historyRevisionRef,
        historySaveQueueRef,
        latestUserIdRef,
        latestHistoryRef,
        latestLogDraftRef,
        pendingWorkoutContentChangeDatesRef,
        pendingWorkoutSessionSyncDatesRef,
        pendingWorkoutNotificationRef,
        explicitWorkoutEditDatesRef,
        workoutsDataHistoryRef,
        workoutTimerStateRef,
        historyRemoteLoadFailedRef,
        recordSyncFailure,
        refreshHistorySyncDiagnostic,
        hasRemoteWorkoutForDate,
        savedWorkoutDurationSecByDate,
        syncWorkoutSessionSnapshot,
        syncWorkoutRowsForDates,
        cleanupWorkoutSessionsForHistory,
        applyTrustedSessionRowsSnapshot,
        applyTrustedWorkoutRowsSnapshot,
        applyWorkoutsDataHistorySnapshot,
        workoutFinishedAt,
        workoutIsFinished,
        workoutLastActivityAt,
        workoutStartedAt,
        workoutStartedForDate,
        applyLocalHistoryDates,
        applyLogDraftState,
        loadDraftForDate,
        saveDraftForDate,
        setHistory,
        setSessionSyncVersion,
    });

    useEffect(() => {
        if (!isOnline || !user?.id || !historySyncReady) return;

        let cancelled = false;

        const backfillCurrentMonthWorkoutSessions = async () => {
            const todayKey = formatDateKey(new Date());
            const currentMonthStart = `${todayKey.slice(0, 7)}-01`;
            const targetDates = getValidWorkoutDatesFromHistory(history, { prefix: todayKey.slice(0, 7) });
            if (!targetDates.length) return;

            try {
                console.warn("[save guard] automatic month backfill write disabled", {
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user.id,
                    dates: targetDates,
                    source: "automatic queue retry / screen open",
                    allowed: false,
                    blockedReason: "auto resend is disabled until explicit user edit",
                });

                if (!cancelled) {
                    console.log("[sync] automatic month diagnostic skipped", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        reason: "avoid repeated Supabase fetches on home open",
                    });
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
        hasRemoteWorkoutForDate,
        history,
        historySyncReady,
        recordSyncFailure,
        isOnline,
        user?.id,
    ]);

    useEffect(() => {
        if (!user?.id || !historySyncReady) return;
        if (Object.keys(syncFailuresByDateRef.current || {}).length === 0) return;
        const monthPrefix = formatDateKey(new Date()).slice(0, 7);
        refreshHistorySyncDiagnostic(user.id, history, { prefix: monthPrefix });
    }, [history, historySyncReady, refreshHistorySyncDiagnostic, sessionSyncVersion, syncFailuresByDateRef, user?.id]);

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
        if (String(latestLogDraftRef.current?.meta?.source || "").startsWith("useWorkoutLog:")) {
            return;
        }

        const normalizedDate = String(logDate || "").slice(0, 10);
        const pendingChange = normalizedDate
            ? pendingWorkoutContentChangeDatesRef.current.get(normalizedDate)
            : null;
        const draftMeta = pendingChange
            ? makeDraftMeta(latestLogDraftRef.current?.meta || {}, {
                source: pendingChange.reason || "user_edit",
                hasUnsavedChanges: true,
                updatedAt: pendingChange.updatedAt || new Date().toISOString(),
            })
            : latestLogDraftRef.current?.meta || null;
        const draft = withDraftDateMeta(normalizedDate, {
            todayLabels,
            logData,
            sessionEx,
            exerciseUnits,
            meta: draftMeta,
        }, {
            source: draftMeta?.source || "autosave_draft",
            hasUnsavedChanges: draftMeta?.hasUnsavedChanges ?? true,
            updatedAt: draftMeta?.updatedAt,
            remoteVerifiedAt: draftMeta?.remoteVerifiedAt,
        });

        if (!hasDraftContent(draft)) return;

        const draftSignature = JSON.stringify({
            date: normalizedDate,
            content: getWorkoutDraftSignature(draft),
            metaSource: draft.meta?.source || null,
            hasUnsavedChanges: draft.meta?.hasUnsavedChanges ?? null,
            updatedAt: draft.meta?.updatedAt || null,
            remoteVerifiedAt: draft.meta?.remoteVerifiedAt || null,
        });
        if (lastAutosavedDraftSignatureRef.current === draftSignature) return;
        lastAutosavedDraftSignatureRef.current = draftSignature;

        saveDraftForDate(normalizedDate, draft);
    }, [screen, todayLabels, logData, sessionEx, exerciseUnits, logDate, hasDraftContent, saveDraftForDate]);

    useEffect(() => { save("routineOrder", routineOrder); }, [routineOrder]);

    useEffect(() => {
        if (initialDraftLoadRanRef.current) return;
        initialDraftLoadRanRef.current = true;

        const today = getTodayKey();
        const todayDraft = loadDraftForDate(today);

        setLogMode("today");
        setLogDate(today);
        if (hasDraftContent(todayDraft)) {
            applyLogDraftState(todayDraft);
        } else {
            applyLogDraftState({ todayLabels: [], sessionEx: null, logData: {}, exerciseUnits: {} });
        }
        if (!new URLSearchParams(window.location.search).get("ref")) {
            setScreen("history");
        }
    }, [applyLogDraftState, getTodayKey, hasDraftContent, loadDraftForDate]);

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



    // ─── Per-exercise default unit ────────────────────
    const toggleExUnit = (name) => {
        const currentDraft = getCurrentLogDraftSnapshot();
        const currentUnits = currentDraft.exerciseUnits || exerciseUnits;
        const currentUnit = currentUnits[name] ?? unit;
        const CYCLE = { kg: "lbs", lbs: "BW", BW: "kg" };
        const newUnit = CYCLE[currentUnit] || "kg";
        markWorkoutContentChanged(logDate, "unit_change", {
            explicitEdit: true,
            details: {
                exerciseName: name,
                beforeSet: { unit: currentUnit },
                afterSet: { unit: newUnit },
            },
        });

        const nextUnits = { ...currentUnits, [name]: newUnit };
        applyCurrentLogDraft({
            ...currentDraft,
            todayLabels: currentDraft.todayLabels?.length ? currentDraft.todayLabels : todayLabels,
            exerciseUnits: nextUnits,
            meta: makeDraftMeta(currentDraft.meta || {}, {
                source: "unit_change",
                hasUnsavedChanges: true,
            }),
        });
    };

    // ─── Derived ──────────────────────────────────────
    const dayColor = LABEL_COLORS[todayLabels[0]] || null;

    const baseExercises = buildBaseExercises({
        todayLabels,
        muscleEx,
        routineOrder,
    });

    const sourceExercises = sessionEx !== null ? sessionEx : baseExercises;
    const exercises = useMemo(
        () => mergeDraftExercisesWithLogData(sourceExercises, logData, todayLabels),
        [sourceExercises, logData, todayLabels]
    );

    const workoutLogInitialDraft = useMemo(() => ({
        date: logDate,
        todayLabels,
        exercises,
        logData,
        sessionEx: exercises,
        exerciseUnits,
        meta: latestLogDraftRef.current?.meta || null,
    }), [exerciseUnits, exercises, logData, logDate, todayLabels]);

    const {
        workoutLog,
        workoutLogExercises,
        workoutLogData,
        workoutLogExerciseUnits,
        addSet,
        setField,
        setWeightMode,
    } = useWorkoutLogBridge({
        logDate,
        workoutLogInitialDraft,
        todayLabels,
        user,
        latestLogDraftRef,
        lastAutosavedDraftSignatureRef,
        markWorkoutContentChanged,
        saveDraftForDate,
        getTodayKey,
        setTodayLabels,
        setLogData,
        setSessionEx,
        setExerciseUnits,
    });

    const getWorkoutLogExUnit = useCallback((name) => (
        workoutLogExerciseUnits?.[name] || getExUnit(name)
    ), [getExUnit, workoutLogExerciseUnits]);

    const {
        displayHistory,
        canonicalDisplayHistory,
    } = useDisplayHistory({
        history,
        workoutsDataHistory,
        trustedWorkoutRows,
        trustedSessionRows,
        logDate,
        screen,
        workoutStartedForDate,
        savedWorkoutDurationSecByDate,
        todayLabels,
        workoutLogExercises,
        workoutLogData,
        getWorkoutLogExUnit,
        pendingWorkoutContentChangeDatesRef,
        workoutTimerStateRef,
        buildDraftHistoryForDate,
        getCurrentWeekRangeForHomeSummary,
        shouldLogPerfDebug,
    });

    useEffect(() => {
        if (screen !== "history") return;
        if (!shouldLogPerfDebug()) return;
        const weekRange = getCurrentWeekRangeForHomeSummary();
        const debugDates = ["2026-06-01", "2026-06-02", "2026-06-03"];
        const summary = getHomeWeeklySummaryDebug(canonicalDisplayHistory, weekRange);
        const signature = JSON.stringify({
            dates: getHistoryDatesInRange(canonicalDisplayHistory, weekRange),
            counts: summary.bodyPartCounts,
            history: getHistoryOverallMetrics(history),
            workoutsDataHistory: getHistoryOverallMetrics(workoutsDataHistory),
            displayHistory: getHistoryOverallMetrics(displayHistory),
        });
        if (homePropsDebugSignatureRef.current === signature) return;
        homePropsDebugSignatureRef.current = signature;

        console.log("[home props]", {
            action: "home_props_before_render",
            sourceOfHistoryProp: "useWorkoutHistory trustedHistory (workouts.data exactHistory priority)",
            user_id: user?.id || null,
            historyLength: getHistoryOverallMetrics(history),
            workoutsDataHistoryLength: getHistoryOverallMetrics(workoutsDataHistory),
            canonicalDisplayHistoryLength: getHistoryOverallMetrics(canonicalDisplayHistory),
            displayHistoryLength: getHistoryOverallMetrics(displayHistory),
            datesIncluded: getHistoryDatesInRange(canonicalDisplayHistory, weekRange),
            historyDatesIncluded: getHistoryDatesInRange(history, weekRange),
            workoutsDataHistoryDatesIncluded: getHistoryDatesInRange(workoutsDataHistory, weekRange),
            displayHistoryDatesIncluded: getHistoryDatesInRange(displayHistory, weekRange),
            sessionsByDate: getHomePropsDateDebug(canonicalDisplayHistory, debugDates),
            historySessionsByDate: getHomePropsDateDebug(history, debugDates),
            workoutsDataHistorySessionsByDate: getHomePropsDateDebug(workoutsDataHistory, debugDates),
            displayHistorySessionsByDate: getHomePropsDateDebug(displayHistory, debugDates),
            calculatedCountsBeforePassing: summary.bodyPartCounts,
            shoulderCount: summary.bodyPartCounts["肩"] || 0,
            tricepsCount: summary.bodyPartCounts["三頭"] || 0,
            bicepsCount: summary.bodyPartCounts["二頭"] || 0,
            backCount: summary.bodyPartCounts["背中"] || 0,
        });
    }, [canonicalDisplayHistory, displayHistory, history, screen, user?.id, workoutsDataHistory]);

    useEffect(() => {
        if (screen !== "log") return;

        const activitySignature = JSON.stringify(
            exercises
                .map((ex, index) => {
                    const exUnit = getExUnit(ex.name);
                    const validSets = sanitizeWorkoutSets(
                        (logData[ex.name] || []).map((set) => ({
                            ...set,
                            weight: storeSetWeightForUnit(set, exUnit),
                            displayWeight: set.weight,
                            displayUnit: getSetDisplayUnit(set, exUnit),
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
                    weight: storeSetWeightForUnit(set, exUnit),
                    displayWeight: set.weight,
                    displayUnit: getSetDisplayUnit(set, exUnit),
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
    const { persistCurrentLog } = usePersistCurrentLog({
        logDate,
        exercises,
        logData,
        todayLabels,
        exerciseUnits,
        history,
        user,
        workoutStartedForDate,
        savedWorkoutDurationSecByDate,
        pendingWorkoutContentChangeDatesRef,
        latestLogDraftRef,
        pendingWorkoutNotificationRef,
        workoutTimerStateRef,
        latestHistoryRef,
        historyRevisionRef,
        lastAutosavedDraftSignatureRef,
        hasDraftContent,
        applyWorkoutsDataHistorySnapshot,
        saveDraftForDate,
        queueWorkoutSessionSync,
        getExUnit,
        getTodayKey,
        getDraftKey,
        setHistory,
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (screen !== "log") return;
        if (user?.id && !historySyncReady) return;

        const hasAnyValidSet = exercises.some((ex) =>
            (logData[ex.name] || []).some((s) => s.weight && s.reps)
        );

        if (!hasAnyValidSet) return;

        const t = setTimeout(() => {
            persistCurrentLog();
        }, 400);

        return () => clearTimeout(t);
    }, [screen, logData, exercises, logDate, exerciseUnits, persistCurrentLog, user?.id, historySyncReady]);

    const previousScreenRef = useRef(screen);
    useEffect(() => {
        const previousScreen = previousScreenRef.current;
        if (previousScreen === "log" && screen !== "log") {
            persistCurrentLog();
        }
        previousScreenRef.current = screen;
    }, [persistCurrentLog, screen]);

    useEffect(() => {
        const flushPendingLog = () => {
            persistCurrentLog();
        };
        const handleVisibilityChange = () => {
            if (document.visibilityState === "hidden") flushPendingLog();
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener("pagehide", flushPendingLog);
        window.addEventListener("beforeunload", flushPendingLog);

        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener("pagehide", flushPendingLog);
            window.removeEventListener("beforeunload", flushPendingLog);
        };
    }, [persistCurrentLog]);

    // ─── Log data ─────────────────────────────────────





    const { getPrev, getPR, getPreviousPR, copySetDown, copyRepDown } = useWorkout({
        history: canonicalDisplayHistory,
        manualBests,
        sessionHistory,
        setLogData: setLogDataAndSaveDraft,
        getExSets,
        getExUnit,
        KG_TO_LBS,
        muscleEx,
        exerciseBodyPartOverrides,
    });

    const { handleFinishWorkoutTimerAndShowSummary } = useWorkoutDaySummaryBuilder({
        logDate,
        exercises,
        logData,
        todayLabels,
        unit,
        user,
        savedWorkoutDurationSecByDate,
        workoutTimerStateRef,
        latestHistoryRef,
        historyRevisionRef,
        getExUnit,
        getPR,
        getPreviousPR,
        finishWorkoutTimer,
        queueWorkoutSessionSync,
        setSavedWorkoutDurationSecByDate,
        setSummary,
        setHistory,
    });



    const {
        closeWorkoutDaySummary,
        closeWorkoutDayShareModal,
        openWorkoutDayShareModal,
        getSyncFailureSignature,
        dismissSyncFailureBanner,
        dismissPendingDeleteUndo,
        dismissPushPromptForToday,
        handleLogSetInputFocusChange,
        markLogSetInputActive,
        clearLogSetInputActiveIfClosed,
        handleLogScreenFocusCapture,
        handleLogScreenInputPointerDownCapture,
        handleLogScreenBlurCapture,
        requestLogExerciseFocus,
        handleLogExerciseActiveChange,
        handleAiInputFocusChange,
    } = useUIHandlers({
        setSummary,
        setWorkoutDayShareTarget,
        syncFailuresByDateRef,
        dismissedSyncFailureSignaturesRef,
        setSyncFailuresByDate,
        pendingDeleteUndoRef,
        setPendingDeleteUndo,
        setShowPushPrompt,
        setPushPromptMessage,
        setFocusedLogSetInputId,
        setIsLogKeyboardOpen,
        setLogExerciseFocusRequest,
        logDate,
        setLastActiveLogExerciseByDate,
        setFocusedAiChatInput,
    });

    // ── log set input activation useEffect (depends on markLogSetInputActive / clearLogSetInputActiveIfClosed from useUIHandlers) ──
    useEffect(() => {
        if (typeof window === "undefined" || typeof document === "undefined") return undefined;
        if (screen !== "log") {
            document.body?.removeAttribute("data-log-set-input-active");
            return undefined;
        }

        const activateFromTarget = (target) => {
            if (!(target instanceof HTMLElement)) return;
            const setInput = target.closest("[data-log-set-input='true']");
            if (setInput) markLogSetInputActive(setInput);
        };
        const handleFocusIn = (event) => activateFromTarget(event.target);
        const handleTouchStart = (event) => activateFromTarget(event.target);
        const handlePointerDown = (event) => activateFromTarget(event.target);
        const scheduleClear = () => window.setTimeout(clearLogSetInputActiveIfClosed, 360);

        const syncKeyboardState = () => {
            const viewport = window.visualViewport;
            const keyboardInset = viewport
                ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
                : 0;
            const keyboardOpen = keyboardInset > 80;
            const activeElement = document.activeElement;
            const activeLogInput =
                activeElement instanceof HTMLElement
                    ? activeElement.closest("[data-log-set-input='true']")
                    : null;
            setIsLogKeyboardOpen(keyboardOpen);
            if (activeLogInput) {
                markLogSetInputActive(activeLogInput, false);
                return;
            }
            if (keyboardOpen) {
                document.body?.setAttribute("data-log-set-input-active", "true");
                return;
            }
            document.body?.removeAttribute("data-log-set-input-active");
            setFocusedLogSetInputId(null);
        };

        document.addEventListener("focusin", handleFocusIn, true);
        document.addEventListener("touchstart", handleTouchStart, true);
        document.addEventListener("pointerdown", handlePointerDown, true);
        document.addEventListener("focusout", scheduleClear, true);
        window.visualViewport?.addEventListener("resize", syncKeyboardState);
        window.visualViewport?.addEventListener("scroll", syncKeyboardState);
        syncKeyboardState();

        return () => {
            document.removeEventListener("focusin", handleFocusIn, true);
            document.removeEventListener("touchstart", handleTouchStart, true);
            document.removeEventListener("pointerdown", handlePointerDown, true);
            document.removeEventListener("focusout", scheduleClear, true);
            window.visualViewport?.removeEventListener("resize", syncKeyboardState);
            window.visualViewport?.removeEventListener("scroll", syncKeyboardState);
            document.body?.removeAttribute("data-log-set-input-active");
        };
    }, [screen, markLogSetInputActive, clearLogSetInputActiveIfClosed]);

    const {
        setExerciseOverrideForLabel,
        removeEx,
        addExToSession,
        reorderEx,
        renameEx,
        quickAdd,
        quickAddToSession,
    } = useWorkoutHandlers({
        workoutLog,
        todayLabels,
        logDate,
        user,
        addTarget,
        setMuscleEx,
        setExerciseBodyPartOverrides,
        requestLogExerciseFocus,
        startWorkoutTimerIfNeeded,
        shouldLogPerfDebug,
        getRuntimeEnvironmentLabel,
    });

    const handleAddAiWorkoutPlanToLog = (rawPlan) => {
        const plan = normalizeWorkoutPlan(rawPlan);
        if (!plan.length) return;

        const todayKey = getTodayKey();
        markWorkoutContentChanged(todayKey, "ai_workout_plan_add");
        const currentDraft = withDraftDateMeta(logDate, getCurrentLogDraftSnapshot(), {
            source: latestLogDraftRef.current?.meta?.source || "current_log_snapshot",
            hasUnsavedChanges: latestLogDraftRef.current?.meta?.hasUnsavedChanges ?? true,
        });

        if (hasDraftContent(currentDraft)) {
            saveDraftForDate(logDate, currentDraft);
        }

        const todayDraft = logDate === todayKey
            ? currentDraft
            : loadDraftForDate(todayKey);
        const baseLogData = { ...(todayDraft.logData || {}) };
        const baseUnits = { ...(todayDraft.exerciseUnits || {}) };
        const baseLabels = Array.isArray(todayDraft.todayLabels) ? [...todayDraft.todayLabels] : [];
        const existingSession = Array.isArray(todayDraft.sessionEx)
            ? todayDraft.sessionEx
            : logDate === todayKey
                ? [...exercises]
                : Object.keys(baseLogData).map((name) => ({
                    id: `${name}-${todayKey}`,
                    name,
                    label: EX_TO_LABEL[name] || baseLabels[0] || "その他",
                    bodyPart: EX_TO_LABEL[name] || baseLabels[0] || "その他",
                }));
        const nextSession = [...existingSession];
        const nextLogData = { ...baseLogData };
        const nextUnits = { ...baseUnits };
        const nextLabels = [...baseLabels];
        let firstAddedExercise = null;

        const ensureLabel = (label) => {
            const safeLabel = label && QUICK_LABELS.includes(label) ? label : (label || "その他");
            if (safeLabel !== "その他" && !nextLabels.includes(safeLabel)) nextLabels.push(safeLabel);
            return safeLabel;
        };

        const makeDraftSet = (set, sourceUnit, targetUnit) => {
            const normalizedTargetUnit = normalizePlanUnit(targetUnit);
            const normalizedSourceUnit = normalizePlanUnit(set?.unit || sourceUnit);
            const reps = Number(set?.reps);
            const targetReps = Number.isFinite(reps) && reps > 0 ? String(Math.floor(reps)) : "";

            if (normalizedTargetUnit === "BW" || String(set?.weight || "").toUpperCase() === "BW") {
                return {
                    weight: "BW",
                    reps: "",
                    targetReps,
                    done: false,
                    weightMode: "BW",
                    weightType: "BW",
                    unit: "BW",
                    displayUnit: "BW",
                    weightUnit: "BW",
                    weight_unit: "BW",
                };
            }

            const weightValue = convertPlanWeight(set?.weight, normalizedSourceUnit, normalizedTargetUnit);
            return {
                weight: weightValue,
                reps: "",
                targetReps,
                done: false,
                weightMode: normalizedTargetUnit,
                weightType: normalizedTargetUnit,
                unit: normalizedTargetUnit,
                displayUnit: normalizedTargetUnit === "lbs" ? "lb" : normalizedTargetUnit,
                weightUnit: normalizedTargetUnit,
                weight_unit: normalizedTargetUnit,
            };
        };

        plan.forEach((item) => {
            const name = String(item.exerciseName || "").trim();
            if (!name) return;

            const label = ensureLabel(item.bodyPart || EX_TO_LABEL[name] || todayLabels[0] || "その他");
            const existingUnit = nextUnits[name] || (logDate === todayKey ? exerciseUnits[name] : null);
            const itemUnit = normalizePlanUnit(item.unit);
            const targetUnit = itemUnit === "BW" ? "BW" : normalizePlanUnit(existingUnit || itemUnit || unit);
            const draftSets = (item.sets || []).map((set) => makeDraftSet(set, itemUnit, targetUnit));
            const safeSets = draftSets.length ? draftSets : makeDefaultDraftSets();

            if (!nextSession.some((ex) => ex.name === name)) {
                const addedExercise = {
                    id: Date.now() + Math.floor(Math.random() * 100000),
                    name,
                    label,
                    bodyPart: label,
                };
                nextSession.push(addedExercise);
                if (!firstAddedExercise) firstAddedExercise = addedExercise;
            }

            nextLogData[name] = nextLogData[name]
                ? [...nextLogData[name], ...safeSets]
                : safeSets;
            nextUnits[name] = targetUnit;
        });

        setMuscleEx((prev) => {
            const next = { ...prev };
            plan.forEach((item) => {
                const name = String(item.exerciseName || "").trim();
                if (!name) return;
                const label = item.bodyPart || EX_TO_LABEL[name] || todayLabels[0] || "その他";
                if (!QUICK_LABELS.includes(label)) return;
                const list = next[label] || [];
                if (!list.some((ex) => ex.name === name)) {
                    next[label] = [...list, { id: Date.now() + Math.floor(Math.random() * 100000), name }];
                }
            });
            return next;
        });

        plan.forEach((item) => {
            if (item.exerciseName && item.bodyPart) {
                setExerciseOverrideForLabel(item.exerciseName, item.bodyPart);
            }
        });

        saveDraftForDate(todayKey, {
            todayLabels: nextLabels,
            logData: nextLogData,
            sessionEx: nextSession,
            exerciseUnits: nextUnits,
        });

        setLogMode("today");
        setLogDate(todayKey);
        setTodayLabels(nextLabels);
        setLogData(nextLogData);
        setSessionEx(nextSession);
        setExerciseUnits(nextUnits);
        startWorkoutTimerIfNeeded(todayKey, { markAsActivity: true });
        requestLogExerciseFocus(firstAddedExercise || nextSession.find((ex) => ex.name === plan[0]?.exerciseName));
        setScreen("log");
    };

    const buildSavedWorkoutDraftForDate = useCallback((dateStr, sourceHistory = history) => {
        const normalizedDate = normalizeDraftDateKey(dateStr);
        const dayExercises = Object.entries(sourceHistory || {})
            .map(([name, recs]) => {
                const rec = (recs || []).find((record) => (
                    String(record?.date || record?.workoutDate || record?.workout_date || "").slice(0, 10) === normalizedDate
                ));
                const sanitizedRecord = sanitizeHistoryRecord(rec, { allowBodyweight: true });
                if (!sanitizedRecord) return null;
                const recordBodyPart = String(sanitizedRecord.bodyPart || sanitizedRecord.body_part || "").trim();
                return {
                    id: name,
                    name,
                    label: recordBodyPart || EX_TO_LABEL[name] || null,
                    bodyPart: recordBodyPart || EX_TO_LABEL[name] || null,
                    order: typeof sanitizedRecord.order === "number" ? sanitizedRecord.order : 999,
                    rec: sanitizedRecord,
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.order - b.order);

        const inferredLabels = [...new Set(
            dayExercises
                .map(({ bodyPart, name }) => bodyPart || EX_TO_LABEL[name])
                .filter(Boolean)
        )];

        const dayLogData = {};
        dayExercises.forEach(({ name, rec }) => {
            if (rec?.sets) {
                const fallbackUnit = rec?.displayUnit || rec?.unit || rec?.weightUnit || rec?.weight_unit || getExUnit(name);
                dayLogData[name] = rec.sets.map(s => normalizeDraftSetFromRecord(s, fallbackUnit));
            }
        });

        return {
            hasSavedWorkout: dayExercises.length > 0,
            todayLabels: inferredLabels,
            sessionEx: dayExercises.map(({ id, name, label, bodyPart }) => ({ id, name, label, bodyPart })),
            logData: dayLogData,
            exerciseUnits: {},
            meta: {
                date: normalizedDate,
                keyDate: normalizedDate,
                draftDate: normalizedDate,
                workoutDate: normalizedDate,
                source: "history",
                hasUnsavedChanges: false,
            },
        };
    }, [getExUnit, history]);

    useEffect(() => {
        if (screen !== "log" || !logDate) return;
        const normalizedDate = normalizeDraftDateKey(logDate);
        const latestDraft = normalizeLogDraftState(latestLogDraftRef.current || {});
        const logDataExerciseNames = Object.keys(logData || {});
        const sessionExNames = (sessionEx || []).map((exercise) => exercise.name);
        const latestLogDraftRefExerciseNames = getRawDraftSetMetrics(latestDraft).exerciseNames;
        const finalRenderedExerciseNames = (exercises || []).map((exercise) => exercise.name);
        const renderedNames = new Set(
            finalRenderedExerciseNames
                .map((exerciseName) => normalizeExerciseName(exerciseName))
                .filter(Boolean)
        );
        const expectedNames = [
            ...logDataExerciseNames,
            ...sessionExNames,
            ...latestLogDraftRefExerciseNames,
        ];
        const missingFromRendered = [...new Set(expectedNames)].filter((exerciseName) => {
            const normalizedExerciseName = normalizeExerciseName(exerciseName);
            return normalizedExerciseName && !renderedNames.has(normalizedExerciseName);
        });
        const shouldLogRenderSource = missingFromRendered.length > 0 || shouldLogPerfDebug();
        if (!shouldLogRenderSource) return;
        const canonicalDraftForDate = buildSavedWorkoutDraftForDate(normalizedDate, canonicalDisplayHistory);
        const canonicalDisplayHistoryExerciseNamesForDate = (canonicalDraftForDate.sessionEx || []).map((exercise) => exercise.name);
        const signature = JSON.stringify({
            normalizedDate,
            logDataExerciseNames,
            sessionExNames,
            latestLogDraftRefExerciseNames,
            canonicalDisplayHistoryExerciseNamesForDate,
            finalRenderedExerciseNames,
            missingFromRendered,
        });
        if (logScreenRenderDebugSignatureRef.current === signature) return;
        logScreenRenderDebugSignatureRef.current = signature;

        console[missingFromRendered.length ? "warn" : "log"]("[log screen] exercise render source", {
            env: getRuntimeEnvironmentLabel(),
            action: "log_screen_exercise_render_source",
            selectedDate: normalizedDate,
            user_id: user?.id || null,
            logDataExerciseNames,
            sessionExNames,
            latestLogDraftRefExerciseNames,
            canonicalDisplayHistoryExerciseNamesForDate,
            finalRenderedExerciseNames,
            missingFromRendered,
            missingReason: missingFromRendered.length
                ? "final rendered exercises are missing current draft/logData names"
                : null,
        });
    }, [buildSavedWorkoutDraftForDate, canonicalDisplayHistory, exercises, logData, logDate, screen, sessionEx, user?.id]);

    const { logRestoreDecision } = useDraftRestore({
        screen,
        historySyncReady,
        logDate,
        user,
        pendingWorkoutContentChangeDatesRef,
        explicitWorkoutEditDatesRef,
        latestLogDraftRef,
        canonicalDisplayHistory,
        exerciseUnits,
        logData,
        sessionEx,
        todayLabels,
        buildSavedWorkoutDraftForDate,
        getCurrentLogDraftSnapshot,
        loadDraftForDate,
        hasDraftContent,
        getExUnit,
        applyCurrentLogDraft,
        markWorkoutContentChanged,
        saveDraftForDate,
    });


    useLogDateRefresh({
        screen,
        user,
        historySyncReady,
        logDate,
        history,
        pendingWorkoutContentChangeDatesRef,
        explicitWorkoutEditDatesRef,
        latestHistoryRef,
        workoutsDataHistoryRef,
        applyTrustedSessionRowsSnapshot,
        applyTrustedWorkoutRowsSnapshot,
        applyWorkoutsDataHistorySnapshot,
        applyLocalHistoryDates,
        applyCurrentLogDraft,
        buildSavedWorkoutDraftForDate,
        getExUnit,
        loadDraftForDate,
        markWorkoutContentChanged,
        saveDraftForDate,
        setHistory,
        setHistoryLoadError,
    });

    const {
        handleLogForDate,
        handleCalendarDayOpen,
        handleEditHistory,
        handleDeleteHistory,
        deleteAllHistoryForDate,
        undoDeleteAllHistoryForDate,
    } = useHistoryHandlers({
        user,
        history,
        latestHistoryRef,
        historyRevisionRef,
        persistHistoryForUser,
        syncWorkoutRowsForDates,
        syncWorkoutSessionSnapshot,
        deleteRemoteWorkoutArtifactsForDate,
        appendHistoryDeleteMarkers,
        commitHistoryDeleteMarkers,
        historyDeleteMarkersRef,
        clearDraftForDate,
        saveDraftForDate,
        loadDraftForDate,
        applyLogDraftState,
        setHistory,
        logDate,
        setLogDate,
        setLogMode,
        setScreen,
        summary,
        setSummary,
        workoutDayShareTarget,
        setWorkoutDayShareTarget,
        workoutStartedForDate,
        resetWorkoutElapsedTimer,
        savedWorkoutDurationSecByDate,
        setSavedWorkoutDurationSecByDate,
        queueWorkoutSessionSync,
        pendingWorkoutContentChangeDatesRef,
        pendingWorkoutSessionSyncDatesRef,
        explicitWorkoutEditDatesRef,
        clearSyncFailure,
        recordSyncFailure,
        refreshHistorySyncDiagnostic,
        applyWorkoutsDataHistorySnapshot,
        workoutsDataHistoryRef,
        markWorkoutContentChanged,
        applyTrustedWorkoutRowsSnapshot,
        buildSavedWorkoutDraftForDate,
        setSessionSyncVersion,
        pendingDeleteUndoRef,
        setPendingDeleteUndo,
        hasDraftContent,
        // module-level helpers from App.jsx
        normalizeDraftDateKey,
        withDraftDateMeta,
        getCurrentLogDraftSnapshot,
        latestLogDraftRef,
        getTodayKey,
        canonicalDisplayHistory,
        getDraftMetricsForDate,
        getExUnit,
        isExplicitWorkoutEditChange,
        isCleanPersistedDraft,
        isDestructiveWorkoutRegression,
        shouldPreserveRawDraftOverIncoming,
        isUnsavedUserWorkoutDraft,
        logRestoreDecision,
        getDraftDateValidation,
        getDraftKey,
        getDraftPayloadDate,
        getRuntimeEnvironmentLabel,
        buildWorkoutDraftForDateFromHistory,
        withDraftMeta,
        applyLocalHistoryDates,
        buildHistoryRecordDeleteKey,
        removeHistoryDate,
    });

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
        screen === "log" ? "記録"
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
    const shouldHideBottomNav =
        (screen === "log" && (Boolean(focusedLogSetInputId) || isLogKeyboardOpen)) ||
        (screen === "ai" && (focusedAiChatInput || isAiKeyboardOpen));
    const showOfflineOnlyCard = !isOnline && ["feed", "ai"].includes(screen);
    const syncFailureDates = Object.keys(syncFailuresByDate);
    const activeLogDate = String(logDate || "").slice(0, 10);
    const visibleSyncFailureDates = syncFailureDates.filter((date) => {
        const isActiveRecordingDate =
            screen === "log" &&
            date === activeLogDate &&
            (workoutStartedForDate === date || pendingWorkoutContentChangeDatesRef.current.has(date));
        return !isActiveRecordingDate;
    });
    const syncFailureSignature = getSyncFailureSignature(syncFailuresByDate);
    const shouldShowSyncFailureBanner =
        isOnline &&
        visibleSyncFailureDates.length > 0 &&
        Boolean(syncFailureSignature) &&
        !dismissedSyncFailureSignaturesRef.current.has(syncFailureSignature);
    const showSplashScreen =
        !splashForceDone &&
        !splashMinElapsed;
    const timerMenuViewportWidth = typeof window !== "undefined" ? window.innerWidth : 430;
    const timerMenuWidth = Math.max(0, Math.min(timerMenuViewportWidth - 36, 398));
    const timerMenuRightLimit = Math.max(18, timerMenuViewportWidth - timerMenuWidth - 18);
    const timerMenuRight = timerMenuAnchor
        ? Math.max(18, Math.min(timerMenuAnchor.right, timerMenuRightLimit))
        : Math.max(18, Math.min((timerMenuViewportWidth - 430) / 2 + 18, timerMenuRightLimit));
    const timerMenuTop = timerMenuAnchor
        ? Math.max(96, Math.round(timerMenuAnchor.bottom + 10))
        : 112;

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
                    onTimerClick={(event) => {
                        if (timerLeft !== null) {
                            stopTimer();
                            void cancelRestTimerNotification();
                            setShowTimerMenu(false);
                            setTimerMenuAnchor(null);
                        } else {
                            const rect = event.currentTarget.getBoundingClientRect();
                            setTimerMenuAnchor({
                                bottom: rect.bottom,
                                right: window.innerWidth - rect.right,
                            });
                            setShowTimerMenu(p => !p);
                        }
                    }}
                    isDark={isDark}
                    onToggleTheme={() => setIsDark(p => !p)}
                    showSettingsButton={true}
                    onOpenSettings={() => setShowSettingsModal(true)}
                    showCalendarButton={true}
                    onOpenCalendar={() => {
                        if (screen === "log") {
                            persistCurrentLog();
                        }
                        setScreen("calendar");
                    }}
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

                {isOnline && user?.id && historyLoadError && (
                    <div style={{ padding: "10px 18px 0" }}>
                        <div style={{
                            background: "rgba(239, 68, 68, 0.08)",
                            color: "var(--text)",
                            border: "1px solid rgba(239, 68, 68, 0.22)",
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
                                <div style={{ fontWeight: 900 }}>記録の取得に失敗しました</div>
                                <div style={{ color: "var(--text2)", fontSize: 12 }}>
                                    {historyLoadError}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setHistoryReloadNonce((prev) => prev + 1)}
                                style={{
                                    border: "none",
                                    borderRadius: 999,
                                    padding: "9px 12px",
                                    background: "linear-gradient(135deg, var(--accent), var(--accent2))",
                                    color: "#fff",
                                    fontSize: 12,
                                    fontWeight: 900,
                                    flexShrink: 0,
                                }}
                            >
                                再取得
                            </button>
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
                                    {visibleSyncFailureDates.slice(0, 3).join(" / ")}
                                    {visibleSyncFailureDates.length > 3 ? ` ほか${visibleSyncFailureDates.length - 3}件` : ""}
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


                <Suspense fallback={null}>
                    {showTimerMenu && screen === "log" && (
                        <div
                            onClick={() => {
                                setShowTimerMenu(false);
                                setTimerMenuAnchor(null);
                            }}
                            style={{
                                position: "fixed",
                                inset: 0,
                                zIndex: 90,
                                background: "rgba(15, 23, 42, 0.03)",
                            }}
                        >
                            <div
                                onClick={(event) => event.stopPropagation()}
                                style={{
                                    position: "fixed",
                                    top: timerMenuTop,
                                    right: timerMenuRight,
                                    width: timerMenuWidth,
                                    maxWidth: "calc(100vw - 36px)",
                                    background: "linear-gradient(180deg, var(--card-modal), var(--card2))",
                                    color: "var(--text)",
                                    border: "1px solid var(--border2)",
                                    borderRadius: 18,
                                    padding: 8,
                                    boxShadow: "0 16px 34px rgba(15, 23, 42, 0.18)",
                                    boxSizing: "border-box",
                                }}
                            >
                                <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
                                    {[
                                        { sec: 30, label: "30秒" },
                                        { sec: 60, label: "1分" },
                                        { sec: 90, label: "1分30秒" },
                                        { sec: 120, label: "2分" },
                                    ].map(({ sec, label }) => {
                                        const selected = intervalSec === sec;
                                        return (
                                            <button
                                                key={sec}
                                                type="button"
                                                onClick={() => {
                                                    setIntervalSec(sec);
                                                    setShowTimerMenu(false);
                                                    setTimerMenuAnchor(null);
                                                    startTimer(sec);
                                                    void scheduleRestTimerNotification(sec);
                                                }}
                                                style={{
                                                    flex: 1,
                                                    minWidth: 0,
                                                    minHeight: 40,
                                                    padding: "9px 8px",
                                                    borderRadius: 13,
                                                    border: selected ? "1px solid transparent" : "1px solid var(--border2)",
                                                    background: selected
                                                        ? "linear-gradient(135deg, var(--accent), var(--accent2))"
                                                        : "var(--btn-secondary)",
                                                    color: selected ? "#ffffff" : "var(--text)",
                                                    fontSize: 12,
                                                    fontWeight: 900,
                                                    boxShadow: selected ? "var(--shadow-soft)" : "none",
                                                    whiteSpace: "nowrap",
                                                }}
                                            >
                                                {label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}

                    {screen === "log" && (
                        <LogScreenView
                            handleLogScreenInputPointerDownCapture={handleLogScreenInputPointerDownCapture}
                            handleLogScreenFocusCapture={handleLogScreenFocusCapture}
                            handleLogScreenBlurCapture={handleLogScreenBlurCapture}
                            touchStartX={touchStartX}
                            touchStartY={touchStartY}
                            setScreen={setScreen}
                            workoutStartedForDate={workoutStartedForDate}
                            logDate={logDate}
                            workoutTimerStatus={workoutTimerStatus}
                            workoutElapsedSec={workoutElapsedSec}
                            savedWorkoutDurationSecByDate={savedWorkoutDurationSecByDate}
                            user={user}
                            manualBests={manualBests}
                            customBodyParts={customBodyParts}
                            hiddenBodyParts={hiddenBodyParts}
                            setCustomBodyParts={setCustomBodyParts}
                            setHiddenBodyParts={setHiddenBodyParts}
                            todayLabels={todayLabels}
                            dayColor={dayColor}
                            workoutLogExercises={workoutLogExercises}
                            workoutLogData={workoutLogData}
                            getExSets={getExSets}
                            setField={setField}
                            setWeightMode={setWeightMode}
                            addSet={addSet}
                            removeEx={removeEx}
                            timerLeft={timerLeft}
                            intervalSec={intervalSec}
                            setIntervalSec={setIntervalSec}
                            startTimer={startTimer}
                            stopTimer={stopTimer}
                            handleSaveLog={handleSaveLog}
                            addExToSession={addExToSession}
                            quickAddToSession={quickAddToSession}
                            reorderEx={reorderEx}
                            renameEx={renameEx}
                            getPrev={getPrev}
                            getPR={getPR}
                            getPreviousPR={getPreviousPR}
                            copySetDown={copySetDown}
                            copyRepDown={copyRepDown}
                            unit={unit}
                            getWorkoutLogExUnit={getWorkoutLogExUnit}
                            toggleExUnit={toggleExUnit}
                            muscleEx={muscleEx}
                            updateTodayLabels={updateTodayLabels}
                            canonicalDisplayHistory={canonicalDisplayHistory}
                            handleFinishWorkoutTimerAndShowSummary={handleFinishWorkoutTimerAndShowSummary}
                            handleLogSetInputFocusChange={handleLogSetInputFocusChange}
                            logExerciseFocusRequest={logExerciseFocusRequest}
                            setLogExerciseFocusRequest={setLogExerciseFocusRequest}
                            lastActiveLogExerciseByDate={lastActiveLogExerciseByDate}
                            handleLogExerciseActiveChange={handleLogExerciseActiveChange}
                            deleteAllHistoryForDate={deleteAllHistoryForDate}
                        />
                    )}

                    {screen === "analytics" && (
                        <AnalyticsScreen
                            history={canonicalDisplayHistory}
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
                        <FeedScreenView
                            history={history}
                            historySyncDiagnostic={historySyncDiagnostic}
                            manualBests={manualBests}
                            sessionSyncVersion={sessionSyncVersion}
                            historyDeleteMarkersRef={historyDeleteMarkersRef}
                            user={user}
                            setShowAuth={setShowAuth}
                            setScreen={setScreen}
                            handleLogout={handleLogout}
                            setSessionEx={setSessionEx}
                            setLogData={setLogData}
                            setLogMode={setLogMode}
                        />
                    )}

                    {screen === "ranking" && !showOfflineOnlyCard && (
                        <RankingScreenView
                            history={history}
                            historySyncDiagnostic={historySyncDiagnostic}
                            manualBests={manualBests}
                            sessionSyncVersion={sessionSyncVersion}
                            user={user}
                            setShowAuth={setShowAuth}
                            setScreen={setScreen}
                            handleLogout={handleLogout}
                            setSessionEx={setSessionEx}
                            setLogData={setLogData}
                            setLogMode={setLogMode}
                        />
                    )}

                    {screen === "history" && (
                        <HomeScreen
                            history={canonicalDisplayHistory}
                            muscleEx={muscleEx}
                            exerciseBodyPartOverrides={exerciseBodyPartOverrides}
                            hiddenBodyParts={hiddenBodyParts}
                            onStartLog={() => {
                                handleLogForDate(getTodayKey());
                            }}
                            user={user}
                            workoutDurationSecByDate={savedWorkoutDurationSecByDate}
                            recordsLoading={Boolean(!authReady || (user?.id && !historyRemoteReady && !historyLoadError))}
                            historyRemoteReady={historyRemoteReady}
                            remoteLoadFailed={historyRemoteLoadFailedRef.current}
                        />
                    )}

                    {screen === "calendar" && (
                        <CalendarScreenView
                            canonicalDisplayHistory={canonicalDisplayHistory}
                            workoutElapsedSec={workoutElapsedSec}
                            savedWorkoutDurationSecByDate={savedWorkoutDurationSecByDate}
                            logDate={logDate}
                            muscleEx={muscleEx}
                            exerciseBodyPartOverrides={exerciseBodyPartOverrides}
                            hiddenBodyParts={hiddenBodyParts}
                            handleEditHistory={handleEditHistory}
                            handleDeleteHistory={handleDeleteHistory}
                            deleteAllHistoryForDate={deleteAllHistoryForDate}
                            unit={unit}
                            getExUnit={getExUnit}
                            handleCalendarDayOpen={handleCalendarDayOpen}
                            user={user}
                            manualBests={manualBests}
                            customBodyParts={customBodyParts}
                            setManualBests={setManualBests}
                            setCustomBodyParts={setCustomBodyParts}
                            setSummary={setSummary}
                            openWorkoutDayShareModal={openWorkoutDayShareModal}
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
                            history={canonicalDisplayHistory}
                            isPro={isPro}
                            onStartPro={activatePumpPro}
                            onDeactivateProDev={deactivatePumpProDev}
                            dailyFreeAiLimit={dailyFreeAiLimit}
                            aiUsageDate={aiUsageDate}
                            aiUsageCount={aiUsageCount}
                            aiRemaining={aiRemaining}
                            aiConversations={aiConversations}
                            aiConversationLoading={aiConversationLoading}
                            aiConversationError={aiConversationError}
                            activeConversationId={activeConversationId}
                            onOpenConversation={openAiConversation}
                            onStartNewConversation={startNewAiConversation}
                            onDeleteConversation={deleteAiConversation}
                            onAddWorkoutPlan={handleAddAiWorkoutPlanToLog}
                            onInputFocusChange={handleAiInputFocusChange}
                        />
                    )}

                    {showOfflineOnlyCard && (
                        <div style={{ padding: "18px 18px var(--bottom-nav-scroll-padding)" }}>
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

                    {!shouldHideBottomNav && (
                        <BottomNav
                            tabs={bottomTabs}
                            activeTab={screen === "photos" ? "analytics" : screen === "ranking" ? "feed" : screen === "calendar" ? "history" : screen}
                            onSelectTab={(nextScreen) => {
                                const tappedAt = getPerfNow();
                                const isCenterWorkoutButton = nextScreen === "log";
                                console.log("[navigation]", {
                                    action: isCenterWorkoutButton ? "center_workout_button_tap" : "nav_button_tap",
                                    currentScreen: screen,
                                    targetScreen: nextScreen,
                                    timestamp: new Date().toISOString(),
                                    onClickFired: true,
                                    navigationApplied: false,
                                    blocked: false,
                                    blockedReason: null,
                                });
                                const logNavigationApplied = () => {
                                    window.requestAnimationFrame(() => {
                                        console.log("[navigation]", {
                                            action: isCenterWorkoutButton ? "center_workout_button_tap" : "nav_button_tap",
                                            currentScreen: screen,
                                            targetScreen: nextScreen,
                                            timestamp: new Date().toISOString(),
                                            onClickFired: true,
                                            navigationApplied: true,
                                            blocked: false,
                                            blockedReason: null,
                                            delayMs: Math.round((getPerfNow() - tappedAt) * 10) / 10,
                                        });
                                    });
                                };
                                if (nextScreen === "log") {
                                    handleLogForDate(getTodayKey());
                                    logNavigationApplied();
                                    return;
                                }
                                if (screen === "log") {
                                    persistCurrentLog();
                                }
                                setScreen(nextScreen);
                                logNavigationApplied();
                            }}
                            isRecording={isRecording}
                        />
                    )}

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
                        isPro={isPro}
                        proPlan={proPlan}
                        onStartPro={activatePumpPro}
                        onRestorePro={restorePumpPro}
                        onDeactivateProDev={deactivatePumpProDev}
                        onRefreshProStatus={refreshPumpProStatus}
                        dailyFreeAiLimit={dailyFreeAiLimit}
                        aiUsageCount={aiUsageCount}
                    />
                    {showAuth && (
                        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "var(--bg)", zIndex: 100 }}>
                            <Auth onClose={() => setShowAuth(false)} isDark={isDark} />
                        </div>
                    )}
                </Suspense>

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
