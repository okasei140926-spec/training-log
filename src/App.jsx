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
    buildHistoryFromWorkoutRows,
} from "./utils/helpers";
// useWorkoutLog → useWorkoutLogBridge
import { QUICK_LABELS, LABEL_COLORS } from "./constants/suggestions";
import { resolveRecordBodyPartLabel } from "./utils/bodyPartClassification";
import { BILLING_ENABLED, isBillingEnabled } from "./constants/features";
import { buildWeeklyBodyPartSetCounts } from "./components/analytics/analyticsUtils";
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
import { ProPaywallModal } from "./components/ProPaywallModal";
import WorkoutDaySummaryModal from "./components/modals/WorkoutDaySummaryModal";
import OnboardingOverlay from "./components/OnboardingOverlay";
import {
    buildBaseExercises,
    getExSetsHelper,
} from "./utils/workoutHelpers";
import { buildSessionExercisesForPlanDay, findBestMatchingPlanDayIndex, buildMuscleExFromAnswers } from "./utils/generateOnboardingPlan";
// buildWorkoutSessionPayloadFromDraft → useWorkoutDaySummaryBuilder
import WorkoutSessionShareModal from "./components/modals/WorkoutSessionShareModal";
import SettingsModal from "./components/modals/SettingsModal";
// buildWorkoutDaySummary, buildWorkoutDaySummaryPrKey → useWorkoutDaySummaryBuilder

