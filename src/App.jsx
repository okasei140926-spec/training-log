import { lazy, Suspense, useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo } from "react";
import { isSupabaseConfigured, missingSupabaseEnvKeys, supabase, supabaseConfigError } from "./utils/supabase";
import {
    load,
    save,
    storeW,
    KG_TO_LBS,
    buildHistoryFromWorkoutRows,
    buildHistoryFromWorkoutRowsWithScopes,
    calc1RM,
    formatDateKey,
    getRecordSourceSets,
    getValidWorkoutDatesFromHistory,
    hasMeaningfulPRIncrease,
    hasValidWorkoutOnDate,
    mergeHistoryMaps,
    PR_UPDATE_TOLERANCE_KG,
    sanitizeHistoryRecord,
    sanitizeWorkoutSets,
} from "./utils/helpers";
import { buildTrustedHistory } from "./features/workout/buildTrustedHistory";
import { useWorkoutLog } from "./features/workout/useWorkoutLog";
import {
    fetchWorkoutRowForDate as fetchWorkoutRowForDateFromRepository,
    fetchWorkoutRows as fetchWorkoutRowsFromRepository,
    fetchWorkoutRowsForDates as fetchWorkoutRowsForDatesFromRepository,
} from "./features/workout/workoutRepository";
import {
    clearWorkoutDraft as clearStoredWorkoutDraft,
    loadWorkoutDraft as loadStoredWorkoutDraft,
    makeVerifiedWorkoutDraft as makeStoredVerifiedWorkoutDraft,
    saveWorkoutDraft as saveStoredWorkoutDraft,
} from "./features/workout/workoutDraftStore";
import { QUICK_LABELS, LABEL_COLORS, SUGGESTIONS } from "./constants/suggestions";
import { S, css } from "./utils/styles";
import { Analytics } from "@vercel/analytics/react";
import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
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
import { buildWorkoutSessionPayloadFromDraft } from "./utils/workoutSessions";
import { getPrimaryDefaultBodyPartLabel } from "./utils/bodyPartClassification";
import {
    getInviteCodeFromLocation,
    processPendingInviteForUser,
    savePendingInviteCode,
} from "./utils/invite";
import WorkoutSessionShareModal from "./components/modals/WorkoutSessionShareModal";
import SettingsModal from "./components/modals/SettingsModal";
import {
    buildWorkoutDaySummary,
    buildWorkoutDaySummaryPrKey,
} from "./utils/workoutDaySummary";

import { useWorkout } from "./hooks/useWorkout";
import { useTimer } from "./hooks/useTimer";
import { useLogLogic } from "./hooks/useLogLogic";
import { useDisplayHistory } from "./hooks/useDisplayHistory";
import { useWorkoutSession } from "./hooks/useWorkoutSession";
import {
    enablePushNotificationsForUser,
    getNotificationPermission,
    getPushSupportState,
    syncPushSubscriptionState,
} from "./lib/pushNotifications";
import {
    cancelRestTimerNotification,
    scheduleRestTimerNotification,
} from "./lib/restTimerNotifications";
import { normalizeExerciseName } from "./utils/exerciseName";
import { convertPlanWeight, normalizePlanUnit, normalizeWorkoutPlan } from "./utils/aiWorkoutPlan";
import { isNativeApp, isNativeOAuthCallbackUrl } from "./utils/oauth";
import {
    computeWorkoutDisplayElapsedSec,
    getWorkoutTimerPersistence,
} from "./utils/workoutTimer";
import { APP_VERSION, HISTORY_CACHE_SCHEMA_VERSION } from "./appVersion";
import {
    useHistorySync,
    REMOTE_HISTORY_SESSION_LOOKBACK_DAYS,
    REMOTE_HISTORY_SESSION_LIMIT,
} from "./hooks/useHistorySync";
import { useHistorySave } from "./hooks/useHistorySave";
import { useWorkoutSummary } from "./hooks/useWorkoutSummary";
import { useHistoryHandlers } from "./hooks/useHistoryHandlers";

const AnalyticsScreen = lazy(() => import("./components/AnalyticsScreen"));
const PhotoScreen = lazy(() => import("./components/PhotoScreen"));
const AIScreen = lazy(() => import("./components/AIScreen"));
const Auth = lazy(() => import("./components/Auth"));

const debugLog = (...args) => {
    if (process.env.NODE_ENV !== "production") console.debug(...args);
};

const getPerfNow = () => (
    typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now()
);

const shouldLogPerfDebug = () => {
    if (typeof window === "undefined") return false;
    try {
        return window.localStorage?.getItem("pump_debug_perf") === "1"
            || window.localStorage?.getItem("pump_debug_history") === "1";
    } catch {
        return false;
    }
};

const draftRestoreDateCheckLogSignatures = new Set();
const logDraftRestoreDateCheck = (payload) => {
    const signature = JSON.stringify({
        source: payload?.source || null,
        keyDate: payload?.keyDate || null,
        payloadDate: payload?.payloadDate || null,
        selectedDate: payload?.selectedDate || null,
        accepted: Boolean(payload?.accepted),
        rejectedReason: payload?.rejectedReason || null,
    });

    if (!payload?.accepted) {
        if (!draftRestoreDateCheckLogSignatures.has(signature)) {
            draftRestoreDateCheckLogSignatures.add(signature);
            console.warn("[restore] draft restore date check", payload);
        }
        return;
    }

    if (!shouldLogPerfDebug()) return;
    if (draftRestoreDateCheckLogSignatures.has(signature)) return;
    draftRestoreDateCheckLogSignatures.add(signature);
    console.log("[restore] draft restore date check", payload);
};

const EX_TO_LABEL = {};
Object.entries(SUGGESTIONS).forEach(([label, names]) => {
    names.forEach((n) => {
        EX_TO_LABEL[n] = label;
    });
});

const getExerciseRecordBodyPart = (exercise, fallbackLabel) =>
    exercise?.bodyPart || exercise?.label || fallbackLabel || EX_TO_LABEL[exercise?.name] || null;

const TRACKED_WORKOUT_DEBUG_EXERCISES = [
    "シーテッドレッグカール",
    "ルーマニアンデッドリフト",
    "ハイパーエクステンション",
    "アダクター",
    "懸垂",
];

const mergeDraftExercisesWithLogData = (exercises = [], logData = {}, labels = []) => {
    const merged = [];
    const seenNames = new Set();

    (exercises || []).forEach((exercise) => {
        const exerciseName = String(exercise?.name || "").trim();
        if (!exerciseName) return;
        const normalizedName = normalizeExerciseName(exerciseName);
        if (seenNames.has(normalizedName)) return;
        seenNames.add(normalizedName);
        merged.push(exercise);
    });

    Object.keys(logData || {}).forEach((exerciseName) => {
        const trimmedName = String(exerciseName || "").trim();
        if (!trimmedName) return;
        const normalizedName = normalizeExerciseName(trimmedName);
        if (seenNames.has(normalizedName)) return;
        seenNames.add(normalizedName);

        const label = EX_TO_LABEL[trimmedName] || labels[0] || "その他";
        merged.push({
            id: trimmedName,
            name: trimmedName,
            label,
            bodyPart: label,
        });
    });

    return merged;
};

const normalizeSetWeightMode = (value) => {
    const unit = String(value || "kg").toLowerCase();
    if (unit === "lbs" || unit === "lb" || unit === "pound" || unit === "pounds") return "lbs";
    if (unit === "bw" || unit === "bodyweight") return "BW";
    return "kg";
};

const getSetWeightMode = (set, fallbackUnit = "kg") =>
    normalizeSetWeightMode(
        set?.weightMode
        || set?.weightType
        || set?.displayUnit
        || set?.unit
        || set?.weightUnit
        || set?.weight_unit
        || fallbackUnit
    );

const getSetDisplayUnit = (set, fallbackUnit = "kg") => {
    const mode = getSetWeightMode(set, fallbackUnit);
    return mode === "lbs" ? "lb" : mode;
};

const storeSetWeightForUnit = (set, fallbackUnit = "kg") => {
    const mode = getSetWeightMode(set, fallbackUnit);
    if (mode === "BW" || String(set?.weight || "").toUpperCase() === "BW") return "BW";
    return storeW(set?.weight, mode);
};

const normalizeDraftSetFromRecord = (set, fallbackUnit = "kg") => {
    const mode = getSetWeightMode(set, fallbackUnit);
    const displayWeight = mode === "BW"
        ? "BW"
        : String(set?.displayWeight ?? set?.weight ?? "");

    return {
        ...set,
        weight: displayWeight,
        reps: String(set?.reps ?? ""),
        done: true,
        weightMode: mode,
        weightType: mode,
        unit: mode,
        displayUnit: getSetDisplayUnit(set, fallbackUnit),
        weightUnit: mode,
        weight_unit: mode,
    };
};

const HISTORY_OWNER_KEY = "historyOwnerUserId";
const getUserHistoryCacheKey = (userId) => `history_cache_${userId}`;
const getHistoryDeleteMarkersKey = (userId) => `historyDeleteMarkers_${userId}`;
const EXERCISE_BODY_PART_OVERRIDES_KEY = "exerciseBodyPartOverrides";
const isPlainObject = (value) =>
    !!value && typeof value === "object" && !Array.isArray(value);

const serializeHistoryMap = (historyMap) => JSON.stringify(historyMap || {});
const PUSH_PROMPT_LATER_KEY = "pushPromptLaterDate";
const APP_VERSION_STORAGE_KEY = "pumpAppVersion";

const getDateDaysAgoKey = (days) => {
    const date = new Date();
    date.setDate(date.getDate() - Number(days || 0));
    return formatDateKey(date);
};

const getNextMonthPrefix = (prefix) => {
    const [year, month] = String(prefix || "").split("-").map(Number);
    if (!year || !month) return "";
    const date = new Date(year, month, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

const logRecordFetchError = (operation, table, error, context = {}) => {
    const payload = {
        operation,
        table,
        ...context,
        query: context.query || null,
        user_id: context.userId || context.user_id || null,
        selectedDate: context.selectedDate || context.date || context.workoutDate || context.workout_date || null,
        date: context.date || context.workoutDate || context.workout_date || null,
        error,
        code: error?.code,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        responseData: context.responseData ?? null,
    };
    console.error("[records] Supabase fetch failed", payload);
    return payload;
};

const attachRecordFetchContext = (error, context) => {
    if (error && typeof error === "object") {
        error.__recordFetchContext = context;
        return error;
    }
    const wrapped = new Error(String(error || "Supabase fetch failed"));
    wrapped.__recordFetchContext = context;
    return wrapped;
};

const getHistoryLoadErrorMessage = (error) => {
    const message = String(error?.message || "");
    const context = error?.__recordFetchContext;
    if (context?.table || context?.query || message) {
        return `記録の取得に失敗しました: ${context?.table || "unknown"} ${context?.operation || ""} - ${message || "unknown error"}`;
    }
    if (message.includes("statement timeout") || message.includes("canceling statement")) {
        return "記録の取得に時間がかかっています。再取得してください。";
    }
    return "記録の取得に失敗しました。再取得してください。";
};

const getRuntimeEnvironmentLabel = () => {
    if (typeof window === "undefined") return "server";
    const protocol = window.location?.protocol || "";
    if (protocol === "capacitor:") return "ios-capacitor";
    return protocol.replace(":", "") || "web";
};

const isTransientSupabaseFetchError = (error) => {
    const message = String(error?.message || error || "").toLowerCase();
    const status = Number(error?.status || error?.statusCode || error?.code);
    return (
        status === 503 ||
        status === 504 ||
        message.includes("503") ||
        message.includes("service unavailable") ||
        message.includes("err_failed") ||
        message.includes("failed to fetch") ||
        message.includes("cors") ||
        message.includes("statement timeout") ||
        message.includes("canceling statement")
    );
};

const getWorkoutDraftSignature = (draft) => JSON.stringify({
    todayLabels: draft?.todayLabels || [],
    sessionEx: (draft?.sessionEx || []).map((ex) => ({
        id: ex?.id || "",
        name: ex?.name || "",
        label: ex?.label || "",
        bodyPart: ex?.bodyPart || "",
    })),
    logData: draft?.logData || {},
    exerciseUnits: draft?.exerciseUnits || {},
});

const unwrapVersionedHistoryCache = (value, { allowLegacy = false } = {}) => {
    if (!isPlainObject(value)) return allowLegacy ? value : null;

    if (
        value.__schema === "pump.history_cache" &&
        value.schemaVersion === HISTORY_CACHE_SCHEMA_VERSION &&
        value.appVersion === APP_VERSION &&
        isPlainObject(value.history)
    ) {
        return value.history;
    }

    if (value.__schema || value.schemaVersion || value.appVersion || value.history) {
        return null;
    }

    return allowLegacy ? value : null;
};

const buildVersionedHistoryCache = (historyMap) => ({
    __schema: "pump.history_cache",
    schemaVersion: HISTORY_CACHE_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    savedAt: new Date().toISOString(),
    history: historyMap || {},
});

const loadTrustedHistoryCache = (key, fallback = null) => {
    const raw = load(key, null);
    const trusted = unwrapVersionedHistoryCache(raw, { allowLegacy: false });
    return trusted || fallback;
};

const persistHistoryForUser = (userId, nextHistory) => {
    const versionedHistory = buildVersionedHistoryCache(nextHistory);
    save("history", versionedHistory);

    if (userId) {
        save(getUserHistoryCacheKey(userId), versionedHistory);
        save(HISTORY_OWNER_KEY, userId);
    }
};

const clearVersionedAppCachesIfNeeded = () => {
    if (typeof window === "undefined") return;

    const previousVersion = load(APP_VERSION_STORAGE_KEY, "");
    if (previousVersion === APP_VERSION) return;

    const removedKeys = [];
    try {
        for (let i = localStorage.length - 1; i >= 0; i -= 1) {
            const key = localStorage.key(i);
            if (!key) continue;
            if (
                key === "history" ||
                key.startsWith("history_cache_") ||
                key === "workoutsDataHistory" ||
                key.startsWith("workoutsDataHistory") ||
                key.startsWith("cachedWeeklySummary") ||
                key.startsWith("homeWeeklySummary")
            ) {
                localStorage.removeItem(key);
                removedKeys.push(key);
            }
        }
        save(APP_VERSION_STORAGE_KEY, APP_VERSION);
    } catch (error) {
        console.error("[app version] cache migration failed", {
            appVersion: APP_VERSION,
            previousVersion,
            removedKeys,
            error,
            message: error?.message,
        });
        return;
    }

    if (removedKeys.length > 0) {
        console.warn("[app version] cleared stale local workout caches", {
            appVersion: APP_VERSION,
            previousVersion: previousVersion || null,
            removedKeys,
        });
    }
};

clearVersionedAppCachesIfNeeded();

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

const describeHistoryRecordsForDate = (historyMap, targetDate) => {
    const normalizedDate = String(targetDate || "").slice(0, 10);
    if (!normalizedDate) return [];

    return Object.entries(historyMap || {})
        .flatMap(([exerciseName, records]) =>
            (records || []).map((record) => {
                const sanitized = sanitizeHistoryRecord(record, { allowBodyweight: true });
                if (sanitized?.date !== normalizedDate) return null;

                return {
                    exerciseName,
                    date: sanitized.date,
                    bodyPart: sanitized.bodyPart || "",
                    setCount: sanitized.sets?.length || 0,
                    sets: (sanitized.sets || []).map((set) => ({
                        weight: set?.weight,
                        reps: set?.reps,
                        unit: set?.unit || set?.displayUnit || set?.weightUnit || set?.weight_unit || null,
                    })),
                    rawDate: record?.date ?? record?.workoutDate ?? record?.workout_date ?? "",
                };
            })
        )
        .filter(Boolean);
};

const EXPLICIT_SET_EDIT_REASONS = new Set(["weight_change", "reps_change", "unit_change", "set_input_change", "explicit_set_edit"]);
const EXPLICIT_WORKOUT_EDIT_REASONS = new Set([
    ...EXPLICIT_SET_EDIT_REASONS,
    "history_record_edit",
    "exercise_add",
    "set_add",
    "exercise_reorder",
]);

const isExplicitWorkoutEditChange = (pendingChange = {}) =>
    Boolean(pendingChange.explicitEdit || EXPLICIT_WORKOUT_EDIT_REASONS.has(pendingChange.reason));

const normalizeWorkoutEditSource = (source) =>
    String(source || "").replace(/^useWorkoutLog:/, "");

const getWorkoutEditReasonFromSource = (source) => {
    const normalizedSource = normalizeWorkoutEditSource(source);
    if (EXPLICIT_WORKOUT_EDIT_REASONS.has(normalizedSource)) return normalizedSource;
    if (normalizedSource.includes("weight_change")) return "weight_change";
    if (normalizedSource.includes("reps_change")) return "reps_change";
    if (normalizedSource.includes("unit_change")) return "unit_change";
    if (normalizedSource.includes("set_input_change")) return "set_input_change";
    if (normalizedSource.includes("exercise_add")) return "exercise_add";
    if (normalizedSource.includes("set_add")) return "set_add";
    if (normalizedSource.includes("history_record_edit")) return "history_record_edit";
    if (normalizedSource === "user_edit" || normalizedSource === "user_input") return "user_edit";
    return "";
};

const isUnsavedUserWorkoutDraft = (draft = {}) =>
    Boolean(
        draft?.meta?.hasUnsavedChanges === true &&
        getWorkoutEditReasonFromSource(draft?.meta?.source)
    );

const getSetEditUnit = (set, fallbackUnit = "kg") =>
    normalizeSetWeightMode(
        set?.weightMode
        || set?.weightType
        || set?.displayUnit
        || set?.unit
        || set?.weightUnit
        || set?.weight_unit
        || fallbackUnit
    );

const getSetEditDisplayWeight = (set) => {
    const value = set?.displayWeight ?? set?.weight;
    return String(value ?? "").trim();
};

const getSetEditSummary = (set, fallbackUnit = "kg") => ({
    weight: getSetEditDisplayWeight(set),
    unit: getSetEditUnit(set, fallbackUnit),
    reps: String(set?.reps ?? "").trim(),
});

const normalizeEditCompareValue = (value) => {
    const text = String(value ?? "").trim();
    if (!text) return "";
    if (text.toUpperCase() === "BW") return "BW";
    const num = Number(text);
    return Number.isFinite(num) ? String(Math.round(num * 1000) / 1000) : text;
};

const findEditedSetInHistory = (historyMap, targetDate, exerciseName, setIndex = 0) => {
    const normalizedDate = String(targetDate || "").slice(0, 10);
    const normalizedExercise = normalizeExerciseName(exerciseName);
    const entry = Object.entries(historyMap || {}).find(([name]) =>
        name === exerciseName || normalizeExerciseName(name) === normalizedExercise
    );
    if (!entry) return null;

    const [, records] = entry;
    const record = (records || []).find((item) => (
        String(item?.date || item?.workoutDate || item?.workout_date || "").slice(0, 10) === normalizedDate
    ));
    if (!record) return null;

    const sets = getRecordSourceSets(record);
    return sets?.[Number(setIndex) || 0] || null;
};

const isEditedSetPersisted = (expectedSet, actualSet) => {
    if (!expectedSet || !actualSet) return false;

    const expected = getSetEditSummary(expectedSet);
    const actual = getSetEditSummary(actualSet, expected.unit);
    const expectedReps = normalizeEditCompareValue(expected.reps);
    const actualReps = normalizeEditCompareValue(actual.reps);

    // weightをkg基準で比較（単位が違っても数値が同じなら一致とみなす）
    const toKg = (weight, unit) => {
        const num = Number(weight);
        if (!Number.isFinite(num)) return null;
        if (unit === "lbs" || unit === "lb") return num / 2.20462;
        return num;
    };
    const expectedKg = toKg(expected.weight, expected.unit);
    const actualKg = toKg(actual.weight, actual.unit);
    const weightMatch = expectedKg !== null && actualKg !== null
        ? Math.abs(expectedKg - actualKg) < 0.1
        : normalizeEditCompareValue(expected.weight) === normalizeEditCompareValue(actual.weight);

    return weightMatch && expectedReps === actualReps;
};

const getEmptyWorkoutMetrics = (updatedAt = null) => ({
    hasWorkout: false,
    exerciseCount: 0,
    setCount: 0,
    volume: 0,
    exerciseNames: [],
    updatedAt: updatedAt || null,
});

const roundWorkoutMetric = (value) => Math.round(Number(value || 0) * 10) / 10;

const getHistoryMetricsForDate = (historyMap, targetDate, { updatedAt = null } = {}) => {
    const normalizedDate = String(targetDate || "").slice(0, 10);
    if (!normalizedDate) return getEmptyWorkoutMetrics(updatedAt);

    const exerciseNames = [];
    let setCount = 0;
    let volume = 0;

    Object.entries(historyMap || {}).forEach(([exerciseName, records]) => {
        (records || []).forEach((record) => {
            const sanitized = sanitizeHistoryRecord(record, { allowBodyweight: true });
            if (sanitized?.date !== normalizedDate) return;

            const sets = sanitized.sets || [];
            exerciseNames.push(exerciseName);
            setCount += sets.length;
            volume += sets.reduce((sum, set) => {
                const weight = Number(set?.weight);
                const reps = Number(set?.reps);
                if (!Number.isFinite(weight) || !Number.isFinite(reps)) return sum;
                return sum + (weight > 0 && reps > 0 ? weight * reps : 0);
            }, 0);
        });
    });

    const uniqueExerciseNames = [...new Set(exerciseNames)];

    return {
        hasWorkout: uniqueExerciseNames.length > 0 && setCount > 0,
        exerciseCount: uniqueExerciseNames.length,
        setCount,
        volume: roundWorkoutMetric(volume),
        exerciseNames: uniqueExerciseNames,
        updatedAt: updatedAt || null,
    };
};

const getWorkoutSummaryMetrics = (summaryJson, { totalVolume = null, exerciseCount = null, updatedAt = null } = {}) => {
    const items = Array.isArray(summaryJson?.items) ? summaryJson.items : [];
    const setCount = Number.isFinite(Number(summaryJson?.setCount))
        ? Number(summaryJson.setCount)
        : items.reduce((sum, item) => sum + Math.max(0, Number(item?.set_count) || 0), 0);
    const resolvedVolume = Number.isFinite(Number(totalVolume))
        ? Number(totalVolume)
        : Number.isFinite(Number(summaryJson?.totalVolume))
            ? Number(summaryJson.totalVolume)
            : items.reduce((sum, item) => sum + Math.max(0, Number(item?.volume) || 0), 0);
    const exerciseNames = [...new Set(items.map((item) => String(item?.exercise_name || item?.exerciseName || "").trim()).filter(Boolean))];
    const resolvedExerciseCount = Number.isFinite(Number(exerciseCount))
        ? Number(exerciseCount)
        : Number.isFinite(Number(summaryJson?.exerciseCount))
            ? Number(summaryJson.exerciseCount)
            : exerciseNames.length;

    return {
        hasWorkout: resolvedExerciseCount > 0 && setCount > 0,
        exerciseCount: resolvedExerciseCount,
        setCount,
        volume: roundWorkoutMetric(resolvedVolume),
        exerciseNames,
        updatedAt: updatedAt || null,
    };
};

const getWorkoutPayloadMetrics = (payload, { updatedAt = null } = {}) =>
    getWorkoutSummaryMetrics(payload?.session?.summary_json, {
        totalVolume: payload?.session?.total_volume,
        exerciseCount: payload?.session?.exercise_count,
        updatedAt,
    });

const getDraftMetricsForDate = ({ exercises = [], logData = {}, getExUnit, workoutDate }) => {
    const payload = buildWorkoutSessionPayloadFromDraft({
        exercises: mergeDraftExercisesWithLogData(exercises, logData),
        logData,
        getExUnit,
        workoutDate,
    });
    return getWorkoutPayloadMetrics(payload);
};

const isDestructiveWorkoutRegression = (incomingMetrics, existingMetrics, options = {}) => {
    if (!existingMetrics?.hasWorkout) return false;
    if (!incomingMetrics?.hasWorkout) return true;

    const incomingNames = new Set((incomingMetrics.exerciseNames || []).map((name) => normalizeExerciseName(name)));
    const missingExistingNames = (existingMetrics.exerciseNames || [])
        .map((name) => normalizeExerciseName(name))
        .filter((name) => name && !incomingNames.has(name));

    const shouldBlockVolumeRegression =
        !options.allowVolumeDecrease &&
        incomingMetrics.volume + 0.01 < existingMetrics.volume;

    return (
        missingExistingNames.length > 0 ||
        incomingMetrics.exerciseCount < existingMetrics.exerciseCount ||
        incomingMetrics.setCount < existingMetrics.setCount ||
        shouldBlockVolumeRegression
    );
};

const getWorkoutRegressionDetails = (incomingMetrics = {}, existingMetrics = {}) => {
    const incomingNames = new Set((incomingMetrics.exerciseNames || []).map((name) => normalizeExerciseName(name)).filter(Boolean));
    const removedExerciseNames = (existingMetrics.exerciseNames || [])
        .filter((name) => {
            const normalizedName = normalizeExerciseName(name);
            return normalizedName && !incomingNames.has(normalizedName);
        });
    const exerciseCountReduced = Number(incomingMetrics.exerciseCount || 0) < Number(existingMetrics.exerciseCount || 0);
    const setCountReduced = Number(incomingMetrics.setCount || 0) < Number(existingMetrics.setCount || 0);
    const volumeReduced = Number(incomingMetrics.volume || 0) + 0.01 < Number(existingMetrics.volume || 0);

    return {
        removedExerciseNames,
        exerciseCountReduced,
        setCountReduced,
        volumeReduced,
    };
};

const getWorkoutSaveGuardDecision = ({
    incomingMetrics,
    remoteMetrics,
    reason,
    explicitEdit = false,
    explicitDelete = false,
}) => {
    const details = getWorkoutRegressionDetails(incomingMetrics, remoteMetrics);
    const remoteHasWorkout = Boolean(remoteMetrics?.hasWorkout);
    const localHasWorkout = Boolean(incomingMetrics?.hasWorkout);

    if (explicitDelete) {
        return {
            blocked: false,
            allowedReason: `explicit delete allowed: ${reason || "delete"}`,
            blockedReason: null,
            details,
        };
    }

    if (remoteHasWorkout && !localHasWorkout) {
        return {
            blocked: true,
            allowedReason: null,
            blockedReason: "local workout has no valid sets while remote has workout",
            details,
        };
    }

    const hasStructuralRegression =
        details.removedExerciseNames.length > 0 ||
        details.exerciseCountReduced ||
        details.setCountReduced;

    if (explicitEdit) {
        if (hasStructuralRegression) {
            return {
                blocked: true,
                allowedReason: null,
                blockedReason: [
                    details.removedExerciseNames.length ? `removed exercises: ${details.removedExerciseNames.join(", ")}` : "",
                    details.exerciseCountReduced ? "exercise count reduced" : "",
                    details.setCountReduced ? "set count reduced" : "",
                ].filter(Boolean).join("; "),
                details,
            };
        }

        return {
            blocked: false,
            allowedReason: details.volumeReduced
                ? `explicit edit allowed despite volume decrease: ${reason || "content_change"}`
                : `explicit edit allowed: ${reason || "content_change"}`,
            blockedReason: null,
            details,
        };
    }

    if (remoteHasWorkout && (hasStructuralRegression || details.volumeReduced)) {
        return {
            blocked: true,
            allowedReason: null,
            blockedReason: [
                details.removedExerciseNames.length ? `removed exercises: ${details.removedExerciseNames.join(", ")}` : "",
                details.exerciseCountReduced ? "exercise count reduced" : "",
                details.setCountReduced ? "set count reduced" : "",
                details.volumeReduced ? "volume reduced" : "",
            ].filter(Boolean).join("; "),
            details,
        };
    }

    return {
        blocked: false,
        allowedReason: localHasWorkout ? `content edit allowed: ${reason || "unknown"}` : "no local workout for date",
        blockedReason: null,
        details,
    };
};

const isMetricPersistenceMismatch = (expectedMetrics, actualMetrics) => {
    if (!expectedMetrics?.hasWorkout && !actualMetrics?.hasWorkout) return false;
    if (expectedMetrics?.exerciseCount !== actualMetrics?.exerciseCount) return true;
    if (expectedMetrics?.setCount !== actualMetrics?.setCount) return true;
    if (Math.abs(Number(expectedMetrics?.volume || 0) - Number(actualMetrics?.volume || 0)) > 0.01) return true;

    const expectedNames = [...new Set((expectedMetrics?.exerciseNames || []).map((name) => normalizeExerciseName(name)).filter(Boolean))].sort();
    const actualNames = [...new Set((actualMetrics?.exerciseNames || []).map((name) => normalizeExerciseName(name)).filter(Boolean))].sort();
    return JSON.stringify(expectedNames) !== JSON.stringify(actualNames);
};

const logWorkoutPersistenceDecision = ({
    action,
    userId,
    date,
    localMetrics,
    remoteMetrics,
    reason,
    level = "log",
}) => {
    const payload = {
        action,
        env: getRuntimeEnvironmentLabel(),
        origin: typeof window !== "undefined" ? window.location?.origin : "",
        user_id: userId || null,
        date,
        source: reason?.includes("explicit") || reason?.includes("content edit") ? "user edit" : "system",
        allowed: !String(reason || "").includes("blocked"),
        blockedReason: String(reason || "").includes("blocked") ? reason : null,
        local: localMetrics,
        remote: remoteMetrics,
        localExerciseNames: localMetrics?.exerciseNames || [],
        remoteExerciseNames: remoteMetrics?.exerciseNames || [],
        localSetCount: localMetrics?.setCount ?? 0,
        remoteSetCount: remoteMetrics?.setCount ?? 0,
        localVolume: localMetrics?.volume ?? 0,
        remoteVolume: remoteMetrics?.volume ?? 0,
        localUpdatedAt: localMetrics?.updatedAt || null,
        remoteUpdatedAt: remoteMetrics?.updatedAt || null,
        reason,
    };

    if (level === "warn") {
        console.warn("[workout-save-guard]", payload);
    } else {
        console.log("[workout-save-guard]", payload);
    }
};

const buildHistoryFromWorkoutSessionRows = (sessionRows = []) => {
    const historyMap = {};

    (sessionRows || []).forEach((session) => {
        const workoutDate = String(session?.workout_date || "").slice(0, 10);
        const durationSec = Math.floor(Number(session?.duration_sec) || 0);
        const summaryItems = Array.isArray(session?.summary_json?.items)
            ? session.summary_json.items
            : [];

        if (!workoutDate || !summaryItems.length) return;

        summaryItems.forEach((item, index) => {
            const exerciseName = String(item?.exercise_name || item?.exerciseName || "").trim();
            if (!exerciseName) return;

            const sets = sanitizeWorkoutSets(item?.sets || [], { allowBodyweight: true });
            if (!sets.length) return;

            if (!historyMap[exerciseName]) historyMap[exerciseName] = [];

            const durationMinutes = durationSec > 0 && durationSec < 86400
                ? Math.max(1, Math.round(durationSec / 60))
                : 0;

            historyMap[exerciseName].push({
                date: workoutDate,
                bodyPart: String(item?.body_part || item?.bodyPart || "").trim(),
                order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index,
                sets,
                weight: sets[0]?.weight === "BW" ? "BW" : Number(sets[0]?.weight),
                reps: Number(sets[0]?.reps),
                source: "workout_session",
                ...(durationMinutes > 0
                    ? {
                        duration_sec: durationSec,
                        durationSec,
                        durationMinutes,
                        elapsedMinutes: durationMinutes,
                    }
                    : {}),
            });
        });
    });

    return historyMap;
};

const removeHistoryDateFromMap = (historyMap, targetDate) => {
    const normalizedDate = String(targetDate || "").slice(0, 10);
    if (!normalizedDate) return historyMap || {};

    const next = {};
    Object.entries(historyMap || {}).forEach(([exerciseName, records]) => {
        const keptRecords = (records || []).filter((record) => (
            String(record?.date || record?.workoutDate || record?.workout_date || "").slice(0, 10) !== normalizedDate
        ));
        if (keptRecords.length > 0) next[exerciseName] = keptRecords;
    });

    return next;
};

const applyPreferredHistoryDates = (baseHistory, preferredHistory, dates = []) => {
    const normalizedDates = [...new Set(
        (dates || []).map((date) => String(date || "").slice(0, 10)).filter(Boolean)
    )];
    let nextHistory = mergeHistoryMaps(baseHistory || {});

    normalizedDates.forEach((date) => {
        nextHistory = removeHistoryDateFromMap(nextHistory, date);
        const dateRecords = {};
        Object.entries(preferredHistory || {}).forEach(([exerciseName, records]) => {
            const filtered = (records || []).filter((record) => (
                String(record?.date || record?.workoutDate || record?.workout_date || "").slice(0, 10) === date
            ));
            if (filtered.length > 0) dateRecords[exerciseName] = filtered;
        });
        nextHistory = mergeHistoryMaps(nextHistory, dateRecords);
    });

    return nextHistory;
};

const removeExerciseRecordOnDate = (historyMap, exerciseName, targetDate) => {
    const normalizedDate = String(targetDate || "").slice(0, 10);
    if (!normalizedDate || !exerciseName) return historyMap || {};

    const next = { ...(historyMap || {}) };
    const keptRecords = (next[exerciseName] || []).filter((record) => (
        String(record?.date || record?.workoutDate || record?.workout_date || "").slice(0, 10) !== normalizedDate
    ));

    if (keptRecords.length > 0) {
        next[exerciseName] = keptRecords;
    } else {
        delete next[exerciseName];
    }

    return next;
};

const buildRemoteHistoryWithWorkoutRowsPriority = (workoutRows = [], sessionRows = []) => {
    return buildTrustedHistory({
        workoutRows,
        sessionRows,
        source: "remote_workouts_priority",
        log: shouldLogPerfDebug(),
    }).history;
};

const normalizeTrustedWorkoutRowDate = (row) => (
    String(row?.date || row?.workout_date || row?.workoutDate || "").slice(0, 10)
);

const normalizeTrustedSessionRowDate = (row) => (
    String(row?.workout_date || row?.date || row?.workoutDate || "").slice(0, 10)
);

const sortTrustedRowsByDate = (rows = [], getDate = normalizeTrustedWorkoutRowDate) => (
    [...(rows || [])].sort((a, b) => getDate(a).localeCompare(getDate(b)))
);

const mergeTrustedRowsByDate = (currentRows = [], incomingRows = [], getDate = normalizeTrustedWorkoutRowDate) => {
    const rowsByDate = new Map();
    (currentRows || []).forEach((row) => {
        const date = getDate(row);
        if (date) rowsByDate.set(date, row);
    });
    (incomingRows || []).forEach((row) => {
        const date = getDate(row);
        if (date) rowsByDate.set(date, row);
    });
    return sortTrustedRowsByDate(Array.from(rowsByDate.values()), getDate);
};

const serializeTrustedRows = (rows = [], getDate = normalizeTrustedWorkoutRowDate) => (
    JSON.stringify(sortTrustedRowsByDate(rows || [], getDate).map((row) => ({
        date: getDate(row),
        data: row?.data ?? row?.summary_json ?? row,
        duration_sec: row?.duration_sec ?? null,
        total_volume: row?.total_volume ?? null,
        updated_at: row?.updated_at ?? null,
    })))
);

const serializeTrustedRow = (row, getDate = normalizeTrustedWorkoutRowDate) => (
    JSON.stringify({
        date: getDate(row),
        data: row?.data ?? row?.summary_json ?? row,
        duration_sec: row?.duration_sec ?? null,
        total_volume: row?.total_volume ?? null,
        updated_at: row?.updated_at ?? null,
    })
);

const buildTrustedRowSignatureMap = (rows = [], getDate = normalizeTrustedWorkoutRowDate) => {
    const map = new Map();
    (rows || []).forEach((row) => {
        const date = getDate(row);
        if (date) map.set(date, serializeTrustedRow(row, getDate));
    });
    return map;
};

const buildDraftHistoryForDate = ({
    baseHistory = {},
    workoutDate,
    exercises = [],
    logData = {},
    getExUnit,
    labels = [],
    durationSec = 0,
    replaceDate = false,
} = {}) => {
    const normalizedDate = String(workoutDate || "").slice(0, 10);
    if (!normalizedDate) return baseHistory || {};

    const duration = Math.max(0, Math.floor(Number(durationSec) || 0));
    const durationMinutes = duration > 0 ? Math.max(1, Math.round(duration / 60)) : 0;
    const draftRecords = {};

    mergeDraftExercisesWithLogData(exercises, logData, labels).forEach((exercise, index) => {
        const exerciseName = String(exercise?.name || "").trim();
        if (!exerciseName) return;

        const exUnit = typeof getExUnit === "function" ? getExUnit(exerciseName) : "kg";
        const stored = sanitizeWorkoutSets(
            (logData[exerciseName] || []).map((set) => ({
                ...set,
                weight: storeSetWeightForUnit(set, exUnit),
                displayWeight: set.weight,
                displayUnit: getSetDisplayUnit(set, exUnit),
                unit: getSetWeightMode(set, exUnit),
                weightMode: getSetWeightMode(set, exUnit),
                weightType: getSetWeightMode(set, exUnit),
                weightUnit: getSetWeightMode(set, exUnit),
                weight_unit: getSetWeightMode(set, exUnit),
            })),
            { allowBodyweight: true }
        );

        if (!stored.length) return;

        const bodyPart = getExerciseRecordBodyPart(exercise, labels[0] || null);
        draftRecords[exerciseName] = [{
            sets: stored,
            weight: stored[0].weight === "BW" ? "BW" : Number(stored[0].weight),
            reps: Number(stored[0].reps),
            date: normalizedDate,
            order: index,
            bodyPart,
            ...(duration > 0
                ? {
                    duration_sec: duration,
                    durationSec: duration,
                    durationMinutes,
                    elapsedMinutes: durationMinutes,
                }
                : {}),
        }];
    });

    const draftExerciseNames = Object.keys(draftRecords);
    if (!draftExerciseNames.length) {
        return replaceDate ? removeHistoryDateFromMap(baseHistory, normalizedDate) : (baseHistory || {});
    }

    let nextHistory = replaceDate
        ? removeHistoryDateFromMap(baseHistory, normalizedDate)
        : mergeHistoryMaps(baseHistory || {});

    if (!replaceDate) {
        draftExerciseNames.forEach((exerciseName) => {
            nextHistory = removeExerciseRecordOnDate(nextHistory, exerciseName, normalizedDate);
        });
    }

    return mergeHistoryMaps(nextHistory, draftRecords);
};

const getHistoryDebugSummaryForDate = (historyMap, targetDate) => {
    const normalizedDate = String(targetDate || "").slice(0, 10);
    const records = describeHistoryRecordsForDate(historyMap, normalizedDate);
    const metrics = getHistoryMetricsForDate(historyMap, normalizedDate);

    return {
        date: normalizedDate,
        exerciseNames: metrics.exerciseNames,
        bodyPartNames: [...new Set(records.map((record) => record.bodyPart).filter(Boolean))],
        setCountByExercise: records.reduce((acc, record) => {
            acc[record.exerciseName] = (acc[record.exerciseName] || 0) + (record.setCount || 0);
            return acc;
        }, {}),
        setsByExercise: records.reduce((acc, record) => {
            acc[record.exerciseName] = record.sets || [];
            return acc;
        }, {}),
        trackedExercises: TRACKED_WORKOUT_DEBUG_EXERCISES.reduce((acc, exerciseName) => {
            acc[exerciseName] = {
                included: metrics.exerciseNames.includes(exerciseName),
                sets: records.find((record) => record.exerciseName === exerciseName)?.sets || [],
            };
            return acc;
        }, {}),
        totalSetCount: metrics.setCount,
        totalVolume: metrics.volume,
    };
};

const getHistoryDebugDiffForDate = (beforeHistory, afterHistory, targetDate) => {
    const before = getHistoryDebugSummaryForDate(beforeHistory, targetDate);
    const after = getHistoryDebugSummaryForDate(afterHistory, targetDate);
    const beforeNames = new Set(before.exerciseNames || []);
    const afterNames = new Set(after.exerciseNames || []);

    return {
        missingExerciseNames: [...beforeNames].filter((name) => !afterNames.has(name)),
        addedExerciseNames: [...afterNames].filter((name) => !beforeNames.has(name)),
        changedExerciseNames: [...afterNames].filter((name) => {
            const beforeSets = JSON.stringify(before.setsByExercise?.[name] || []);
            const afterSets = JSON.stringify(after.setsByExercise?.[name] || []);
            return beforeSets !== afterSets;
        }),
        before,
        after,
    };
};

const getDraftInputDebugSummary = ({ exercises = [], logData = {}, labels = [] } = {}) => {
    const mergedExercises = mergeDraftExercisesWithLogData(exercises, logData, labels);
    const exerciseNames = mergedExercises.map((exercise) => exercise.name);
    const bodyPartByExercise = mergedExercises.reduce((acc, exercise) => {
        acc[exercise.name] = getExerciseRecordBodyPart(exercise, labels[0] || null) || "";
        return acc;
    }, {});
    const setsByExercise = exerciseNames.reduce((acc, exerciseName) => {
        acc[exerciseName] = (logData[exerciseName] || []).map((set) => ({
            weight: set?.weight,
            reps: set?.reps,
            unit: set?.unit || set?.displayUnit || set?.weightMode || set?.weightUnit || set?.weight_unit || null,
            done: Boolean(set?.done),
        }));
        return acc;
    }, {});

    return {
        exerciseNames,
        bodyPartByExercise,
        setsByExercise,
        trackedExercises: TRACKED_WORKOUT_DEBUG_EXERCISES.reduce((acc, exerciseName) => {
            acc[exerciseName] = {
                included: exerciseNames.includes(exerciseName),
                bodyPart: bodyPartByExercise[exerciseName] || "",
                sets: setsByExercise[exerciseName] || [],
            };
            return acc;
        }, {}),
    };
};

const getRawDraftSetMetrics = ({ exercises = [], logData = {}, labels = [] } = {}) => {
    const mergedExercises = mergeDraftExercisesWithLogData(exercises, logData, labels);
    const exerciseNames = mergedExercises.map((exercise) => exercise.name);
    const setCountByExercise = exerciseNames.reduce((acc, exerciseName) => {
        acc[exerciseName] = Array.isArray(logData?.[exerciseName]) ? logData[exerciseName].length : 0;
        return acc;
    }, {});
    const setCount = Object.values(setCountByExercise).reduce((sum, count) => sum + count, 0);

    return {
        exerciseNames,
        exerciseCount: exerciseNames.length,
        setCount,
        setCountByExercise,
    };
};

const getRemovedRawDraftExerciseNames = (beforeDraft = {}, afterDraft = {}) => {
    const beforeMetrics = getRawDraftSetMetrics(beforeDraft);
    const afterMetrics = getRawDraftSetMetrics(afterDraft);
    const afterNames = new Set(
        (afterMetrics.exerciseNames || [])
            .map((name) => normalizeExerciseName(name))
            .filter(Boolean)
    );

    return (beforeMetrics.exerciseNames || []).filter((name) => {
        const normalizedName = normalizeExerciseName(name);
        return normalizedName && !afterNames.has(normalizedName);
    });
};

const shouldPreserveRawDraftOverIncoming = (localDraft = {}, incomingDraft = {}) => {
    const localRawMetrics = getRawDraftSetMetrics(localDraft);
    const incomingRawMetrics = getRawDraftSetMetrics(incomingDraft);
    const removedExerciseNames = getRemovedRawDraftExerciseNames(localDraft, incomingDraft);

    return {
        preserve:
            removedExerciseNames.length > 0 ||
            localRawMetrics.exerciseCount > incomingRawMetrics.exerciseCount ||
            localRawMetrics.setCount > incomingRawMetrics.setCount,
        localRawMetrics,
        incomingRawMetrics,
        removedExerciseNames,
    };
};

const makeDraftMeta = (meta = {}, overrides = {}) => {
    const now = new Date().toISOString();
    const source = overrides.source ?? meta?.source ?? "local_draft";
    return {
        ...meta,
        ...overrides,
        source,
        updatedAt: overrides.updatedAt ?? now,
        remoteVerifiedAt: overrides.remoteVerifiedAt ?? meta?.remoteVerifiedAt ?? null,
        hasUnsavedChanges: overrides.hasUnsavedChanges ?? meta?.hasUnsavedChanges ?? true,
    };
};

const withDraftMeta = (draft = {}, overrides = {}) => ({
    ...draft,
    meta: makeDraftMeta(draft?.meta || {}, overrides),
});

const normalizeDraftDateKey = (value) => String(value || "").slice(0, 10);

const getDraftDateCandidates = (draft = {}) => {
    const meta = draft?.meta || {};
    return {
        metaDate: normalizeDraftDateKey(meta.date),
        metaKeyDate: normalizeDraftDateKey(meta.keyDate),
        metaDraftDate: normalizeDraftDateKey(meta.draftDate),
        metaWorkoutDate: normalizeDraftDateKey(meta.workoutDate || meta.workout_date),
        draftDate: normalizeDraftDateKey(draft.date),
        draftLogDate: normalizeDraftDateKey(draft.logDate),
        draftWorkoutDate: normalizeDraftDateKey(draft.workoutDate || draft.workout_date),
    };
};

const getDraftPayloadDate = (draft = {}) => {
    const candidates = getDraftDateCandidates(draft);
    return Object.values(candidates).find(Boolean) || "";
};

const getDraftDateValidation = (keyDate, draft = {}, selectedDate = keyDate) => {
    const normalizedKeyDate = normalizeDraftDateKey(keyDate);
    const normalizedSelectedDate = normalizeDraftDateKey(selectedDate) || normalizedKeyDate;
    const candidates = getDraftDateCandidates(draft);
    const mismatches = Object.entries(candidates)
        .filter(([, date]) => date && date !== normalizedKeyDate)
        .map(([field, date]) => ({ field, date }));
    const payloadDate = Object.values(candidates).find(Boolean) || "";

    return {
        keyDate: normalizedKeyDate,
        selectedDate: normalizedSelectedDate,
        payloadDate,
        accepted: mismatches.length === 0,
        mismatches,
        rejectedReason: mismatches.length
            ? `draft payload date mismatch: ${mismatches.map(({ field, date }) => `${field}=${date}`).join(", ")}`
            : "",
    };
};

const withDraftDateMeta = (dateStr, draft = {}, overrides = {}) => {
    const normalizedDate = normalizeDraftDateKey(dateStr);
    return withDraftMeta(draft, {
        ...overrides,
        date: normalizedDate,
        keyDate: normalizedDate,
        draftDate: normalizedDate,
        workoutDate: normalizedDate,
    });
};

const isCleanPersistedDraft = (draft = {}) => (
    draft?.meta?.hasUnsavedChanges === false &&
    ["save_verified", "remote_supabase"].includes(draft?.meta?.source)
);

const getTimestampMs = (value) => {
    const ms = Date.parse(value || "");
    return Number.isFinite(ms) ? ms : 0;
};

const isDraftNewerThan = (draft = {}, timestamp) => {
    const draftMs = getTimestampMs(draft?.meta?.updatedAt);
    const targetMs = getTimestampMs(timestamp);
    return draftMs > 0 && targetMs > 0 && draftMs > targetMs;
};

const normalizeLogDraftState = (draft = {}) => {
    const todayLabels = Array.isArray(draft.todayLabels) ? draft.todayLabels : [];
    const logData = draft.logData || {};
    const sessionEx = draft.sessionEx === null && !Object.keys(logData).length
        ? null
        : mergeDraftExercisesWithLogData(draft.sessionEx || [], logData, todayLabels);

    return {
        todayLabels,
        logData,
        sessionEx,
        exerciseUnits: draft.exerciseUnits || {},
        meta: draft.meta || null,
    };
};

const getCurrentWeekRangeForHomeSummary = () => {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);
    startDate.setDate(now.getDate() + diff);

    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);

    return {
        start: formatDateKey(startDate),
        end: formatDateKey(endDate),
        key: `${formatDateKey(startDate)}:${formatDateKey(endDate)}`,
    };
};