import { useWorkout } from "./hooks/useWorkout";
import { useSupabasePR } from "./hooks/useSupabasePR";
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
import { useAiPlanProgress } from "./hooks/useAiPlanProgress";
import { useWorkoutDaySummaryBuilder } from "./hooks/useWorkoutDaySummaryBuilder";
import { logWriteTrace, wpCountExercises, wpCountSetsFromLogData } from "./utils/writeTrace";
import { useAccountActions } from "./hooks/useAccountActions";
import { useWorkoutSyncHelpers } from "./hooks/useWorkoutSyncHelpers";
import { useDraftStore } from "./hooks/useDraftStore";
import { useLogDraftApplicator } from "./hooks/useLogDraftApplicator";
import { useWorkoutsDataHistorySync } from "./hooks/useWorkoutsDataHistorySync";
import { useAuthSetup } from "./hooks/useAuthSetup";
import { useCustomExercises } from "./hooks/useCustomExercises";
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
    loadPendingOps,
    upsertPendingOp,
    loadPersistentDeletedDates,
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
    removePersistentDeletedDate,
    serializeHistoryMap,
    serializeTrustedRow,
    serializeTrustedRows,
    shouldLogPerfDebug,
    shouldPreserveRawDraftOverIncoming,
    sortTrustedRowsByDate,
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

    const draftStoreUserIdRef = useRef(null);
    const { getDraftKey, loadDraftForDate, hasDraftContent, makeDefaultDraftSets, saveDraftForDate, clearDraftForDate } = useDraftStore({ userIdRef: draftStoreUserIdRef });

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
    // Synchronous assignment so Gate B in useDraftStore has userId available from the very first
    // render — a useEffect fires after the render, which is too late for startup restore paths.
    draftStoreUserIdRef.current = user?.id ?? null;
    const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
    const [splashMinElapsed, setSplashMinElapsed] = useState(false);
    const [splashForceDone, setSplashForceDone] = useState(false);

    const [onboardingAnswers, setOnboardingAnswers] = useState(() => load("onboardingAnswers", null));
    const [bodyWeightKg, setBodyWeightKg] = useState(() => {
        const answers = load("onboardingAnswers", null);
        const v = Number(answers?.bodyWeight);
        return Number.isFinite(v) && v > 0 ? v : null;
    });
    const [bodyWeightUpdatedAt, setBodyWeightUpdatedAt] = useState(() =>
        load("onboardingAnswers", null)?.bodyWeightUpdatedAt || null
    );
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
        logWriteTrace("app:launch", { date: null, decision: "executed", extra: { online: navigator.onLine } });
    }, []);

    useEffect(() => {
        const minTimerId = window.setTimeout(() => setSplashMinElapsed(true), 400);
        const maxTimerId = window.setTimeout(() => setSplashForceDone(true), 3000);

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

    const {
        progress: aiPlanProgress,
        getNextPlanDay,
        getPlanDayForDate,
        markPlanDayCompleted,
        markPlanDayCompletedAtIndex,
        unmarkPlanDayCompleted,
        resetPlanProgress,
        selfMadeCount,
        handleSelfMade,
        handlePlanAccepted,
        aiPlanEnabled,
        setAiPlanEnabled,
    } = useAiPlanProgress({ user });

    // Track which date the AI plan banner was accepted (dismissed) for
    const [planBannerDismissedForDate, setPlanBannerDismissedForDate] = useState(null);
    // Ref to detect completion: set when user accepts AI plan for a date
    const aiPlanActiveDateRef = useRef(null);

    useEffect(() => {
        if (screen === "friends") {
            setScreen("ranking");
        }
    }, [screen]);

    useEffect(() => {
        const handleOnline = () => {
            setIsOnline(true);
            // On network restore, re-scan localStorage for unsynced drafts and queue
            // them for sync. Debounced to 1 s to guard against rapid-fire events.
            // Uses a stable ref so this effect never needs to re-register.
            if (onlineResumeSyncDebounceRef.current) {
                window.clearTimeout(onlineResumeSyncDebounceRef.current);
            }
            onlineResumeSyncDebounceRef.current = window.setTimeout(() => {
                onlineResumeSyncDebounceRef.current = null;
                rescueUnsyncedDraftsRef.current?.("online_resume");
            }, 1_000);
        };
        const handleOffline = () => setIsOnline(false);

        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);

        return () => {
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
            if (onlineResumeSyncDebounceRef.current) {
                window.clearTimeout(onlineResumeSyncDebounceRef.current);
                onlineResumeSyncDebounceRef.current = null;
            }
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
    // logDateRef is always the latest logDate — used wherever a useCallback/useEffect
    // might capture a stale closure value of logDate between renders.
    const logDateRef = useRef(getTodayKey());
    useEffect(() => { logDateRef.current = logDate; }, [logDate]);
    const [, setLogMode] = useState("today");
    const [exerciseUnits, setExerciseUnits] = useState(() => loadDraftForDate(getTodayKey()).exerciseUnits);

    // eslint-disable-next-line no-unused-vars
    const { isDark, setIsDark, unit, setUnit, showOnboarding, completeOnboarding, weekStartDay, setWeekStartDay, weeklySetTargets, setWeeklySetTargets } = useSettings();
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

    // persistentDeletedVersion: addPersistentDeletedDate / removePersistentDeletedDate が
    // 呼ばれるたびにインクリメントされる。persistentDeletedDates の useMemo を正確に無効化し、
    // 毎レンダーの再計算を避けるためにバージョン管理する。
    // ここで宣言することで markLogWorkoutContentChanged / useHistorySave など
    // 後続のすべての呼び出し元に参照を渡せる。
    const [persistentDeletedVersion, setPersistentDeletedVersion] = useState(0);
    const onPersistentDeleteChanged = useCallback(
        () => setPersistentDeletedVersion((v) => v + 1),
        []
    );

    const markLogWorkoutContentChanged = useCallback((reason = "set_update", details = {}) => {
        // Use logDateRef.current to avoid stale-closure contamination: if logDate
        // changes in state but this callback hasn't been recreated yet, the ref
        // always holds the latest value.
        const normalizedDate = String(logDateRef.current || "").slice(0, 10);
        if (!normalizedDate) return;

        const previous = pendingWorkoutContentChangeDatesRef.current.get(normalizedDate) || {};
        const explicitEdit = Boolean(previous.explicitEdit || details.explicitEdit || EXPLICIT_WORKOUT_EDIT_REASONS.has(reason));
        const _qbMarkLog = pendingWorkoutContentChangeDatesRef.current.size;
        // Clear stalled flag when a new user intent arrives: explicitEdit means the
        // user just edited the date; explicitDelete+scope=date means the user deleted it.
        // Mirrors the condition in useHistorySave.js markWorkoutContentChanged.
        const _clearStalled = explicitEdit
            || (Boolean(previous.explicitDelete) && (previous.deleteScope ?? null) === "date");
        pendingWorkoutContentChangeDatesRef.current.set(normalizedDate, {
            ...previous,
            reason,
            explicitDelete: Boolean(previous.explicitDelete),
            explicitEdit,
            details,
            updatedAt: new Date().toISOString(),
            ...(_clearStalled ? { stalled: false, stalledAt: null } : {}),
        });
        logWriteTrace("syncQueue:add", {
            date: normalizedDate,
            decision: "executed",
            reason: "markLogWorkoutContentChanged",
            extra: {
                queueSizeBefore: _qbMarkLog,
                queueSizeAfter: pendingWorkoutContentChangeDatesRef.current.size,
                queueDatesAfter: [...pendingWorkoutContentChangeDatesRef.current.keys()],
                saveReason: reason,
                explicitEdit,
            },
        });
        if (explicitEdit) {
            explicitWorkoutEditDatesRef.current.set(normalizedDate, {
                reason,
                updatedAt: Date.now(),
            });
        }
        // 削除後に再入力されたとき、persistentDeletedDates から即座に解除する。
        // markLogWorkoutContentChanged は deleteScope をリセットしないため previous.deleteScope で判定する。
        if (explicitEdit && !(Boolean(previous.explicitDelete) && (previous.deleteScope ?? null) === "date")) {
            if (user?.id) {
                removePersistentDeletedDate(user.id, normalizedDate);
                onPersistentDeleteChanged();
                console.log("[WP] persistentDelete:clearedByUserEdit", {
                    date: normalizedDate,
                    reason,
                    deleteScope: previous.deleteScope ?? null,
                });
            }
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
    // logDate is intentionally excluded — we read it via logDateRef.current to avoid
    // stale-closure contamination (marking pending changes for the wrong date).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, onPersistentDeleteChanged]);

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
        let safeTimerId = 0;

        const applyViewportHeight = () => {
            const viewportHeight = window.visualViewport?.height || window.innerHeight;
            root.style.setProperty("--app-height", `${Math.round(viewportHeight)}px`);
        };

        // iOS PWA / Capacitor WKWebView: env(safe-area-inset-*) may return 0 at
        // CSS parse time and on initial render before the WebView has reported
        // safe-area metrics. Use DOM probes to read the resolved values and
        // write them back as explicit px variables.
        //
        // applySafeAreas handles both --safe-top and --safe-bottom.
        //   shouldLog=true  → also records a "safeArea:probe" trace entry.
        //   shouldLog=false → probe + apply only (used for the 80 ms rAF retry
        //                     to avoid spamming the log on every resize frame).
        const applySafeAreas = (trigger, shouldLog) => {
            // Height probe: safe-area-inset-top
            const topProbe = document.createElement("div");
            topProbe.style.cssText = "position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top,0px);pointer-events:none;visibility:hidden;";
            root.appendChild(topProbe);
            const safeTop = parseFloat(getComputedStyle(topProbe).height) || 0;
            root.removeChild(topProbe);

            // Height probe: safe-area-inset-bottom (original applySafeBottom approach)
            const bottomProbe = document.createElement("div");
            bottomProbe.style.cssText = "position:fixed;bottom:0;left:0;width:0;height:env(safe-area-inset-bottom,0px);pointer-events:none;visibility:hidden;";
            root.appendChild(bottomProbe);
            const safeBottom = parseFloat(getComputedStyle(bottomProbe).height) || 0;
            root.removeChild(bottomProbe);

            if (shouldLog) {
                // Read current CSS var values BEFORE applying the new probe
                // results — this shows whether correction was needed.
                // (changedTop/changedBottom are log-only; the setProperty below
                //  runs unconditionally regardless of these values.)
                const prevTop = parseFloat(root.style.getPropertyValue("--safe-top")) || 0;
                const prevBottom = parseFloat(root.style.getPropertyValue("--safe-bottom")) || 0;

                // --app-header-height: read via getComputedStyle so we capture the
                // CSS fallback value (calc(63px + var(--safe-top))) before AppHeader's
                // ResizeObserver has written a fixed px value. Returns null when the
                // value is not a plain number (e.g. calc() string not yet overridden).
                const appHeaderHeightStr = getComputedStyle(root).getPropertyValue("--app-header-height").trim();
                const appHeaderHeight = parseFloat(appHeaderHeightStr) || null;

                logWriteTrace("safeArea:probe", {
                    date: null,
                    decision: "executed",
                    extra: {
                        trigger,
                        probeTop: safeTop,
                        probeBottom: safeBottom,
                        innerWidth: window.innerWidth,
                        innerHeight: window.innerHeight,
                        changedTop: safeTop !== prevTop,
                        changedBottom: safeBottom !== prevBottom,
                        appHeaderHeight,
                    },
                });
            }

            root.style.setProperty("--safe-top", `${safeTop}px`);
            root.style.setProperty("--safe-bottom", `${safeBottom}px`);

            // Defensive re-measure: force --app-header-height to update synchronously
            // after --safe-top changes, guarding against WKWebView delaying the
            // ResizeObserver callback for CSS-variable-induced size changes.
            // getBoundingClientRect() triggers a forced synchronous reflow so the
            // returned height already reflects the new --safe-top value.
            // Loop-safe: only writes when the measured value actually differs.
            const headerEl = document.querySelector('[data-app-header="true"]');
            if (headerEl) {
                const newH = headerEl.getBoundingClientRect().height;
                const curH = parseFloat(root.style.getPropertyValue("--app-header-height")) || 0;
                if (Math.round(newH) !== Math.round(curH)) {
                    root.style.setProperty("--app-header-height", `${newH}px`);
                }
            }
        };

        const scheduleViewportHeightUpdate = (trigger) => {
            cancelAnimationFrame(rafId);
            clearTimeout(timeoutId);
            rafId = window.requestAnimationFrame(() => {
                applyViewportHeight();
                applySafeAreas(trigger, true);
                timeoutId = window.setTimeout(() => {
                    applyViewportHeight();
                    // Retry without logging to avoid duplicate entries per event
                    applySafeAreas(trigger, false);
                }, 80);
            });
        };

        applyViewportHeight();
        applySafeAreas("initial", true);
        scheduleViewportHeightUpdate("initial");
        // Re-apply after 200ms to catch iOS PWA / Capacitor delayed safe area
        // resolution (same rationale as the original applySafeBottom timer).
        safeTimerId = window.setTimeout(() => applySafeAreas("initial", true), 200);

        const onResize = () => scheduleViewportHeightUpdate("resize");
        const onOrientationChange = () => scheduleViewportHeightUpdate("orientationchange");
        // Re-probe on app resume: WebView may finalize safe-area only after
        // returning from background (observed with Capacitor on iOS).
        const onVisibilityChange = () => {
            if (document.visibilityState === "visible") scheduleViewportHeightUpdate("resume");
        };

        window.addEventListener("resize", onResize);
        window.addEventListener("orientationchange", onOrientationChange);
        window.visualViewport?.addEventListener("resize", onResize);
        window.visualViewport?.addEventListener("scroll", onResize);
        document.addEventListener("visibilitychange", onVisibilityChange);

        return () => {
            cancelAnimationFrame(rafId);
            clearTimeout(timeoutId);
            clearTimeout(safeTimerId);
            window.removeEventListener("resize", onResize);
            window.removeEventListener("orientationchange", onOrientationChange);
            window.visualViewport?.removeEventListener("resize", onResize);
            window.visualViewport?.removeEventListener("scroll", onResize);
            document.removeEventListener("visibilitychange", onVisibilityChange);
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
    const settingsModalAutoSaveRef = useRef(null);
    const [forceSyncVersion, setForceSyncVersion] = useState(0);
    const [syncFailuresByDate, setSyncFailuresByDate] = useState({});
    const [syncRetrying, setSyncRetrying] = useState(false);
    const [pendingDeleteUndo, setPendingDeleteUndo] = useState(null);
    const [accountActionBusy, setAccountActionBusy] = useState(false);
    // eslint-disable-next-line no-unused-vars
    const [focusedLogSetInputId, setFocusedLogSetInputId] = useState(null);
    // eslint-disable-next-line no-unused-vars
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
        loadAiConversations,
        activateStripeCheckoutSession,
        openStripePortal,
        updateWeeklyContext,
    } = useAI({ loadConversationsOnMount: screen === "ai" });

    // Per-user billing flag: true when BILLING_ENABLED or user is in test list
    const billingEnabled = isBillingEnabled(user?.id);

    // Global paywall modal state — source string (e.g. "ai_limit", "stagnation", "general") or null (closed)
    const [paywallSource, setPaywallSource] = useState(null);
    const openPaywall = useCallback((source) => setPaywallSource(source || "general"), []);
    const closePaywall = useCallback(() => setPaywallSource(null), []);

    useEffect(() => {
        latestUserIdRef.current = user?.id ?? null;
    }, [user?.id]);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const stripeStatus = params.get("stripe_checkout");
        const sessionId = params.get("session_id");

        if (BILLING_ENABLED && stripeStatus === "success" && sessionId) {
            // Remove query params from URL without reloading
            const cleanUrl = window.location.pathname;
            window.history.replaceState({}, "", cleanUrl);

            activateStripeCheckoutSession(sessionId).then((ok) => {
                if (ok) {
                    setScreen("ai");
                }
            });
        } else if (stripeStatus === "cancel") {
            const cleanUrl = window.location.pathname;
            window.history.replaceState({}, "", cleanUrl);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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

    // ── AIプラン自動完了: localStorage で「プラン受け入れ日」を管理 ──
    const AI_PLAN_ACCEPTED_DATES_KEY = "aiPlanAcceptedDates";
    const readAiPlanAcceptedDates = () => {
        try { return JSON.parse(localStorage.getItem(AI_PLAN_ACCEPTED_DATES_KEY) || "{}"); }
        catch { return {}; }
    };
    const markAiPlanAcceptedDate = (date) => {
        try {
            const dates = readAiPlanAcceptedDates();
            dates[date] = true;
            localStorage.setItem(AI_PLAN_ACCEPTED_DATES_KEY, JSON.stringify(dates));
        } catch {}
    };

    // Track latest trustedHistory for use in callbacks (handleFinishWorkout etc.)
    const latestCanonicalHistoryRef = useRef({});

    // Helper: get body parts that have valid sets recorded for a given date
    const getRecordedBodyPartsForDate = (history, date) => {
        const parts = new Set();
        Object.values(history || {}).forEach((records) => {
            const record = (records || []).find(r => r.date === date);
            if (!record) return;
            const bp = String(record?.bodyPart || record?.body_part || "").trim();
            const hasValidSet = (record.sets || []).some(s => {
                const reps = Number(s.reps);
                if (!Number.isFinite(reps) || reps <= 0) return false;
                if (s.weight === "BW") return true;
                const weight = Number(s.weight);
                return Number.isFinite(weight) && weight > 0;
            });
            if (bp && hasValidSet) parts.add(bp);
        });
        return [...parts];
    };

    // Finish-workout handler: marks AI plan day complete (if plan was accepted today)
    const handleFinishWorkout = useCallback(() => {
        console.log("[handleFinishWorkout] called, logDate =", logDate);

        if (aiPlanEnabled) {
            const recordedParts = getRecordedBodyPartsForDate(latestCanonicalHistoryRef.current, logDate);
            const sequence = aiPlanProgress?.sequence || [];
            const isFirstCompletion = Object.keys(aiPlanProgress?.completedDates || {}).length === 0;
            const matchedIdx = findBestMatchingPlanDayIndex(recordedParts, sequence);
            if (matchedIdx >= 0) {
                console.log("[handleFinishWorkout] inferred cycle index", matchedIdx, "for parts", recordedParts, "(firstCompletion:", isFirstCompletion, ")");
                markPlanDayCompletedAtIndex(logDate, matchedIdx);
            } else {
                markPlanDayCompleted(logDate);
            }
        } else {
            markPlanDayCompleted(logDate);
        }

        aiPlanActiveDateRef.current = null;
        // Dismiss banner for today so it does not reappear until the next day
        setPlanBannerDismissedForDate(logDate);
        console.log("[handleFinishWorkout] markPlanDayCompleted called, banner dismissed for", logDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [markPlanDayCompleted, markPlanDayCompletedAtIndex, logDate, aiPlanEnabled, aiPlanProgress]);

    const handleUnfinishWorkout = useCallback(() => {
        console.log("[handleUnfinishWorkout] called, logDate =", logDate);
        unmarkPlanDayCompleted(logDate);
    }, [unmarkPlanDayCompleted, logDate]);

    // Plan-affecting fields: changing any of these resets AI plan progress + rebuilds muscleEx
    const PLAN_RESET_FIELDS = ["level", "frequency", "location", "hasDumbbells", "preferredSplit"];

    const handleSaveProfileField = useCallback(async (fieldId, newValue) => {
        // Merge into onboardingAnswers
        const prevAnswers = load("onboardingAnswers", {}) || {};
        const newAnswers = { ...prevAnswers, [fieldId]: newValue };
        save("onboardingAnswers", newAnswers);
        setOnboardingAnswers(newAnswers);

        // Build Supabase update payload for this field
        const colMap = {
            goal:          "fitness_goal",
            level:         "fitness_level",
            frequency:     "workout_frequency",
            trainingYears: "training_years",
            preferredSplit: "preferred_split",
            location:      "workout_location",
            hasDumbbells:  "has_dumbbells",
            gender:        "gender",
            birthdate:     "birth_date",
        };
        const col = colMap[fieldId];
        if (col && user?.id) {
            let dbValue = newValue;
            if (fieldId === "frequency") dbValue = parseInt(newValue, 10) || null;
            if (fieldId === "hasDumbbells") dbValue = newValue === "ある";
            try {
                await supabase.from("profiles").upsert(
                    { id: user.id, [col]: dbValue },
                    { onConflict: "id" }
                );
            } catch (err) {
                console.warn("[profileField] Supabase update failed:", err?.message);
            }
        }

        // If plan-affecting field changed, reset plan progress and rebuild muscleEx
        if (PLAN_RESET_FIELDS.includes(fieldId)) {
            // For custom split, customSequence will be set via handleSaveCustomSplit instead
            if (newValue !== "custom") {
                resetPlanProgress(newAnswers);
                const newMuscleEx = buildMuscleExFromAnswers(newAnswers);
                setMuscleEx(newMuscleEx);
                save("routineEx", newMuscleEx);
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, resetPlanProgress, setMuscleEx]);

    const handleSaveBodyWeight = useCallback(async (kg) => {
        const num = Number(kg);
        if (!Number.isFinite(num) || num <= 0) return;
        const now = new Date().toISOString();
        const prevAnswers = load("onboardingAnswers", {}) || {};
        const newAnswers = { ...prevAnswers, bodyWeight: String(num), bodyWeightUpdatedAt: now };
        save("onboardingAnswers", newAnswers);
        setOnboardingAnswers(newAnswers);
        setBodyWeightKg(num);
        setBodyWeightUpdatedAt(now);
        if (user?.id) {
            try {
                await supabase.from("profiles").upsert(
                    { id: user.id, body_weight_kg: num, weight_updated_at: now },
                    { onConflict: "id" }
                );
            } catch (err) {
                console.warn("[bodyWeight] Supabase update failed:", err?.message);
            }
        }
    }, [user?.id]);


    const handleSaveCustomSplit = useCallback((customSequence) => {
        // Persist custom sequence independently (survives plan resets)
        save("customSplitSequence", customSequence);
        // Update onboardingAnswers.preferredSplit = "custom"
        const prevAnswers = load("onboardingAnswers", {}) || {};
        const newAnswers = { ...prevAnswers, preferredSplit: "custom" };
        save("onboardingAnswers", newAnswers);
        setOnboardingAnswers(newAnswers);
        // Reset plan progress with new custom sequence
        resetPlanProgress(newAnswers, customSequence);
        const newMuscleEx = buildMuscleExFromAnswers(newAnswers);
        setMuscleEx(newMuscleEx);
        save("routineEx", newMuscleEx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resetPlanProgress, setMuscleEx]);

    const { applyWorkoutsDataHistorySnapshot } = useWorkoutsDataHistorySync({        workoutsDataHistory,        workoutsDataHistoryRef,        user,        setWorkoutsDataHistory,    });
    const commitHistoryDeleteMarkers = useCallback((nextMarkers) => {
        const normalized = normalizeHistoryDeleteMarkers(nextMarkers);
        // Preserve existing deletedAt timestamps for entries that the caller did not
        // explicitly pass a deletedAt map for (e.g. the undo path only passes dates/records).
        // Then remove timestamps whose date/record is no longer present in the marker lists.
        const callerDeletedAt = normalized.deletedAt; // already extracted by normalizeHistoryDeleteMarkers
        const existingDeletedAt = historyDeleteMarkersRef.current?.deletedAt || {};
        const mergedDeletedAt = Object.keys(callerDeletedAt).length > 0
            ? { ...existingDeletedAt, ...callerDeletedAt }
            : existingDeletedAt;
        const validDates = new Set(normalized.dates);
        const validKeys = new Set(normalized.records);
        const cleanedDeletedAt = {};
        Object.entries(mergedDeletedAt).forEach(([k, v]) => {
            if (validDates.has(k) || validKeys.has(k)) cleanedDeletedAt[k] = v;
        });
        const finalMarkers = { ...normalized, deletedAt: cleanedDeletedAt };
        historyDeleteMarkersRef.current = finalMarkers;

        const userId = latestUserIdRef.current;
        if (userId) {
            save(getHistoryDeleteMarkersKey(userId), finalMarkers);
        }

        return finalMarkers;
    }, []);

    const appendHistoryDeleteMarkers = useCallback((nextMarkers) => {
        const now = new Date().toISOString();
        const nextDates = nextMarkers?.dates || [];
        const nextRecords = nextMarkers?.records || [];
        // Build deletedAt map for the newly appended entries
        const newDeletedAt = {};
        nextDates.forEach((d) => { newDeletedAt[String(d || "").slice(0, 10)] = now; });
        nextRecords.forEach((r) => { newDeletedAt[String(r || "")] = now; });
        const result = commitHistoryDeleteMarkers({
            dates: [
                ...(historyDeleteMarkersRef.current?.dates || []),
                ...nextDates,
            ],
            records: [
                ...(historyDeleteMarkersRef.current?.records || []),
                ...nextRecords,
            ],
            deletedAt: {
                ...(historyDeleteMarkersRef.current?.deletedAt || {}),
                ...newDeletedAt,
            },
        });
        // ■4: Verify delete marker was written with deletedAt (detects write failures)
        nextDates.forEach((d) => {
            const key = String(d || "").slice(0, 10);
            const writtenAt = result?.deletedAt?.[key] || null;
            console.log("[restore] delete marker written", {
                date: key,
                deletedAt: writtenAt,
                markerCount: result?.dates?.length ?? 0,
            });
        });
        return result;
    }, [commitHistoryDeleteMarkers]);

    // TTL for delete markers: 120 seconds from deletedAt.
    // Ensures in-flight fetches (which resolve in <5 s) are protected without
    // permanently suppressing data that was re-saved after the deletion.
    const DELETE_MARKER_TTL_MS = 120_000;

    const getCurrentHistoryDeleteMarkers = useCallback(() => {
        const raw = historyDeleteMarkersRef.current || createEmptyHistoryDeleteMarkers();
        const normalized = normalizeHistoryDeleteMarkers(raw);
        const deletedAtMap = normalized.deletedAt;
        const now = Date.now();

        const isEntryValid = (key) => {
            const dateKey = String(key || "").slice(0, 10); // for record keys, first 10 chars = date
            // (a) Deletion is still pending in the sync queue → always intercept regardless of age
            const pendingChange = pendingWorkoutContentChangeDatesRef.current.get(dateKey);
            if (Boolean(pendingChange?.explicitDelete)) return true;
            // (b) deletedAt exists and is within TTL → intercept
            const ts = deletedAtMap[key];
            if (!ts) return false; // legacy entry without timestamp → treated as expired
            return (now - new Date(ts).getTime()) < DELETE_MARKER_TTL_MS;
        };

        const filteredDates = normalized.dates.filter(isEntryValid);
        const filteredRecords = normalized.records.filter(isEntryValid);

        // Clean up expired entries from storage (de-duped: only when something was actually removed)
        const expiredDates = normalized.dates.filter((d) => !filteredDates.includes(d));
        const expiredRecords = normalized.records.filter((r) => !filteredRecords.includes(r));
        if (expiredDates.length > 0 || expiredRecords.length > 0) {
            const cleanedDeletedAt = { ...deletedAtMap };
            expiredDates.forEach((d) => { delete cleanedDeletedAt[d]; });
            expiredRecords.forEach((r) => { delete cleanedDeletedAt[r]; });
            const cleanedMarkers = { dates: filteredDates, records: filteredRecords, deletedAt: cleanedDeletedAt };
            historyDeleteMarkersRef.current = cleanedMarkers;
            const userId = latestUserIdRef.current;
            if (userId) save(getHistoryDeleteMarkersKey(userId), cleanedMarkers);
            expiredDates.forEach((d) => {
                console.log("[restore] delete marker cleared", { date: d, reason: "expired", deletedAt: deletedAtMap[d] || null });
            });
            expiredRecords.forEach((r) => {
                console.log("[restore] delete marker cleared", { key: r, reason: "expired", deletedAt: deletedAtMap[r] || null });
            });
        }

        return { dates: filteredDates, records: filteredRecords };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Remove a specific date's delete marker — called after a successful Supabase save
    // confirms that valid data now exists for the date.
    const clearHistoryDeleteMarkerForDate = useCallback((dateStr) => {
        const date = String(dateStr || "").slice(0, 10);
        if (!date) return;
        const raw = historyDeleteMarkersRef.current || createEmptyHistoryDeleteMarkers();
        const hasMark = (raw.dates || []).includes(date);
        if (!hasMark) return;
        const nextDates = (raw.dates || []).filter((d) => d !== date);
        const nextRecords = (raw.records || []).filter((r) => !String(r || "").startsWith(`${date}::`));
        const nextDeletedAt = { ...(raw.deletedAt || {}) };
        delete nextDeletedAt[date];
        nextRecords.forEach((r) => { delete nextDeletedAt[r]; }); // already removed records
        commitHistoryDeleteMarkers({ dates: nextDates, records: nextRecords, deletedAt: nextDeletedAt });
        console.log("[restore] delete marker cleared", { date, reason: "save-succeeded" });
    }, [commitHistoryDeleteMarkers]);

    // Debug helper for useLogDateRefresh logging — returns timestamp info for a date.
    const getHistoryDeleteMarkerDebugInfo = useCallback((dateStr) => {
        const date = String(dateStr || "").slice(0, 10);
        const raw = historyDeleteMarkersRef.current || createEmptyHistoryDeleteMarkers();
        const deletedAt = raw.deletedAt?.[date] || null;
        const ageSeconds = deletedAt ? Math.round((Date.now() - new Date(deletedAt).getTime()) / 1000) : null;
        const pendingChange = pendingWorkoutContentChangeDatesRef.current.get(date);
        const isPending = Boolean(pendingChange?.explicitDelete);
        return { deletedAt, ageSeconds, isPending };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Stable ref so onStartupUnsyncedLocalDates can be defined before markWorkoutContentChanged
    const pendingSavePayloadsRef = useRef(new Map());
    const markWorkoutContentChangedRef = useRef(null);
    const rescueUnsyncedDraftsRef = useRef(null);
    const onlineResumeSyncDebounceRef = useRef(null);
    const onStartupUnsyncedLocalDates = useCallback((unsyncedDates) => {
        unsyncedDates.forEach((date) => {
            markWorkoutContentChangedRef.current?.(date, "startup_unsynced_local", { explicitEdit: false }, { recordToOutbox: false });
        });
        setForceSyncVersion((v) => v + 1);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const {
        trustedWorkoutRows,
        trustedSessionRows,
        historyRemoteReady,
        historyDisplayFromCache,
        historyLoadError,
        setHistoryLoadError,
        historySyncReady,
        historyRemoteLoadFailedRef,
        historyLoadedRangeStartRef,
        trustedWorkoutRowsRef,
        applyTrustedWorkoutRowsSnapshot,
        applyTrustedSessionRowsSnapshot,
        invalidateSupabaseFetchFreshByPrefix,
        runDedupeSupabaseFetch,
    } = useHistorySync({
        user,
        isPro,
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
        onStartupUnsyncedLocalDates,
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

    useEffect(() => {
        if (!isOnline) {
            const displayedMetrics = getHistoryOverallMetrics(history || {});
            const bannerVariant = displayedMetrics.setCount > 0 ? "cache" : "no-cache";
            logWriteTrace("offlineBanner:render", {
                date: null,
                decision: "executed",
                reason: null,
                extra: {
                    isOnline,
                    historyDisplayFromCache,
                    historyRemoteReady,
                    remoteLoadFailed: historyRemoteLoadFailedRef.current,
                    historyLoadError: historyLoadError || null,
                    displayedSetCount: displayedMetrics.setCount,
                    bannerVariant,
                },
            });
        }
    }, [isOnline, historyDisplayFromCache, historyRemoteReady, historyLoadError]); // eslint-disable-line react-hooks/exhaustive-deps

    // Bounded wrapper for persistHistoryForUser.
    //
    // Auto-injects rangeFrom = historyLoadedRangeStartRef.current when the caller
    // does not supply one.  This converts full-replace writes (which can wipe older
    // cache data that was never loaded into the 30-day in-memory window) into
    // range-aware merges that preserve out-of-range dates.
    //
    // When the loaded window is not yet known (ref is null — e.g. before initial_load
    // completes), falls back to union mode: existing dates are never deleted, incoming
    // overwrites on overlap.  Which callers hit this is reported in historyCache:write.
    const persistHistoryForUserBounded = useCallback((userId, historyArg, opts = {}) => {
        if (opts.rangeFrom !== undefined) {
            // Caller explicitly provided a range — honour it as-is.
            return persistHistoryForUser(userId, historyArg, opts);
        }
        const rangeFrom = historyLoadedRangeStartRef.current ?? null;
        if (rangeFrom != null) {
            return persistHistoryForUser(userId, historyArg, { ...opts, rangeFrom });
        }
        // Window unknown → union mode (never deletes existing dates).
        return persistHistoryForUser(userId, historyArg, { ...opts, union: true });
    // historyLoadedRangeStartRef is a ref (stable) — intentionally omitted from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
        pendingSavePayloadsRef,
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
        clearHistoryDeleteMarkerForDate,
        onPersistentDeleteChanged,
        loadDraftForDate,
        hasDraftContent,
        historyRemoteReady,
        historyDisplayFromCache,
    });

    // Keep ref current so onStartupUnsyncedLocalDates (defined before useHistorySave) can call it
    markWorkoutContentChangedRef.current = markWorkoutContentChanged;

    // Scan localStorage for drafts with hasUnsavedChanges: true and queue them for
    // sync. Used both at startup and when network is restored after offline edits.
    // trigger: "startup" | "online_resume"
    const rescueUnsyncedDrafts = useCallback((trigger = "startup") => {
        if (!user?.id || !historySyncReady) return;
        // Only rescue drafts from the last 7 days to avoid spurious write storms.
        const rescueCutoff = getDateDaysAgoKey(7);
        const unsyncedDates = [];
        const draftDateCandidates = new Set();
        try {
            for (let i = 0; i < window.localStorage.length; i++) {
                const lsKey = window.localStorage.key(i);
                if (lsKey?.startsWith("workoutDraft:")) {
                    const d = lsKey.slice("workoutDraft:".length);
                    if (d && d.length === 10) draftDateCandidates.add(d);
                } else if (lsKey?.startsWith("draft_logData_")) {
                    const d = lsKey.slice("draft_logData_".length);
                    if (d && d.length === 10) draftDateCandidates.add(d);
                }
            }
        } catch { }
        try {
            for (const date of draftDateCandidates) {
                if (date < rescueCutoff) continue;
                const draft = loadDraftForDate(date);
                if (!draft) continue;
                const draftMetaDate = normalizeDraftDateKey(draft.meta?.date || draft.date);
                if (draftMetaDate && draftMetaDate !== date) {
                    console.warn(`[${trigger}] discarding date-contaminated draft`, {
                        key: date,
                        draftMetaDate,
                        source: draft.meta?.source || null,
                    });
                    clearDraftForDate(date);
                    continue;
                }
                const hasContent = (draft.sessionEx || draft.exercises || []).length > 0
                    || Object.keys(draft.logData || {}).length > 0;
                // F-2: If outbox has an active entry for this date, always include it
                const _pendingOps = loadPendingOps(user?.id);
                const _hasPendingOp = Boolean(_pendingOps[date]);
                if (!_hasPendingOp) {
                    if (!hasContent) continue;
                    // Only rescue drafts explicitly marked as having unsaved changes.
                    // A deleted date has hasUnsavedChanges: false → skipped here, preventing
                    // permanently-deleted dates from being re-synced by this path.
                    const isUnsynced = draft.meta?.hasUnsavedChanges === true;
                    if (!isUnsynced) continue;
                    // Skip drafts whose content originated from remote data (trustedHistory
                    // or fetchedRemoteRows). These were auto-persisted by the hydration path and do
                    // not represent user intent. Rescuing them would zombie-restore exercises that
                    // were deleted before the next remote sync completed.
                    const isRemoteOriginContent = draft.meta?.contentOrigin === "remote";
                    if (isRemoteOriginContent) continue;
                }
                // Inject local draft directly into pendingSavePayloadsRef so
                // syncWorkoutRowsForDates sends local content (not remote-derived history).
                const directPayload = buildDraftHistoryForDate({
                    baseHistory: latestHistoryRef.current || {},
                    workoutDate: date,
                    exercises: draft.sessionEx || draft.exercises || [],
                    logData: draft.logData || {},
                    getExUnit: (name) => draft.exerciseUnits?.[name] || getExUnit(name),
                    labels: draft.todayLabels || [],
                    durationSec: 0,
                    replaceDate: false,
                });
                pendingSavePayloadsRef.current.set(date, directPayload);
                unsyncedDates.push(date);
            }
        } catch (err) {
            console.warn(`[${trigger}] unsynced draft scan failed`, err);
        }
        if (unsyncedDates.length > 0) {
            console.log(`[${trigger}] found unsynced drafts, queuing for rescue`, { unsyncedDates, rescueCutoff });
            unsyncedDates.forEach((date) => {
                // startup_unsynced_draft is a system process, not a user action.
                // explicitEdit must NOT be true — it would bypass G2 save guards.
                // explicitDelete: false — a stale delete flag from a prior session must
                // not OR-merge into the pending change and cause a false delete.
                markWorkoutContentChangedRef.current?.(date, "startup_unsynced_draft", { explicitEdit: false, explicitDelete: false }, { recordToOutbox: false });
                // On online-resume: clear stalled flag so syncDates includes this entry.
                // Network failures that hit the retry limit stall the entry; restoring
                // connectivity un-stalls it so the next auto-save cycle retries.
                if (trigger === "online_resume") {
                    const _entry = pendingWorkoutContentChangeDatesRef.current.get(date);
                    // Only un-stall entries that were stalled due to network failure.
                    // hold_limit and guard_skip stalls are NOT connectivity issues —
                    // clearing them on online_resume causes the ~10s retry loop where
                    // the entry stalls immediately again on the next batch.
                    // Only network_failure stalls should be retried when connectivity returns.
                    if (_entry?.stalled && _entry.stalledReason === "network_failure") {
                        pendingWorkoutContentChangeDatesRef.current.set(date, {
                            ..._entry,
                            stalled: false,
                            stalledAt: null,
                            stalledReason: null,
                        });
                        logWriteTrace("syncQueue:unstall", {
                            date,
                            decision: "executed",
                            reason: "online-resume rescue: network_failure stall cleared",
                        });
                    }
                }
            });
            setForceSyncVersion((v) => v + 1);
        }
    }, [historySyncReady, user?.id, loadDraftForDate, clearDraftForDate, getExUnit]); // eslint-disable-line react-hooks/exhaustive-deps
    // Keep ref current so the stable online-event listener always calls the latest version.
    rescueUnsyncedDraftsRef.current = rescueUnsyncedDrafts;

    // Rescue draft files that were written to localStorage but never synced to Supabase
    // (meta.hasUnsavedChanges = true). Runs once per user session at startup.
    const unsyncedDraftRescueRef = useRef(new Set());
    useEffect(() => {
        if (!user?.id || !historySyncReady) return;
        if (unsyncedDraftRescueRef.current.has(user.id)) return;
        unsyncedDraftRescueRef.current.add(user.id);
        rescueUnsyncedDrafts("startup");
    }, [historySyncReady, user?.id, rescueUnsyncedDrafts]);

    // F-1: Replay outbox entries from previous session
    const outboxReplayRef = useRef(new Set());
    useEffect(() => {
        if (!historySyncReady || !user?.id) return;
        if (outboxReplayRef.current.has(user.id)) return;
        outboxReplayRef.current.add(user.id);
        const ops = loadPendingOps(user.id);
        let replayed = false;
        Object.entries(ops).forEach(([date, entry]) => {
            // Stalled entries ARE replayed at startup — their stalled flag is cleared
            // here and attempts is incremented.  Same-session suppression is handled
            // by the syncBatch:build stalled filter in useHistoryAutoSave, not here.
            // Reset stalled flag and increment attempts before replaying
            upsertPendingOp(user.id, date, {
                ...entry,
                stalled: false,
                attempts: (entry.attempts || 0) + 1,
            });
            // recordToOutbox: false — the outbox was already updated by upsertPendingOp
            // directly above; calling markWorkoutContentChanged must NOT overwrite it.
            markWorkoutContentChangedRef.current?.(date, entry.reason || "startup_unsynced_draft", {
                explicitDelete: entry.explicitDelete,
                explicitEdit: entry.explicitEdit,
                deleteScope: entry.deleteScope || null,
            }, { recordToOutbox: false });
            replayed = true;
        });
        if (replayed) setForceSyncVersion((v) => v + 1);
    }, [historySyncReady, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

    const { customExercisesByBodyPart, customEquipmentMap, addCustomExercise, bulkAddCustomExercises, renameCustomExercise } = useCustomExercises(user);

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
        persistHistoryForUser: persistHistoryForUserBounded,
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

    const forceSyncLocalHistory = useCallback(() => {
        // Limit to last 30 days to avoid firing 100+ parallel Supabase requests at once
        const since = getDateDaysAgoKey(30);
        const dates = getValidWorkoutDatesFromHistory(latestHistoryRef.current || history, { since });
        if (!dates.length) return 0;
        dates.forEach((date) => {
            markWorkoutContentChanged(date, "manual_resync", { explicitEdit: true });
        });
        // Increment forceSyncVersion to reliably re-trigger useHistoryAutoSave effect
        setForceSyncVersion((v) => v + 1);
        return dates.length;
    }, [history, markWorkoutContentChanged]); // eslint-disable-line react-hooks/exhaustive-deps


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
        persistHistoryForUserBounded(user?.id, history, { source: "App:historyPersistEffect" });
    }, [authReady, history, historyRemoteLoadFailedRef, historyRemoteReady, historySyncReady, user, persistHistoryForUserBounded]);
    useEffect(() => {
        save("lastActiveLogExerciseByDate", lastActiveLogExerciseByDate || {});
    }, [lastActiveLogExerciseByDate]);
    useEffect(() => { save("customBodyParts", customBodyParts); }, [customBodyParts]);
    useEffect(() => { save(EXERCISE_BODY_PART_OVERRIDES_KEY, exerciseBodyPartOverrides); }, [exerciseBodyPartOverrides]);
    useEffect(() => { save("hiddenBodyParts", hiddenBodyParts); }, [hiddenBodyParts]);

    // dismissPushPromptForToday → useUIHandlers

    const clearLastActiveExerciseForDate = useCallback((date) => {
        setLastActiveLogExerciseByDate((prev) => {
            if (!prev?.[date]) return prev;
            const next = { ...prev };
            delete next[date];
            return next;
        });
    }, []);

    useHistoryAutoSave({
        history,
        user,
        historySyncReady,
        historyRemoteReady,
        historyDisplayFromCache,
        persistHistoryForUser: persistHistoryForUserBounded,
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
        clearDraftForDate,
        clearLastActiveExerciseForDate,
        setHistory,
        setSessionSyncVersion,
        forceSyncVersion,
        invalidateSupabaseFetchFreshByPrefix,
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
        // Guard against cross-date contamination during intermediate renders:
        // when logDate changes (e.g. date navigation), exercises / sessionEx may
        // still reflect the previous date until applyLogDraftState / useLogDateRefresh
        // fires.  If latestLogDraftRef belongs to a different date we are in that
        // transient window — skip the save.
        const latestDraftDate = normalizeDraftDateKey(
            latestLogDraftRef.current?.date || latestLogDraftRef.current?.meta?.date
        );
        if (latestDraftDate && latestDraftDate !== normalizedDate) return;
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
        // Don't re-save drafts that are already clean/verified (hasUnsavedChanges: false).
        // These are written by the save or restore path that produced them; the auto-save
        // must not re-write them, because that would recreate phantom drafts after they
        // have been deleted.
        if ((draft.meta?.hasUnsavedChanges ?? true) === false) return;

        // ■4: updatedAt and remoteVerifiedAt excluded — both are fresh timestamps on
        // every call and would always differ from the previous signature even when workout
        // content (exercises, sets, weights) is unchanged. Content changes are fully captured
        // by getWorkoutDraftSignature (todayLabels, sessionEx, logData, exerciseUnits).
        const draftSignature = JSON.stringify({
            date: normalizedDate,
            content: getWorkoutDraftSignature(draft),
            metaSource: draft.meta?.source || null,
            hasUnsavedChanges: draft.meta?.hasUnsavedChanges ?? null,
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

    // ログ画面での exercise 削除後に trustedWorkoutRows のその日付の行を除去するコールバック。
    // buildTrustedHistory が forceReplace:true で exactHistory を上書きするため、行を残すと
    // 次の handleLogForDate で削除した exercise が zombie restore される。
    const clearTrustedRowsForDate = useCallback((date) => {
        if (!date || !trustedWorkoutRowsRef?.current) return;
        const d = String(date).slice(0, 10);
        const filtered = (trustedWorkoutRowsRef.current || []).filter(
            (row) => String(row?.date || "").slice(0, 10) !== d
        );
        if (filtered.length !== (trustedWorkoutRowsRef.current || []).length) {
            applyTrustedWorkoutRowsSnapshot(filtered, { replace: true, source: "log_exercise_delete", skipPendingFilter: true });
        }
    }, [trustedWorkoutRowsRef, applyTrustedWorkoutRowsSnapshot]);

    const applyExerciseDeleteToHistoryRef = useRef(null);

    const {
        workoutLog,
        workoutLogExercises,
        workoutLogData,
        workoutLogExerciseUnits,
        addSet,
        removeSet,
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
        startWorkoutTimerIfNeeded,
        clearTrustedRowsForDate,
        applyExerciseDeleteToHistoryRef,
    });


    const getWorkoutLogExUnit = useCallback((name) => (
        workoutLogExerciseUnits?.[name] || getExUnit(name)
    ), [getExUnit, workoutLogExerciseUnits]);

    // ■1: Track which date workoutLogExercises actually belongs to.
    // workoutLog.draft.date reflects the date of the internal useWorkoutLog draft state.
    // When the user navigates to a new logDate, the draft resets asynchronously (via useEffect
    // in useWorkoutLog). During that transition render workoutLog.draft.date still holds the
    // previous date even though logDate has already changed.
    // useDisplayHistory reads this ref synchronously in its useMemo to decide whether to skip
    // the overlay, preventing stale exercises from being mapped into the new date's history.
    const liveExercisesDateRef = useRef(null);
    useEffect(() => {
        const draftDate = normalizeDraftDateKey(
            workoutLog.draft?.date || workoutLog.draft?.meta?.date
        ) || null;
        liveExercisesDateRef.current = draftDate;
    }, [workoutLog.draft]);

    // 永続削除リスト: buildTrustedHistory の session fallback が削除済み日付を
    // 再注入しないよう useDisplayHistory → useWorkoutHistory → buildTrustedHistory に渡す。
    // userId が確定するまでは空オブジェクト（デフォルト引数）が使われる。
    const persistentDeletedDates = useMemo(
        () => loadPersistentDeletedDates(user?.id),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [user?.id, persistentDeletedVersion]
    );

    const {
        displayHistory,
        trustedHistory,
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
        liveExercisesDateRef,
        pendingWorkoutContentChangeDatesRef,
        workoutTimerStateRef,
        buildDraftHistoryForDate,
        getCurrentWeekRangeForHomeSummary,
        shouldLogPerfDebug,
        deletedDates: persistentDeletedDates,
    });

    // Keep latestCanonicalHistoryRef in sync (used in handleFinishWorkout callback)
    useEffect(() => {
        latestCanonicalHistoryRef.current = trustedHistory;
    }, [trustedHistory]);

    // AIプラン自動完了: 対象部位で 2種目以上・4セット以上記録されたら完了とみなす
    const AI_PLAN_AUTO_COMPLETE_MIN_SETS = 4;
    const AI_PLAN_AUTO_COMPLETE_MIN_EXERCISES = 2;
    useEffect(() => {
        if (!aiPlanEnabled) return;
        const today = formatDateKey(new Date());
        if (!logDate || logDate !== today) return;

        // AIプランを受け入れた日のみ対象（「自分で組む」は除外）
        if (!readAiPlanAcceptedDates()[logDate]) return;

        // 既に完了済みならスキップ（終了ボタン押し済みを含む）
        const planDay = getPlanDayForDate(logDate);
        if (!planDay || planDay.completed) return;

        const targetBodyParts = new Set(planDay.bodyParts || []);
        if (!targetBodyParts.size) return;

        // 対象部位の有効セット数・種目数を集計
        let totalSets = 0;
        const exercisesWithSets = new Set();
        const recordedBodyParts = new Set();

        Object.entries(trustedHistory).forEach(([exName, records]) => {
            const record = (records || []).find((r) => r.date === logDate);
            if (!record) return;

            const bodyPart = String(record?.bodyPart || record?.body_part || "").trim();
            if (!bodyPart || !targetBodyParts.has(bodyPart)) return;

            const validSets = (record.sets || []).filter((s) => {
                const reps = Number(s.reps);
                if (!Number.isFinite(reps) || reps <= 0) return false;
                if (s.weight === "BW") return true;
                const weight = Number(s.weight);
                return Number.isFinite(weight) && weight > 0;
            });

            if (validSets.length > 0) {
                totalSets += validSets.length;
                exercisesWithSets.add(exName);
                recordedBodyParts.add(bodyPart);
            }
        });

        if (totalSets >= AI_PLAN_AUTO_COMPLETE_MIN_SETS && exercisesWithSets.size >= AI_PLAN_AUTO_COMPLETE_MIN_EXERCISES) {
            console.log("[aiPlan] auto-complete triggered", {
                date: logDate,
                totalSets,
                exerciseCount: exercisesWithSets.size,
            });

            // First completion only: infer cycle position from recorded body parts
            const isFirstCompletion = Object.keys(aiPlanProgress?.completedDates || {}).length === 0;
            if (isFirstCompletion) {
                const sequence = aiPlanProgress?.sequence || [];
                const matchedIdx = findBestMatchingPlanDayIndex([...recordedBodyParts], sequence);
                if (matchedIdx >= 0) {
                    console.log("[aiPlan] first auto-complete — inferred cycle index", matchedIdx, "for parts", [...recordedBodyParts]);
                    markPlanDayCompletedAtIndex(logDate, matchedIdx);
                    return;
                }
            }
            markPlanDayCompleted(logDate);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trustedHistory, logDate, aiPlanEnabled, getPlanDayForDate, markPlanDayCompleted, markPlanDayCompletedAtIndex, aiPlanProgress]);

    const weeklyBodyPartCounts = useMemo(
        () => buildWeeklyBodyPartSetCounts(trustedHistory, weekStartDay, muscleEx, exerciseBodyPartOverrides),
        [trustedHistory, weekStartDay, muscleEx, exerciseBodyPartOverrides]
    );

    useEffect(() => {
        updateWeeklyContext(weeklyBodyPartCounts, weeklySetTargets);
    }, [weeklyBodyPartCounts, weeklySetTargets, updateWeeklyContext]);

    useEffect(() => {
        if (screen !== "history") return;
        if (!shouldLogPerfDebug()) return;
        const weekRange = getCurrentWeekRangeForHomeSummary();
        const debugDates = ["2026-06-01", "2026-06-02", "2026-06-03"];
        const summary = getHomeWeeklySummaryDebug(trustedHistory, weekRange);
        const signature = JSON.stringify({
            dates: getHistoryDatesInRange(trustedHistory, weekRange),
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
            trustedHistoryLength: getHistoryOverallMetrics(trustedHistory),
            displayHistoryLength: getHistoryOverallMetrics(displayHistory),
            datesIncluded: getHistoryDatesInRange(trustedHistory, weekRange),
            historyDatesIncluded: getHistoryDatesInRange(history, weekRange),
            workoutsDataHistoryDatesIncluded: getHistoryDatesInRange(workoutsDataHistory, weekRange),
            displayHistoryDatesIncluded: getHistoryDatesInRange(displayHistory, weekRange),
            sessionsByDate: getHomePropsDateDebug(trustedHistory, debugDates),
            historySessionsByDate: getHomePropsDateDebug(history, debugDates),
            workoutsDataHistorySessionsByDate: getHomePropsDateDebug(workoutsDataHistory, debugDates),
            displayHistorySessionsByDate: getHomePropsDateDebug(displayHistory, debugDates),
            calculatedCountsBeforePassing: summary.bodyPartCounts,
            shoulderCount: summary.bodyPartCounts["肩"] || 0,
            tricepsCount: summary.bodyPartCounts["三頭"] || 0,
            bicepsCount: summary.bodyPartCounts["二頭"] || 0,
            backCount: summary.bodyPartCounts["背中"] || 0,
        });
    }, [trustedHistory, displayHistory, history, screen, user?.id, workoutsDataHistory]);

    useEffect(() => {
        if (screen !== "log") return;

        // Timer start trigger: reps > 0 is sufficient (weight is not required).
        // This ensures the timer starts as soon as the user inputs the first rep count.
        // Sort by name so that exercise reordering does NOT change the signature —
        // only set content (reps added/removed) should trigger the timer.
        const activitySignature = JSON.stringify(
            exercises
                .map((ex) => {
                    const repsOnlySets = (logData[ex.name] || []).filter((set) => {
                        const reps = Number(set.reps ?? set.rep);
                        return Number.isFinite(reps) && reps > 0;
                    });

                    if (!repsOnlySets.length) return null;

                    return {
                        name: ex.name,
                        sets: repsOnlySets.map((set) => ({
                            reps: Number(set.reps ?? set.rep),
                        })),
                    };
                })
                .filter(Boolean)
                .sort((a, b) => a.name.localeCompare(b.name, "ja"))
        );

        if (previousWorkoutActivityDateRef.current !== logDate) {
            previousWorkoutActivityDateRef.current = logDate;
            // Always reset to "[]" on date change so the first valid-reps input on this date
            // is detected as a change from empty — even if the draft was already loaded.
            previousWorkoutActivitySignatureRef.current = "[]";
            // On initial load or date switch: if valid sets already exist for today,
            // resume or start the timer. startWorkoutTimerIfNeeded guards non-today dates internally.
            if (activitySignature !== "[]") {
                startWorkoutTimerIfNeeded(logDate, { markAsActivity: false });
            }
            return;
        }

        if (
            activitySignature !== "[]" &&
            activitySignature !== previousWorkoutActivitySignatureRef.current
        ) {
            // Use startWorkoutTimerIfNeeded so entering the first set starts the timer.
            // markWorkoutActivity had startIfNeeded: false and never started a new timer.
            startWorkoutTimerIfNeeded(logDate, { markAsActivity: true });
        }

        previousWorkoutActivitySignatureRef.current = activitySignature;
    }, [screen, exercises, logData, getExUnit, logDate, startWorkoutTimerIfNeeded]);

    useEffect(() => {
        // Use workoutLogExercises/workoutLogData (from useWorkoutLog's internal state)
        // instead of App.jsx's exercises/logData. The latter are updated one render later
        // via setLogData/setSessionEx in handleWorkoutLogDraftChange, causing a stale-state
        // delay where hasValidDraftWorkout is false when the timer first starts.
        // workoutLogData is already fresh by the time workoutStartedForDate changes.
        const hasValidDraftWorkout = workoutLogExercises.some((ex) =>
            (workoutLogData[ex.name] || []).some((set) => {
                const reps = Number(set.reps ?? set.rep);
                return Number.isFinite(reps) && reps > 0;
            })
        );

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
    }, [workoutLogExercises, workoutLogData, history, logDate, resetWorkoutElapsedTimer, workoutStartedForDate]);

    // useEffectより前に定義
    const { persistCurrentLog } = usePersistCurrentLog({
        logDate,
        logDateRef,
        exercises,
        persistHistoryForUser: persistHistoryForUserBounded,
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
        pendingSavePayloadsRef,
        setHistory,
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (screen !== "log") return;
        if (user?.id && !historySyncReady) return;

        const hasAnyValidSet = exercises.some((ex) =>
            (logData[ex.name] || []).some((s) => s.weight && s.reps)
        );

        const normalizedLogDate = String(logDate || "").slice(0, 10);
        const pendingChangeForDate = pendingWorkoutContentChangeDatesRef.current.get(normalizedLogDate);
        const hasPendingExplicitDelete = Boolean(pendingChangeForDate?.explicitDelete);
        // Also flush when the user has added exercises (but not yet filled in sets).
        // Without this, exercise-only edits never call persistCurrentLog, so
        // latestHistoryRef.current never gets the exercise data, and the save guard
        // in syncWorkoutRowsForDates fires on the next useHistoryAutoSave run.
        const hasPendingExplicitEdit = exercises.length > 0 && Boolean(pendingChangeForDate?.explicitEdit);

        logWriteTrace("A-2:debounce-gate", {
            date: normalizedLogDate,
            decision: (!hasAnyValidSet && !hasPendingExplicitDelete && !hasPendingExplicitEdit) ? "skip" : "pass",
            reason: (!hasAnyValidSet && !hasPendingExplicitDelete && !hasPendingExplicitEdit)
                ? "no valid sets, no pending explicit delete, no pending explicit edit"
                : null,
            flags: {
                explicitEdit: Boolean(pendingChangeForDate?.explicitEdit),
                explicitDelete: Boolean(pendingChangeForDate?.explicitDelete),
                source: pendingChangeForDate?.reason || undefined,
            },
            exerciseCount: wpCountExercises(exercises),
            setCount: wpCountSetsFromLogData(logData),
            extra: {
                hasAnyValidSet,
                hasPendingExplicitDelete,
                hasPendingExplicitEdit,
                screen,
                historySyncReady,
            },
        });
        if (!hasAnyValidSet && !hasPendingExplicitDelete && !hasPendingExplicitEdit) return;

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





    const { prCache } = useSupabasePR({ userId: user?.id || null });

    const { getPrev, getPR, getPreviousPR, copySetDown, copyRepDown } = useWorkout({
        history: trustedHistory,
        manualBests,
        sessionHistory,
        setLogData: setLogDataAndSaveDraft,
        getExSets,
        getExUnit,
        KG_TO_LBS,
        muscleEx,
        exerciseBodyPartOverrides,
        prCache,
    });

    const { handleFinishWorkoutTimerAndShowSummary } = useWorkoutDaySummaryBuilder({
        logDate,
        exercises,
        logData,
        persistHistoryForUser: persistHistoryForUserBounded,
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
            if (keyboardOpen && activeLogInput) {
                // Keyboard is open AND a set-input is focused — keep the attribute so the
                // bottom nav stays hidden while the user is actively typing.
                markLogSetInputActive(activeLogInput, false);
                return;
            }
            if (keyboardOpen) {
                // Keyboard still open but no set-input focused — preserve existing state.
                // Do NOT setAttribute here: visualViewport.scroll can give false-positive
                // keyboardInset readings during normal page scroll on iOS Capacitor,
                // which would incorrectly hide the bottom nav.
                return;
            }
            // Keyboard is closed — always clear the attribute even if an input element
            // still technically has focus (e.g. user tapped the iOS "Done" button).
            // The bottom nav must reappear whenever the keyboard is gone.
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
        renameCustomExercise,
    });

    // Copy only exercise names from a past workout into today's session
    const handleCopyExercisesToSession = (exerciseList) => {
        if (!exerciseList?.length) return;
        const todayKey = getTodayKey();
        // Save current draft before switching dates
        const currentDraft = withDraftDateMeta(logDate, getCurrentLogDraftSnapshot(), {
            source: latestLogDraftRef.current?.meta?.source || "current_log_snapshot",
            hasUnsavedChanges: latestLogDraftRef.current?.meta?.hasUnsavedChanges ?? true,
        });
        if (hasDraftContent(currentDraft)) {
            saveDraftForDate(logDate, currentDraft);
        }
        // Load today's draft as base
        const todayDraft = logDate === todayKey ? currentDraft : loadDraftForDate(todayKey);
        const nextSession = [...(Array.isArray(todayDraft.sessionEx) ? todayDraft.sessionEx : [])];
        const nextLabels = [...(Array.isArray(todayDraft.todayLabels) ? todayDraft.todayLabels : [])];
        const nextLogData = { ...(todayDraft.logData || {}) };
        const nextUnits = { ...(todayDraft.exerciseUnits || {}) };
        // Add each exercise to today's session
        exerciseList.forEach((ex) => {
            const name = typeof ex === "string" ? ex : ex.name;
            if (!name) return;
            const rawBodyPart = typeof ex === "object" ? (ex.bodyPart || ex.label) : undefined;
            const resolvedBodyPart = resolveRecordBodyPartLabel(
                { bodyPart: rawBodyPart },
                name,
                { muscleEx, exerciseBodyPartOverrides }
            ) || nextLabels[0] || "その他";
            console.log(`[copyExercises] ${name} → ${resolvedBodyPart}`);
            if (!nextSession.some((e) => e.name === name)) {
                nextSession.push({ id: Date.now() + Math.floor(Math.random() * 100000), name, label: resolvedBodyPart, bodyPart: resolvedBodyPart });
            }
            if (!nextLogData[name]) {
                nextLogData[name] = makeDefaultDraftSets();
            }
        });
        const newDraft = withDraftDateMeta(todayKey, {
            todayLabels: nextLabels,
            logData: nextLogData,
            sessionEx: nextSession,
            exerciseUnits: nextUnits,
        }, {
            source: "explicit_date_nav",
            hasUnsavedChanges: true,
        });
        markWorkoutContentChanged(todayKey, "exercise_copy", { explicitEdit: true });
        // Remove from persistent deleted-dates list before writing: the user is explicitly
        // recreating content for this date, so "deleted" state no longer applies.
        // removePersistentDeletedDate is a no-op when the date is not in the list.
        removePersistentDeletedDate(user?.id, todayKey);
        onPersistentDeleteChanged();
        saveDraftForDate(todayKey, newDraft);
        setLogMode("today");
        setLogDate(todayKey);
        applyLogDraftState(newDraft); // updates latestLogDraftRef + all state; bypasses regression guard
        startWorkoutTimerIfNeeded(todayKey, { markAsActivity: true });
        setScreen("log");
    };

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
        const canonicalDraftForDate = buildSavedWorkoutDraftForDate(normalizedDate, trustedHistory);
        const trustedHistoryExerciseNamesForDate = (canonicalDraftForDate.sessionEx || []).map((exercise) => exercise.name);
        const signature = JSON.stringify({
            normalizedDate,
            logDataExerciseNames,
            sessionExNames,
            latestLogDraftRefExerciseNames,
            trustedHistoryExerciseNamesForDate,
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
            trustedHistoryExerciseNamesForDate,
            finalRenderedExerciseNames,
            missingFromRendered,
            missingReason: missingFromRendered.length
                ? "final rendered exercises are missing current draft/logData names"
                : null,
        });
    }, [buildSavedWorkoutDraftForDate, trustedHistory, exercises, logData, logDate, screen, sessionEx, user?.id]);

    const { logRestoreDecision } = useDraftRestore({
        screen,
        historySyncReady,
        logDate,
        user,
        pendingWorkoutContentChangeDatesRef,
        explicitWorkoutEditDatesRef,
        latestLogDraftRef,
        trustedHistory,
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
        persistHistoryForUser: persistHistoryForUserBounded,
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
        clearDraftForDate,
        setHistory,
        setHistoryLoadError,
        getCurrentHistoryDeleteMarkers,
        getHistoryDeleteMarkerDebugInfo,
    });

    const {
        handleLogForDate,
        handleCalendarDayOpen,
        handleEditHistory,
        handleDeleteHistory,
        deleteAllHistoryForDate,
        undoDeleteAllHistoryForDate,
        applyExerciseDeleteToHistory,
    } = useHistoryHandlers({
        user,
        history,
        latestHistoryRef,
        historyRevisionRef,
        persistHistoryForUser: persistHistoryForUserBounded,
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
        trustedWorkoutRowsRef,
        applyTrustedSessionRowsSnapshot,
        trustedSessionRows,
        onPersistentDeleteChanged,
        pendingSavePayloadsRef,
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
        trustedHistory,
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
        onDeleteDateClearCompletion: unmarkPlanDayCompleted,
        invalidateSupabaseFetchFreshByPrefix,
    });

    applyExerciseDeleteToHistoryRef.current = applyExerciseDeleteToHistory;

    // ─── カレンダー月移動時の追加フェッチ ─────────────────
    const fetchedCalendarMonthsRef = useRef(new Set());
    const handleCalendarMonthChange = useCallback(async (yearMonth) => {
        if (!user?.id || !yearMonth) return;
        if (typeof navigator !== "undefined" && navigator.onLine === false) return;
        if (fetchedCalendarMonthsRef.current.has(yearMonth)) return;
        fetchedCalendarMonthsRef.current.add(yearMonth);

        const monthStart = `${yearMonth}-01`;
        const [yStr, mStr] = yearMonth.split("-");
        const y = Number(yStr);
        const m = Number(mStr); // 1-indexed
        const nextDate = new Date(y, m, 1); // m is next month index (0-indexed)
        const nextMonthPrefix = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;
        const monthEnd = `${nextMonthPrefix}-01`;

        const fetchKey = `calendar_month:${user.id}:${yearMonth}`;
        try {
            const result = await runDedupeSupabaseFetch(
                fetchKey,
                async () => {
                    const { data, error } = await supabase
                        .from("workouts")
                        .select("date, data")
                        .eq("user_id", user.id)
                        .gte("date", monthStart)
                        .lt("date", monthEnd)
                        .order("date", { ascending: true });
                    if (error) throw error;
                    return data || [];
                },
                { minIntervalMs: 60000, freshTtlMs: 300000, backoffMs: 30000 }
            );
            if (!result.skipped && (result.value || []).length > 0) {
                applyTrustedWorkoutRowsSnapshot(result.value, { source: "calendar_month_fetch" });
                const monthHistory = applyHistoryDeleteMarkers(
                    buildHistoryFromWorkoutRows(result.value),
                    getCurrentHistoryDeleteMarkers()
                );
                const monthDates = getValidWorkoutDatesFromHistory(monthHistory);
                if (monthDates.length > 0) {
                    const nextHistory = applyHistoryDeleteMarkers(
                        applyLocalHistoryDates(latestHistoryRef.current || {}, monthHistory, monthDates),
                        getCurrentHistoryDeleteMarkers()
                    );
                    setHistory(nextHistory);
                    persistHistoryForUserBounded(user.id, nextHistory, {
                        rangeFrom: monthStart,
                        rangeTo: monthEnd,
                        source: "calendar_month_fetch",
                    });
                }
            }
        } catch (e) {
            console.error("[calendar] month fetch failed", { yearMonth, error: e?.message });
        }
    }, [user?.id, runDedupeSupabaseFetch, applyTrustedWorkoutRowsSnapshot,
        getCurrentHistoryDeleteMarkers, applyLocalHistoryDates, latestHistoryRef,
        setHistory, persistHistoryForUserBounded]);

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
            : screen === "analytics" ? "成長"
                : screen === "photos" ? "写真比較"
                    : screen === "feed" ? "フィード"
                        : screen === "calendar" ? "カレンダー"
                            : screen === "ai" ? "AI"
                                : "ホーム";

    const isRecording = false;
    const bottomTabs = [
        { id: "history", icon: "🏠", label: "ホーム" },
        { id: "analytics", icon: "📊", label: "成長" },
        { id: "log", icon: null, label: "" },
        { id: "feed", icon: "💬", label: "フィード" },
        { id: "ai", icon: "🤖", label: "AI" },
    ];
    const shouldHideBottomNav =
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
        (!splashMinElapsed || !authReady);
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

                {/* Offline banner wrapper.
                    Always in DOM so that adding/removing `position:sticky` never triggers
                    a sticky-context reflow that collapses the content's top gap on iOS.
                    When online: empty div, zero height, zero layout impact (≡ pre-545ad83). */}
                <div style={isOnline ? {} : {
                    padding: "10px 18px 0",
                    position: "sticky",
                    top: "var(--app-header-height)",
                    zIndex: 49,
                    background: "var(--bg)",
                }}>
                    {!isOnline && (
                        <div style={{
                            background: "var(--info-soft)",
                            color: "var(--text)",
                            border: "1px solid var(--info-border)",
                            borderRadius: 18,
                            padding: "12px 14px",
                            fontSize: 13,
                            lineHeight: 1.6,
                        }}>
                            {getHistoryOverallMetrics(history || {}).setCount > 0
                                ? "オフラインです。端末内の記録を表示しています。通信が戻ると自動で同期します。"
                                : "オフラインです。端末内に記録が無いため表示できません。"}
                        </div>
                    )}
                </div>

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
                                <div style={{ fontWeight: 900 }}>保存できませんでした</div>
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
                            removeSet={removeSet}
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
                            customExercisesByBodyPart={customExercisesByBodyPart}
                            onSaveCustomExercise={addCustomExercise}
                            onBulkSaveCustomExercises={bulkAddCustomExercises}
                            updateTodayLabels={updateTodayLabels}
                            trustedHistory={trustedHistory}
                            handleFinishWorkoutTimerAndShowSummary={handleFinishWorkoutTimerAndShowSummary}
                            handleLogSetInputFocusChange={handleLogSetInputFocusChange}
                            logExerciseFocusRequest={logExerciseFocusRequest}
                            setLogExerciseFocusRequest={setLogExerciseFocusRequest}
                            lastActiveLogExerciseByDate={lastActiveLogExerciseByDate}
                            handleLogExerciseActiveChange={handleLogExerciseActiveChange}
                            deleteAllHistoryForDate={deleteAllHistoryForDate}
                            planDayInfo={aiPlanEnabled && logDate === getTodayKey() ? getPlanDayForDate(logDate) : null}
                            onLoadPlanDay={(bodyParts) => {
                                // 1. Update workoutLog's internal draft.todayLabels
                                //    so onDraftChange later carries the correct labels.
                                workoutLog.setTodayLabels(bodyParts);
                                // 2. Immediately reflect in App state for UI (header color etc.)
                                setTodayLabels(bodyParts);
                                // 3. Replace session exercises with AI-plan priority selection.
                                workoutLogExercises.forEach((ex) => removeEx(ex.name, ex.id));
                                (() => {
                                    let answers = null;
                                    try { answers = JSON.parse(localStorage.getItem("onboardingAnswers") || "null"); } catch {}
                                    buildSessionExercisesForPlanDay({ bodyParts, answers, history: trustedHistory })
                                        .forEach((ex) => addExToSession(ex.name, ex.bodyPart));
                                })();
                                setPlanBannerDismissedForDate(logDate);
                                handlePlanAccepted();
                                aiPlanActiveDateRef.current = logDate;
                                markAiPlanAcceptedDate(logDate);
                            }}
                            onSelfMadeToday={() => {
                                setPlanBannerDismissedForDate(logDate);
                                handleSelfMade();
                            }}
                            selfMadeConsecutiveCount={selfMadeCount}
                            aiPlanEnabled={aiPlanEnabled}
                            planBannerDismissedForDate={planBannerDismissedForDate}
                            onFinishWorkout={handleFinishWorkout}
                            onUnfinishWorkout={handleUnfinishWorkout}
                            isAiPlanDay={Boolean(readAiPlanAcceptedDates()[logDate])}
                        />
                    )}

                    {screen === "analytics" && (
                        <AnalyticsScreen
                            history={trustedHistory}
                            manualBests={manualBests}
                            muscleEx={muscleEx}
                            hiddenBodyParts={hiddenBodyParts}
                            exerciseBodyPartOverrides={exerciseBodyPartOverrides}
                            onOpenPhotoCompare={() => setScreen("photos")}
                            weekStartDay={weekStartDay}
                            weeklySetTargets={weeklySetTargets}
                            setWeeklySetTargets={setWeeklySetTargets}
                            bodyWeightKg={bodyWeightKg}
                            bodyWeightUpdatedAt={bodyWeightUpdatedAt}
                            onSaveBodyWeight={handleSaveBodyWeight}
                            gender={onboardingAnswers?.gender || null}
                            onSaveGender={(g) => handleSaveProfileField("gender", g)}
                            customEquipmentMap={customEquipmentMap}
                            isPro={isPro}
                            billingEnabled={billingEnabled}
                            onOpenPaywall={billingEnabled ? openPaywall : null}
                            initialTab="growth"
                            onAskWhyStagnant={(exerciseName, recentRecords) => {
                                const lines = (recentRecords || []).slice(0, 8).map((r) => {
                                    const setsText = (r?.sets || [])
                                        .filter((s) => {
                                            const rep = Number(s?.reps);
                                            if (rep <= 0) return false;
                                            const w = s?.weight;
                                            return w === "BW" || (Number.isFinite(Number(w)) && Number(w) > 0);
                                        })
                                        .map((s) => s?.weight === "BW" ? `自重×${s.reps}回` : `${s.weight}kg×${s.reps}回`)
                                        .join(", ");
                                    return `${r?.date || ""}: ${setsText || "記録なし"}`;
                                }).join("\n");
                                const prompt = `「${exerciseName}」が止まっています。直近の記録：\n${lines || "データなし"}\n\n原因と次の打ち手を教えてください。`;
                                setAiInput("");
                                setScreen("ai");
                                // sendAI accepts overrideMsg — call after a tick so AIScreen mounts
                                setTimeout(() => sendAI(prompt), 0);
                            }}
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
                            onCopyExercises={handleCopyExercisesToSession}
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
                            history={trustedHistory}
                            muscleEx={muscleEx}
                            exerciseBodyPartOverrides={exerciseBodyPartOverrides}
                            hiddenBodyParts={hiddenBodyParts}
                            onStartLog={() => {
                                const activeDate = (workoutStartedForDate && !workoutIsFinished) ? workoutStartedForDate : null;
                                handleLogForDate(activeDate || getTodayKey());
                            }}
                            user={user}
                            workoutDurationSecByDate={savedWorkoutDurationSecByDate}
                            recordsLoading={Boolean(!authReady || (user?.id && !historyRemoteReady && !historyDisplayFromCache && !historyLoadError))}
                            historyRemoteReady={historyRemoteReady}
                            remoteLoadFailed={historyRemoteLoadFailedRef.current}
                            onCopyExercises={handleCopyExercisesToSession}
                            weekStartDay={weekStartDay}
                            weeklySetTargets={weeklySetTargets}
                            onNavigateToWeeklyAnalytics={() => setScreen("analytics")}
                            nextPlanDay={aiPlanEnabled ? getNextPlanDay() : null}
                            aiPlanEnabled={aiPlanEnabled}
                            isTodayCompleted={Boolean(getPlanDayForDate(getTodayKey())?.completed)}
                            onStartNextPlanDay={() => {
                                const nextDay = getNextPlanDay();
                                if (!nextDay) return;
                                const todayKey = getTodayKey();
                                const bodyParts = nextDay.bodyParts;
                                workoutLog.setTodayLabels(bodyParts);
                                setTodayLabels(bodyParts);
                                workoutLogExercises.forEach((ex) => removeEx(ex.name, ex.id));
                                (() => {
                                    let answers = null;
                                    try { answers = JSON.parse(localStorage.getItem("onboardingAnswers") || "null"); } catch {}
                                    buildSessionExercisesForPlanDay({ bodyParts, answers, history: trustedHistory })
                                        .forEach((ex) => addExToSession(ex.name, ex.bodyPart));
                                })();
                                setPlanBannerDismissedForDate(todayKey);
                                handlePlanAccepted();
                                aiPlanActiveDateRef.current = todayKey;
                                markAiPlanAcceptedDate(todayKey);
                                handleLogForDate(todayKey);
                            }}
                        />
                    )}

                    {screen === "calendar" && (() => {
                        const minCalendarYearMonth = null; // 全ユーザー全期間閲覧可
                        return (
                            <CalendarScreenView
                                trustedHistory={trustedHistory}
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
                                minCalendarYearMonth={minCalendarYearMonth}
                                onCopyExercises={handleCopyExercisesToSession}
                                onMonthChange={handleCalendarMonthChange}
                            />
                        );
                    })()}

                    {screen === "ai" && !showOfflineOnlyCard && (
                        <AIScreen
                            aiMsgs={aiMsgs}
                            aiInput={aiInput}
                            setAiInput={setAiInput}
                            sendAI={sendAI}
                            aiLoad={aiLoad}
                            aiEnd={aiEnd}
                            history={trustedHistory}
                            weeklyBodyPartCounts={weeklyBodyPartCounts}
                            weeklySetTargets={weeklySetTargets}
                            isPro={isPro}
                            onDeactivateProDev={deactivatePumpProDev}
                            billingEnabled={billingEnabled}
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
                            onLoadConversations={loadAiConversations}
                            onAddWorkoutPlan={handleAddAiWorkoutPlanToLog}
                            onInputFocusChange={handleAiInputFocusChange}
                            onOpenStripePortal={openStripePortal}
                            onOpenPaywall={billingEnabled ? openPaywall : null}
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

                    {/* BottomNav moved outside app-shell to avoid maxWidth/margin containment */}

                    {showOnboarding && <OnboardingOverlay user={user} onDone={() => completeOnboarding()} />}
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
                            summary?.shareTarget
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
                        billingEnabled={billingEnabled}
                        onStartPro={activatePumpPro}
                        onOpenPaywall={billingEnabled ? openPaywall : null}
                        onRestorePro={restorePumpPro}
                        onDeactivateProDev={deactivatePumpProDev}
                        onRefreshProStatus={refreshPumpProStatus}
                        onManageStripePortal={openStripePortal}
                        dailyFreeAiLimit={dailyFreeAiLimit}
                        aiUsageCount={aiUsageCount}
                        onForceSyncHistory={forceSyncLocalHistory}
                        weekStartDay={weekStartDay}
                        setWeekStartDay={setWeekStartDay}
                        weeklySetTargets={weeklySetTargets}
                        setWeeklySetTargets={setWeeklySetTargets}
                        aiPlanEnabled={aiPlanEnabled}
                        onSetAiPlanEnabled={setAiPlanEnabled}
                        onboardingAnswers={onboardingAnswers}
                        onSaveProfileField={handleSaveProfileField}
                        onSaveBodyWeight={handleSaveBodyWeight}
                        onSaveCustomSplit={handleSaveCustomSplit}
                        autoSaveRef={settingsModalAutoSaveRef}
                    />
                    {showAuth && (
                        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "var(--bg)", zIndex: 100 }}>
                            <Auth onClose={() => setShowAuth(false)} isDark={isDark} />
                        </div>
                    )}
                </Suspense>

                {/* Global Pro paywall modal — shown from any entry point */}
                <ProPaywallModal
                    isOpen={Boolean(paywallSource)}
                    source={paywallSource || "general"}
                    onStartPro={activatePumpPro}
                    onClose={closePaywall}
                    onRestorePro={restorePumpPro}
                    isPro={isPro}
                />

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
                        // Close overlays that sit below z=520 (BottomNav) and
                        // stay open during navigation without this explicit close.
                        // ProPaywallModal is intentionally excluded: closing it
                        // mid-purchase would interrupt the transaction.
                        if (showSettingsModal) {
                            // Auto-save any in-progress profile editor input before
                            // closing. The × button path never calls this ref.
                            settingsModalAutoSaveRef.current?.();
                            setShowSettingsModal(false);
                        }
                        if (workoutDayShareTarget) setWorkoutDayShareTarget(null);

                        if (nextScreen === "log") {
                            const activeDate = (workoutStartedForDate && !workoutIsFinished) ? workoutStartedForDate : null;
                            handleLogForDate(activeDate || getTodayKey());
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
        </>
    );
}