const getHistoryOverallMetrics = (historyMap) => {
    const exerciseNames = new Set();
    let setCount = 0;
    let volume = 0;

    Object.entries(historyMap || {}).forEach(([exerciseName, records]) => {
        (records || []).forEach((record) => {
            const sanitized = sanitizeHistoryRecord(record, { allowBodyweight: true });
            if (!sanitized?.date) return;
            exerciseNames.add(exerciseName);
            (sanitized.sets || []).forEach((set) => {
                setCount += 1;
                const weight = Number(set?.weight);
                const reps = Number(set?.reps);
                if (Number.isFinite(weight) && Number.isFinite(reps) && weight > 0 && reps > 0) {
                    volume += weight * reps;
                }
            });
        });
    });

    return {
        exerciseCount: exerciseNames.size,
        exerciseNames: Array.from(exerciseNames).sort(),
        setCount,
        volume,
    };
};

const getWorkoutRowsDebugSummary = (rows = []) => {
    const scopedHistory = buildHistoryFromWorkoutRowsWithScopes(rows);
    const recoveredDates = [...new Set([
        ...scopedHistory.exactDates,
        ...scopedHistory.legacyDates,
    ])].sort();

    return {
        rowCount: rows.length,
        dates: rows.map((row) => String(row?.date || "").slice(0, 10)).filter(Boolean),
        exactDates: scopedHistory.exactDates,
        legacyEmbeddedDates: scopedHistory.legacyDates,
        preMay15RowDates: rows
            .map((row) => String(row?.date || "").slice(0, 10))
            .filter((date) => date && date < "2026-05-15"),
        preMay15RecoveredDates: recoveredDates.filter((date) => date < "2026-05-15"),
        "2026-05-25": rows
            .filter((row) => String(row?.date || "").slice(0, 10) === "2026-05-25")
            .map((row) => getHistoryMetricsForDate(row?.data || {}, "2026-05-25")),
    };
};

const getWorkoutSessionRowsDebugSummary = (rows = []) => ({
    rowCount: rows.length,
    dates: rows.map((row) => String(row?.workout_date || "").slice(0, 10)).filter(Boolean),
    "2026-05-25": rows
        .filter((row) => String(row?.workout_date || "").slice(0, 10) === "2026-05-25")
        .map((row) => ({
            workout_date: String(row?.workout_date || "").slice(0, 10),
            total_volume: row?.total_volume ?? null,
            exercise_count: row?.exercise_count ?? null,
            summaryMetrics: getWorkoutSummaryMetrics(row?.summary_json, {
                totalVolume: row?.total_volume,
                exerciseCount: row?.exercise_count,
            }),
        })),
});

const normalizeHomeSummaryBodyPart = (label) => {
    const raw = String(label || "").trim();
    if (raw === "ハムストリングス" || raw === "ハムストリング" || raw === "大腿二頭筋") return "ハム";
    if (raw === "腹") return "腹筋";
    return raw || "その他";
};

const getHomeWeeklySummaryDebug = (historyMap, { start, end } = getCurrentWeekRangeForHomeSummary()) => {
    const exerciseNames = [];
    const bodyPartCounts = {};
    const setCountByExercise = {};
    let totalSetCount = 0;

    Object.entries(historyMap || {}).forEach(([exerciseName, records]) => {
        (records || []).forEach((record) => {
            const sanitized = sanitizeHistoryRecord(record, { allowBodyweight: true });
            if (!sanitized?.date || sanitized.date < start || sanitized.date > end) return;

            const setCount = sanitized.sets?.length || 0;
            if (setCount <= 0) return;

            const bodyPart = normalizeHomeSummaryBodyPart(
                sanitized.bodyPart || EX_TO_LABEL[exerciseName] || ""
            );
            if (bodyPart !== "その他") {
                bodyPartCounts[bodyPart] = (bodyPartCounts[bodyPart] || 0) + setCount;
            }

            exerciseNames.push(exerciseName);
            setCountByExercise[exerciseName] = (setCountByExercise[exerciseName] || 0) + setCount;
            totalSetCount += setCount;
        });
    });

    return {
        week: { start, end },
        exerciseNames: [...new Set(exerciseNames)],
        bodyPartCounts,
        hamSetCount: bodyPartCounts["ハム"] || 0,
        totalSetCount,
        setCountByExercise,
    };
};

const HOME_WEEKLY_DEBUG_DATE = "2026-06-03";

const getHistoryDatesInRange = (historyMap, { start, end } = getCurrentWeekRangeForHomeSummary()) => {
    const dates = new Set();
    Object.values(historyMap || {}).forEach((records) => {
        (records || []).forEach((record) => {
            const date = String(record?.date || record?.workoutDate || record?.workout_date || "").slice(0, 10);
            if (date && date >= start && date <= end) dates.add(date);
        });
    });
    return [...dates].sort();
};

const getHomeWeeklyDateDebug = (historyMap, targetDate = HOME_WEEKLY_DEBUG_DATE) => {
    const normalizedDate = String(targetDate || "").slice(0, 10);
    const exerciseNames = [];
    const shoulderExercises = [];
    const setCountByExercise = {};
    let shoulderSetCount = 0;

    Object.entries(historyMap || {}).forEach(([exerciseName, records]) => {
        (records || []).forEach((record) => {
            const sanitized = sanitizeHistoryRecord(record, { allowBodyweight: true });
            if (sanitized?.date !== normalizedDate) return;

            const setCount = sanitized.sets?.length || 0;
            if (setCount <= 0) return;

            const bodyPart = normalizeHomeSummaryBodyPart(
                sanitized.bodyPart || EX_TO_LABEL[exerciseName] || ""
            );
            exerciseNames.push(exerciseName);
            setCountByExercise[exerciseName] = (setCountByExercise[exerciseName] || 0) + setCount;
            if (bodyPart === "肩") {
                shoulderExercises.push(exerciseName);
                shoulderSetCount += setCount;
            }
        });
    });

    return {
        date: normalizedDate,
        exerciseNames: [...new Set(exerciseNames)],
        shoulderExercises: [...new Set(shoulderExercises)],
        shoulderSetCount,
        setCountByExercise,
    };
};

const getHomePropsDateDebug = (historyMap, targetDates = []) => {
    const dateSet = new Set((targetDates || []).map((date) => String(date || "").slice(0, 10)).filter(Boolean));
    const result = {};

    dateSet.forEach((date) => {
        result[date] = {
            exercises: [],
            bodyPartCounts: {},
            totalSetCount: 0,
        };
    });

    Object.entries(historyMap || {}).forEach(([exerciseName, records]) => {
        (records || []).forEach((record) => {
            const sanitized = sanitizeHistoryRecord(record, { allowBodyweight: true });
            const date = String(sanitized?.date || "").slice(0, 10);
            if (!dateSet.has(date)) return;

            const setCount = sanitized.sets?.length || 0;
            if (setCount <= 0) return;

            const bodyPart = normalizeHomeSummaryBodyPart(
                sanitized.bodyPart || EX_TO_LABEL[exerciseName] || ""
            );

            result[date].exercises.push({
                name: exerciseName,
                bodyPart,
                setCount,
            });
            result[date].bodyPartCounts[bodyPart] = (result[date].bodyPartCounts[bodyPart] || 0) + setCount;
            result[date].totalSetCount += setCount;
        });
    });

    Object.values(result).forEach((day) => {
        day.exercises.sort((a, b) => String(a.name).localeCompare(String(b.name), "ja"));
    });

    return result;
};

const getHomeWeeklySourceDebug = ({
    workoutsHistory = {},
    summaryHistory = {},
    finalHistory = {},
    weekRange = getCurrentWeekRangeForHomeSummary(),
    source = "unknown",
    appliedSource = "unknown",
    ignoredStaleSource = null,
} = {}) => {
    const workoutsSummary = getHomeWeeklySummaryDebug(workoutsHistory, weekRange);
    const summaryJsonSummary = getHomeWeeklySummaryDebug(summaryHistory, weekRange);
    const finalSummary = getHomeWeeklySummaryDebug(finalHistory, weekRange);
    const debugDate = getHomeWeeklyDateDebug(finalHistory, HOME_WEEKLY_DEBUG_DATE);

    return {
        weekRange: { start: weekRange.start, end: weekRange.end },
        source,
        loadedDates: getHistoryDatesInRange(finalHistory, weekRange),
        debugDate: HOME_WEEKLY_DEBUG_DATE,
        debugDateExerciseNames: debugDate.exerciseNames,
        debugDateShoulderExercises: debugDate.shoulderExercises,
        debugDateShoulderSetCount: debugDate.shoulderSetCount,
        setCountByExercise: finalSummary.setCountByExercise,
        bodyPartCounts: finalSummary.bodyPartCounts,
        summaryJsonShoulderCount: summaryJsonSummary.bodyPartCounts["肩"] || 0,
        workoutsDataShoulderCount: workoutsSummary.bodyPartCounts["肩"] || 0,
        appliedSource,
        ignoredStaleSource,
        finalShoulderSetCount: finalSummary.bodyPartCounts["肩"] || 0,
    };
};

const getHomeWeeklyStaleRegressionDecision = (
    trustedHistory = {},
    incomingHistory = {},
    weekRange = getCurrentWeekRangeForHomeSummary()
) => {
    const trustedSummary = getHomeWeeklySummaryDebug(trustedHistory, weekRange);
    const incomingSummary = getHomeWeeklySummaryDebug(incomingHistory, weekRange);
    const bodyParts = [...new Set([
        ...Object.keys(trustedSummary.bodyPartCounts || {}),
        ...Object.keys(incomingSummary.bodyPartCounts || {}),
    ])];
    const regressedBodyParts = bodyParts.filter((part) => (
        Number(incomingSummary.bodyPartCounts?.[part] || 0) < Number(trustedSummary.bodyPartCounts?.[part] || 0)
    ));
    const totalRegression = Number(incomingSummary.totalSetCount || 0) < Number(trustedSummary.totalSetCount || 0);
    const nonIncreasingTotal = Number(incomingSummary.totalSetCount || 0) <= Number(trustedSummary.totalSetCount || 0);

    return {
        blocked: Boolean(
            Number(trustedSummary.totalSetCount || 0) > 0 &&
            Number(incomingSummary.totalSetCount || 0) > 0 &&
            regressedBodyParts.length > 0 &&
            nonIncreasingTotal
        ),
        totalRegression,
        nonIncreasingTotal,
        trustedSummary,
        incomingSummary,
        regressedBodyParts,
    };
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

const buildWorkoutDraftForDateFromHistory = (dateStr, sourceHistory = {}) => {
    const normalizedDate = String(dateStr || "").slice(0, 10);
    if (!normalizedDate) {
        return {
            hasSavedWorkout: false,
            todayLabels: [],
            sessionEx: [],
            logData: {},
            exerciseUnits: {},
        };
    }

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
    const exerciseUnitsForDate = {};
    dayExercises.forEach(({ name, rec }) => {
        if (!rec?.sets) return;

        const fallbackUnit = rec?.displayUnit || rec?.unit || rec?.weightUnit || rec?.weight_unit || "kg";
        dayLogData[name] = rec.sets.map((set) => {
            const normalized = normalizeDraftSetFromRecord(set, fallbackUnit);
            if (normalized.unit) exerciseUnitsForDate[name] = normalized.unit;
            return normalized;
        });
    });

    return {
        hasSavedWorkout: dayExercises.length > 0,
        todayLabels: inferredLabels,
        sessionEx: dayExercises.map(({ id, name, label, bodyPart }) => ({ id, name, label, bodyPart })),
        logData: dayLogData,
        exerciseUnits: exerciseUnitsForDate,
        meta: {
            date: normalizedDate,
            keyDate: normalizedDate,
            draftDate: normalizedDate,
            workoutDate: normalizedDate,
            source: "history",
            hasUnsavedChanges: false,
        },
    };
};

export default function GymApp() {
    const getTodayKey = useCallback(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }, []);

    const getDraftKey = useCallback((baseKey, dateStr) => `${baseKey}_${dateStr}`, []);

    const loadDraftForDate = useCallback((dateStr) => {
        const normalizedDate = normalizeDraftDateKey(dateStr);
        const emptyDraft = withDraftDateMeta(normalizedDate, {
            todayLabels: [],
            logData: {},
            sessionEx: null,
            exerciseUnits: {},
        }, {
            source: "empty_draft",
            hasUnsavedChanges: false,
        });
        if (!normalizedDate) return emptyDraft;

        const hasDraftPayloadContent = (draft) => (
            draft.sessionEx !== null ||
            Object.keys(draft.logData || {}).length > 0 ||
            Object.keys(draft.exerciseUnits || {}).length > 0 ||
            (draft.todayLabels || []).length > 0
        );

        const normalizeDraftForLoad = (draft, source) => {
            const validation = getDraftDateValidation(normalizedDate, draft, normalizedDate);
            const accepted = validation.accepted;
            const logPayload = {
                action: "draft_restore_date_check",
                source,
                keyDate: validation.keyDate,
                payloadDate: validation.payloadDate || null,
                selectedDate: validation.selectedDate,
                accepted,
                rejectedReason: validation.rejectedReason || null,
            };
            if (!accepted) {
                logDraftRestoreDateCheck(logPayload);
                return null;
            }
            logDraftRestoreDateCheck(logPayload);
            return withDraftDateMeta(normalizedDate, draft, {
                source: draft?.meta?.source || source,
                hasUnsavedChanges: draft?.meta?.hasUnsavedChanges ?? true,
                remoteVerifiedAt: draft?.meta?.remoteVerifiedAt ?? null,
            });
        };

        const storedWorkoutDraft = loadStoredWorkoutDraft(normalizedDate, {
            logger: console,
            log: false,
        });
        const acceptedStoredWorkoutDraft = storedWorkoutDraft
            ? normalizeDraftForLoad(storedWorkoutDraft, storedWorkoutDraft?.meta?.source || "workoutDraftStore")
            : null;
        if (acceptedStoredWorkoutDraft && hasDraftPayloadContent(acceptedStoredWorkoutDraft)) {
            return acceptedStoredWorkoutDraft;
        }

        const datedLogData = load(getDraftKey("draft_logData", normalizedDate), null);
        const datedTodayLabels = load(getDraftKey("draft_todayLabels", normalizedDate), []);
        const datedRawSessionEx = load(getDraftKey("draft_sessionEx", normalizedDate), null);
        const datedExerciseUnits = load(getDraftKey("draft_exerciseUnits", normalizedDate), {});
        const datedMeta = load(getDraftKey("draft_meta", normalizedDate), null);
        const datedSessionEx = datedRawSessionEx === null && !Object.keys(datedLogData || {}).length
            ? null
            : mergeDraftExercisesWithLogData(datedRawSessionEx || [], datedLogData || {}, datedTodayLabels);
        const datedDraft = {
            todayLabels: datedTodayLabels,
            logData: datedLogData || {},
            sessionEx: datedSessionEx,
            exerciseUnits: datedExerciseUnits,
            meta: datedMeta,
        };
        const datedDraftHasPayload = datedLogData !== null ||
            datedRawSessionEx !== null ||
            Object.keys(datedExerciseUnits || {}).length > 0 ||
            datedTodayLabels.length > 0 ||
            Boolean(datedMeta);
        const acceptedDatedDraft = datedDraftHasPayload
            ? normalizeDraftForLoad(datedDraft, "date_scoped_draft")
            : null;
        if (acceptedDatedDraft && hasDraftPayloadContent(acceptedDatedDraft)) {
            return acceptedDatedDraft;
        }

        const legacyDraftDate = normalizeDraftDateKey(load("draft_logDate", ""));
        const useLegacyFallback = legacyDraftDate === normalizedDate;
        const legacyMeta = useLegacyFallback
            ? (load("draft_meta", null) || { date: legacyDraftDate, keyDate: legacyDraftDate })
            : null;
        const legacyLogData = useLegacyFallback ? load("draft_logData", {}) : {};
        const legacyTodayLabels = useLegacyFallback ? load("draft_todayLabels", []) : [];
        const legacyRawSessionEx = useLegacyFallback ? load("draft_sessionEx", null) : null;
        const legacyExerciseUnits = useLegacyFallback ? load("draft_exerciseUnits", {}) : {};
        const legacySessionEx = legacyRawSessionEx === null && !Object.keys(legacyLogData || {}).length
            ? null
            : mergeDraftExercisesWithLogData(legacyRawSessionEx || [], legacyLogData || {}, legacyTodayLabels);
        const legacyDraft = {
            todayLabels: legacyTodayLabels,
            logData: legacyLogData || {},
            sessionEx: legacySessionEx,
            exerciseUnits: legacyExerciseUnits,
            meta: legacyMeta,
        };
        const acceptedLegacyDraft = useLegacyFallback
            ? normalizeDraftForLoad(legacyDraft, "legacy_draft")
            : null;

        return acceptedLegacyDraft && hasDraftPayloadContent(acceptedLegacyDraft)
            ? acceptedLegacyDraft
            : emptyDraft;
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
        const normalizedDate = normalizeDraftDateKey(dateStr);
        if (!normalizedDate) return false;
        const validation = getDraftDateValidation(normalizedDate, draft, normalizedDate);
        if (!validation.accepted) {
            console.warn("[save] blocked date-mismatched draft persistence", {
                action: "draft_restore_date_check",
                keyDate: validation.keyDate,
                payloadDate: validation.payloadDate || null,
                selectedDate: validation.selectedDate,
                accepted: false,
                rejectedReason: validation.rejectedReason,
            });
            return false;
        }
        const logData = draft.logData || {};
        const todayLabels = draft.todayLabels || [];
        const sessionEx = draft.sessionEx === null && !Object.keys(logData).length
            ? null
            : mergeDraftExercisesWithLogData(draft.sessionEx || [], logData, todayLabels);
        const meta = makeDraftMeta(draft.meta || {}, {
            date: normalizedDate,
            keyDate: normalizedDate,
            draftDate: normalizedDate,
            workoutDate: normalizedDate,
            exerciseNames: (sessionEx || []).map((exercise) => exercise.name),
            logDataNames: Object.keys(logData),
        });
        const nextStoredDraft = withDraftDateMeta(normalizedDate, {
            ...draft,
            todayLabels,
            logData,
            sessionEx,
            exerciseUnits: draft.exerciseUnits || {},
            meta,
        }, meta);

        saveStoredWorkoutDraft(normalizedDate, nextStoredDraft, {
            logger: console,
            log: shouldLogPerfDebug(),
        });

        save(getDraftKey("draft_todayLabels", normalizedDate), todayLabels);
        save(getDraftKey("draft_logData", normalizedDate), logData);
        save(getDraftKey("draft_sessionEx", normalizedDate), sessionEx);
        save(getDraftKey("draft_exerciseUnits", normalizedDate), draft.exerciseUnits || {});
        save(getDraftKey("draft_meta", normalizedDate), meta);

        save("draft_todayLabels", todayLabels);
        save("draft_logData", logData);
        save("draft_sessionEx", sessionEx);
        save("draft_exerciseUnits", draft.exerciseUnits || {});
        save("draft_meta", meta);
        save("draft_logDate", normalizedDate);
        return true;
    }, [getDraftKey]);

    const clearDraftForDate = useCallback((dateStr) => {
        if (!dateStr) return;
        clearStoredWorkoutDraft(dateStr);

        [
            getDraftKey("draft_todayLabels", dateStr),
            getDraftKey("draft_logData", dateStr),
            getDraftKey("draft_sessionEx", dateStr),
            getDraftKey("draft_exerciseUnits", dateStr),
            getDraftKey("draft_exercises", dateStr),
            getDraftKey("draft_meta", dateStr),
        ].forEach((key) => {
            try {
                localStorage.removeItem(key);
            } catch { }
        });

        if (load("draft_logDate", "") === dateStr) {
            save("draft_todayLabels", []);
            save("draft_logData", {});
            save("draft_sessionEx", null);
            save("draft_exerciseUnits", {});
            save("draft_meta", null);
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
    const processingInviteCodeRef = useRef("");
    const ensuredProfileUserIdsRef = useRef(new Set());
    const ensuringProfileUserIdsRef = useRef(new Set());

    const ensureProfileForUser = useCallback(async (nextUser) => {
        if (!nextUser?.id) return;
        if (ensuredProfileUserIdsRef.current.has(nextUser.id)) return;
        if (ensuringProfileUserIdsRef.current.has(nextUser.id)) return;

        ensuringProfileUserIdsRef.current.add(nextUser.id);

        try {
            const { data: existingProfile, error: profileError } = await supabase
                .from("profiles")
                .select("id")
                .eq("id", nextUser.id)
                .maybeSingle();

            if (profileError) throw profileError;
            if (existingProfile?.id) {
                ensuredProfileUserIdsRef.current.add(nextUser.id);
                return;
            }

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

                if (!error) {
                    ensuredProfileUserIdsRef.current.add(nextUser.id);
                    return;
                }
                if (error.code !== "23505") {
                    throw error;
                }
            }

            throw new Error("プロフィールの初期作成に失敗しました。");
        } finally {
            ensuringProfileUserIdsRef.current.delete(nextUser.id);
        }
    }, []);

    const connectPendingFriendForUser = useCallback(async (nextUser) => {
        if (!nextUser?.id) return;
        const result = await processPendingInviteForUser({
            supabase,
            user: nextUser,
        });

        if (result?.message) {
            console.log("[invite]", result);
            window.alert(result.message);
        }
    }, []);

    useEffect(() => {
        const minTimerId = window.setTimeout(() => setSplashMinElapsed(true), 120);
        const maxTimerId = window.setTimeout(() => setSplashForceDone(true), 500);

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

            if (!nextUser) {
                debugLog("[auth] signed out");
                return;
            }

            debugLog("[auth] signed in", {
                userId: nextUser.id,
                email: nextUser.email,
            });

            setShowAuth(false);

            void (async () => {
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
            })();
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
        const inviteCode = getInviteCodeFromLocation(window.location);
        if (inviteCode) {
            savePendingInviteCode(inviteCode);
            setScreen("ranking");
            if (user?.id) {
                const processingKey = `${user.id}:${inviteCode}`;
                if (processingInviteCodeRef.current === processingKey) return;
                processingInviteCodeRef.current = processingKey;
                processPendingInviteForUser({
                    supabase,
                    user,
                    code: inviteCode,
                })
                    .then((result) => {
                        if (result?.message) {
                            console.log("[invite]", result);
                            window.alert(result.message);
                        }
                    })
                    .catch((error) => {
                        console.error("[invite] immediate processing failed", {
                            error,
                            code: error?.code,
                            message: error?.message,
                            details: error?.details,
                            hint: error?.hint,
                            inviteCode,
                            userId: user.id,
                        });
                        window.alert("友達追加に失敗しました。時間をおいて再試行してください。");
                    })
                    .finally(() => {
                        processingInviteCodeRef.current = "";
                    });
            } else {
                setShowAuth(true);
            }
        }
    }, [user]);


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

    const applyLogDraftState = useCallback((draft) => {
        const normalizedDraft = normalizeLogDraftState(draft);
        const currentDate = normalizeDraftDateKey(logDate);
        const incomingDate = normalizeDraftDateKey(
            normalizedDraft?.meta?.date ||
            normalizedDraft?.meta?.keyDate ||
            normalizedDraft?.meta?.draftDate ||
            normalizedDraft?.meta?.workoutDate ||
            currentDate
        );
        const previousDraft = normalizeLogDraftState(latestLogDraftRef.current || {
            todayLabels,
            logData,
            sessionEx,
            exerciseUnits,
        });
        const previousDraftSignature = getWorkoutDraftSignature(previousDraft);
        const normalizedDraftSignature = getWorkoutDraftSignature(normalizedDraft);
        const pendingChange = currentDate
            ? pendingWorkoutContentChangeDatesRef.current.get(currentDate) || {}
            : {};
        const previousMetrics = getRawDraftSetMetrics(previousDraft);
        const restoredMetrics = getRawDraftSetMetrics(normalizedDraft);
        const lostExerciseNames = getRemovedRawDraftExerciseNames(previousDraft, normalizedDraft);
        const previousDisplayedExerciseNames = previousMetrics.exerciseNames;
        const restoredExerciseNames = restoredMetrics.exerciseNames;
        const incomingSource = normalizedDraft?.meta?.source || "unknown";
        const dateMismatch = Boolean(screen === "log" && currentDate && incomingDate && incomingDate !== currentDate);
        const regressionDetected = (
            lostExerciseNames.length > 0 ||
            restoredMetrics.exerciseCount < previousMetrics.exerciseCount ||
            restoredMetrics.setCount < previousMetrics.setCount
        );
        const protectsCurrentLog = screen === "log" && currentDate && (!incomingDate || incomingDate === currentDate);
        const userMutationSource = new Set([
            "current_log_draft",
            "user_edit",
            "exercise_add",
            "manual_exercise_add",
            "exercise_remove",
            "exercise_delete",
            "exercise_rename",
            "exercise_reorder",
            "set_add",
            "set_input_change",
            "weight_change",
            "reps_change",
            "unit_change",
            "explicit_set_edit",
        ]);
        const explicitDelete = Boolean(pendingChange.explicitDelete);
        const explicitUserEdit = Boolean(userMutationSource.has(incomingSource));
        const previousHasContent = hasDraftContent(previousDraft);
        const shouldBlockRegression = (
            dateMismatch ||
            (
                protectsCurrentLog &&
                previousHasContent &&
                regressionDetected &&
                !explicitDelete &&
                !explicitUserEdit
            )
        );

        if (shouldBlockRegression) {
            console.warn("[restore] workout_restore_integrity_check", {
                env: getRuntimeEnvironmentLabel(),
                action: "workout_restore_integrity_check",
                date: currentDate,
                user_id: user?.id || null,
                previousDisplayedExerciseNames,
                restoredExerciseNames,
                lostExerciseNames,
                previousSetCount: previousMetrics.setCount,
                restoredSetCount: restoredMetrics.setCount,
                appliedSource: null,
                rejectedSource: incomingSource,
                reason: dateMismatch
                    ? "draft date does not match current log date"
                    : "restore would remove current draft exercises or sets",
                dateMismatch,
                incomingDate,
                currentDate,
                explicitDelete,
                explicitUserEdit,
                pendingExplicitEdit: Boolean(pendingChange.explicitEdit),
                overwrittenByRestore: false,
            });
            return previousDraft;
        }

        if (previousDraftSignature === normalizedDraftSignature) {
            latestLogDraftRef.current = normalizedDraft;
            const skipSignature = `${currentDate || incomingDate || "unknown"}:${normalizedDraftSignature}`;
            if (shouldLogPerfDebug() && lastAppliedLogDataHashRef.current !== skipSignature) {
                lastAppliedLogDataHashRef.current = skipSignature;
                console.log("[restore] restore_skip_same_snapshot", {
                    env: getRuntimeEnvironmentLabel(),
                    action: "restore_skip_same_snapshot",
                    selectedDate: currentDate || incomingDate || null,
                    draftHash: normalizedDraftSignature,
                    previousDraftHash: previousDraftSignature,
                    logDataHash: normalizedDraftSignature,
                    previousLogDataHash: previousDraftSignature,
                    skipped: true,
                    reason: "same_snapshot",
                });
            }
            return normalizedDraft;
        }

        if (shouldLogPerfDebug() || regressionDetected) {
            console.log("[restore] workout_restore_integrity_check", {
                env: getRuntimeEnvironmentLabel(),
                action: "workout_restore_integrity_check",
                date: currentDate || incomingDate || null,
                user_id: user?.id || null,
                previousDisplayedExerciseNames,
                restoredExerciseNames,
                lostExerciseNames,
                previousSetCount: previousMetrics.setCount,
                restoredSetCount: restoredMetrics.setCount,
                appliedSource: incomingSource,
                rejectedSource: null,
                reason: regressionDetected
                    ? (explicitDelete ? "explicit delete restore applied" : "user mutation restore applied")
                    : "restore applied",
                dateMismatch: false,
                incomingDate,
                currentDate,
                explicitDelete,
                explicitUserEdit,
                pendingExplicitEdit: Boolean(pendingChange.explicitEdit),
                overwrittenByRestore: regressionDetected,
            });
        }

        latestLogDraftRef.current = normalizedDraft;
        setTodayLabels(normalizedDraft.todayLabels);
        setLogData(normalizedDraft.logData);
        setSessionEx(normalizedDraft.sessionEx);
        setExerciseUnits(normalizedDraft.exerciseUnits);
        return normalizedDraft;
    }, [exerciseUnits, hasDraftContent, logData, logDate, screen, sessionEx, todayLabels, user?.id]);

    const applyCurrentLogDraft = useCallback((draft, { persist = true } = {}) => {
        const datedDraft = withDraftDateMeta(logDate, draft, {
            source: draft?.meta?.source || "current_log_draft",
            hasUnsavedChanges: draft?.meta?.hasUnsavedChanges ?? true,
            remoteVerifiedAt: draft?.meta?.remoteVerifiedAt ?? null,
        });
        const normalizedDraft = applyLogDraftState(datedDraft);
        if (persist) {
            const draftSignature = JSON.stringify({
                date: normalizeDraftDateKey(logDate),
                content: getWorkoutDraftSignature(normalizedDraft),
                metaSource: normalizedDraft.meta?.source || null,
                hasUnsavedChanges: normalizedDraft.meta?.hasUnsavedChanges ?? null,
                remoteVerifiedAt: normalizedDraft.meta?.remoteVerifiedAt || null,
            });
            if (lastAutosavedDraftSignatureRef.current !== draftSignature) {
                lastAutosavedDraftSignatureRef.current = draftSignature;
                saveDraftForDate(logDate, normalizedDraft);
            }
        }
        return normalizedDraft;
    }, [applyLogDraftState, logDate, saveDraftForDate]);

    const setLogDataAndSaveDraft = useCallback((nextOrUpdater) => {
        setLogData((prev) => {
            const beforeDraft = getCurrentLogDraftSnapshot();
            const sourceLogData = beforeDraft.logData || prev || {};
            const next =
                typeof nextOrUpdater === "function"
                    ? nextOrUpdater(sourceLogData)
                    : nextOrUpdater;
            const normalizedDate = String(logDate || "").slice(0, 10);
            if (normalizedDate) {
                const previousChange = pendingWorkoutContentChangeDatesRef.current.get(normalizedDate) || {};
                pendingWorkoutContentChangeDatesRef.current.set(normalizedDate, {
                    ...previousChange,
                    reason: previousChange.explicitEdit || previousChange.explicitDelete
                        ? (previousChange.reason || "set_update")
                        : "set_update",
                    explicitDelete: Boolean(previousChange.explicitDelete),
                    explicitEdit: Boolean(previousChange.explicitEdit),
                    details: previousChange.details || null,
                    updatedAt: new Date().toISOString(),
                });
            }

            const beforeSessionSource = beforeDraft.sessionEx !== null
                ? beforeDraft.sessionEx
                : sessionEx;
            const nextSessionEx = mergeDraftExercisesWithLogData(
                [
                    ...(beforeSessionSource || []),
                    ...(sessionEx || []),
                ],
                next || {},
                beforeDraft.todayLabels?.length ? beforeDraft.todayLabels : todayLabels
            );
            const nextDraft = {
                todayLabels: beforeDraft.todayLabels?.length ? beforeDraft.todayLabels : todayLabels,
                logData: next || {},
                sessionEx: nextSessionEx,
                exerciseUnits: beforeDraft.exerciseUnits || exerciseUnits,
                meta: makeDraftMeta(beforeDraft.meta || {}, {
                    source: "user_edit",
                    hasUnsavedChanges: true,
                }),
            };
            const pendingChangeAfterUpdate = normalizedDate
                ? pendingWorkoutContentChangeDatesRef.current.get(normalizedDate) || {}
                : {};
            const beforeRawMetrics = getRawDraftSetMetrics(beforeDraft);
            const afterRawMetrics = getRawDraftSetMetrics(nextDraft);
            const removedExerciseNames = getRemovedRawDraftExerciseNames(beforeDraft, nextDraft);
            const isSetInputChange = EXPLICIT_SET_EDIT_REASONS.has(pendingChangeAfterUpdate.reason);
            const blockedReason = isSetInputChange && removedExerciseNames.length
                ? "set_input_change would remove exercises"
                : isSetInputChange && afterRawMetrics.setCount < beforeRawMetrics.setCount
                    ? "set_input_change would reduce total set count"
                    : null;

            if (isSetInputChange) {
                const isUnitChange = pendingChangeAfterUpdate.reason === "unit_change";
                console[blockedReason ? "warn" : "log"]("[set mutation]", {
                    action: isUnitChange ? "unit_change" : "set_input_change",
                    date: normalizedDate,
                    user_id: user?.id || null,
                    exerciseName: pendingChangeAfterUpdate.details?.exerciseName || null,
                    setIndex: pendingChangeAfterUpdate.details?.setIndex ?? null,
                    beforeExerciseNames: beforeRawMetrics.exerciseNames,
                    afterExerciseNames: afterRawMetrics.exerciseNames,
                    removedExerciseNames,
                    beforeSetCountTotal: beforeRawMetrics.setCount,
                    afterSetCountTotal: afterRawMetrics.setCount,
                    beforeTargetSet: pendingChangeAfterUpdate.details?.beforeSet || null,
                    afterTargetSet: pendingChangeAfterUpdate.details?.afterSet || null,
                    source: "user_input",
                    dirty: true,
                    explicitEdit: Boolean(pendingChangeAfterUpdate.explicitEdit),
                    allowed: !blockedReason,
                    blockedReason,
                    restoreApplied: false,
                    overwrittenByRestore: false,
                    saveReason: pendingChangeAfterUpdate.reason,
                    latestLogDraftRefUpdated: !blockedReason,
                    logDataUpdated: !blockedReason,
                    sessionExUpdated: !blockedReason,
                    workoutsDataUpdated: false,
                    summaryJsonUpdated: false,
                });
            }

            if (blockedReason) return prev;

            const datedNextDraft = withDraftDateMeta(logDate, nextDraft, {
                source: nextDraft?.meta?.source || "user_input",
                hasUnsavedChanges: nextDraft?.meta?.hasUnsavedChanges ?? true,
            });
            saveDraftForDate(logDate, datedNextDraft);
            latestLogDraftRef.current = datedNextDraft;

            return next;
        });
    }, [exerciseUnits, getCurrentLogDraftSnapshot, logDate, saveDraftForDate, sessionEx, todayLabels, user?.id]);

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

    const handleLogSetInputFocusChange = useCallback((inputId) => {
        if (inputId && typeof document !== "undefined") {
            document.body?.setAttribute("data-log-set-input-active", "true");
        }
        setFocusedLogSetInputId(inputId || null);
    }, []);

    const requestLogExerciseFocus = useCallback((exercise) => {
        if (!exercise?.id && !exercise?.name) return;
        setLogExerciseFocusRequest({
            id: exercise.id,
            name: exercise.name,
            nonce: Date.now() + Math.random(),
        });
    }, []);

    const handleLogExerciseActiveChange = useCallback((exercise) => {
        if (!exercise?.id && !exercise?.name) return;
        setLastActiveLogExerciseByDate((prev) => ({
            ...(prev || {}),
            [logDate]: {
                id: exercise.id,
                name: exercise.name,
                updatedAt: Date.now(),
            },
        }));
    }, [logDate]);

    const markLogSetInputActive = useCallback((setInput, shouldScroll = true) => {
        if (!(setInput instanceof HTMLElement)) return;
        document.body?.setAttribute("data-log-set-input-active", "true");
        setFocusedLogSetInputId(setInput.getAttribute("data-log-set-input-id") || "__log_set_input__");
        if (!shouldScroll) return;
        window.setTimeout(() => {
            setInput.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "smooth" });
        }, 120);
    }, []);

    const clearLogSetInputActiveIfClosed = useCallback(() => {
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement && activeElement.closest("[data-log-set-input='true']")) {
            markLogSetInputActive(activeElement);
            return;
        }
        const viewport = window.visualViewport;
        const keyboardInset = viewport
            ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
            : 0;
        if (keyboardInset > 80) {
            document.body?.setAttribute("data-log-set-input-active", "true");
            setIsLogKeyboardOpen(true);
            return;
        }
        document.body?.removeAttribute("data-log-set-input-active");
        setFocusedLogSetInputId(null);
        setIsLogKeyboardOpen(false);
    }, [markLogSetInputActive]);

    const handleLogScreenFocusCapture = useCallback((event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const setInput = target.closest("[data-log-set-input='true']");
        if (!setInput) return;
        markLogSetInputActive(setInput);
    }, [markLogSetInputActive]);

    const handleLogScreenInputPointerDownCapture = useCallback((event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const setInput = target.closest("[data-log-set-input='true']");
        if (!setInput) return;
        markLogSetInputActive(setInput);
    }, [markLogSetInputActive]);

    const handleLogScreenBlurCapture = useCallback(() => {
        window.setTimeout(clearLogSetInputActiveIfClosed, 360);
    }, [clearLogSetInputActiveIfClosed]);

    const handleAiInputFocusChange = useCallback((isFocused) => {
        setFocusedAiChatInput(Boolean(isFocused));
    }, []);

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

    useEffect(() => {
        const incomingStateHistory = workoutsDataHistory || {};
        const trustedRefHistory = workoutsDataHistoryRef.current || {};
        if (serializeHistoryMap(incomingStateHistory) === serializeHistoryMap(trustedRefHistory)) return;

        const decision = getHomeWeeklyStaleRegressionDecision(
            trustedRefHistory,
            incomingStateHistory,
            getCurrentWeekRangeForHomeSummary()
        );
        if (decision.blocked) {
            console.warn("[home weekly summary] stale state commit blocked", {
                action: "home_weekly_stale_overwrite_blocked",
                source: "workoutsDataHistory state commit",
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                applied: false,
                staleBodyPartCounts: decision.incomingSummary.bodyPartCounts,
                trustedBodyPartCounts: decision.trustedSummary.bodyPartCounts,
                staleShoulderCount: decision.incomingSummary.bodyPartCounts["肩"] || 0,
                staleTricepsCount: decision.incomingSummary.bodyPartCounts["三頭"] || 0,
                staleBicepsCount: decision.incomingSummary.bodyPartCounts["二頭"] || 0,
                trustedShoulderCount: decision.trustedSummary.bodyPartCounts["肩"] || 0,
                trustedTricepsCount: decision.trustedSummary.bodyPartCounts["三頭"] || 0,
                trustedBicepsCount: decision.trustedSummary.bodyPartCounts["二頭"] || 0,
                regressedBodyParts: decision.regressedBodyParts,
                reason: "older workoutsDataHistory state attempted to replace richer ref",
                timestamp: new Date().toISOString(),
            });
            setWorkoutsDataHistory(trustedRefHistory);
            return;
        }

        workoutsDataHistoryRef.current = incomingStateHistory;
    }, [user?.id, workoutsDataHistory]);

    const applyWorkoutsDataHistorySnapshot = useCallback((nextHistory, {
        allowRegression = false,
        source = "workouts.data",
        reason = "unknown",
        requestId = null,
        weekRange = getCurrentWeekRangeForHomeSummary(),
        workoutsHistory = null,
        summaryHistory = {},
    } = {}) => {
        const incomingHistory = nextHistory || {};
        const trustedHistory = workoutsDataHistoryRef.current || {};
        const decision = getHomeWeeklyStaleRegressionDecision(
            trustedHistory,
            incomingHistory,
            weekRange
        );

        if (!allowRegression && decision.blocked) {
            console.warn("[home weekly summary] stale overwrite blocked", {
                action: "home_weekly_stale_overwrite_blocked",
                source,
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                requestId,
                applied: false,
                reason,
                staleSource: source,
                staleBodyPartCounts: decision.incomingSummary.bodyPartCounts,
                staleShoulderCount: decision.incomingSummary.bodyPartCounts["肩"] || 0,
                staleTricepsCount: decision.incomingSummary.bodyPartCounts["三頭"] || 0,
                staleBicepsCount: decision.incomingSummary.bodyPartCounts["二頭"] || 0,
                trustedBodyPartCounts: decision.trustedSummary.bodyPartCounts,
                trustedShoulderCount: decision.trustedSummary.bodyPartCounts["肩"] || 0,
                trustedTricepsCount: decision.trustedSummary.bodyPartCounts["三頭"] || 0,
                trustedBicepsCount: decision.trustedSummary.bodyPartCounts["二頭"] || 0,
                regressedBodyParts: decision.regressedBodyParts,
                timestamp: new Date().toISOString(),
                ...getHomeWeeklySourceDebug({
                    workoutsHistory: workoutsHistory || incomingHistory,
                    summaryHistory,
                    finalHistory: incomingHistory,
                    weekRange,
                    source,
                    appliedSource: "none",
                    ignoredStaleSource: `${source}: ${reason}`,
                }),
            });
            return false;
        }

        const previousSummary = getHomeWeeklySummaryDebug(trustedHistory, weekRange);
        const nextSummary = getHomeWeeklySummaryDebug(incomingHistory, weekRange);
        const previousSignature = JSON.stringify(previousSummary.bodyPartCounts || {});
        const nextSignature = JSON.stringify(nextSummary.bodyPartCounts || {});

        const changedFromTrusted = serializeHistoryMap(incomingHistory) !== serializeHistoryMap(trustedHistory);
        workoutsDataHistoryRef.current = incomingHistory;
        if (changedFromTrusted) {
            setWorkoutsDataHistory(incomingHistory);
        }

        if (shouldLogPerfDebug() && previousSignature !== nextSignature) {
            console.log("[home weekly summary] render value source changed", {
                action: "home_weekly_render_value_changed",
                source,
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                requestId,
                applied: true,
                reason,
                previousBodyPartCounts: previousSummary.bodyPartCounts,
                nextBodyPartCounts: nextSummary.bodyPartCounts,
                previousSource: "workoutsDataHistoryRef",
                nextSource: source,
                appliedSource: source,
                rejectedSource: null,
                timestamp: new Date().toISOString(),
                shoulderCount: nextSummary.bodyPartCounts["肩"] || 0,
                tricepsCount: nextSummary.bodyPartCounts["三頭"] || 0,
                bicepsCount: nextSummary.bodyPartCounts["二頭"] || 0,
            });
        }

        return true;
    }, [user?.id]);

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
    }, [resetWorkoutElapsedTimer, setSavedWorkoutDurationSecByDate, syncFailuresByDateRef]);

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

    const fetchRemoteWorkoutRowsForDates = useCallback(async (userId, dates = []) => {
        const normalizedDates = [...new Set(
            (dates || [])
                .map((date) => String(date || "").slice(0, 10))
                .filter(Boolean)
        )];

        if (!userId || !normalizedDates.length) return [];

        const { rows, error } = await fetchWorkoutRowsForDatesFromRepository({
            userId,
            dates: normalizedDates,
        });

        if (error) throw error;
        applyTrustedWorkoutRowsSnapshot(rows || [], {
            source: "fetchRemoteWorkoutRowsForDates",
        });
        return rows || [];
    }, [applyTrustedWorkoutRowsSnapshot]);

    const hasRemoteWorkoutForDate = useCallback(async (userId, workoutDate) => {
        const normalizedDate = String(workoutDate || "").slice(0, 10);
        if (!userId || !normalizedDate) return false;

        const rows = await fetchRemoteWorkoutRowsForDates(userId, [normalizedDate]);
        return rows.some((row) => String(row?.date || "").slice(0, 10) === normalizedDate);
    }, [fetchRemoteWorkoutRowsForDates]);

    const buildLatestLocalHistoryForRetryDate = useCallback((baseHistory, date) => {
        const normalizedDate = String(date || "").slice(0, 10);
        if (!normalizedDate) return mergeHistoryMaps(baseHistory || {});

        const draftForDate = loadDraftForDate(normalizedDate);
        if (!hasDraftContent(draftForDate)) {
            return mergeHistoryMaps(baseHistory || {});
        }

        const draftHistory = buildDraftHistoryForDate({
            baseHistory: baseHistory || {},
            workoutDate: normalizedDate,
            exercises: draftForDate.sessionEx || [],
            logData: draftForDate.logData || {},
            getExUnit: (name) => draftForDate.exerciseUnits?.[name] || getExUnit(name),
            labels: draftForDate.todayLabels || [],
            durationSec: Math.floor(Number(savedWorkoutDurationSecByDate[normalizedDate]) || 0),
            replaceDate: false,
        });

        return applyPreferredHistoryDates(baseHistory || {}, draftHistory, [normalizedDate]);
    }, [getExUnit, hasDraftContent, loadDraftForDate, savedWorkoutDurationSecByDate]);

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
    }, [getSyncFailureSignature, syncFailuresByDateRef]);


    const deleteRemoteWorkoutArtifactsForDate = useCallback(async (userId, workoutDate, nextHistoryMap = null) => {
        const normalizedDate = String(workoutDate || "").slice(0, 10);
        if (!userId || !normalizedDate) return;

        const { data: sessionRows, error: sessionFetchError } = await supabase
            .from("workout_sessions")
            .select("id")
            .eq("user_id", userId)
            .eq("workout_date", normalizedDate);

        if (sessionFetchError) throw sessionFetchError;

        const sessionIds = (sessionRows || []).map((session) => session.id).filter(Boolean);

        if (sessionIds.length > 0) {
            const [deleteLikesResult, deleteCommentsResult] = await Promise.all([
                supabase
                    .from("workout_session_likes")
                    .delete()
                    .in("session_id", sessionIds),
                supabase
                    .from("workout_session_comments")
                    .delete()
                    .in("session_id", sessionIds),
            ]);

            if (deleteLikesResult.error) {
                console.warn("workout session likes delete failed", deleteLikesResult.error);
            }
            if (deleteCommentsResult.error) {
                console.warn("workout session comments delete failed", deleteCommentsResult.error);
            }

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

    // refreshHistorySyncDiagnostic is provided by useWorkoutSummary (called above)



    const retryFailedSync = useCallback(async () => {
        if (!user?.id || syncRetrying) return;

        const failedDates = Object.keys(syncFailuresByDateRef.current);
        if (!failedDates.length) return;

        setSyncRetrying(true);
        try {
            let currentHistory = mergeHistoryMaps(latestHistoryRef.current || history || {});
            for (const date of failedDates) {
                const retryHistory = buildLatestLocalHistoryForRetryDate(currentHistory, date);
                const hasWorkoutForDate = hasValidWorkoutOnDate(retryHistory, date);
                const previousFailure = syncFailuresByDateRef.current[date] || {};
                const isDeleteRetry = String(previousFailure.stage || "").startsWith("delete_");
                try {
                    if (hasWorkoutForDate) {
                        const remoteRows = await fetchRemoteWorkoutRowsForDates(user.id, [date]);
                        const remoteRow = remoteRows.find((row) => String(row?.date || "").slice(0, 10) === date);
                        const localMetrics = getHistoryMetricsForDate(retryHistory, date);
                        const remoteMetrics = remoteRow
                            ? getHistoryMetricsForDate(remoteRow.data || {}, date)
                            : getEmptyWorkoutMetrics();
                        const pendingChange = pendingWorkoutContentChangeDatesRef.current.get(date) || {};
                        const explicitEdit = isExplicitWorkoutEditChange(pendingChange);
                        const saveGuardDecision = getWorkoutSaveGuardDecision({
                            incomingMetrics: localMetrics,
                            remoteMetrics,
                            reason: pendingChange.reason,
                            explicitEdit,
                            explicitDelete: Boolean(pendingChange.explicitDelete),
                        });
                        const wouldDestructivelyOverwrite = saveGuardDecision.blocked;
                        const retryAllowed = !wouldDestructivelyOverwrite || Boolean(pendingChange.explicitDelete);

                        console.log("[sync retry] preflight", {
                            env: getRuntimeEnvironmentLabel(),
                            user_id: user.id,
                            unsyncedDate: date,
                            queueCreatedAt: previousFailure.createdAt || null,
                            queueUpdatedAt: previousFailure.updatedAt || null,
                            localExerciseCount: localMetrics.exerciseCount,
                            localSetCount: localMetrics.setCount,
                            remoteExerciseCount: remoteMetrics.exerciseCount,
                            remoteSetCount: remoteMetrics.setCount,
                            localVolume: localMetrics.volume,
                            remoteVolume: remoteMetrics.volume,
                            retryAllowed,
                            removedExerciseNames: saveGuardDecision.details.removedExerciseNames,
                            reason: pendingChange.reason || null,
                            explicitEdit,
                            explicitDelete: Boolean(pendingChange.explicitDelete),
                            blockedReason: retryAllowed ? null : saveGuardDecision.blockedReason,
                            allowedReason: retryAllowed ? saveGuardDecision.allowedReason : null,
                        });

                        if (!retryAllowed) {
                            throw new Error("[sync retry] blocked destructive overwrite");
                        }

                        const rowSyncResults = await syncWorkoutRowsForDates(
                            user.id,
                            retryHistory,
                            [date],
                            savedWorkoutDurationSecByDate
                        );
                        if (rowSyncResults.failedDates.includes(date)) {
                            const remoteAlreadyHasWorkout = await hasRemoteWorkoutForDate(user.id, date);
                            if (!remoteAlreadyHasWorkout) {
                                throw new Error(`workouts sync failed for ${date}`);
                            }
                        }
                        try {
                            await syncWorkoutSessionSnapshot(user.id, retryHistory, date);
                        } catch (sessionError) {
                            const remoteAlreadyHasWorkout = await hasRemoteWorkoutForDate(user.id, date);
                            console.error("[sync] workout session retry failed after workout row sync", {
                                date,
                                userId: user.id,
                                records: describeHistoryRecordsForDate(retryHistory, date),
                                error: sessionError,
                                message: sessionError?.message,
                                code: sessionError?.code,
                                details: sessionError?.details,
                                hint: sessionError?.hint,
                            });
                            if (!remoteAlreadyHasWorkout) throw sessionError;
                        }
                        currentHistory = applyPreferredHistoryDates(currentHistory, retryHistory, [date]);
                        latestHistoryRef.current = currentHistory;
                        setHistory(currentHistory);
                        const retryWorkoutsDataHistory = applyPreferredHistoryDates(
                            workoutsDataHistoryRef.current || {},
                            retryHistory,
                            [date]
                        );
                        applyWorkoutsDataHistorySnapshot(retryWorkoutsDataHistory, {
                            allowRegression: true,
                            source: "workouts.data",
                            reason: "manual sync retry",
                            requestId: "sync-retry",
                            workoutsHistory: retryHistory,
                        });
                        persistHistoryForUser(user.id, currentHistory);
                        const retryVerifiedAt = new Date().toISOString();
                        const savedDraft = withDraftMeta(buildWorkoutDraftForDateFromHistory(date, currentHistory), {
                            source: "save_verified",
                            remoteVerifiedAt: retryVerifiedAt,
                            hasUnsavedChanges: false,
                        });
                        if (savedDraft.hasSavedWorkout) saveDraftForDate(date, savedDraft);
                        explicitWorkoutEditDatesRef.current.delete(date);
                        pendingWorkoutContentChangeDatesRef.current.delete(date);
                    } else if (!isDeleteRetry) {
                        const remoteAlreadyHasWorkout = await hasRemoteWorkoutForDate(user.id, date);
                        if (!remoteAlreadyHasWorkout) {
                            console.error("[sync] retry skipped stale failure without local or remote workout", {
                                date,
                                userId: user.id,
                                previousFailure,
                            });
                        }
                    } else {
                        await deleteRemoteWorkoutArtifactsForDate(user.id, date, retryHistory);
                    }
                    pendingWorkoutSessionSyncDatesRef.current.delete(date);
                    clearSyncFailure(date);
                } catch (error) {
                    if (!syncFailuresByDateRef.current[date]) {
                        recordSyncFailure(
                            date,
                            error,
                            hasWorkoutForDate
                                ? "workout_sessions_retry"
                                : isDeleteRetry
                                    ? "delete_workout_artifacts_retry"
                                    : "stale_sync_failure_retry"
                        );
                    }
                    console.error("[sync] retry failed for workout date", {
                        date,
                        userId: user.id,
                        hasWorkoutForDate,
                        isDeleteRetry,
                        previousFailure,
                        records: describeHistoryRecordsForDate(retryHistory, date),
                        error,
                        message: error?.message,
                        code: error?.code,
                        details: error?.details,
                        hint: error?.hint,
                    });
                }
            }

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
        applyWorkoutsDataHistorySnapshot,
        buildLatestLocalHistoryForRetryDate,
        clearSyncFailure,
        deleteRemoteWorkoutArtifactsForDate,
        fetchRemoteWorkoutRowsForDates,
        hasRemoteWorkoutForDate,
        history,
        pendingWorkoutSessionSyncDatesRef,
        recordSyncFailure,
        refreshHistorySyncDiagnostic,
        saveDraftForDate,
        savedWorkoutDurationSecByDate,
        syncFailuresByDateRef,
        syncRetrying,
        syncWorkoutRowsForDates,
        syncWorkoutSessionSnapshot,
        user?.id,
    ]);

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
        if (!user || !historySyncReady) return;
        const currentUserId = user.id;
        const pendingWorkoutNotification = pendingWorkoutNotificationRef.current;
        const pendingContentDates = Array.from(pendingWorkoutContentChangeDatesRef.current.keys());
        if (historyRemoteLoadFailedRef.current) {
            console.warn("[save guard] skipped save because Supabase record load failed", {
                env: getRuntimeEnvironmentLabel(),
                user_id: currentUserId,
                dates: pendingContentDates,
                source: "localStorage / fallback after fetch error",
                allowed: false,
                blockedReason: "remote history load failed",
            });
            return;
        }
        if (!pendingContentDates.length) {
            if (pendingWorkoutSessionSyncDatesRef.current.size) {
                console.warn("[save guard] skipped pending session sync without user edit", {
                    env: getRuntimeEnvironmentLabel(),
                    user_id: currentUserId,
                    dates: Array.from(pendingWorkoutSessionSyncDatesRef.current),
                    source: "queue retry / timer restore / screen open",
                    allowed: false,
                    blockedReason: "no explicit workout content edit",
                });
                pendingWorkoutSessionSyncDatesRef.current = new Set();
            }
            return;
        }

        historySaveQueueRef.current = historySaveQueueRef.current
            .catch(() => { })
            .then(async () => {
                if (latestUserIdRef.current !== currentUserId) return;
                const saveStartedAt = new Date().toISOString();
                const saveRevision = historyRevisionRef.current;
                const baseLocalHistory = mergeHistoryMaps(latestHistoryRef.current);
                const effectiveDeleteMarkers = getCurrentHistoryDeleteMarkers();
                const localHistorySnapshot = applyHistoryDeleteMarkers(
                    baseLocalHistory,
                    effectiveDeleteMarkers
                );

                const sessionRangeStart = getDateDaysAgoKey(REMOTE_HISTORY_SESSION_LOOKBACK_DAYS);
                const [workoutsRes, sessionsRes] = await Promise.all([
                    fetchWorkoutRowsFromRepository({
                        userId: currentUserId,
                        fromDate: sessionRangeStart,
                        limit: REMOTE_HISTORY_SESSION_LIMIT,
                    }),
                    supabase
                        .from("workout_sessions")
                        .select("workout_date, duration_sec, summary_json")
                        .eq("user_id", currentUserId)
                        .gte("workout_date", sessionRangeStart)
                        .order("workout_date", { ascending: true })
                        .limit(REMOTE_HISTORY_SESSION_LIMIT),
                ]);

                if (workoutsRes.error) {
                    logRecordFetchError("history_save_reconcile", "workouts", workoutsRes.error, {
                        userId: currentUserId,
                        dateRange: { from: sessionRangeStart, limit: REMOTE_HISTORY_SESSION_LIMIT },
                        query: "workoutRepository.fetchWorkoutRows",
                        responseData: workoutsRes.rows,
                    });
                    throw workoutsRes.error;
                }
                if (sessionsRes.error) {
                    logRecordFetchError("history_save_reconcile", "workout_sessions", sessionsRes.error, {
                        userId: currentUserId,
                        dateRange: { from: sessionRangeStart, limit: REMOTE_HISTORY_SESSION_LIMIT },
                        query: "workout_sessions.select(workout_date,duration_sec,summary_json).eq(user_id).gte(workout_date).order(workout_date asc).limit",
                        responseData: sessionsRes.data,
                    });
                    console.warn("[save] workout_sessions reconcile failed; continuing with workouts.data as canonical", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: currentUserId,
                        code: sessionsRes.error?.code,
                        message: sessionsRes.error?.message,
                        details: sessionsRes.error?.details,
                        hint: sessionsRes.error?.hint,
                        responseData: sessionsRes.data,
                    });
                }
                if (latestUserIdRef.current !== currentUserId) return;

                const workoutRows = workoutsRes.rows || [];
                const remoteHistory = applyHistoryDeleteMarkers(
                    buildRemoteHistoryWithWorkoutRowsPriority(
                        workoutRows,
                        sessionsRes.error ? [] : (sessionsRes.data || [])
                    ),
                    effectiveDeleteMarkers
                );
                const syncDates = [...new Set(pendingContentDates)];
                let mergedHistory = applyHistoryDeleteMarkers(
                    applyLocalHistoryDates(remoteHistory, localHistorySnapshot, syncDates),
                    effectiveDeleteMarkers
                );

                console.log("[save] Supabase reconcile before write", {
                    env: getRuntimeEnvironmentLabel(),
                    user_id: currentUserId,
                    dates: syncDates,
                    supabaseDates: getValidWorkoutDatesFromHistory(remoteHistory),
                    localStorageDates: getValidWorkoutDatesFromHistory(localHistorySnapshot),
                    savingExerciseNames: syncDates.reduce((acc, date) => ({
                        ...acc,
                        [date]: getHistoryMetricsForDate(mergedHistory, date).exerciseNames,
                    }), {}),
                    reason: "pending content change only",
                });

                const workoutSyncResults = await syncWorkoutRowsForDates(currentUserId, mergedHistory, syncDates);
                if (workoutSyncResults.failedDates.length > 0) {
                    throw new Error(`workouts sync failed for ${workoutSyncResults.failedDates.join(", ")}`);
                }
                if (workoutSyncResults.skippedDates.length > 0) {
                    mergedHistory = applyHistoryDeleteMarkers(
                        applyLocalHistoryDates(mergedHistory, remoteHistory, workoutSyncResults.skippedDates),
                        effectiveDeleteMarkers
                    );
                }

                if (latestUserIdRef.current !== currentUserId) return;
                if (historyRevisionRef.current !== saveRevision) return;

                persistHistoryForUser(currentUserId, mergedHistory);
                setHistory((prev) => {
                    const reconciledHistory = applyHistoryDeleteMarkers(
                        applyLocalHistoryDates(prev, mergedHistory, syncDates),
                        effectiveDeleteMarkers
                    );
                    if (serializeHistoryMap(reconciledHistory) === serializeHistoryMap(prev)) return prev;
                    latestHistoryRef.current = reconciledHistory;
                    return reconciledHistory;
                });
                const nextWorkoutsDataHistory = applyHistoryDeleteMarkers(
                    applyLocalHistoryDates(
                        workoutsDataHistoryRef.current || latestHistoryRef.current || {},
                        mergedHistory,
                        syncDates
                    ),
                    effectiveDeleteMarkers
                );
                applyWorkoutsDataHistorySnapshot(nextWorkoutsDataHistory, {
                    allowRegression: true,
                    source: "workouts.data",
                    reason: "workouts.data save sync",
                    requestId: "save-sync",
                    workoutsHistory: mergedHistory,
                });
                if (shouldLogPerfDebug()) {
                    console.log("[home weekly summary] apply", {
                        source: "workouts.data",
                        env: getRuntimeEnvironmentLabel(),
                        user_id: currentUserId,
                        requestId: "save-sync",
                        applied: true,
                        reason: "workouts.data save sync",
                        ...getHomeWeeklySummaryDebug(nextWorkoutsDataHistory),
                    });
                }

                const sessionSyncDates = syncDates.filter(
                    (date) => !workoutSyncResults.skippedDates.includes(date)
                );
                const failedSessionSyncDates = new Set();
                const skippedSessionSyncDates = new Set();

                if (sessionSyncDates.length > 0) {
                    await Promise.all(
                        sessionSyncDates.map(async (date) => {
                            try {
                                const hasValidWorkoutForDate = hasValidWorkoutOnDate(mergedHistory, date);
                                const shouldPersistWorkoutTiming =
                                    hasValidWorkoutForDate &&
                                    workoutStartedAt &&
                                    workoutStartedForDate === date;
                                const timing = shouldPersistWorkoutTiming
                                    ? getWorkoutTimerPersistence(workoutTimerStateRef.current)
                                    : null;
                                const sessionResult = await syncWorkoutSessionSnapshot(currentUserId, mergedHistory, date, timing);
                                if (sessionResult?.skipped) {
                                    skippedSessionSyncDates.add(date);
                                    pendingWorkoutSessionSyncDatesRef.current.add(date);
                                    return;
                                }
                                clearSyncFailure(date);
                            } catch (error) {
                                console.error("workout session sync failed", {
                                    error,
                                    userId: currentUserId,
                                    date,
                                    records: describeHistoryRecordsForDate(mergedHistory, date),
                                });
                                recordSyncFailure(date, error, "workout_sessions");
                                failedSessionSyncDates.add(date);
                                pendingWorkoutSessionSyncDatesRef.current.add(date);
                            }
                        })
                    );
                }

                syncDates.forEach((date) => {
                    if (workoutSyncResults.skippedDates.includes(date)) {
                        return;
                    }
                    const pendingAfterSave = pendingWorkoutContentChangeDatesRef.current.get(date);
                    if (!pendingAfterSave?.updatedAt || getTimestampMs(pendingAfterSave.updatedAt) <= getTimestampMs(saveStartedAt)) {
                        pendingWorkoutContentChangeDatesRef.current.delete(date);
                    }
                    if (!failedSessionSyncDates.has(date) && !skippedSessionSyncDates.has(date)) {
                        pendingWorkoutSessionSyncDatesRef.current.delete(date);
                    }
                });

                const savedDates = syncDates.filter((date) => (
                    !workoutSyncResults.skippedDates.includes(date)
                ));
                savedDates.forEach((date) => {
                    const sessionSynced = !failedSessionSyncDates.has(date) && !skippedSessionSyncDates.has(date);
                    const remoteVerifiedAt = new Date().toISOString();
                    const verifiedHistoryForDate = workoutSyncResults.verifiedHistoryByDate?.[date] || applyPreferredHistoryDates({}, mergedHistory, [date]);
                    const verifiedHistorySnapshot = applyLocalHistoryDates(mergedHistory, verifiedHistoryForDate, [date]);
                    const savedDraft = makeStoredVerifiedWorkoutDraft(
                        date,
                        buildWorkoutDraftForDateFromHistory(date, verifiedHistoryForDate),
                        { remoteVerifiedAt }
                    );
                    if (!savedDraft.hasSavedWorkout) return;
                    const localDraftForDate = date === logDate
                        ? latestLogDraftRef.current
                        : loadDraftForDate(date);
                    const pendingAfterSave = pendingWorkoutContentChangeDatesRef.current.get(date);
                    const hasNewerUnsavedEdit = Boolean(
                        pendingAfterSave?.updatedAt &&
                        getTimestampMs(pendingAfterSave.updatedAt) > getTimestampMs(saveStartedAt)
                    );
                    const {
                        preserve: preserveDirtyDraft,
                        localRawMetrics,
                        incomingRawMetrics: savedRawMetrics,
                        removedExerciseNames,
                    } = shouldPreserveRawDraftOverIncoming(localDraftForDate, savedDraft);

                    if (hasNewerUnsavedEdit) {
                        console.warn("[restore] preserve dirty draft after save verification", {
                            env: getRuntimeEnvironmentLabel(),
                            user_id: currentUserId,
                            date,
                            action: "workout_autosave",
                            source: "autosave",
                            dirty: true,
                            savedRawMetrics,
                            localRawMetrics,
                            removedExerciseNames,
                            overwrittenByRestore: false,
                            blockedReason: preserveDirtyDraft
                                ? "verified history would drop local draft sets"
                                : "newer unsaved edit happened after this save started",
                        });
                        saveDraftForDate(date, localDraftForDate);
                        return;
                    }

                    saveDraftForDate(date, savedDraft);
                    if (date === logDate) {
                        applyLogDraftState(savedDraft);
                    }
                    latestHistoryRef.current = verifiedHistorySnapshot;
                    setHistory(verifiedHistorySnapshot);
                    persistHistoryForUser(currentUserId, verifiedHistorySnapshot);
                    const verifiedWorkoutsDataHistory = applyLocalHistoryDates(
                        workoutsDataHistoryRef.current || {},
                        verifiedHistoryForDate,
                        [date]
                    );
                    applyWorkoutsDataHistorySnapshot(verifiedWorkoutsDataHistory, {
                        allowRegression: true,
                        source: "workouts.data",
                        reason: "remote save verified",
                        requestId: "save-verified",
                        workoutsHistory: verifiedHistoryForDate,
                    });
                    explicitWorkoutEditDatesRef.current.delete(date);
                    pendingWorkoutContentChangeDatesRef.current.delete(date);
                    if (sessionSynced) {
                        pendingWorkoutSessionSyncDatesRef.current.delete(date);
                        clearSyncFailure(date);
                    }
                    console.log("[save] draft refreshed from verified history", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: currentUserId,
                        date,
                        exerciseNames: savedDraft.sessionEx.map((exercise) => exercise.name),
                        logDataNames: Object.keys(savedDraft.logData || {}),
                        reason: "remote save verified",
                    });
                    console.log("[save] save_success_update_local_draft", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: currentUserId,
                        action: "save_success_update_local_draft",
                        date,
                        savedExerciseNames: savedDraft.sessionEx.map((exercise) => exercise.name),
                        savedSetCount: getRawDraftSetMetrics(savedDraft).setCount,
                        saveDraftForDateUpdated: true,
                        latestLogDraftRefUpdated: date === logDate,
                        logDataSessionExUpdated: date === logDate,
                        historyWorkoutsDataHistoryUpdated: true,
                        explicitWorkoutEditDatesRefCleared: !explicitWorkoutEditDatesRef.current.has(date),
                        pendingSyncCleared: !pendingWorkoutContentChangeDatesRef.current.has(date) && !pendingWorkoutSessionSyncDatesRef.current.has(date),
                        sessionSynced,
                        remoteVerifiedAt,
                        hasUnsavedChanges: false,
                    });
                });

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
        getCurrentHistoryDeleteMarkers,
        historyRevisionRef,
        historySaveQueueRef,
        pendingWorkoutSessionSyncDatesRef,
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
        historyRemoteLoadFailedRef,
        workoutFinishedAt,
        workoutIsFinished,
        workoutLastActivityAt,
        workoutStartedAt,
        workoutStartedForDate,
        applyLocalHistoryDates,
        applyLogDraftState,
        loadDraftForDate,
        saveDraftForDate,
        workoutTimerStateRef,
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

    const handleWorkoutLogDraftChange = useCallback((nextDraft, mutation = {}) => {
        const normalizedDate = normalizeDraftDateKey(nextDraft?.date || logDate);
        const currentDate = normalizeDraftDateKey(logDate);
        if (!normalizedDate || normalizedDate !== currentDate) {
            console.warn("[workout log] skipped date-mismatched draft sync", {
                action: "draft_restore_date_check",
                keyDate: currentDate,
                payloadDate: normalizedDate,
                selectedDate: currentDate,
                accepted: false,
                rejectedReason: "useWorkoutLog draft date does not match current log date",
            });
            return;
        }

        const source = `useWorkoutLog:${mutation.reason || nextDraft?.meta?.source || "draft_change"}`;
        const normalizedDraft = withDraftDateMeta(normalizedDate, normalizeLogDraftState({
            todayLabels: nextDraft?.todayLabels?.length ? nextDraft.todayLabels : todayLabels,
            logData: nextDraft?.logData || {},
            sessionEx: nextDraft?.sessionEx ?? nextDraft?.exercises ?? [],
            exerciseUnits: nextDraft?.exerciseUnits || {},
            meta: makeDraftMeta(nextDraft?.meta || {}, {
                source,
                hasUnsavedChanges: true,
            }),
        }), {
            source,
            hasUnsavedChanges: true,
        });

        latestLogDraftRef.current = normalizedDraft;
        setTodayLabels((prev) =>
            JSON.stringify(prev || []) === JSON.stringify(normalizedDraft.todayLabels || [])
                ? prev
                : normalizedDraft.todayLabels
        );
        setLogData((prev) =>
            JSON.stringify(prev || {}) === JSON.stringify(normalizedDraft.logData || {})
                ? prev
                : normalizedDraft.logData
        );
        setSessionEx((prev) =>
            JSON.stringify(prev) === JSON.stringify(normalizedDraft.sessionEx)
                ? prev
                : normalizedDraft.sessionEx
        );
        setExerciseUnits((prev) =>
            JSON.stringify(prev || {}) === JSON.stringify(normalizedDraft.exerciseUnits || {})
                ? prev
                : normalizedDraft.exerciseUnits
        );

        if (mutation.reason) {
            markWorkoutContentChanged(normalizedDate, mutation.reason, {
                explicitDelete: Boolean(mutation.explicitDelete),
                explicitEdit: Boolean(mutation.explicitEdit),
                details: mutation.details || null,
            });
        }

        const explicitEdit = isExplicitWorkoutEditChange({
            reason: mutation.reason,
            explicitEdit: mutation.explicitEdit,
        });
        const isPastDateEdit = normalizedDate !== getTodayKey();
        if (explicitEdit && isPastDateEdit) {
            const draftSavedToLocalStorage = saveDraftForDate(normalizedDate, normalizedDraft);
            if (draftSavedToLocalStorage) {
                lastAutosavedDraftSignatureRef.current = JSON.stringify({
                    date: normalizedDate,
                    content: getWorkoutDraftSignature(normalizedDraft),
                    metaSource: normalizedDraft.meta?.source || null,
                    hasUnsavedChanges: normalizedDraft.meta?.hasUnsavedChanges ?? null,
                    updatedAt: normalizedDraft.meta?.updatedAt || null,
                    remoteVerifiedAt: normalizedDraft.meta?.remoteVerifiedAt || null,
                });
            }
            if (shouldLogPerfDebug()) {
                console.log("[workout edit] past edit persistence debug", {
                    action: "past_edit_persistence_debug",
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user?.id || null,
                    selectedDate: normalizedDate,
                    field: mutation.details?.field || null,
                    beforeValue: mutation.details?.beforeValue ?? null,
                    afterValue: mutation.details?.afterValue ?? null,
                    localStateUpdated: true,
                    draftSavedToLocalStorage,
                    pendingSaveQueued: Boolean(mutation.reason),
                    repositorySaveStarted: false,
                    repositorySaveCompleted: false,
                    remoteVerified: false,
                    saveVerifiedDraftPersisted: false,
                    appBackgroundFlushTriggered: false,
                    initialLoadSourceAfterRestart: null,
                    valueAfterRestart: null,
                    lostAfterRestart: false,
                });
            }
        }
    }, [getTodayKey, logDate, markWorkoutContentChanged, saveDraftForDate, todayLabels, user?.id]);

    const handleWorkoutLogDraftPersist = useCallback((nextDraft) => {
        const normalizedDate = normalizeDraftDateKey(nextDraft?.date || logDate);
        if (!normalizedDate) return;

        const source = `useWorkoutLog:${nextDraft?.meta?.source || "draft_persist"}`;
        const normalizedDraft = withDraftDateMeta(normalizedDate, normalizeLogDraftState({
            todayLabels: nextDraft?.todayLabels?.length ? nextDraft.todayLabels : todayLabels,
            logData: nextDraft?.logData || {},
            sessionEx: nextDraft?.sessionEx ?? nextDraft?.exercises ?? [],
            exerciseUnits: nextDraft?.exerciseUnits || {},
            meta: makeDraftMeta(nextDraft?.meta || {}, {
                source,
                hasUnsavedChanges: nextDraft?.meta?.hasUnsavedChanges ?? true,
            }),
        }), {
            source,
            hasUnsavedChanges: nextDraft?.meta?.hasUnsavedChanges ?? true,
            updatedAt: nextDraft?.meta?.updatedAt,
            remoteVerifiedAt: nextDraft?.meta?.remoteVerifiedAt,
        });

        const draftSignature = JSON.stringify({
            date: normalizedDate,
            content: getWorkoutDraftSignature(normalizedDraft),
            metaSource: normalizedDraft.meta?.source || null,
            hasUnsavedChanges: normalizedDraft.meta?.hasUnsavedChanges ?? null,
            updatedAt: normalizedDraft.meta?.updatedAt || null,
            remoteVerifiedAt: normalizedDraft.meta?.remoteVerifiedAt || null,
        });
        if (lastAutosavedDraftSignatureRef.current === draftSignature) return;
        lastAutosavedDraftSignatureRef.current = draftSignature;
        saveDraftForDate(normalizedDate, normalizedDraft);
        latestLogDraftRef.current = normalizedDraft;
    }, [logDate, saveDraftForDate, todayLabels]);

    const workoutLog = useWorkoutLog({
        date: logDate,
        initialDraft: workoutLogInitialDraft,
        debug: shouldLogPerfDebug(),
        debounceMs: 350,
        onDraftChange: handleWorkoutLogDraftChange,
        onDraftPersist: handleWorkoutLogDraftPersist,
    });

    const workoutLogExercises = workoutLog.exercises;
    const workoutLogData = workoutLog.logData;
    const workoutLogExerciseUnits = workoutLog.exerciseUnits;
    const addSet = workoutLog.addSet;
    const setField = workoutLog.setField;
    const setWeightMode = workoutLog.setWeightMode;

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
    const persistCurrentLog = useCallback(() => {
        const normalizedLogDate = String(logDate || "").slice(0, 10);
        const pendingChange = pendingWorkoutContentChangeDatesRef.current.get(normalizedLogDate);
        if (!pendingChange) return;

        const latestDraftCandidate = latestLogDraftRef.current || null;
        const latestDraftDate = normalizeDraftDateKey(
            latestDraftCandidate?.date
            || latestDraftCandidate?.meta?.date
            || normalizedLogDate
        );
        const useLatestDraft =
            latestDraftDate === normalizedLogDate
            && hasDraftContent(latestDraftCandidate);
        const saveDraftSnapshot = normalizeLogDraftState(useLatestDraft
            ? latestDraftCandidate
            : {
                todayLabels,
                logData,
                sessionEx: exercises,
                exerciseUnits,
            });
        const saveLabels = saveDraftSnapshot.todayLabels?.length
            ? saveDraftSnapshot.todayLabels
            : todayLabels;
        const saveLogData = saveDraftSnapshot.logData || {};
        const saveExercises = saveDraftSnapshot.sessionEx || [];
        const saveExerciseUnits = saveDraftSnapshot.exerciseUnits || {};
        const getSaveExUnit = (name) => saveExerciseUnits?.[name] || getExUnit(name);

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
            Math.floor(Number(savedWorkoutDurationSecByDate[normalizedLogDate]) || 0)
        );
        const incomingMetrics = getDraftMetricsForDate({
            exercises: saveExercises,
            logData: saveLogData,
            getExUnit: getSaveExUnit,
            workoutDate: normalizedLogDate,
        });
        const existingMetrics = getHistoryMetricsForDate(latestHistoryRef.current || history || {}, normalizedLogDate);
        const explicitEdit = isExplicitWorkoutEditChange(pendingChange);
        const saveGuardDecision = getWorkoutSaveGuardDecision({
            incomingMetrics,
            remoteMetrics: existingMetrics,
            reason: pendingChange.reason,
            explicitEdit,
            explicitDelete: Boolean(pendingChange.explicitDelete),
        });
        const wouldDestructivelyOverwrite = saveGuardDecision.blocked;

        logWorkoutPersistenceDecision({
            action: "local_auto_persist_check",
            userId: user?.id,
            date: logDate,
            localMetrics: incomingMetrics,
            remoteMetrics: existingMetrics,
            reason: wouldDestructivelyOverwrite
                ? `blocked: ${saveGuardDecision.blockedReason || `pending guarded save: ${pendingChange.reason}`}`
                : saveGuardDecision.allowedReason,
        });
        console[wouldDestructivelyOverwrite && !pendingChange.explicitDelete ? "warn" : "log"]("[workout-save-guard] explicit guard detail", {
            env: getRuntimeEnvironmentLabel(),
            action: "workout_save_guard",
            user_id: user?.id || null,
            date: normalizedLogDate,
            reason: pendingChange.reason || null,
            explicitEdit,
            explicitDelete: Boolean(pendingChange.explicitDelete),
            localExerciseNames: incomingMetrics.exerciseNames,
            remoteExerciseNames: existingMetrics.exerciseNames,
            removedExerciseNames: saveGuardDecision.details.removedExerciseNames,
            localSetCount: incomingMetrics.setCount,
            remoteSetCount: existingMetrics.setCount,
            localVolume: incomingMetrics.volume,
            remoteVolume: existingMetrics.volume,
            blockedReason: wouldDestructivelyOverwrite && !pendingChange.explicitDelete ? saveGuardDecision.blockedReason : null,
            allowedReason: wouldDestructivelyOverwrite && !pendingChange.explicitDelete ? null : saveGuardDecision.allowedReason,
            source: "local_auto_persist",
        });
        if (explicitEdit && !wouldDestructivelyOverwrite && saveGuardDecision.details.volumeReduced) {
            console.log("[workout-save-guard] explicit edit allowed despite metric difference", {
                env: getRuntimeEnvironmentLabel(),
                action: "workout_save_guard",
                user_id: user?.id || null,
                date: normalizedLogDate,
                reason: pendingChange.reason || null,
                explicitEdit,
                localVolume: incomingMetrics.volume,
                remoteVolume: existingMetrics.volume,
                localSetCount: incomingMetrics.setCount,
                remoteSetCount: existingMetrics.setCount,
                removedExerciseNames: saveGuardDecision.details.removedExerciseNames,
                allowedReason: saveGuardDecision.allowedReason,
                source: "local_auto_persist",
            });
        }
        if (shouldLogPerfDebug() && explicitEdit && normalizedLogDate !== getTodayKey()) {
            console.log("[workout edit] past workout edit debug", {
                action: "past_workout_edit_debug",
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                selectedDate: logDate,
                saveTargetDate: normalizedLogDate,
                exerciseName: pendingChange.details?.exerciseName || null,
                setIndex: pendingChange.details?.setIndex ?? null,
                field: pendingChange.details?.field || null,
                beforeValue: pendingChange.details?.beforeValue ?? null,
                afterValue: pendingChange.details?.afterValue ?? null,
                draftKey: getDraftKey("draft_logData", normalizedLogDate),
                draftHash: getWorkoutDraftSignature(saveDraftSnapshot),
                previousDraftHash: lastAutosavedDraftSignatureRef.current || null,
                saveReason: pendingChange.reason || null,
                explicitEdit,
                saveBlocked: Boolean(wouldDestructivelyOverwrite && !pendingChange.explicitDelete),
                blockReason: wouldDestructivelyOverwrite && !pendingChange.explicitDelete
                    ? saveGuardDecision.blockedReason || null
                    : null,
                repositorySaved: false,
                remoteVerified: false,
                restoredAfterSave: false,
                restoredSource: null,
                rolledBackAfterInput: false,
                usedLatestDraft: useLatestDraft,
            });
        }

        console[wouldDestructivelyOverwrite && !pendingChange.explicitDelete ? "warn" : "log"]("[set mutation]", {
            action: "workout_autosave",
            env: getRuntimeEnvironmentLabel(),
            date: normalizedLogDate,
            user_id: user?.id || null,
            exerciseName: pendingChange.details?.exerciseName || null,
            beforeSetCount: existingMetrics.setCount,
            afterSetCount: incomingMetrics.setCount,
            beforeSets: null,
            afterSets: getDraftInputDebugSummary({
                exercises: saveExercises,
                logData: saveLogData,
                labels: saveLabels,
            }).setsByExercise,
            dirty: true,
            source: "autosave",
            allowed: !(wouldDestructivelyOverwrite && !pendingChange.explicitDelete),
            blockedReason: wouldDestructivelyOverwrite && !pendingChange.explicitDelete
                ? saveGuardDecision.blockedReason || `pending guarded save: ${pendingChange.reason}`
                : null,
            overwrittenByRestore: false,
        });

        if (wouldDestructivelyOverwrite && !pendingChange.explicitDelete) {
            console.warn("[save guard] blocked destructive local draft apply", {
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                date: normalizedLogDate,
                reason: pendingChange.reason || "unknown",
                localMetrics: incomingMetrics,
                remoteMetrics: existingMetrics,
                explicitEdit,
                explicitDelete: Boolean(pendingChange.explicitDelete),
                removedExerciseNames: saveGuardDecision.details.removedExerciseNames,
                localSetCount: incomingMetrics.setCount,
                remoteSetCount: existingMetrics.setCount,
                localVolume: incomingMetrics.volume,
                remoteVolume: existingMetrics.volume,
                blockedReason: saveGuardDecision.blockedReason,
            });
            return;
        }

        const dirtyDraftForPersistence = withDraftDateMeta(normalizedLogDate, saveDraftSnapshot, {
            source: pendingChange.reason || saveDraftSnapshot.meta?.source || "local_auto_persist",
            hasUnsavedChanges: true,
            updatedAt: pendingChange.updatedAt || saveDraftSnapshot.meta?.updatedAt || new Date().toISOString(),
            remoteVerifiedAt: saveDraftSnapshot.meta?.remoteVerifiedAt || null,
        });
        const draftSavedToLocalStorage = saveDraftForDate(normalizedLogDate, dirtyDraftForPersistence);
        latestLogDraftRef.current = dirtyDraftForPersistence;
        if (shouldLogPerfDebug() && explicitEdit && normalizedLogDate !== getTodayKey()) {
            console.log("[workout edit] past edit persistence debug", {
                action: "past_edit_persistence_debug",
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                selectedDate: normalizedLogDate,
                field: pendingChange.details?.field || null,
                beforeValue: pendingChange.details?.beforeValue ?? null,
                afterValue: pendingChange.details?.afterValue ?? null,
                localStateUpdated: true,
                draftSavedToLocalStorage,
                pendingSaveQueued: true,
                repositorySaveStarted: false,
                repositorySaveCompleted: false,
                remoteVerified: false,
                saveVerifiedDraftPersisted: false,
                appBackgroundFlushTriggered: false,
                initialLoadSourceAfterRestart: null,
                valueAfterRestart: null,
                lostAfterRestart: false,
            });
        }

        pendingWorkoutNotificationRef.current = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            userId: user?.id || null,
            logDate: normalizedLogDate,
        };
        queueWorkoutSessionSync(normalizedLogDate);

        setHistory((prev) => {
            const nextHistory = buildDraftHistoryForDate({
                baseHistory: prev,
                workoutDate: normalizedLogDate,
                exercises: saveExercises,
                logData: saveLogData,
                getExUnit: getSaveExUnit,
                labels: saveLabels,
                durationSec,
                replaceDate: Boolean(pendingChange.explicitDelete),
            });

            if (shouldLogPerfDebug()) {
                console.log("[save] local draft applied to history", {
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user?.id || null,
                    date: normalizedLogDate,
                    reason: pendingChange.reason,
                    explicitDelete: Boolean(pendingChange.explicitDelete),
                    draftInput: getDraftInputDebugSummary({
                        exercises: saveExercises,
                        logData: saveLogData,
                        labels: saveLabels,
                    }),
                    saving: getHistoryDebugSummaryForDate(nextHistory, normalizedLogDate),
                    previous: getHistoryDebugSummaryForDate(prev, normalizedLogDate),
                    diffPreviousToSaving: getHistoryDebugDiffForDate(prev, nextHistory, normalizedLogDate),
                    usedLatestDraft: useLatestDraft,
                });
            }

            if (serializeHistoryMap(nextHistory) === serializeHistoryMap(prev)) return prev;
            latestHistoryRef.current = nextHistory;
            historyRevisionRef.current += 1;
            applyWorkoutsDataHistorySnapshot(nextHistory, {
                allowRegression: true,
                source: "workouts.data",
                reason: "local draft flush to workouts.data canonical",
                requestId: "local-draft-flush",
                workoutsHistory: nextHistory,
            });
            persistHistoryForUser(user?.id, nextHistory);
            if (shouldLogPerfDebug()) {
                console.log("[home weekly summary] apply", {
                    source: "workouts.data",
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user?.id || null,
                    requestId: "local-draft-flush",
                    applied: true,
                    reason: "local draft flush to workouts.data canonical",
                    ...getHomeWeeklySummaryDebug(nextHistory),
                });
            }
            return nextHistory;
        });
    }, [applyWorkoutsDataHistorySnapshot, exerciseUnits, exercises, getDraftKey, getExUnit, getTodayKey, hasDraftContent, historyRevisionRef, history, logData, logDate, queueWorkoutSessionSync, saveDraftForDate, savedWorkoutDurationSecByDate, todayLabels, user?.id, workoutStartedForDate, workoutTimerStateRef]); // ← 依存配列

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
                        weight: storeSetWeightForUnit(set, exUnit),
                        displayWeight: set.weight,
                        displayUnit: getSetDisplayUnit(set, exUnit),
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
            durationSec,
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
                    sessionPayload: {
                        ...sessionPayload,
                        durationSec,
                        session: {
                            ...sessionPayload.session,
                            durationSec,
                            duration_sec: durationSec,
                        },
                    },
                }
                : null,
        });
    }, [exercises, getExUnit, getPR, getPreviousPR, logData, savedWorkoutDurationSecByDate, todayLabels, unit, user?.id, workoutTimerStateRef]);

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
    }, [buildDraftWorkoutDaySummary, finishWorkoutTimer, historyRevisionRef, logDate, queueWorkoutSessionSync, setSavedWorkoutDurationSecByDate, user?.id]);



    const removeEx = (idOrName, maybeName) => {
        const isNameOnly = maybeName === undefined;
        const targetName = isNameOnly ? idOrName : maybeName;
        workoutLog.removeExercise(idOrName, maybeName);
        clearExerciseOverrideForLabel(targetName, todayLabels[0]);
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

    const addExToSession = (name, labelOverride, options = {}) => {
        const trimmed = String(name || "").trim();
        if (!trimmed) {
            console.error("[add-exercise] failed: empty exercise name", {
                labelOverride,
                logDate,
            });
            return;
        }

        const normalizedName = normalizeExerciseName(trimmed);
        const label = labelOverride || todayLabels[0] || getPrimaryDefaultBodyPartLabel(normalizedName) || "その他";
        if (!label) {
            console.error("[add-exercise] failed: missing body part label", {
                name: trimmed,
                labelOverride,
                todayLabels,
                logDate,
            });
            return;
        }
        const beforeExercises = workoutLog.exercises || [];
        const beforeNames = beforeExercises.map((e) => e.name);
        const existingExercise = beforeExercises.find(
            (e) => normalizeExerciseName(e.name) === normalizedName
        );
        const alreadyInSession = !!existingExercise;

        if (alreadyInSession) {
            if (shouldLogPerfDebug()) console.log("[add-exercise] duplicate ignored", {
                action: "exercise_add_attempt",
                env: getRuntimeEnvironmentLabel(),
                date: logDate,
                user_id: user?.id || null,
                name: trimmed,
                exerciseName: trimmed,
                bodyPart: label,
                label,
                before: beforeNames,
                beforeExerciseNames: beforeNames,
                afterExerciseNames: beforeNames,
                added: false,
                blocked: false,
                blockedReason: null,
                duplicateDetected: true,
                filteredOut: false,
                removedExerciseNames: [],
            });
            requestLogExerciseFocus(existingExercise);
            return;
        }

        const ex = {
            id: Date.now() + (Math.random() * 1000 | 0),
            name: trimmed,
            label,
            bodyPart: label,
        };
        const nextSessionForDraft = [...beforeExercises, ex];
        const afterNames = nextSessionForDraft.map((exercise) => exercise.name);
        const removedExerciseNames = beforeNames.filter((beforeName) => {
            const normalizedBefore = normalizeExerciseName(beforeName);
            return normalizedBefore && !afterNames.some((afterName) => normalizeExerciseName(afterName) === normalizedBefore);
        });
        const beforeSetCount = beforeExercises.reduce((sum, exercise) => sum + ((exercise.sets || []).length || 0), 0);
        const afterSetCount = nextSessionForDraft.reduce((sum, exercise) => sum + ((exercise.sets || []).length || 0), 0);
        const blockedReason = removedExerciseNames.length
            ? "exercise add would remove existing exercises"
            : afterNames.length < beforeNames.length
                ? "exercise add would reduce exercise count"
                : afterSetCount < beforeSetCount
                    ? "exercise add would reduce set count"
                    : null;

        const action = options.action || "exercise_add";

        if (shouldLogPerfDebug() || blockedReason) console[blockedReason ? "warn" : "log"]("[exercise mutation]", {
            action,
            env: getRuntimeEnvironmentLabel(),
            date: logDate,
            user_id: user?.id || null,
            addedExerciseName: trimmed,
            removedExerciseNames,
            beforeExerciseNames: beforeNames,
            afterExerciseNames: afterNames,
            beforeSetCount,
            afterSetCount,
            selectedBodyPartFilter: labelOverride || todayLabels[0] || null,
            explicitDelete: false,
            allowed: !blockedReason,
            blockedReason,
        });

        if (shouldLogPerfDebug() || blockedReason) console[blockedReason ? "warn" : "log"]("[exercise add]", {
            action: "exercise_add_attempt",
            env: getRuntimeEnvironmentLabel(),
            date: logDate,
            user_id: user?.id || null,
            exerciseName: trimmed,
            bodyPart: label,
            beforeExerciseNames: beforeNames,
            afterExerciseNames: afterNames,
            beforeSetCount,
            afterSetCount,
            added: !blockedReason,
            blocked: Boolean(blockedReason),
            blockedReason,
            duplicateDetected: false,
            filteredOut: false,
            removedExerciseNames,
            selectedBodyPartFilter: labelOverride || todayLabels[0] || null,
            explicitDelete: false,
        });

        if (blockedReason) return;

        if (shouldLogPerfDebug()) console.log("[add-exercise] adding exercise", {
            name: trimmed,
            label,
            before: beforeNames,
            after: afterNames,
        });

        workoutLog.addExercise(ex, label, { reason: "exercise_add" });

        const muscleExLabel = getPrimaryDefaultBodyPartLabel(normalizedName) || label;
        setMuscleEx((prev) => {
            const next = { ...prev };
            const list = next[muscleExLabel] || [];

            if (!list.find((e) => e.name === trimmed)) {
                next[muscleExLabel] = [...list, { id: Date.now(), name: trimmed }];
            }

            return next;
        });

        setExerciseOverrideForLabel(trimmed, label);

        if (!alreadyInSession) {
            requestLogExerciseFocus(ex);
            startWorkoutTimerIfNeeded(logDate, { markAsActivity: true });
        }
    };

    const reorderEx = (fromIdx, toIdx) => {
        workoutLog.reorderExercise(fromIdx, toIdx);
    };

    const renameEx = (id, newName) => {
        const trimmed = newName.trim();
        if (!trimmed) return;

        const oldEx = (workoutLog.exercises || []).find((e) => e.id === id);
        if (!oldEx || oldEx.name === trimmed) return;

        workoutLog.renameExercise(id, trimmed);

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

    const quickAdd = (name, remove, labelOverride, options = {}) => {
        if (remove) {
            removeEx(name);
            const tgts = labelOverride
                ? [labelOverride]
                : Array.isArray(addTarget)
                    ? addTarget
                    : (addTarget ? [addTarget] : []);
            tgts.forEach((label) => clearExerciseOverrideForLabel(name, label));
            return;
        }
        addExToSession(name, labelOverride, options);
    };

    const quickAddToSession = (name, remove, labelOverride, options) => {
        quickAdd(name, remove, labelOverride, options);
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

    const logRestoreDecision = useCallback((dateStr, savedDraft, localDraft, finalDraft, source) => {
        if (!shouldLogPerfDebug()) return;
        const metricGetExUnit = (name) =>
            finalDraft?.exerciseUnits?.[name] ||
            localDraft?.exerciseUnits?.[name] ||
            savedDraft?.exerciseUnits?.[name] ||
            getExUnit(name);
        console.log("[restore] environment", {
            env: getRuntimeEnvironmentLabel(),
            origin: typeof window !== "undefined" ? window.location?.origin : "",
            protocol: typeof window !== "undefined" ? window.location?.protocol : "",
            user_id: user?.id || null,
            date: dateStr,
            source,
            savedMetrics: getDraftMetricsForDate({
                exercises: savedDraft?.sessionEx || [],
                logData: savedDraft?.logData || {},
                getExUnit: metricGetExUnit,
                workoutDate: dateStr,
            }),
            localMetrics: getDraftMetricsForDate({
                exercises: localDraft?.sessionEx || [],
                logData: localDraft?.logData || {},
                getExUnit: metricGetExUnit,
                workoutDate: dateStr,
            }),
            finalMetrics: getDraftMetricsForDate({
                exercises: finalDraft?.sessionEx || [],
                logData: finalDraft?.logData || {},
                getExUnit: metricGetExUnit,
                workoutDate: dateStr,
            }),
        });
        console.log("[restore] supabase exercises", (savedDraft?.sessionEx || []).map((ex) => ex.name));
        console.log("[restore] local draft exercises", (localDraft?.sessionEx || []).map((ex) => ex.name));
        console.log("[restore] final exercises", (finalDraft?.sessionEx || []).map((ex) => ex.name));
    }, [getExUnit, user?.id]);

    useEffect(() => {
        if (screen !== "log" || !historySyncReady || !logDate) return;
        if (pendingWorkoutContentChangeDatesRef.current.has(String(logDate || "").slice(0, 10))) return;

        const normalizedLogDate = normalizeDraftDateKey(logDate);
        const savedDraftForDate = withDraftDateMeta(
            normalizedLogDate,
            buildSavedWorkoutDraftForDate(normalizedLogDate, canonicalDisplayHistory),
            {
                source: "canonical_display_history",
                hasUnsavedChanges: false,
            }
        );
        if (!savedDraftForDate.hasSavedWorkout) return;

        const currentDraft = withDraftDateMeta(normalizedLogDate, getCurrentLogDraftSnapshot(), {
            source: latestLogDraftRef.current?.meta?.source || "current_log_snapshot",
            hasUnsavedChanges: latestLogDraftRef.current?.meta?.hasUnsavedChanges ?? true,
        });
        const currentDraftSignature = getWorkoutDraftSignature(currentDraft);
        const savedDraftSignature = getWorkoutDraftSignature(savedDraftForDate);
        if (currentDraftSignature === savedDraftSignature) {
            return;
        }

        const localDraft = loadDraftForDate(normalizedLogDate);
        if (
            hasDraftContent(currentDraft) &&
            currentDraftSignature === getWorkoutDraftSignature(localDraft)
        ) {
            return;
        }

        const savedMetrics = getDraftMetricsForDate({
            exercises: savedDraftForDate.sessionEx,
            logData: savedDraftForDate.logData,
            getExUnit,
            workoutDate: normalizedLogDate,
        });
        const localMetrics = getDraftMetricsForDate({
            exercises: localDraft.sessionEx || [],
            logData: localDraft.logData || {},
            getExUnit: (name) => localDraft.exerciseUnits?.[name] || getExUnit(name),
            workoutDate: normalizedLogDate,
        });
        const explicitLocalEdit = Boolean(explicitWorkoutEditDatesRef.current.has(normalizedLogDate));
        const localDraftIsCleanPersisted = isCleanPersistedDraft(localDraft);
        const localDraftEditReason = getWorkoutEditReasonFromSource(localDraft?.meta?.source);
        const localDraftIsUnsavedUserEdit = isUnsavedUserWorkoutDraft(localDraft);
        const localDraftHasUnsavedChanges = Boolean(localDraft?.meta?.hasUnsavedChanges === true || explicitLocalEdit);
        const localDraftCanOverrideSaved = Boolean(
            hasDraftContent(localDraft) &&
            !localDraftIsCleanPersisted &&
            (localDraftHasUnsavedChanges || localDraftIsUnsavedUserEdit)
        );
        const {
            preserve: preserveRawLocalDraft,
            localRawMetrics,
            incomingRawMetrics: savedRawMetrics,
            removedExerciseNames,
        } = shouldPreserveRawDraftOverIncoming(localDraft, savedDraftForDate);

        if (shouldLogPerfDebug()) {
            console.log("[restore] restore_decision", {
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                action: "restore_decision",
                date: normalizedLogDate,
                localDraftSource: localDraft?.meta?.source || null,
                localDraftUpdatedAt: localDraft?.meta?.updatedAt || null,
                localDraftRemoteVerifiedAt: localDraft?.meta?.remoteVerifiedAt || null,
                localDraftHasUnsavedChanges: localDraft?.meta?.hasUnsavedChanges ?? null,
                remoteUpdatedAt: null,
                localSetCount: localMetrics.setCount,
                remoteSetCount: savedMetrics.setCount,
                localIsNewerUnsavedDraft: localDraftCanOverrideSaved,
                appliedSource: localDraftCanOverrideSaved && (isDestructiveWorkoutRegression(savedMetrics, localMetrics) || preserveRawLocalDraft)
                    ? "localDraft"
                    : "remoteSupabase",
                rejectedSource: localDraftCanOverrideSaved && (isDestructiveWorkoutRegression(savedMetrics, localMetrics) || preserveRawLocalDraft)
                    ? "remoteSupabase"
                    : "localDraft",
                reason: localDraftIsCleanPersisted
                    ? "local draft is already clean persisted data"
                    : localDraftCanOverrideSaved
                        ? "local draft has unsaved changes"
                        : "local draft is not unsaved; remote can refresh",
            });
        }

        if (
            localDraftCanOverrideSaved &&
            localDraftIsUnsavedUserEdit &&
            (localMetrics.hasWorkout || localRawMetrics.exerciseCount > 0 || localRawMetrics.setCount > 0)
        ) {
            console.warn("[restore] kept unsaved user draft instead of saved workout", {
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                date: normalizedLogDate,
                local: localMetrics,
                saved: savedMetrics,
                localRawMetrics,
                savedRawMetrics,
                removedExerciseNames,
                explicitLocalEdit,
                source: localDraft?.meta?.source || null,
                reason: "local draft has unsaved user edit source",
                restoreApplied: false,
                overwrittenByRestore: false,
            });
            const datedLocalDraft = withDraftDateMeta(normalizedLogDate, localDraft, {
                source: localDraft?.meta?.source || "draft_restore",
                hasUnsavedChanges: true,
            });
            applyCurrentLogDraft(datedLocalDraft);
            markWorkoutContentChanged(normalizedLogDate, localDraftEditReason || "local_unsaved_draft_restore", { explicitEdit: true });
            logRestoreDecision(normalizedLogDate, savedDraftForDate, datedLocalDraft, datedLocalDraft, "local_unsaved_draft");
            return;
        }

        if (localDraftCanOverrideSaved && (isDestructiveWorkoutRegression(savedMetrics, localMetrics) || preserveRawLocalDraft)) {
            console.warn("[restore] kept richer local draft instead of smaller saved workout", {
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                date: normalizedLogDate,
                local: localMetrics,
                saved: savedMetrics,
                localRawMetrics,
                savedRawMetrics,
                removedExerciseNames,
                explicitLocalEdit,
                source: "draft_restore",
                restoreApplied: false,
                overwrittenByRestore: false,
            });
            const datedLocalDraft = withDraftDateMeta(normalizedLogDate, localDraft, {
                source: localDraft?.meta?.source || "draft_restore",
                hasUnsavedChanges: localDraft?.meta?.hasUnsavedChanges ?? true,
            });
            applyCurrentLogDraft(datedLocalDraft);
            logRestoreDecision(normalizedLogDate, savedDraftForDate, datedLocalDraft, datedLocalDraft, "local_draft_richer_than_saved");
            return;
        }

        const cleanSavedDraft = withDraftDateMeta(normalizedLogDate, savedDraftForDate, {
            source: "remote_supabase",
            remoteVerifiedAt: new Date().toISOString(),
            hasUnsavedChanges: false,
        });
        applyCurrentLogDraft(cleanSavedDraft);
        logRestoreDecision(normalizedLogDate, cleanSavedDraft, localDraft, cleanSavedDraft, "supabase_saved_workout_refresh");
    }, [
        buildSavedWorkoutDraftForDate,
        applyCurrentLogDraft,
        canonicalDisplayHistory,
        exerciseUnits,
        historySyncReady,
        hasDraftContent,
        getCurrentLogDraftSnapshot,
        loadDraftForDate,
        logData,
        logDate,
        logRestoreDecision,
        markWorkoutContentChanged,
        saveDraftForDate,
        screen,
        sessionEx,
        todayLabels,
        user?.id,
        getExUnit,
    ]);

    useEffect(() => {
        if (screen !== "log" || !user?.id || !historySyncReady || !logDate) return;
        const normalizedDate = String(logDate || "").slice(0, 10);
        if (!normalizedDate) return;
        if (pendingWorkoutContentChangeDatesRef.current.has(normalizedDate)) return;

        let cancelled = false;

        const refreshLogDateFromSupabase = async () => {
            try {
                const [workoutsRes, sessionRes] = await Promise.all([
                    fetchWorkoutRowForDateFromRepository({
                        userId: user.id,
                        date: normalizedDate,
                    }),
                    supabase
                        .from("workout_sessions")
                        .select("workout_date, duration_sec, summary_json")
                        .eq("user_id", user.id)
                        .eq("workout_date", normalizedDate)
                        .maybeSingle(),
                ]);

                if (workoutsRes.error) {
                    logRecordFetchError("log_date_refresh", "workouts", workoutsRes.error, {
                        userId: user.id,
                        workoutDate: normalizedDate,
                        query: "workoutRepository.fetchWorkoutRowForDate",
                        responseData: workoutsRes.row,
                    });
                    throw workoutsRes.error;
                }
                if (sessionRes.error) {
                    logRecordFetchError("log_date_refresh", "workout_sessions", sessionRes.error, {
                        userId: user.id,
                        workoutDate: normalizedDate,
                        query: "workout_sessions.select(workout_date,duration_sec,summary_json).eq(user_id).eq(workout_date).maybeSingle",
                        responseData: sessionRes.data,
                    });
                    console.warn("[restore] workout_sessions date refresh failed; using workouts.data", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        date: normalizedDate,
                        code: sessionRes.error?.code,
                        message: sessionRes.error?.message,
                        details: sessionRes.error?.details,
                        hint: sessionRes.error?.hint,
                        responseData: sessionRes.data,
                    });
                }
                if (cancelled) return;
                if (pendingWorkoutContentChangeDatesRef.current.has(normalizedDate)) return;

                const fetchedWorkoutRowsForDate = workoutsRes.row ? [workoutsRes.row] : [];
                const workoutRowsForDate = fetchedWorkoutRowsForDate.filter((row) => {
                    const rowDate = normalizeDraftDateKey(row?.date);
                    const accepted = rowDate === normalizedDate;
                    if (!accepted) {
                        console.warn("[restore] rejected date-mismatched workouts row", {
                            action: "refresh_log_date_result",
                            requestedDate: normalizedDate,
                            remoteRowDate: rowDate || null,
                            accepted: false,
                            rejectedReason: "workouts.row.date mismatch",
                        });
                    }
                    return accepted;
                });
                const sessionRowsForDate = sessionRes.error
                    ? []
                    : (sessionRes.data ? [sessionRes.data] : []).filter((row) => {
                        const rowDate = normalizeDraftDateKey(row?.workout_date || row?.date);
                        const accepted = rowDate === normalizedDate;
                        if (!accepted) {
                            console.warn("[restore] rejected date-mismatched workout_sessions row", {
                                action: "refresh_log_date_result",
                                requestedDate: normalizedDate,
                                remoteSessionDate: rowDate || null,
                                accepted: false,
                                rejectedReason: "workout_sessions.workout_date mismatch",
                            });
                        }
                        return accepted;
                    });
                applyTrustedWorkoutRowsSnapshot(workoutRowsForDate, {
                    source: "log_date_refresh",
                });
                applyTrustedSessionRowsSnapshot(sessionRowsForDate, {
                    source: "log_date_refresh",
                });
                const rawRemoteHistory = buildRemoteHistoryWithWorkoutRowsPriority(
                    workoutRowsForDate,
                    sessionRowsForDate
                );
                const remoteHistory = applyPreferredHistoryDates(
                    {},
                    rawRemoteHistory,
                    [normalizedDate]
                );
                const remoteMetrics = getHistoryMetricsForDate(remoteHistory, normalizedDate, {
                    updatedAt: null,
                });
                const localDraft = loadDraftForDate(normalizedDate);
                const localMetrics = getDraftMetricsForDate({
                    exercises: localDraft.sessionEx || [],
                    logData: localDraft.logData || {},
                    getExUnit: (name) => localDraft.exerciseUnits?.[name] || getExUnit(name),
                    workoutDate: normalizedDate,
                });
                const remoteDraftForDate = buildSavedWorkoutDraftForDate(normalizedDate, remoteHistory);
                const remoteDraftValidation = getDraftDateValidation(normalizedDate, remoteDraftForDate, normalizedDate);
                if (shouldLogPerfDebug()) {
                    console.log("[restore] refresh log date result", {
                        action: "refresh_log_date_result",
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        requestedDate: normalizedDate,
                        remoteRowDates: fetchedWorkoutRowsForDate.map((row) => normalizeDraftDateKey(row?.date)).filter(Boolean),
                        remoteDataDates: getValidWorkoutDatesFromHistory(rawRemoteHistory),
                        remoteSessionDates: sessionRowsForDate.map((row) => normalizeDraftDateKey(row?.workout_date || row?.date)).filter(Boolean),
                        restoredHistoryDates: getValidWorkoutDatesFromHistory(remoteHistory),
                        appliedLogDataDate: getDraftPayloadDate(remoteDraftForDate) || normalizedDate,
                        appliedSessionExDate: getDraftPayloadDate(remoteDraftForDate) || normalizedDate,
                        dateMismatch: !remoteDraftValidation.accepted,
                        rejectedReason: remoteDraftValidation.rejectedReason || null,
                    });
                }
                const {
                    preserve: preserveRawLocalDraft,
                    localRawMetrics,
                    incomingRawMetrics: remoteRawMetrics,
                    removedExerciseNames,
                } = shouldPreserveRawDraftOverIncoming(localDraft, remoteDraftForDate);
                const explicitLocalEdit = Boolean(explicitWorkoutEditDatesRef.current.has(normalizedDate));
                const remoteVerifiedAt = new Date().toISOString();
                const localDraftIsCleanPersisted = isCleanPersistedDraft(localDraft);
                const pendingLocalEdit = pendingWorkoutContentChangeDatesRef.current.get(normalizedDate) || null;
                const localDraftEditReason = getWorkoutEditReasonFromSource(localDraft?.meta?.source);
                const localDraftIsUnsavedUserEdit = isUnsavedUserWorkoutDraft(localDraft);
                const localDraftHasUnsavedChanges = Boolean(
                    localDraft?.meta?.hasUnsavedChanges === true ||
                    explicitLocalEdit ||
                    pendingLocalEdit ||
                    localDraftIsUnsavedUserEdit
                );
                const localDraftIsNewerUnsaved = Boolean(
                    localDraftHasUnsavedChanges &&
                    !localDraftIsCleanPersisted &&
                    (
                        !localDraft?.meta?.remoteVerifiedAt ||
                        isDraftNewerThan(localDraft, localDraft.meta.remoteVerifiedAt) ||
                        explicitLocalEdit ||
                        pendingLocalEdit
                    )
                );

                if (shouldLogPerfDebug()) {
                    console.log("[restore] restore_decision", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        action: "restore_decision",
                        date: normalizedDate,
                        localDraftSource: localDraft?.meta?.source || null,
                        localDraftUpdatedAt: localDraft?.meta?.updatedAt || null,
                        localDraftRemoteVerifiedAt: localDraft?.meta?.remoteVerifiedAt || null,
                        localDraftHasUnsavedChanges: localDraft?.meta?.hasUnsavedChanges ?? null,
                        remoteUpdatedAt: remoteVerifiedAt,
                        localSetCount: localMetrics.setCount,
                        remoteSetCount: remoteMetrics.setCount,
                        localIsNewerUnsavedDraft: localDraftIsNewerUnsaved,
                        appliedSource: localDraftIsNewerUnsaved && (preserveRawLocalDraft || isDestructiveWorkoutRegression(remoteMetrics, localMetrics))
                            ? "localDraft"
                            : "remoteSupabase",
                        rejectedSource: localDraftIsNewerUnsaved && (preserveRawLocalDraft || isDestructiveWorkoutRegression(remoteMetrics, localMetrics))
                            ? "remoteSupabase"
                            : "localDraft",
                        reason: localDraftIsCleanPersisted
                            ? "local draft is save verified/remote persisted"
                            : localDraftIsNewerUnsaved
                                ? "local draft has newer unsaved edits"
                                : "remote is allowed to refresh local draft",
                    });
                }

                if (!remoteMetrics.hasWorkout) {
                    console.log("[restore] Supabase date refresh skipped empty remote", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        date: normalizedDate,
                        supabase: remoteMetrics,
                        localStorage: localMetrics,
                    });
                    return;
                }

                if (
                    localDraftIsNewerUnsaved &&
                    localDraftIsUnsavedUserEdit &&
                    (localMetrics.hasWorkout || localRawMetrics.exerciseCount > 0 || localRawMetrics.setCount > 0)
                ) {
                    const datedLocalDraft = withDraftDateMeta(normalizedDate, localDraft, {
                        source: localDraft?.meta?.source || "draft_restore",
                        hasUnsavedChanges: true,
                    });
                    console.warn("[restore] skipped Supabase date refresh during unsaved user draft; keeping local draft", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        date: normalizedDate,
                        source: localDraft?.meta?.source || null,
                        dirty: true,
                        supabase: remoteMetrics,
                        localStorage: localMetrics,
                        remoteRawMetrics,
                        localRawMetrics,
                        removedExerciseNames,
                        overwrittenByRestore: false,
                        blockedReason: "local draft has unsaved user edit source",
                    });
                    applyCurrentLogDraft(datedLocalDraft);
                    markWorkoutContentChanged(normalizedDate, localDraftEditReason || "local_unsaved_draft_restore", { explicitEdit: true });
                    return;
                }

                if (localDraftIsNewerUnsaved && preserveRawLocalDraft && explicitLocalEdit) {
                    console.warn("[restore] skipped Supabase date refresh during dirty draft; keeping local draft", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        date: normalizedDate,
                        source: "supabase",
                        dirty: true,
                        supabase: remoteMetrics,
                        localStorage: localMetrics,
                        remoteRawMetrics,
                        localRawMetrics,
                        removedExerciseNames,
                        overwrittenByRestore: false,
                        blockedReason: "remote refresh would drop local draft sets",
                    });
                    markWorkoutContentChanged(normalizedDate, "local_draft_richer_restore", { explicitEdit: true });
                    return;
                }

                if (localDraftIsNewerUnsaved && explicitLocalEdit && (localMetrics.hasWorkout || localRawMetrics.exerciseCount > 0 || localRawMetrics.setCount > 0)) {
                    console.warn("[restore] skipped Supabase date refresh during explicit local edit; keeping local draft", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        date: normalizedDate,
                        supabase: remoteMetrics,
                        localStorage: localMetrics,
                        explicitEdit: explicitWorkoutEditDatesRef.current.get(normalizedDate) || null,
                    });
                    markWorkoutContentChanged(normalizedDate, "local_draft_richer_restore", { explicitEdit: true });
                    return;
                }

                if (localDraftIsNewerUnsaved && isDestructiveWorkoutRegression(remoteMetrics, localMetrics)) {
                    console.warn("[restore] skipped smaller Supabase date refresh; keeping local draft", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        date: normalizedDate,
                        supabase: remoteMetrics,
                        localStorage: localMetrics,
                        localExerciseNames: localMetrics.exerciseNames,
                        remoteExerciseNames: remoteMetrics.exerciseNames,
                    });
                    markWorkoutContentChanged(normalizedDate, "local_draft_richer_restore");
                    return;
                }

                const nextHistory = applyLocalHistoryDates(latestHistoryRef.current || history || {}, remoteHistory, [normalizedDate]);
                const remoteWorkoutsHistory = applyPreferredHistoryDates(
                    {},
                    buildHistoryFromWorkoutRows(workoutRowsForDate),
                    [normalizedDate]
                );
                const nextWorkoutsDataHistory = applyLocalHistoryDates(
                    workoutsDataHistoryRef.current || latestHistoryRef.current || history || {},
                    remoteWorkoutsHistory,
                    [normalizedDate]
                );
                const savedDraftForDate = withDraftDateMeta(
                    normalizedDate,
                    buildSavedWorkoutDraftForDate(normalizedDate, nextHistory),
                    {
                        source: "remote_supabase",
                        hasUnsavedChanges: false,
                    }
                );
                const cleanSavedDraftForDate = withDraftDateMeta(normalizedDate, savedDraftForDate, {
                    source: "remote_supabase",
                    remoteVerifiedAt,
                    hasUnsavedChanges: false,
                });

                if (shouldLogPerfDebug()) {
                    console.log("[restore] Supabase date refresh applied", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        date: normalizedDate,
                        supabase: remoteMetrics,
                        localStorage: localMetrics,
                        appliedExerciseNames: cleanSavedDraftForDate.sessionEx.map((ex) => ex.name),
                    });
                }

                if (serializeHistoryMap(nextHistory) !== serializeHistoryMap(latestHistoryRef.current || history || {})) {
                    setHistory(nextHistory);
                    persistHistoryForUser(user.id, nextHistory);
                }
                if (serializeHistoryMap(nextWorkoutsDataHistory) !== serializeHistoryMap(workoutsDataHistoryRef.current || {})) {
                    const logDateRefreshApplied = applyWorkoutsDataHistorySnapshot(nextWorkoutsDataHistory, {
                        source: "workouts.data",
                        reason: "log date workouts.data refresh",
                        requestId: "log-date-refresh",
                        workoutsHistory: remoteWorkoutsHistory,
                    });
                    if (shouldLogPerfDebug()) {
                        console.log("[home weekly summary] apply", {
                            source: "workouts.data",
                            env: getRuntimeEnvironmentLabel(),
                            user_id: user.id,
                            requestId: "log-date-refresh",
                            applied: logDateRefreshApplied,
                            reason: "log date workouts.data refresh",
                            ...getHomeWeeklySummaryDebug(nextWorkoutsDataHistory),
                        });
                    }
                }
                applyCurrentLogDraft(cleanSavedDraftForDate);
                setHistoryLoadError("");
            } catch (error) {
                console.warn("[restore] Supabase date refresh failed", {
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user.id,
                    date: normalizedDate,
                    error,
                    message: error?.message,
                });
            }
        };

        refreshLogDateFromSupabase();

        return () => {
            cancelled = true;
        };
    }, [
        applyTrustedSessionRowsSnapshot,
        applyTrustedWorkoutRowsSnapshot,
        applyWorkoutsDataHistorySnapshot,
        applyLocalHistoryDates,
        applyCurrentLogDraft,
        buildSavedWorkoutDraftForDate,
        getExUnit,
        history,
        historySyncReady,
        loadDraftForDate,
        logDate,
        markWorkoutContentChanged,
        saveDraftForDate,
        screen,
        setHistoryLoadError,
        user?.id,
    ]);

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
