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
import { QUICK_LABELS, LABEL_COLORS, SUGGESTIONS } from "./constants/suggestions";
import { S, css } from "./utils/styles";
import { Analytics } from "@vercel/analytics/react";
import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
// eslint-disable-next-line no-unused-vars

import { useAI } from "./hooks/useAI";
import { useSettings } from "./hooks/useSettings";

import LogScreen from "./components/LogScreen";
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
import {
    buildWorkoutSessionPayloadFromDraft,
    buildWorkoutSessionPayloadFromHistory,
} from "./utils/workoutSessions";
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
import { APP_VERSION, HISTORY_CACHE_SCHEMA_VERSION } from "./appVersion";

const AnalyticsScreen = lazy(() => import("./components/AnalyticsScreen"));
const PhotoScreen = lazy(() => import("./components/PhotoScreen"));
const FriendsScreen = lazy(() => import("./components/FriendsScreen"));
const HistoryScreen = lazy(() => import("./components/HistoryScreen"));
const AIScreen = lazy(() => import("./components/AIScreen"));
const Auth = lazy(() => import("./components/Auth"));

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
const REMOTE_HISTORY_SESSION_LOOKBACK_DAYS = 180;
const REMOTE_HISTORY_SESSION_LIMIT = 400;
const INITIAL_HOME_HISTORY_LOOKBACK_DAYS = 21;
const INITIAL_HOME_HISTORY_LIMIT = 80;
const HISTORY_RECOVERY_LIMIT = 250;
const DIAGNOSTIC_LOOKBACK_DAYS = 45;

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

const EXPLICIT_SET_EDIT_REASONS = new Set(["weight_change", "reps_change", "unit_change"]);
const EXPLICIT_WORKOUT_EDIT_REASONS = new Set([
    ...EXPLICIT_SET_EDIT_REASONS,
    "history_record_edit",
    "exercise_add",
    "set_add",
    "exercise_reorder",
]);

const isExplicitWorkoutEditChange = (pendingChange = {}) =>
    Boolean(pendingChange.explicitEdit || EXPLICIT_WORKOUT_EDIT_REASONS.has(pendingChange.reason));

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
    const workoutHistoryScopes = buildHistoryFromWorkoutRowsWithScopes(workoutRows || []);
    const sessionHistory = buildHistoryFromWorkoutSessionRows(sessionRows || []);
    const fallbackHistory = mergeHistoryMaps(sessionHistory, workoutHistoryScopes.legacyHistory);

    return applyPreferredHistoryDates(
        fallbackHistory,
        workoutHistoryScopes.exactHistory,
        workoutHistoryScopes.exactDates
    );
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
    };
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
        const todayLabels = load(
            getDraftKey("draft_todayLabels", dateStr),
            useLegacyFallback ? load("draft_todayLabels", []) : []
        );
        const rawSessionEx = load(
            getDraftKey("draft_sessionEx", dateStr),
            useLegacyFallback ? load("draft_sessionEx", null) : null
        );
        const sessionEx = rawSessionEx === null && !Object.keys(logData || {}).length
            ? null
            : mergeDraftExercisesWithLogData(rawSessionEx || [], logData, todayLabels);

        return {
            todayLabels,
            logData,
            sessionEx,
            exerciseUnits: load(
                getDraftKey("draft_exerciseUnits", dateStr),
                useLegacyFallback ? load("draft_exerciseUnits", {}) : {}
            ),
            meta: load(getDraftKey("draft_meta", dateStr), null),
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
        const logData = draft.logData || {};
        const todayLabels = draft.todayLabels || [];
        const sessionEx = draft.sessionEx === null && !Object.keys(logData).length
            ? null
            : mergeDraftExercisesWithLogData(draft.sessionEx || [], logData, todayLabels);
        const meta = makeDraftMeta(draft.meta || {}, {
            exerciseNames: (sessionEx || []).map((exercise) => exercise.name),
            logDataNames: Object.keys(logData),
        });

        save(getDraftKey("draft_todayLabels", dateStr), todayLabels);
        save(getDraftKey("draft_logData", dateStr), logData);
        save(getDraftKey("draft_sessionEx", dateStr), sessionEx);
        save(getDraftKey("draft_exerciseUnits", dateStr), draft.exerciseUnits || {});
        save(getDraftKey("draft_meta", dateStr), meta);

        save("draft_todayLabels", todayLabels);
        save("draft_logData", logData);
        save("draft_sessionEx", sessionEx);
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
    const [historySyncReady, setHistorySyncReady] = useState(false);
    const [historyRemoteReady, setHistoryRemoteReady] = useState(false);
    const [historyLoadError, setHistoryLoadError] = useState("");
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

            saveDraftForDate(logDate, {
                todayLabels: next,
                logData,
                sessionEx,
                exerciseUnits,
                meta: makeDraftMeta(latestLogDraftRef.current?.meta || {}, {
                    source: "user_edit",
                    hasUnsavedChanges: true,
                }),
            });
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
    const [logMode, setLogMode] = useState("today");
    const [exerciseUnits, setExerciseUnits] = useState(() => loadDraftForDate(getTodayKey()).exerciseUnits);

    // eslint-disable-next-line no-unused-vars
    const { isDark, setIsDark, unit, setUnit, showOnboarding, completeOnboarding } = useSettings();
    const appThemeClassName = isDark ? "app-shell" : "theme-light app-shell";

    const getExUnit = useCallback((name) => {
        return exerciseUnits[name] ?? unit;
    }, [exerciseUnits, unit]);

    const pendingWorkoutContentChangeDatesRef = useRef(new Map());
    const explicitWorkoutEditDatesRef = useRef(new Map());

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
        latestLogDraftRef.current = normalizedDraft;
        setTodayLabels(normalizedDraft.todayLabels);
        setLogData(normalizedDraft.logData);
        setSessionEx(normalizedDraft.sessionEx);
        setExerciseUnits(normalizedDraft.exerciseUnits);
        return normalizedDraft;
    }, []);

    const applyCurrentLogDraft = useCallback((draft, { persist = true } = {}) => {
        const normalizedDraft = applyLogDraftState(draft);
        if (persist) saveDraftForDate(logDate, normalizedDraft);
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

            saveDraftForDate(logDate, nextDraft);
            latestLogDraftRef.current = nextDraft;

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
    }, [logDate, user?.id]);

    const {
        addSet,
        setField,
        setWeightMode,
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
    const historyRemoteLoadFailedRef = useRef(false);
    const workoutsDataHistoryRef = useRef(workoutsDataHistory);
    const displayHistoryRefreshRequestIdRef = useRef(0);
    const homeWeeklySummaryRequestIdRef = useRef(0);
    const historyHasTrustedRemoteSnapshotRef = useRef(false);
    const supabaseFetchInFlightRef = useRef(new Map());
    const supabaseFetchBackoffRef = useRef({});
    const supabaseFetchFreshUntilRef = useRef({});

    const markSupabaseFetchFresh = useCallback((key, ttlMs = 30000) => {
        if (!key) return;
        supabaseFetchFreshUntilRef.current[key] = Date.now() + ttlMs;
    }, []);

    const isSupabaseFetchFresh = useCallback((key) => {
        if (!key) return false;
        return Number(supabaseFetchFreshUntilRef.current[key] || 0) > Date.now();
    }, []);

    const runDedupeSupabaseFetch = useCallback(async (
        key,
        fetcher,
        {
            minIntervalMs = 15000,
            freshTtlMs = 30000,
            backoffMs = 30000,
            context = {},
        } = {}
    ) => {
        const now = Date.now();
        const nextAllowedAt = Number(supabaseFetchBackoffRef.current[key]?.nextAllowedAt || 0);

        const inFlightRequest = supabaseFetchInFlightRef.current.get(key);
        if (inFlightRequest) {
            console.warn("[supabase fetch] dedupe in-flight attach", {
                env: getRuntimeEnvironmentLabel(),
                key,
                applied: false,
                reason: "same request already in flight; waiting for shared result",
                ...context,
            });
            const sharedResult = await inFlightRequest;
            return {
                ...sharedResult,
                deduped: true,
                reason: sharedResult?.reason || "shared-in-flight",
            };
        }

        if (nextAllowedAt > now) {
            console.warn("[supabase fetch] backoff skip", {
                env: getRuntimeEnvironmentLabel(),
                key,
                applied: false,
                reason: "transient error backoff",
                retryAfterMs: nextAllowedAt - now,
                ...context,
            });
            return { skipped: true, reason: "backoff", retryAfterMs: nextAllowedAt - now };
        }

        if (isSupabaseFetchFresh(key)) {
            console.log("[supabase fetch] fresh skip", {
                env: getRuntimeEnvironmentLabel(),
                key,
                applied: false,
                reason: "fresh identical range already fetched",
                ...context,
            });
            return { skipped: true, reason: "fresh" };
        }

        const fetchName = context.fetchName || key;
        const startedAt = Date.now();
        const fetchPromise = (async () => {
            console.log(`[home fetch] ${fetchName} start`, {
                env: getRuntimeEnvironmentLabel(),
                key,
                user_id: context.user_id || context.userId || null,
                dateRange: context.dateRange || null,
                table: context.table || null,
                tables: context.tables || null,
            });
            const value = await fetcher();
            markSupabaseFetchFresh(key, freshTtlMs || minIntervalMs);
            delete supabaseFetchBackoffRef.current[key];
            const rowsCount =
                Array.isArray(value?.data)
                    ? value.data.length
                    : Object.entries(value || {}).reduce((acc, [name, result]) => {
                        if (Array.isArray(result?.data)) acc[name] = result.data.length;
                        return acc;
                    }, {});
            console.log(`[home fetch] ${fetchName} end`, {
                env: getRuntimeEnvironmentLabel(),
                key,
                durationMs: Date.now() - startedAt,
                rowsCount,
                skipped: false,
                applied: true,
                reason: "success",
                user_id: context.user_id || context.userId || null,
                dateRange: context.dateRange || null,
            });
            return { skipped: false, value, reason: "success" };
        })();

        supabaseFetchInFlightRef.current.set(key, fetchPromise);

        try {
            return await fetchPromise;
        } catch (error) {
            console.warn(`[home fetch] ${fetchName} failed`, {
                env: getRuntimeEnvironmentLabel(),
                key,
                durationMs: Date.now() - startedAt,
                user_id: context.user_id || context.userId || null,
                dateRange: context.dateRange || null,
                message: error?.message || String(error || "unknown error"),
                code: error?.code || null,
                status: error?.status || null,
            });
            if (isTransientSupabaseFetchError(error)) {
                const previousBackoffMs = Number(supabaseFetchBackoffRef.current[key]?.backoffMs || backoffMs);
                const nextBackoffMs = Math.min(Math.max(backoffMs, previousBackoffMs * 2), 120000);
                supabaseFetchBackoffRef.current[key] = {
                    nextAllowedAt: Date.now() + nextBackoffMs,
                    backoffMs: nextBackoffMs,
                };
                console.warn("[supabase fetch] transient error backoff set", {
                    env: getRuntimeEnvironmentLabel(),
                    key,
                    nextBackoffMs,
                    message: error?.message || String(error || "unknown error"),
                    code: error?.code || null,
                    status: error?.status || null,
                    ...context,
                });
            }
            throw error;
        } finally {
            if (supabaseFetchInFlightRef.current.get(key) === fetchPromise) {
                supabaseFetchInFlightRef.current.delete(key);
            }
        }
    }, [isSupabaseFetchFresh, markSupabaseFetchFresh]);
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
    const [focusedLogSetInputId, setFocusedLogSetInputId] = useState(null);
    const [isLogKeyboardOpen, setIsLogKeyboardOpen] = useState(false);
    const [logExerciseFocusRequest, setLogExerciseFocusRequest] = useState(null);
    const [lastActiveLogExerciseByDate, setLastActiveLogExerciseByDate] = useState(() =>
        load("lastActiveLogExerciseByDate", {})
    );
    const [focusedAiChatInput, setFocusedAiChatInput] = useState(false);
    const [isAiKeyboardOpen, setIsAiKeyboardOpen] = useState(false);
    const [historySyncDiagnostic, setHistorySyncDiagnostic] = useState({
        localHistoryDates: [],
        remoteWorkoutDates: [],
        sessionDates: [],
        missingFromRemoteWorkouts: [],
        missingFromWorkoutSessions: [],
        syncFailedDates: [],
        lastSyncErrorByDate: {},
    });

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
    }, [history]);

    useEffect(() => {
        workoutsDataHistoryRef.current = workoutsDataHistory;
    }, [workoutsDataHistory]);

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
        if (normalizedDate !== getTodayKey()) return;

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
    }, [applyWorkoutTimerState, getTodayKey]);

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
                const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
                const sessionsRes = await supabase
                    .from("workout_sessions")
                    .select("workout_date, duration_sec")
                    .eq("user_id", user.id)
                    .gte("workout_date", fourteenDaysAgo);

                if (sessionsRes.error) throw sessionsRes.error;

                const map = {};
                (sessionsRes.data || []).forEach(({ workout_date, duration_sec }) => {
                    const sec = Math.floor(Number(duration_sec));
                    if (workout_date && sec > 0 && sec < 86400) {
                        map[workout_date] = Math.max(map[workout_date] || 0, sec);
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
        const normalizedDate = String(date || "").slice(0, 10);
        if (!normalizedDate) return;
        pendingWorkoutSessionSyncDatesRef.current.add(normalizedDate);
    }, []);

    const markWorkoutContentChanged = useCallback((date, reason = "content_change", options = {}) => {
        const normalizedDate = String(date || "").slice(0, 10);
        if (!normalizedDate) return;

        const previous = pendingWorkoutContentChangeDatesRef.current.get(normalizedDate) || {};
        const explicitEdit = Boolean(previous.explicitEdit || options.explicitEdit || EXPLICIT_WORKOUT_EDIT_REASONS.has(reason));
        pendingWorkoutContentChangeDatesRef.current.set(normalizedDate, {
            ...previous,
            reason,
            explicitDelete: Boolean(previous.explicitDelete || options.explicitDelete),
            explicitEdit,
            details: options.details || previous.details || null,
            updatedAt: new Date().toISOString(),
        });
        if (explicitEdit) {
            explicitWorkoutEditDatesRef.current.set(normalizedDate, {
                reason,
                updatedAt: Date.now(),
            });
        }
        if (EXPLICIT_SET_EDIT_REASONS.has(reason)) {
            console.log("[workout edit] explicit set edit", {
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || latestUserIdRef.current || null,
                date: normalizedDate,
                exerciseName: options.details?.exerciseName || null,
                setIndex: options.details?.setIndex ?? null,
                before: options.details?.beforeSet || null,
                after: options.details?.afterSet || null,
                saveReason: reason,
                explicitEdit: true,
            });
        }
        queueWorkoutSessionSync(normalizedDate);
    }, [queueWorkoutSessionSync, user?.id]);

    const recordSyncFailure = useCallback((workoutDate, error, stage) => {
        const normalizedDate = String(workoutDate || "").slice(0, 10);
        if (!normalizedDate) return;
        const normalizedStage = String(stage || "").trim() || "unknown";

        console.error("[sync] workout date sync failure tracked", {
            workoutDate: normalizedDate,
            stage: normalizedStage,
            error,
            message: error?.message || String(error || "unknown error"),
            code: error?.code || null,
            details: error?.details || null,
            hint: error?.hint || null,
        });

        syncFailuresByDateRef.current = {
            ...syncFailuresByDateRef.current,
            [normalizedDate]: {
                stage: normalizedStage,
                message: error?.message || String(error || "unknown error"),
                code: error?.code || null,
                details: error?.details || null,
                hint: error?.hint || null,
                createdAt: syncFailuresByDateRef.current[normalizedDate]?.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
        };
        setSyncFailuresByDate(syncFailuresByDateRef.current);
    }, []);

    const clearSyncFailure = useCallback((workoutDate) => {
        const normalizedDate = String(workoutDate || "").slice(0, 10);
        if (!normalizedDate || !syncFailuresByDateRef.current[normalizedDate]) return;
        const nextFailures = { ...syncFailuresByDateRef.current };
        delete nextFailures[normalizedDate];
        syncFailuresByDateRef.current = nextFailures;
        setSyncFailuresByDate(nextFailures);
    }, []);

    const fetchRemoteWorkoutRowsForDates = useCallback(async (userId, dates = []) => {
        const normalizedDates = [...new Set(
            (dates || [])
                .map((date) => String(date || "").slice(0, 10))
                .filter(Boolean)
        )];

        if (!userId || !normalizedDates.length) return [];

        const { data, error } = await supabase
            .from("workouts")
            .select("date, data")
            .eq("user_id", userId)
            .in("date", normalizedDates);

        if (error) throw error;
        return data || [];
    }, []);

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
    }, [getSyncFailureSignature]);

    const syncWorkoutRowsForDates = useCallback(async (userId, historyMap, dates = []) => {
        const normalizedDates = [...new Set((dates || []).map((date) => String(date || "").slice(0, 10)).filter(Boolean))];
        const normalizedHistoryMap = mergeHistoryMaps(historyMap || {});
        const results = {
            syncedDates: [],
            failedDates: [],
            skippedDates: [],
            verifiedHistoryByDate: {},
        };

        if (!userId || !normalizedDates.length) return results;

        await Promise.all(
            normalizedDates.map(async (workoutDate) => {
                try {
                    const hasWorkoutForDate = hasValidWorkoutOnDate(normalizedHistoryMap, workoutDate);
                    const incomingMetrics = getHistoryMetricsForDate(normalizedHistoryMap, workoutDate);
                    const { data: existingWorkoutRow, error: existingWorkoutError } = await supabase
                        .from("workouts")
                        .select("date, data")
                        .eq("user_id", userId)
                        .eq("date", workoutDate)
                        .maybeSingle();

                    if (existingWorkoutError) throw existingWorkoutError;

                    const remoteMetrics = existingWorkoutRow
                        ? getHistoryMetricsForDate(existingWorkoutRow.data || {}, workoutDate, {
                            updatedAt: null,
                        })
                        : getEmptyWorkoutMetrics();
                    const pendingChange = pendingWorkoutContentChangeDatesRef.current.get(workoutDate) || {};
                    const explicitEdit = isExplicitWorkoutEditChange(pendingChange);
                    if (!hasWorkoutForDate && !pendingChange.explicitDelete) {
                        console.warn("[save guard] skip empty workout delete without explicit delete intent", {
                            env: getRuntimeEnvironmentLabel(),
                            user_id: userId,
                            date: workoutDate,
                            localMetrics: incomingMetrics,
                            remoteMetrics,
                            reason: pendingChange.reason || "missing local workout data",
                            explicitDelete: false,
                            safety: "avoid deleting Supabase data when history failed to load",
                        });
                        results.skippedDates.push(workoutDate);
                        return;
                    }
                    const wouldDestructivelyOverwrite = isDestructiveWorkoutRegression(incomingMetrics, remoteMetrics, {
                        allowVolumeDecrease: explicitEdit,
                    });
                    const allowDestructiveSave = Boolean(pendingChange.explicitDelete);

                    logWorkoutPersistenceDecision({
                        action: "workouts_sync_check",
                        userId,
                        date: workoutDate,
                        localMetrics: incomingMetrics,
                        remoteMetrics,
                        reason: wouldDestructivelyOverwrite
                            ? allowDestructiveSave
                                ? `allowed explicit delete: ${pendingChange.reason || "delete"}`
                                : "blocked: local workout is smaller than remote"
                            : explicitEdit && incomingMetrics.volume + 0.01 < remoteMetrics.volume
                                ? `allowed explicit edit volume decrease: ${pendingChange.reason || "content_change"}`
                            : hasWorkoutForDate
                                ? `allowed content edit: ${pendingChange.reason || "unknown"}`
                                : "allowed: no local workout for date",
                        level: wouldDestructivelyOverwrite && !allowDestructiveSave ? "warn" : "log",
                    });
                    const dateScopedHistoryForSave = applyPreferredHistoryDates({}, normalizedHistoryMap, [workoutDate]);

                    console.log("[save] workouts.data before save", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: userId,
                        date: workoutDate,
                        saving: getHistoryDebugSummaryForDate(dateScopedHistoryForSave, workoutDate),
                        remote: existingWorkoutRow
                            ? getHistoryDebugSummaryForDate(existingWorkoutRow.data || {}, workoutDate)
                            : getHistoryDebugSummaryForDate({}, workoutDate),
                        diffFromRemote: getHistoryDebugDiffForDate(existingWorkoutRow?.data || {}, dateScopedHistoryForSave, workoutDate),
                    });

                    if (wouldDestructivelyOverwrite && !allowDestructiveSave) {
                        console.warn("[save guard] local workout is smaller than remote. Skip overwrite.", {
                            env: getRuntimeEnvironmentLabel(),
                            user_id: userId,
                            date: workoutDate,
                            supabase: remoteMetrics,
                            localStorage: incomingMetrics,
                            savingExerciseNames: incomingMetrics.exerciseNames,
                            reason: pendingChange.reason || "unknown",
                        });
                        results.skippedDates.push(workoutDate);
                        return;
                    }
                    if (EXPLICIT_SET_EDIT_REASONS.has(pendingChange.reason)) {
                        console.log("[workout edit] workouts.data save decision", {
                            env: getRuntimeEnvironmentLabel(),
                            user_id: userId,
                            date: workoutDate,
                            exerciseName: pendingChange.details?.exerciseName || null,
                            setIndex: pendingChange.details?.setIndex ?? null,
                            before: pendingChange.details?.beforeSet || null,
                            after: pendingChange.details?.afterSet || null,
                            saveReason: pendingChange.reason,
                            explicitEdit: Boolean(pendingChange.explicitEdit),
                            allowed: true,
                            blockedReason: null,
                            workoutsDataUpdated: false,
                            summaryJsonUpdated: false,
                        });
                    }

                    const { error } = hasWorkoutForDate
                        ? await supabase
                            .from("workouts")
                            .upsert({
                                user_id: userId,
                                date: workoutDate,
                                data: dateScopedHistoryForSave,
                            }, {
                                onConflict: "user_id,date",
                            })
                        : await supabase
                            .from("workouts")
                            .delete()
                            .eq("user_id", userId)
                            .eq("date", workoutDate);

                    if (error) throw error;

                    const { data: verifyWorkoutRow, error: verifyWorkoutError } = await supabase
                        .from("workouts")
                        .select("date, data")
                        .eq("user_id", userId)
                        .eq("date", workoutDate)
                        .maybeSingle();

                    if (verifyWorkoutError) {
                        logRecordFetchError("workouts_post_save_verify", "workouts", verifyWorkoutError, {
                            userId,
                            workoutDate,
                            query: "workouts.select(date,data).eq(user_id).eq(date).maybeSingle",
                            responseData: verifyWorkoutRow,
                        });
                        throw verifyWorkoutError;
                    }

                    const verifiedMetrics = verifyWorkoutRow
                        ? getHistoryMetricsForDate(verifyWorkoutRow.data || {}, workoutDate, {
                            updatedAt: null,
                        })
                        : getEmptyWorkoutMetrics();
                    if (isMetricPersistenceMismatch(incomingMetrics, verifiedMetrics)) {
                        console.error("[save verify] workouts.data mismatch after save", {
                            env: getRuntimeEnvironmentLabel(),
                            user_id: userId,
                            date: workoutDate,
                            expected: incomingMetrics,
                            actual: verifiedMetrics,
                            savingExerciseNames: incomingMetrics.exerciseNames,
                        });
                        throw new Error(`workouts.data verification failed for ${workoutDate}`);
                    }
                    if (EXPLICIT_SET_EDIT_REASONS.has(pendingChange.reason)) {
                        const expectedSet = pendingChange.details?.afterSet || null;
                        const actualSet = findEditedSetInHistory(
                            verifyWorkoutRow?.data || {},
                            workoutDate,
                            pendingChange.details?.exerciseName,
                            pendingChange.details?.setIndex
                        );
                        const persisted = isEditedSetPersisted(expectedSet, actualSet);
                        if (!persisted) {
                            console.error("[save verify] workouts.data explicit set edit mismatch after save", {
                                env: getRuntimeEnvironmentLabel(),
                                user_id: userId,
                                date: workoutDate,
                                exerciseName: pendingChange.details?.exerciseName || null,
                                setIndex: pendingChange.details?.setIndex ?? null,
                                saveReason: pendingChange.reason,
                                expected: getSetEditSummary(expectedSet),
                                actual: actualSet ? getSetEditSummary(actualSet, getSetEditUnit(expectedSet)) : null,
                                workoutsDataAfterSave: verifyWorkoutRow
                                    ? getHistoryDebugSummaryForDate(verifyWorkoutRow.data || {}, workoutDate)
                                    : getHistoryDebugSummaryForDate({}, workoutDate),
                            });
                            throw new Error(`workouts.data explicit set edit verification failed for ${workoutDate}`);
                        }
                    }
                    console.log("[save] workouts.data after save verified", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: userId,
                        date: workoutDate,
                        workoutsDataAfterSave: verifyWorkoutRow
                            ? getHistoryDebugSummaryForDate(verifyWorkoutRow.data || {}, workoutDate)
                            : getHistoryDebugSummaryForDate({}, workoutDate),
                        diffSavedVsVerified: getHistoryDebugDiffForDate(normalizedHistoryMap, verifyWorkoutRow?.data || {}, workoutDate),
                    });
                    results.verifiedHistoryByDate[workoutDate] = verifyWorkoutRow?.data
                        ? applyPreferredHistoryDates({}, verifyWorkoutRow.data, [workoutDate])
                        : {};
                    if (EXPLICIT_SET_EDIT_REASONS.has(pendingChange.reason)) {
                        console.log("[workout edit] workouts.data after save", {
                            env: getRuntimeEnvironmentLabel(),
                            user_id: userId,
                            date: workoutDate,
                            exerciseName: pendingChange.details?.exerciseName || null,
                            setIndex: pendingChange.details?.setIndex ?? null,
                            saveReason: pendingChange.reason,
                            workoutsDataUpdated: true,
                            summaryJsonUpdated: false,
                            workoutsDataAfterSave: verifyWorkoutRow
                                ? getHistoryDebugSummaryForDate(verifyWorkoutRow.data || {}, workoutDate)
                                : getHistoryDebugSummaryForDate({}, workoutDate),
                        });
                    }

                    clearSyncFailure(workoutDate);
                    results.syncedDates.push(workoutDate);
                } catch (error) {
                    recordSyncFailure(workoutDate, error, "workouts");
                    console.error("workout remote sync failed", {
                        error,
                        message: error?.message,
                        code: error?.code,
                        details: error?.details,
                        hint: error?.hint,
                        userId,
                        workoutDate,
                        records: describeHistoryRecordsForDate(normalizedHistoryMap, workoutDate),
                    });
                    results.failedDates.push(workoutDate);
                }
            })
        );

        return results;
    }, [clearSyncFailure, recordSyncFailure]);

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

            const rangeStart = prefix ? `${prefix}-01` : getDateDaysAgoKey(DIAGNOSTIC_LOOKBACK_DAYS);
            const rangeEndPrefix = prefix ? getNextMonthPrefix(prefix) : "";
            let workoutsQuery = supabase
                .from("workouts")
                .select("date")
                .eq("user_id", userId)
                .gte("date", rangeStart)
                .order("date", { ascending: true });
            let sessionsQuery = supabase
                .from("workout_sessions")
                .select("workout_date")
                .eq("user_id", userId)
                .gte("workout_date", rangeStart)
                .order("workout_date", { ascending: true });

            if (rangeEndPrefix) {
                workoutsQuery = workoutsQuery.lt("date", `${rangeEndPrefix}-01`);
                sessionsQuery = sessionsQuery.lt("workout_date", `${rangeEndPrefix}-01`);
            }

            const diagnosticFetchKey = `history_sync_diagnostic:${userId}:${rangeStart}:${rangeEndPrefix || "open"}`;
            const diagnosticFetch = await runDedupeSupabaseFetch(
                diagnosticFetchKey,
                async () => {
                    const [remoteWorkoutsRes, remoteSessionsRes] = await Promise.all([
                        workoutsQuery.limit(120),
                        sessionsQuery.limit(120),
                    ]);
                    if (remoteWorkoutsRes.error) {
                        logRecordFetchError("history_sync_diagnostic", "workouts", remoteWorkoutsRes.error, {
                            userId,
                            dateRange: { from: rangeStart, toBefore: rangeEndPrefix ? `${rangeEndPrefix}-01` : null },
                        });
                        throw remoteWorkoutsRes.error;
                    }
                    if (remoteSessionsRes.error) {
                        logRecordFetchError("history_sync_diagnostic", "workout_sessions", remoteSessionsRes.error, {
                            userId,
                            dateRange: { from: rangeStart, toBefore: rangeEndPrefix ? `${rangeEndPrefix}-01` : null },
                        });
                        throw remoteSessionsRes.error;
                    }
                    return { remoteWorkoutsRes, remoteSessionsRes };
                },
                {
                    minIntervalMs: 60000,
                    freshTtlMs: 90000,
                    backoffMs: 60000,
                    context: {
                        fetchName: "history_sync_diagnostic",
                        user_id: userId,
                        dateRange: { from: rangeStart, toBefore: rangeEndPrefix ? `${rangeEndPrefix}-01` : null },
                        tables: ["workouts", "workout_sessions"],
                    },
                }
            );

            if (diagnosticFetch.skipped) return;

            const { remoteWorkoutsRes, remoteSessionsRes } = diagnosticFetch.value;

            const remoteWorkoutDates = [...new Set(
                (remoteWorkoutsRes.data || [])
                    .map((row) => String(row?.date || "").slice(0, 10))
                    .filter((date) => !prefix || date.startsWith(prefix))
            )].sort();
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
                details: error?.details,
                hint: error?.hint,
                userId,
                prefix,
            });
        }
    }, [runDedupeSupabaseFetch]);

    const syncWorkoutSessionSnapshot = useCallback(async (userId, historyMap, workoutDate, timing = null) => {
        const normalizedDate = String(workoutDate || "").slice(0, 10);
        if (!userId || !normalizedDate) return;

        const payload = buildWorkoutSessionPayloadFromHistory(historyMap, normalizedDate);
        const { data: existingSession, error: existingSessionError } = await supabase
            .from("workout_sessions")
            .select("id, started_at, ended_at, duration_sec, total_volume, exercise_count, summary_json")
            .eq("user_id", userId)
            .eq("workout_date", normalizedDate)
            .maybeSingle();

        if (existingSessionError) throw existingSessionError;

        const incomingMetrics = getWorkoutPayloadMetrics(payload);
        const remoteMetrics = existingSession
            ? getWorkoutSummaryMetrics(existingSession.summary_json, {
                totalVolume: existingSession.total_volume,
                exerciseCount: existingSession.exercise_count,
                updatedAt: null,
            })
            : getEmptyWorkoutMetrics();
        const pendingChange = pendingWorkoutContentChangeDatesRef.current.get(normalizedDate) || {};
        const explicitEdit = isExplicitWorkoutEditChange(pendingChange);
        const wouldDestructivelyOverwrite = isDestructiveWorkoutRegression(incomingMetrics, remoteMetrics, {
            allowVolumeDecrease: explicitEdit,
        });
        const allowDestructiveSave = Boolean(pendingChange.explicitDelete);

        logWorkoutPersistenceDecision({
            action: "workout_sessions_sync_check",
            userId,
            date: normalizedDate,
            localMetrics: incomingMetrics,
            remoteMetrics,
            reason: wouldDestructivelyOverwrite
                ? allowDestructiveSave
                    ? `allowed explicit delete: ${pendingChange.reason || "delete"}`
                    : "blocked: local session is smaller than remote"
                : explicitEdit && incomingMetrics.volume + 0.01 < remoteMetrics.volume
                    ? `allowed explicit edit volume decrease: ${pendingChange.reason || "content_change"}`
                : payload
                    ? `allowed content edit: ${pendingChange.reason || "unknown"}`
                    : "allowed: no local payload",
            level: wouldDestructivelyOverwrite && !allowDestructiveSave ? "warn" : "log",
        });
        console.log("[save] workout_sessions.summary_json before save", {
            env: getRuntimeEnvironmentLabel(),
            user_id: userId,
            date: normalizedDate,
            savingExerciseNames: payload?.session?.summary_json?.items?.map((item) => item.exercise_name) || [],
            savingBodyPartNames: [...new Set((payload?.session?.summary_json?.items || []).map((item) => item.body_part).filter(Boolean))],
            savingSetCountByExercise: (payload?.session?.summary_json?.items || []).reduce((acc, item) => {
                acc[item.exercise_name] = item.set_count || 0;
                return acc;
            }, {}),
            savingMetrics: incomingMetrics,
            remoteMetrics,
        });

        if (wouldDestructivelyOverwrite && !allowDestructiveSave) {
            console.warn("[save guard] local workout is smaller than remote. Skip overwrite.", {
                env: getRuntimeEnvironmentLabel(),
                user_id: userId,
                date: normalizedDate,
                supabase: remoteMetrics,
                localStorage: incomingMetrics,
                savingExerciseNames: incomingMetrics.exerciseNames,
                reason: pendingChange.reason || "unknown",
            });
            return { skipped: true };
        }
        if (EXPLICIT_SET_EDIT_REASONS.has(pendingChange.reason)) {
            console.log("[workout edit] workout_sessions.summary_json save decision", {
                env: getRuntimeEnvironmentLabel(),
                user_id: userId,
                date: normalizedDate,
                exerciseName: pendingChange.details?.exerciseName || null,
                setIndex: pendingChange.details?.setIndex ?? null,
                before: pendingChange.details?.beforeSet || null,
                after: pendingChange.details?.afterSet || null,
                saveReason: pendingChange.reason,
                explicitEdit: Boolean(pendingChange.explicitEdit),
                allowed: true,
                blockedReason: null,
                workoutsDataUpdated: null,
                summaryJsonUpdated: false,
            });
        }

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
            return { deleted: true };
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

        const shouldUpdateTiming = normalizedDate === getTodayKey() && timing;
        const startedAt = shouldUpdateTiming
            ? (timing.startedAtIso || existingSession?.started_at || new Date().toISOString())
            : (existingSession?.started_at || null);
        const endedAt = shouldUpdateTiming
            ? (timing.endedAtIso || existingSession?.ended_at || new Date().toISOString())
            : (existingSession?.ended_at || null);
        const existingDurationSec = Number.isFinite(Number(existingSession?.duration_sec)) && Number(existingSession?.duration_sec) > 0 && Number(existingSession?.duration_sec) < 86400
            ? Math.floor(Number(existingSession.duration_sec))
            : 0;
        const payloadDurationSec = Number.isFinite(Number(payload.session?.duration_sec)) && Number(payload.session.duration_sec) > 0 && Number(payload.session.duration_sec) < 86400
            ? Math.floor(Number(payload.session.duration_sec))
            : 0;
        const durationSec = shouldUpdateTiming && Number.isFinite(timing?.durationSec)
            ? Math.max(0, Math.floor(timing.durationSec))
            : (existingDurationSec || payloadDurationSec);

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

        const { data: verifiedSession, error: verifySessionError } = await supabase
            .from("workout_sessions")
            .select("workout_date, duration_sec, total_volume, exercise_count, summary_json")
            .eq("user_id", userId)
            .eq("workout_date", normalizedDate)
            .maybeSingle();

        if (verifySessionError) {
            logRecordFetchError("workout_sessions_post_save_verify", "workout_sessions", verifySessionError, {
                userId,
                workoutDate: normalizedDate,
                query: "workout_sessions.select(workout_date,duration_sec,total_volume,exercise_count,summary_json).eq(user_id).eq(workout_date).maybeSingle",
                responseData: verifiedSession,
            });
            throw verifySessionError;
        }

        const verifiedMetrics = verifiedSession
            ? getWorkoutSummaryMetrics(verifiedSession.summary_json, {
                totalVolume: verifiedSession.total_volume,
                exerciseCount: verifiedSession.exercise_count,
                updatedAt: null,
            })
            : getEmptyWorkoutMetrics();
        if (isMetricPersistenceMismatch(incomingMetrics, verifiedMetrics)) {
            console.error("[save verify] workout_sessions.summary_json mismatch after save", {
                env: getRuntimeEnvironmentLabel(),
                user_id: userId,
                date: normalizedDate,
                expected: incomingMetrics,
                actual: verifiedMetrics,
                savingExerciseNames: incomingMetrics.exerciseNames,
            });
            throw new Error(`workout_sessions verification failed for ${normalizedDate}`);
        }
        // workout_sessions.summary_jsonはセット詳細を持たないため、セットレベルの検証はスキップ
        console.log("[save] workout_sessions.summary_json after save verified", {
            env: getRuntimeEnvironmentLabel(),
            user_id: userId,
            date: normalizedDate,
            summaryJsonAfterSaveExerciseNames: verifiedSession?.summary_json?.items?.map((item) => item.exercise_name) || [],
            summaryJsonAfterSaveBodyPartNames: [...new Set((verifiedSession?.summary_json?.items || []).map((item) => item.body_part).filter(Boolean))],
            summaryJsonAfterSaveSetCountByExercise: (verifiedSession?.summary_json?.items || []).reduce((acc, item) => {
                acc[item.exercise_name] = item.set_count || 0;
                return acc;
            }, {}),
            summaryJsonAfterSaveMetrics: verifiedMetrics,
            diffHistoryVsSummaryJson: getHistoryDebugDiffForDate(
                historyMap,
                buildHistoryFromWorkoutSessionRows(verifiedSession ? [verifiedSession] : []),
                normalizedDate
            ),
        });
        if (EXPLICIT_SET_EDIT_REASONS.has(pendingChange.reason)) {
            console.log("[workout edit] summary_json after save", {
                env: getRuntimeEnvironmentLabel(),
                user_id: userId,
                date: normalizedDate,
                exerciseName: pendingChange.details?.exerciseName || null,
                setIndex: pendingChange.details?.setIndex ?? null,
                saveReason: pendingChange.reason,
                workoutsDataUpdated: null,
                summaryJsonUpdated: true,
                summaryJsonAfterSave: verifiedSession?.summary_json || null,
            });
        }

        return { synced: true };
    }, [getTodayKey]);

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
                        const wouldDestructivelyOverwrite = isDestructiveWorkoutRegression(localMetrics, remoteMetrics, {
                            allowVolumeDecrease: explicitEdit,
                        });
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
                            blockedReason: retryAllowed ? null : "local workout is smaller than remote",
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
                        workoutsDataHistoryRef.current = applyPreferredHistoryDates(
                            workoutsDataHistoryRef.current || {},
                            retryHistory,
                            [date]
                        );
                        setWorkoutsDataHistory(workoutsDataHistoryRef.current);
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
        buildLatestLocalHistoryForRetryDate,
        clearSyncFailure,
        deleteRemoteWorkoutArtifactsForDate,
        fetchRemoteWorkoutRowsForDates,
        hasRemoteWorkoutForDate,
        history,
        recordSyncFailure,
        refreshHistorySyncDiagnostic,
        saveDraftForDate,
        savedWorkoutDurationSecByDate,
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
    }, [authReady, history, historyRemoteReady, historySyncReady, user]);
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

    useEffect(() => {
        let isActive = true;

        const syncHistoryFromSupabase = async () => {
            if (!user?.id) {
                historyRemoteLoadFailedRef.current = false;
                historyHasTrustedRemoteSnapshotRef.current = false;
                historyDeleteMarkersRef.current = createEmptyHistoryDeleteMarkers();
                if (isActive) setHistoryLoadError("");
                if (isActive) setHistoryRemoteReady(false);
                if (isActive) setHistorySyncReady(true);
                return;
            }

            if (isActive) {
                const currentDisplayedMetrics = getHistoryOverallMetrics(latestHistoryRef.current || {});
                const currentWorkoutsDataMetrics = getHistoryOverallMetrics(workoutsDataHistoryRef.current || {});
                const hasCurrentTrustedDisplay =
                    currentDisplayedMetrics.setCount > 0 ||
                    currentWorkoutsDataMetrics.setCount > 0;
                setHistorySyncReady(false);
                setHistoryRemoteReady(hasCurrentTrustedDisplay);
                setHistoryLoadError("");
                if (!historyHasTrustedRemoteSnapshotRef.current) {
                    console.log("[restore] ignore localStorage bootstrap until Supabase history load succeeds", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        currentDisplayed: currentDisplayedMetrics,
                        currentWorkoutsDataDisplayed: currentWorkoutsDataMetrics,
                        historyRemoteReady: hasCurrentTrustedDisplay,
                        cachedHistory: getHistoryOverallMetrics(
                            loadTrustedHistoryCache(getUserHistoryCacheKey(user.id), loadTrustedHistoryCache("history", {}))
                        ),
                    });
                    if (!hasCurrentTrustedDisplay) {
                        setHistory({});
                        workoutsDataHistoryRef.current = {};
                        setWorkoutsDataHistory({});
                    }
                }
            }

            const rawLocalHistory = loadTrustedHistoryCache("history", {});
            const localOwnerUserId = load(HISTORY_OWNER_KEY, null);
            const scopedLocalHistory = loadTrustedHistoryCache(getUserHistoryCacheKey(user.id), null);
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
                save(getUserHistoryCacheKey(localOwnerUserId), buildVersionedHistoryCache(rawLocalHistory));
            }

            const effectiveDeleteMarkers = getCurrentHistoryDeleteMarkers();

            try {
                const sessionRangeStart = getDateDaysAgoKey(INITIAL_HOME_HISTORY_LOOKBACK_DAYS);
                const initialHistoryLimit = INITIAL_HOME_HISTORY_LIMIT;
                const initialFetchKey = `history_initial_load:${user.id}:${sessionRangeStart}:${initialHistoryLimit}`;
                const initialFetch = await runDedupeSupabaseFetch(
                    initialFetchKey,
                    async () => {
                        const initialWeekRange = getCurrentWeekRangeForHomeSummary();
                        const workoutsRes = await supabase
                            .from("workouts")
                            .select("date, data")
                            .eq("user_id", user.id)
                            .gte("date", sessionRangeStart)
                            .order("date", { ascending: true })
                            .limit(initialHistoryLimit);
                        if (workoutsRes.error) {
                            const context = logRecordFetchError("history_initial_load", "workouts", workoutsRes.error, {
                                userId: user.id,
                                dateRange: { from: sessionRangeStart, limit: initialHistoryLimit },
                                query: "workouts.select(date,data).eq(user_id).gte(date).order(date asc).limit",
                                responseData: workoutsRes.data,
                            });
                            throw attachRecordFetchContext(workoutsRes.error, context);
                        }
                        const weekWorkoutsRes = await supabase
                            .from("workouts")
                            .select("date, data")
                            .eq("user_id", user.id)
                            .gte("date", initialWeekRange.start)
                            .lte("date", initialWeekRange.end)
                            .order("date", { ascending: true });
                        if (weekWorkoutsRes.error) {
                            const context = logRecordFetchError("history_initial_load_week", "workouts", weekWorkoutsRes.error, {
                                userId: user.id,
                                dateRange: { from: initialWeekRange.start, to: initialWeekRange.end },
                                query: "workouts.select(date,data).eq(user_id).gte(date).lte(date).order(date asc)",
                                responseData: weekWorkoutsRes.data,
                            });
                            throw attachRecordFetchContext(weekWorkoutsRes.error, context);
                        }
                        const combinedWorkoutRows = [
                            ...(workoutsRes.data || []),
                            ...(weekWorkoutsRes.data || []),
                        ].sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")));
                        return {
                            workoutsRes: {
                                ...workoutsRes,
                                data: combinedWorkoutRows,
                                initialRowsCount: workoutsRes.data?.length || 0,
                                weekRowsCount: weekWorkoutsRes.data?.length || 0,
                                weekRange: initialWeekRange,
                            },
                            sessionsRes: {
                                data: [],
                                error: null,
                                skipped: true,
                                skippedReason: "home initial load uses workouts.data only",
                            },
                        };
                    },
                    {
                        minIntervalMs: 20000,
                        freshTtlMs: 45000,
                        backoffMs: 30000,
                        context: {
                            fetchName: "history_initial_load",
                            user_id: user.id,
                            dateRange: {
                                from: sessionRangeStart,
                                limit: initialHistoryLimit,
                                week: getCurrentWeekRangeForHomeSummary(),
                            },
                            tables: ["workouts"],
                        },
                    }
                );

                if (initialFetch.skipped) {
                    const currentDisplayed = latestHistoryRef.current || {};
                    const currentWorkoutsData = workoutsDataHistoryRef.current || {};
                    const currentDisplayedMetrics = getHistoryOverallMetrics(currentDisplayed);
                    const currentWorkoutsDataMetrics = getHistoryOverallMetrics(currentWorkoutsData);
                    const hasCurrentTrustedDisplay =
                        currentDisplayedMetrics.setCount > 0 ||
                        currentWorkoutsDataMetrics.setCount > 0;
                    console.warn("[restore] history initial load skipped by fetch guard", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        dateRange: { from: sessionRangeStart, limit: initialHistoryLimit },
                        reason: initialFetch.reason,
                        fallbackUsed: false,
                        currentDisplayed: currentDisplayedMetrics,
                        currentWorkoutsDataDisplayed: currentWorkoutsDataMetrics,
                        historyRemoteReady: hasCurrentTrustedDisplay,
                        remoteLoadFailed: historyRemoteLoadFailedRef.current,
                    });
                    if (isActive && hasCurrentTrustedDisplay) {
                        historyRemoteLoadFailedRef.current = false;
                        historyHasTrustedRemoteSnapshotRef.current = true;
                        setHistoryRemoteReady(true);
                        setHistoryLoadError("");
                    }
                    return;
                }

                let { workoutsRes, sessionsRes } = initialFetch.value;

                if (sessionsRes.error) {
                    logRecordFetchError("history_initial_load", "workout_sessions", sessionsRes.error, {
                        userId: user.id,
                        dateRange: { from: sessionRangeStart, limit: initialHistoryLimit },
                        query: "workout_sessions.select(workout_date,duration_sec,summary_json).eq(user_id).gte(workout_date).order(workout_date asc).limit",
                        responseData: sessionsRes.data,
                    });
                    console.warn("[records] workout_sessions history load failed; continuing with workouts data", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        table: "workout_sessions",
                        query: "workout_sessions.select(workout_date,duration_sec,summary_json).eq(user_id).gte(workout_date).order(workout_date asc).limit",
                        code: sessionsRes.error?.code,
                        message: sessionsRes.error?.message,
                        details: sessionsRes.error?.details,
                        hint: sessionsRes.error?.hint,
                        responseData: sessionsRes.data,
                    });
                }

                console.log("[restore] history initial load response", {
                    env: getRuntimeEnvironmentLabel(),
                    fetchName: "history_initial_load",
                    user_id: user.id,
                    dateRange: { from: sessionRangeStart, limit: initialHistoryLimit },
                    initialRowsCount: workoutsRes.initialRowsCount ?? null,
                    weekRowsCount: workoutsRes.weekRowsCount ?? null,
                    weekRange: workoutsRes.weekRange || null,
                    workouts: getWorkoutRowsDebugSummary(workoutsRes.data || []),
                    workout_sessions: sessionsRes.error
                        ? { rowCount: 0, error: sessionsRes.error?.message || String(sessionsRes.error) }
                        : sessionsRes.skipped
                            ? { rowCount: 0, skipped: true, reason: sessionsRes.skippedReason }
                            : getWorkoutSessionRowsDebugSummary(sessionsRes.data || []),
                    error: {
                        workouts: workoutsRes.error?.message || null,
                        workout_sessions: sessionsRes.error?.message || null,
                    },
                });

                if (!(workoutsRes.data || []).length && !(sessionsRes.error ? [] : (sessionsRes.data || [])).length) {
                    const recoveryFetchKey = `history_recovery_latest:${user.id}:${HISTORY_RECOVERY_LIMIT}`;
                    const recoveryFetch = await runDedupeSupabaseFetch(
                        recoveryFetchKey,
                        async () => {
                            const [recoveryWorkoutsRes, recoverySessionsRes] = await Promise.all([
                                supabase
                                    .from("workouts")
                                    .select("date, data")
                                    .eq("user_id", user.id)
                                    .order("date", { ascending: false })
                                    .limit(HISTORY_RECOVERY_LIMIT),
                                supabase
                                    .from("workout_sessions")
                                    .select("workout_date, duration_sec, total_volume, exercise_count, summary_json")
                                    .eq("user_id", user.id)
                                    .order("workout_date", { ascending: false })
                                    .limit(HISTORY_RECOVERY_LIMIT),
                            ]);

                            if (recoveryWorkoutsRes.error) {
                                const context = logRecordFetchError("history_recovery_latest", "workouts", recoveryWorkoutsRes.error, {
                                    userId: user.id,
                                    dateRange: { latest: true, limit: HISTORY_RECOVERY_LIMIT },
                                    query: "workouts.select(date,data).eq(user_id).order(date desc).limit",
                                    responseData: recoveryWorkoutsRes.data,
                                });
                                throw attachRecordFetchContext(recoveryWorkoutsRes.error, context);
                            }

                            return {
                                workoutsRes: {
                                    ...recoveryWorkoutsRes,
                                    data: [...(recoveryWorkoutsRes.data || [])].reverse(),
                                },
                                sessionsRes: {
                                    ...recoverySessionsRes,
                                    data: [...(recoverySessionsRes.data || [])].reverse(),
                                },
                            };
                        },
                        {
                            minIntervalMs: 20000,
                            freshTtlMs: 45000,
                            backoffMs: 30000,
                            context: {
                                fetchName: "history_recovery_latest",
                                user_id: user.id,
                                dateRange: { latest: true, limit: HISTORY_RECOVERY_LIMIT },
                                tables: ["workouts", "workout_sessions"],
                            },
                        }
                    );

                    if (!recoveryFetch.skipped) {
                        workoutsRes = recoveryFetch.value.workoutsRes;
                        sessionsRes = recoveryFetch.value.sessionsRes;
                        console.log("[restore] history recovery latest response", {
                            env: getRuntimeEnvironmentLabel(),
                            fetchName: "history_recovery_latest",
                            user_id: user.id,
                            dateRange: { latest: true, limit: HISTORY_RECOVERY_LIMIT },
                            workouts: getWorkoutRowsDebugSummary(workoutsRes.data || []),
                            workout_sessions: sessionsRes.error
                                ? { rowCount: 0, error: sessionsRes.error?.message || String(sessionsRes.error) }
                                : getWorkoutSessionRowsDebugSummary(sessionsRes.data || []),
                            error: {
                                workouts: workoutsRes.error?.message || null,
                                workout_sessions: sessionsRes.error?.message || null,
                            },
                        });
                    } else {
                        console.warn("[restore] history recovery latest skipped", {
                            env: getRuntimeEnvironmentLabel(),
                            user_id: user.id,
                            reason: recoveryFetch.reason,
                            fallbackUsed: false,
                            currentDisplayed: getHistoryOverallMetrics(latestHistoryRef.current || {}),
                        });
                    }
                }

                const remoteHistory = applyHistoryDeleteMarkers(
                    buildRemoteHistoryWithWorkoutRowsPriority(
                        workoutsRes.data || [],
                        sessionsRes.error ? [] : (sessionsRes.data || [])
                    ),
                    effectiveDeleteMarkers
                );
                const workoutsOnlyHistory = applyHistoryDeleteMarkers(
                    buildHistoryFromWorkoutRows(workoutsRes.data || []),
                    effectiveDeleteMarkers
                );
                const hasRemoteWorkout = getValidWorkoutDatesFromHistory(remoteHistory).length > 0;
                const fetchedWorkoutRowsCount = (workoutsRes.data || []).length;
                const fetchedSessionRowsCount = sessionsRes.error ? 0 : (sessionsRes.data || []).length;
                const currentDisplayedBeforeApply = latestHistoryRef.current || {};

                if (!hasRemoteWorkout && (fetchedWorkoutRowsCount > 0 || fetchedSessionRowsCount > 0)) {
                    const canShowWorkoutsData = getValidWorkoutDatesFromHistory(workoutsOnlyHistory).length > 0;
                    console.warn("[restore] fetched rows did not produce history; keeping current state", {
                        env: getRuntimeEnvironmentLabel(),
                        fetchName: "history_initial_load",
                        user_id: user.id,
                        workoutsRowsCount: fetchedWorkoutRowsCount,
                        workoutSessionsRowsCount: fetchedSessionRowsCount,
                        workouts: getWorkoutRowsDebugSummary(workoutsRes.data || []),
                        workout_sessions: sessionsRes.error
                            ? { rowCount: 0, error: sessionsRes.error?.message || String(sessionsRes.error) }
                            : getWorkoutSessionRowsDebugSummary(sessionsRes.data || []),
                        currentDisplayed: getHistoryOverallMetrics(currentDisplayedBeforeApply),
                        fallbackUsed: false,
                        emptyHistoryApplied: false,
                        workoutsDataFallbackCanDisplay: canShowWorkoutsData,
                        reason: "Supabase rows exist but could not be converted to valid history",
                    });
                    if (isActive && canShowWorkoutsData) {
                        historyRemoteLoadFailedRef.current = false;
                        historyHasTrustedRemoteSnapshotRef.current = true;
                        setHistoryRemoteReady(true);
                        setHistoryLoadError("");
                        workoutsDataHistoryRef.current = workoutsOnlyHistory;
                        setWorkoutsDataHistory(workoutsOnlyHistory);
                        console.log("[restore] workouts.data applied despite session conversion issue", {
                            env: getRuntimeEnvironmentLabel(),
                            user_id: user.id,
                            historyRemoteReady: true,
                            remoteLoadFailed: false,
                            workoutsRowsCount: fetchedWorkoutRowsCount,
                            workoutSessionsRowsCount: fetchedSessionRowsCount,
                            history: getHistoryOverallMetrics(latestHistoryRef.current || {}),
                            workoutsDataHistory: getHistoryOverallMetrics(workoutsOnlyHistory),
                            appliedDates: getValidWorkoutDatesFromHistory(workoutsOnlyHistory),
                        });
                        return;
                    }
                    setHistoryLoadError("記録データの復元形式を確認中です。再取得してください。");
                    return;
                }

                if (!hasRemoteWorkout && !historyHasTrustedRemoteSnapshotRef.current) {
                    console.warn("[restore] no remote workout rows found; empty history not persisted as cache", {
                        env: getRuntimeEnvironmentLabel(),
                        fetchName: "history_initial_load",
                        user_id: user.id,
                        workoutsRowsCount: fetchedWorkoutRowsCount,
                        workoutSessionsRowsCount: fetchedSessionRowsCount,
                        currentDisplayed: getHistoryOverallMetrics(currentDisplayedBeforeApply),
                        fallbackUsed: false,
                    });
                }

                const mergedHistory = remoteHistory;
                const appliedWorkoutsDataHistory = workoutsOnlyHistory;
                const currentWeekRange = getCurrentWeekRangeForHomeSummary();
                if (
                    workoutsRes.weekRange?.start === currentWeekRange.start &&
                    workoutsRes.weekRange?.end === currentWeekRange.end
                ) {
                    markSupabaseFetchFresh(`home_weekly:${user.id}:${currentWeekRange.start}:${currentWeekRange.end}`, 45000);
                }
                markSupabaseFetchFresh(`display_history:history:${user.id}:${currentWeekRange.start}:${currentWeekRange.end}:${INITIAL_HOME_HISTORY_LIMIT}`, 45000);
                const initialSummaryHistory = sessionsRes.error || sessionsRes.skipped
                    ? {}
                    : buildHistoryFromWorkoutSessionRows(sessionsRes.data || []);

                console.log("[restore] Supabase priority load", {
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user.id,
                    source: hasRemoteWorkout ? "supabase" : "supabase_empty",
                    fallbackUsed: false,
                    fallbackSource: "localStorage/history_cache",
                    fallbackRejected: true,
                    rejectedReason: "logged-in initial load uses Supabase only",
                    dateRange: { from: sessionRangeStart, limit: initialHistoryLimit },
                    workoutsRows: workoutsRes.data?.length || 0,
                    sessionRows: sessionsRes.data?.length || 0,
                    supabaseDates: getValidWorkoutDatesFromHistory(remoteHistory),
                    localStorageDates: getValidWorkoutDatesFromHistory(localMergeCandidate),
                    appliedDates: getValidWorkoutDatesFromHistory(mergedHistory),
                });
                console.log("[home weekly summary] apply", {
                    source: "workouts.data",
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user.id,
                    requestId: "initial-load",
                    applied: true,
                    reason: "history_initial_load",
                    ...getHomeWeeklySummaryDebug(appliedWorkoutsDataHistory),
                    ...getHomeWeeklySourceDebug({
                        workoutsHistory: appliedWorkoutsDataHistory,
                        summaryHistory: initialSummaryHistory,
                        finalHistory: appliedWorkoutsDataHistory,
                        weekRange: currentWeekRange,
                        source: "workouts.data",
                        appliedSource: "workouts.data",
                        ignoredStaleSource: sessionsRes.skipped
                            ? "summary_json skipped on initial load"
                            : "summary_json ignored for home weekly",
                    }),
                });

                if (!isActive) return;

                historyRemoteLoadFailedRef.current = false;
                historyHasTrustedRemoteSnapshotRef.current = true;
                setHistoryRemoteReady(true);
                setHistoryLoadError("");
                setHistory(mergedHistory);
                workoutsDataHistoryRef.current = appliedWorkoutsDataHistory;
                setWorkoutsDataHistory(appliedWorkoutsDataHistory);
                console.log("[restore] history ready state applied", {
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user.id,
                    historyRemoteReady: true,
                    remoteLoadFailed: false,
                    workoutsRowsCount: fetchedWorkoutRowsCount,
                    workoutSessionsRowsCount: fetchedSessionRowsCount,
                    history: getHistoryOverallMetrics(mergedHistory),
                    workoutsDataHistory: getHistoryOverallMetrics(appliedWorkoutsDataHistory),
                    appliedDates: getValidWorkoutDatesFromHistory(mergedHistory),
                });
                if (hasRemoteWorkout) {
                    persistHistoryForUser(user.id, mergedHistory);
                }
            } catch (error) {
                console.error("history sync load failed", {
                    error,
                    message: error?.message,
                    code: error?.code,
                    details: error?.details,
                    hint: error?.hint,
                    userId: user.id,
                    email: user.email,
                });

                if (!isActive) return;

                historyRemoteLoadFailedRef.current = true;
                setHistoryRemoteReady(false);
                setHistoryLoadError(getHistoryLoadErrorMessage(error));
                const fallbackHistory = applyHistoryDeleteMarkers(localMergeCandidate, effectiveDeleteMarkers);
                const currentDisplayedHistory = latestHistoryRef.current || {};
                console.warn("[restore] fallback rejected after Supabase history load failure", {
                    env: getRuntimeEnvironmentLabel(),
                    fetchName: "history_initial_load",
                    user_id: user.id,
                    dateRange: { from: getDateDaysAgoKey(INITIAL_HOME_HISTORY_LOOKBACK_DAYS), limit: INITIAL_HOME_HISTORY_LIMIT },
                    query: "workouts.select(date,data).eq(user_id).gte(date).order(date asc).limit",
                    errorMessage: error?.message || String(error || "unknown error"),
                    fallbackUsed: false,
                    fallbackSource: "localStorage/history_cache",
                    fallback: getHistoryOverallMetrics(fallbackHistory),
                    currentDisplayed: getHistoryOverallMetrics(currentDisplayedHistory),
                    fallbackRejected: true,
                    rejectedReason: "Supabase fetch failed; stale fallback must not overwrite trusted/current displayed state",
                });
            } finally {
                if (isActive) setHistorySyncReady(true);
            }
        };

        syncHistoryFromSupabase();

        return () => {
            isActive = false;
        };
    }, [
        getCurrentHistoryDeleteMarkers,
        historyReloadNonce,
        markSupabaseFetchFresh,
        runDedupeSupabaseFetch,
        user,
    ]);

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
                    supabase
                        .from("workouts")
                        .select("date, data")
                        .eq("user_id", currentUserId)
                        .gte("date", sessionRangeStart)
                        .order("date", { ascending: true })
                        .limit(REMOTE_HISTORY_SESSION_LIMIT),
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
                        query: "workouts.select(date,data).eq(user_id).gte(date).order(date asc).limit",
                        responseData: workoutsRes.data,
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

                const remoteHistory = applyHistoryDeleteMarkers(
                    buildRemoteHistoryWithWorkoutRowsPriority(
                        workoutsRes.data || [],
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
                workoutsDataHistoryRef.current = nextWorkoutsDataHistory;
                setWorkoutsDataHistory(nextWorkoutsDataHistory);
                console.log("[home weekly summary] apply", {
                    source: "workouts.data",
                    env: getRuntimeEnvironmentLabel(),
                    user_id: currentUserId,
                    requestId: "save-sync",
                    applied: true,
                    reason: "workouts.data save sync",
                    ...getHomeWeeklySummaryDebug(nextWorkoutsDataHistory),
                });

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
                    if (
                        workoutSyncResults.skippedDates.includes(date) ||
                        failedSessionSyncDates.has(date) ||
                        skippedSessionSyncDates.has(date)
                    ) {
                        return;
                    }
                    const pendingAfterSave = pendingWorkoutContentChangeDatesRef.current.get(date);
                    if (!pendingAfterSave?.updatedAt || getTimestampMs(pendingAfterSave.updatedAt) <= getTimestampMs(saveStartedAt)) {
                        pendingWorkoutContentChangeDatesRef.current.delete(date);
                    }
                    pendingWorkoutSessionSyncDatesRef.current.delete(date);
                });

                const savedDates = syncDates.filter((date) => (
                    !workoutSyncResults.skippedDates.includes(date) &&
                    !failedSessionSyncDates.has(date) &&
                    !skippedSessionSyncDates.has(date)
                ));
                savedDates.forEach((date) => {
                    const remoteVerifiedAt = new Date().toISOString();
                    const verifiedHistoryForDate = workoutSyncResults.verifiedHistoryByDate?.[date] || applyPreferredHistoryDates({}, mergedHistory, [date]);
                    const verifiedHistorySnapshot = applyLocalHistoryDates(mergedHistory, verifiedHistoryForDate, [date]);
                    const savedDraft = withDraftMeta(
                        buildWorkoutDraftForDateFromHistory(date, verifiedHistoryForDate),
                        {
                            source: "save_verified",
                            remoteVerifiedAt,
                            hasUnsavedChanges: false,
                        }
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
                    workoutsDataHistoryRef.current = verifiedWorkoutsDataHistory;
                    setWorkoutsDataHistory(verifiedWorkoutsDataHistory);
                    explicitWorkoutEditDatesRef.current.delete(date);
                    pendingWorkoutContentChangeDatesRef.current.delete(date);
                    pendingWorkoutSessionSyncDatesRef.current.delete(date);
                    clearSyncFailure(date);
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
        recordSyncFailure,
        refreshHistorySyncDiagnostic,
        hasRemoteWorkoutForDate,
        savedWorkoutDurationSecByDate,
        syncWorkoutSessionSnapshot,
        syncWorkoutRowsForDates,
        cleanupWorkoutSessionsForHistory,
        workoutFinishedAt,
        workoutIsFinished,
        workoutLastActivityAt,
        workoutStartedAt,
        workoutStartedForDate,
        applyLocalHistoryDates,
        applyLogDraftState,
        loadDraftForDate,
        saveDraftForDate,
    ]);

    useEffect(() => {
        if (!user?.id || !historySyncReady) return;
        if (!["calendar", "analytics"].includes(screen)) return;
        const trustedDisplayHistory = mergeHistoryMaps(workoutsDataHistory || {}, history || {});
        const trustedHistoryMetrics = getHistoryOverallMetrics(trustedDisplayHistory);
        if (trustedHistoryMetrics.setCount > 0) {
            console.log("[home fetch] display_history skipped; trustedHistory already available", {
                env: getRuntimeEnvironmentLabel(),
                user_id: user.id,
                screen,
                source: "trustedHistory",
                applied: false,
                skipped: true,
                reason: "screen uses existing trusted history immediately",
                trustedHistory: trustedHistoryMetrics,
            });
            return;
        }

        let cancelled = false;

        const refreshDisplayHistoryFromSupabase = async () => {
            const requestId = displayHistoryRefreshRequestIdRef.current + 1;
            displayHistoryRefreshRequestIdRef.current = requestId;
            const queryLabel = "display_history_refresh";
            const weekRange = getCurrentWeekRangeForHomeSummary();
            const sessionRangeStart = screen === "calendar"
                ? `${formatDateKey(new Date()).slice(0, 7)}-01`
                : getDateDaysAgoKey(35);
            const sessionRangeEnd = screen === "calendar"
                ? `${getNextMonthPrefix(formatDateKey(new Date()).slice(0, 7))}-01`
                : null;
            const displayHistoryLimit = screen === "calendar" ? 80 : 120;

            try {
                let workoutsQuery = supabase
                    .from("workouts")
                    .select("date, data")
                    .eq("user_id", user.id)
                    .gte("date", sessionRangeStart);
                let sessionsQuery = supabase
                    .from("workout_sessions")
                    .select("workout_date, duration_sec, summary_json")
                    .eq("user_id", user.id)
                    .gte("workout_date", sessionRangeStart);

                if (sessionRangeEnd) {
                    workoutsQuery = workoutsQuery.lt("date", sessionRangeEnd);
                    sessionsQuery = sessionsQuery.lt("workout_date", sessionRangeEnd);
                }

                workoutsQuery = workoutsQuery
                    .order("date", { ascending: true })
                    .limit(displayHistoryLimit);
                sessionsQuery = sessionsQuery
                    .order("workout_date", { ascending: true })
                    .limit(displayHistoryLimit);

                const displayFetchKey = `display_history:${screen}:${user.id}:${sessionRangeStart}:${sessionRangeEnd || "open"}:${displayHistoryLimit}`;
                const displayFetch = await runDedupeSupabaseFetch(
                    displayFetchKey,
                    async () => {
                        const [workoutsRes, sessionsRes] = await Promise.all([
                            workoutsQuery,
                            sessionsQuery,
                        ]);
                        if (workoutsRes.error) {
                            const context = logRecordFetchError(queryLabel, "workouts", workoutsRes.error, {
                                userId: user.id,
                                dateRange: { from: sessionRangeStart, to: sessionRangeEnd, limit: displayHistoryLimit },
                                query: "workouts.select(date,data).eq(user_id).gte(date).lte(date?).order(date asc).limit",
                                responseData: workoutsRes.data,
                            });
                            throw attachRecordFetchContext(workoutsRes.error, context);
                        }
                        return { workoutsRes, sessionsRes };
                    },
                    {
                        minIntervalMs: 20000,
                        freshTtlMs: 30000,
                        backoffMs: 30000,
                        context: {
                            fetchName: queryLabel,
                            user_id: user.id,
                            screen,
                            dateRange: { from: sessionRangeStart, to: sessionRangeEnd, limit: displayHistoryLimit },
                            tables: ["workouts", "workout_sessions"],
                        },
                    }
                );

                if (displayFetch.skipped) {
                    console.log("[restore] display history fetch skipped", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        screen,
                        requestId,
                        applied: false,
                        reason: displayFetch.reason,
                        dateRange: { from: sessionRangeStart, to: sessionRangeEnd, limit: displayHistoryLimit },
                        currentDisplayed: getHistoryOverallMetrics(latestHistoryRef.current || {}),
                        currentWorkoutsDataDisplayed: getHistoryOverallMetrics(workoutsDataHistoryRef.current || {}),
                    });
                    return;
                }

                const { workoutsRes, sessionsRes } = displayFetch.value;

                if (sessionsRes.error) {
                    logRecordFetchError(queryLabel, "workout_sessions", sessionsRes.error, {
                        userId: user.id,
                        dateRange: { from: sessionRangeStart, to: sessionRangeEnd, limit: displayHistoryLimit },
                        query: "workout_sessions.select(workout_date,duration_sec,summary_json).eq(user_id).gte(workout_date).lte(workout_date?).order(workout_date asc).limit",
                        responseData: sessionsRes.data,
                    });
                    console.warn("[restore] workout_sessions display summary refresh failed; using workouts.data", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        table: "workout_sessions",
                        query: "workout_sessions.select(workout_date,duration_sec,summary_json).eq(user_id).gte(workout_date).order(workout_date asc).limit",
                        code: sessionsRes.error?.code,
                        message: sessionsRes.error?.message,
                        details: sessionsRes.error?.details,
                        hint: sessionsRes.error?.hint,
                        responseData: sessionsRes.data,
                    });
                }

                if (cancelled || displayHistoryRefreshRequestIdRef.current !== requestId) {
                    console.log("[home weekly summary] ignore stale", {
                        source: sessionsRes.error ? "workouts.data" : "workouts.data + workout_sessions.summary_json",
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        requestId,
                        latestRequestId: displayHistoryRefreshRequestIdRef.current,
                        applied: false,
                        reason: cancelled ? "cancelled" : "stale display history request",
                        ...getHomeWeeklySummaryDebug(buildHistoryFromWorkoutRows(workoutsRes.data || []), weekRange),
                    });
                    return;
                }

                const effectiveDeleteMarkers = getCurrentHistoryDeleteMarkers();
                const workoutsOnlyHistory = applyHistoryDeleteMarkers(
                    buildHistoryFromWorkoutRows(workoutsRes.data || []),
                    effectiveDeleteMarkers
                );
                const remoteHistory = applyHistoryDeleteMarkers(
                    buildRemoteHistoryWithWorkoutRowsPriority(
                        workoutsRes.data || [],
                        sessionsRes.error ? [] : (sessionsRes.data || [])
                    ),
                    effectiveDeleteMarkers
                );
                const pendingLocalDates = new Set(Array.from(pendingWorkoutContentChangeDatesRef.current.keys()));
                const remoteDates = getValidWorkoutDatesFromHistory(remoteHistory)
                    .filter((date) => !pendingLocalDates.has(date));
                const workoutsDates = getValidWorkoutDatesFromHistory(workoutsOnlyHistory)
                    .filter((date) => !pendingLocalDates.has(date));
                if (!remoteDates.length && !workoutsDates.length) return;

                const currentHistory = latestHistoryRef.current || {};
                const nextHistory = applyHistoryDeleteMarkers(
                    applyLocalHistoryDates(currentHistory, remoteHistory, remoteDates),
                    effectiveDeleteMarkers
                );
                const nextWorkoutsDataHistory = applyHistoryDeleteMarkers(
                    applyLocalHistoryDates(
                        workoutsDataHistoryRef.current || currentHistory,
                        workoutsOnlyHistory,
                        workoutsDates
                    ),
                    effectiveDeleteMarkers
                );

                console.log("[restore] display history refreshed from workouts.data priority", {
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user.id,
                    screen,
                    workoutsRows: workoutsRes.data?.length || 0,
                    sessionRows: sessionsRes.error ? 0 : (sessionsRes.data?.length || 0),
                    appliedDates: remoteDates,
                    skippedPendingLocalDates: Array.from(pendingLocalDates),
                    exerciseNamesByDate: remoteDates.reduce((acc, date) => {
                        acc[date] = getHistoryMetricsForDate(nextHistory, date).exerciseNames;
                        return acc;
                    }, {}),
                });

                historyHasTrustedRemoteSnapshotRef.current = true;
                historyRemoteLoadFailedRef.current = false;
                if (serializeHistoryMap(nextHistory) !== serializeHistoryMap(currentHistory)) {
                    setHistory(nextHistory);
                    persistHistoryForUser(user.id, nextHistory);
                }
                if (serializeHistoryMap(nextWorkoutsDataHistory) !== serializeHistoryMap(workoutsDataHistoryRef.current || {})) {
                    workoutsDataHistoryRef.current = nextWorkoutsDataHistory;
                    setWorkoutsDataHistory(nextWorkoutsDataHistory);
                }
                console.log("[home weekly summary] apply", {
                    source: "workouts.data",
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user.id,
                    requestId,
                    applied: true,
                    reason: "display refresh workouts.data canonical",
                    ...getHomeWeeklySummaryDebug(nextWorkoutsDataHistory, weekRange),
                });
                setHistoryLoadError("");
            } catch (error) {
                if (cancelled) return;
                console.error("[restore] display history refresh failed", {
                    env: getRuntimeEnvironmentLabel(),
                    fetchName: queryLabel,
                    user_id: user.id,
                    screen,
                    dateRange: { from: sessionRangeStart, to: sessionRangeEnd, limit: displayHistoryLimit },
                    table: error?.recordFetch?.table || "workouts",
                    query: error?.recordFetch?.query || "workouts.select(date,data).eq(user_id).gte(date).lte(date?).order(date asc).limit",
                    code: error?.code || null,
                    message: error?.message || String(error || "unknown error"),
                    details: error?.details || null,
                    hint: error?.hint || null,
                    responseData: error?.recordFetch?.responseData || null,
                    fallbackUsed: false,
                    fallbackSource: "none",
                    fallbackRejected: true,
                    rejectedReason: "display refresh keeps current displayed state on fetch failure",
                    currentDisplayed: getHistoryOverallMetrics(latestHistoryRef.current || {}),
                    currentWorkoutsDataDisplayed: getHistoryOverallMetrics(workoutsDataHistoryRef.current || {}),
                });
                setHistoryLoadError(getHistoryLoadErrorMessage(error));
            }
        };

        refreshDisplayHistoryFromSupabase();

        return () => {
            cancelled = true;
        };
    }, [
        applyLocalHistoryDates,
        getCurrentHistoryDeleteMarkers,
        history,
        historyReloadNonce,
        historySyncReady,
        runDedupeSupabaseFetch,
        screen,
        sessionSyncVersion,
        user?.id,
        workoutsDataHistory,
    ]);

    useEffect(() => {
        if (!user?.id || !historySyncReady || screen !== "history") return;

        let cancelled = false;
        const requestId = homeWeeklySummaryRequestIdRef.current + 1;
        homeWeeklySummaryRequestIdRef.current = requestId;
        const weekRange = getCurrentWeekRangeForHomeSummary();

        const refreshHomeWeeklySummaryFromWorkouts = async () => {
            const sessionRangeStart = weekRange.start;
            const sessionRangeEnd = weekRange.end;
            const homeHistoryLimit = INITIAL_HOME_HISTORY_LIMIT;
            const homeFetchKey = `home_weekly:${user.id}:${sessionRangeStart}:${sessionRangeEnd}`;

            try {
                const homeFetch = await runDedupeSupabaseFetch(
                    homeFetchKey,
                    async () => {
                        const result = await supabase
                            .from("workouts")
                            .select("date, data")
                            .eq("user_id", user.id)
                            .gte("date", sessionRangeStart)
                            .lte("date", sessionRangeEnd)
                            .order("date", { ascending: true })
                            .limit(homeHistoryLimit);
                        if (result.error) {
                            logRecordFetchError("home_weekly_summary_refresh", "workouts", result.error, {
                                userId: user.id,
                                dateRange: { from: sessionRangeStart, to: sessionRangeEnd, limit: homeHistoryLimit },
                                query: "workouts.select(date,data).eq(user_id).gte(date).lte(date).order(date asc).limit",
                                responseData: result.data,
                            });
                            throw result.error;
                        }
                        return result;
                    },
                    {
                        minIntervalMs: 20000,
                        freshTtlMs: 30000,
                        backoffMs: 30000,
                        context: {
                            fetchName: "home_weekly_summary_refresh",
                            user_id: user.id,
                            dateRange: { from: sessionRangeStart, to: sessionRangeEnd, limit: homeHistoryLimit },
                            table: "workouts",
                        },
                    }
                );

                if (homeFetch.skipped) {
                    const currentWorkoutsDataHistory = workoutsDataHistoryRef.current || {};
                    console.log("[home weekly summary] fetch skipped", {
                        source: "workouts.data",
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        requestId,
                        applied: false,
                        reason: homeFetch.reason,
                        dateRange: { from: sessionRangeStart, to: sessionRangeEnd, limit: homeHistoryLimit },
                        currentDisplayed: getHistoryOverallMetrics(currentWorkoutsDataHistory),
                        ...getHomeWeeklySummaryDebug(currentWorkoutsDataHistory, weekRange),
                        ...getHomeWeeklySourceDebug({
                            workoutsHistory: currentWorkoutsDataHistory,
                            finalHistory: currentWorkoutsDataHistory,
                            weekRange,
                            source: "workouts.data",
                            appliedSource: "current trusted workoutsDataHistory",
                            ignoredStaleSource: `fetch skipped: ${homeFetch.reason || "unknown"}`,
                        }),
                    });
                    return;
                }

                const { data } = homeFetch.value;

                const remoteWorkoutsHistory = applyHistoryDeleteMarkers(
                    buildHistoryFromWorkoutRows(data || []),
                    getCurrentHistoryDeleteMarkers()
                );
                const pendingLocalDates = new Set(Array.from(pendingWorkoutContentChangeDatesRef.current.keys()));
                const remoteDates = getValidWorkoutDatesFromHistory(remoteWorkoutsHistory)
                    .filter((date) => !pendingLocalDates.has(date));

                const nextWorkoutsDataHistory = applyLocalHistoryDates(
                    workoutsDataHistoryRef.current || latestHistoryRef.current || {},
                    remoteWorkoutsHistory,
                    remoteDates
                );

                if (cancelled || homeWeeklySummaryRequestIdRef.current !== requestId) {
                    console.log("[home weekly summary] ignore stale", {
                        source: "workouts.data",
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        requestId,
                        latestRequestId: homeWeeklySummaryRequestIdRef.current,
                        applied: false,
                        reason: cancelled ? "cancelled" : "stale home weekly request",
                        ...getHomeWeeklySummaryDebug(nextWorkoutsDataHistory, weekRange),
                        ...getHomeWeeklySourceDebug({
                            workoutsHistory: remoteWorkoutsHistory,
                            finalHistory: nextWorkoutsDataHistory,
                            weekRange,
                            source: "workouts.data",
                            appliedSource: "none",
                            ignoredStaleSource: cancelled ? "cancelled" : "stale workouts.data response",
                        }),
                    });
                    return;
                }

                workoutsDataHistoryRef.current = nextWorkoutsDataHistory;
                historyHasTrustedRemoteSnapshotRef.current = true;
                historyRemoteLoadFailedRef.current = false;
                setWorkoutsDataHistory(nextWorkoutsDataHistory);
                setHistoryLoadError("");

                console.log("[home weekly summary] apply", {
                    source: "workouts.data",
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user.id,
                    requestId,
                    applied: true,
                    reason: "home screen workouts.data refresh",
                    ...getHomeWeeklySummaryDebug(nextWorkoutsDataHistory, weekRange),
                    ...getHomeWeeklySourceDebug({
                        workoutsHistory: remoteWorkoutsHistory,
                        finalHistory: nextWorkoutsDataHistory,
                        weekRange,
                        source: "workouts.data",
                        appliedSource: "workouts.data",
                        ignoredStaleSource: "summary_json/history_cache/localStorage",
                    }),
                });
            } catch (error) {
                if (cancelled) return;
                console.error("[home weekly summary] refresh failed", {
                    source: "workouts.data",
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user.id,
                    requestId,
                    applied: false,
                    reason: "workouts.data fetch failed",
                    dateRange: { from: sessionRangeStart, to: sessionRangeEnd, limit: homeHistoryLimit },
                    query: "workouts.select(date,data).eq(user_id).gte(date).lte(date).order(date asc).limit",
                    fallbackUsed: false,
                    fallbackSource: "none",
                    fallbackRejected: true,
                    rejectedReason: "home weekly keeps current workoutsDataHistory on fetch failure",
                    currentDisplayed: getHistoryOverallMetrics(workoutsDataHistoryRef.current || {}),
                    code: error?.code || null,
                    message: error?.message || String(error || "unknown error"),
                    details: error?.details || null,
                    hint: error?.hint || null,
                });
            }
        };

        refreshHomeWeeklySummaryFromWorkouts();

        return () => {
            cancelled = true;
        };
    }, [
        applyLocalHistoryDates,
        getCurrentHistoryDeleteMarkers,
        historyReloadNonce,
        historySyncReady,
        runDedupeSupabaseFetch,
        screen,
        sessionSyncVersion,
        user?.id,
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
        const draft = {
            todayLabels,
            logData,
            sessionEx,
            exerciseUnits,
            meta: draftMeta,
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

    const displayHistory = useMemo(() => {
        if (!logDate) return history;
        const hasPendingDraftEdit = pendingWorkoutContentChangeDatesRef.current.has(String(logDate || "").slice(0, 10));
        const shouldOverlayDraft = screen === "log" || workoutStartedForDate === logDate || hasPendingDraftEdit;
        if (!shouldOverlayDraft) return history;

        const durationSec = Math.max(
            0,
            workoutStartedForDate === logDate
                ? computeWorkoutDisplayElapsedSec(workoutTimerStateRef.current)
                : 0,
            Math.floor(Number(savedWorkoutDurationSecByDate[logDate]) || 0)
        );
        const pendingChange = pendingWorkoutContentChangeDatesRef.current.get(String(logDate || "").slice(0, 10)) || {};
        const nextHistory = buildDraftHistoryForDate({
            baseHistory: history,
            workoutDate: logDate,
            exercises,
            logData,
            getExUnit,
            labels: todayLabels,
            durationSec,
            replaceDate: Boolean(pendingChange.explicitDelete),
        });

        return nextHistory;
    }, [
        exercises,
        getExUnit,
        history,
        logData,
        logDate,
        savedWorkoutDurationSecByDate,
        screen,
        todayLabels,
        workoutStartedForDate,
    ]);

    const canonicalDisplayHistory = useMemo(
        () => applyPreferredHistoryDates(
            displayHistory,
            workoutsDataHistory,
            getValidWorkoutDatesFromHistory(workoutsDataHistory)
        ),
        [displayHistory, workoutsDataHistory]
    );

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
        const pendingChange = pendingWorkoutContentChangeDatesRef.current.get(String(logDate || "").slice(0, 10));
        if (!pendingChange) return;

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
        const incomingMetrics = getDraftMetricsForDate({
            exercises,
            logData,
            getExUnit,
            workoutDate: logDate,
        });
        const existingMetrics = getHistoryMetricsForDate(latestHistoryRef.current || history || {}, logDate);
        const explicitEdit = isExplicitWorkoutEditChange(pendingChange);
        const wouldDestructivelyOverwrite = isDestructiveWorkoutRegression(incomingMetrics, existingMetrics, {
            allowVolumeDecrease: explicitEdit,
        });

        logWorkoutPersistenceDecision({
            action: "local_auto_persist_check",
            userId: user?.id,
            date: logDate,
            localMetrics: incomingMetrics,
            remoteMetrics: existingMetrics,
            reason: wouldDestructivelyOverwrite
                ? `pending guarded save: ${pendingChange.reason}`
                : explicitEdit && incomingMetrics.volume + 0.01 < existingMetrics.volume
                    ? `allowed explicit edit volume decrease: ${pendingChange.reason}`
                : `allowed content edit: ${pendingChange.reason}`,
        });

        console[wouldDestructivelyOverwrite && !pendingChange.explicitDelete ? "warn" : "log"]("[set mutation]", {
            action: "workout_autosave",
            env: getRuntimeEnvironmentLabel(),
            date: logDate,
            user_id: user?.id || null,
            exerciseName: pendingChange.details?.exerciseName || null,
            beforeSetCount: existingMetrics.setCount,
            afterSetCount: incomingMetrics.setCount,
            beforeSets: null,
            afterSets: getDraftInputDebugSummary({ exercises, logData, labels: todayLabels }).setsByExercise,
            dirty: true,
            source: "autosave",
            allowed: !(wouldDestructivelyOverwrite && !pendingChange.explicitDelete),
            blockedReason: wouldDestructivelyOverwrite && !pendingChange.explicitDelete
                ? `pending guarded save: ${pendingChange.reason}`
                : null,
            overwrittenByRestore: false,
        });

        if (wouldDestructivelyOverwrite && !pendingChange.explicitDelete) {
            console.warn("[save guard] blocked destructive local draft apply", {
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                date: logDate,
                reason: pendingChange.reason || "unknown",
                localMetrics: incomingMetrics,
                remoteMetrics: existingMetrics,
            });
            return;
        }

        pendingWorkoutNotificationRef.current = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            userId: user?.id || null,
            logDate,
        };
        queueWorkoutSessionSync(logDate);

        setHistory((prev) => {
            const nextHistory = buildDraftHistoryForDate({
                baseHistory: prev,
                workoutDate: logDate,
                exercises,
                logData,
                getExUnit,
                labels: todayLabels,
                durationSec,
                replaceDate: Boolean(pendingChange.explicitDelete),
            });

            console.log("[save] local draft applied to history", {
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                date: logDate,
                reason: pendingChange.reason,
                explicitDelete: Boolean(pendingChange.explicitDelete),
                draftInput: getDraftInputDebugSummary({ exercises, logData, labels: todayLabels }),
                saving: getHistoryDebugSummaryForDate(nextHistory, logDate),
                previous: getHistoryDebugSummaryForDate(prev, logDate),
                diffPreviousToSaving: getHistoryDebugDiffForDate(prev, nextHistory, logDate),
            });

            if (serializeHistoryMap(nextHistory) === serializeHistoryMap(prev)) return prev;
            latestHistoryRef.current = nextHistory;
            historyRevisionRef.current += 1;
            workoutsDataHistoryRef.current = nextHistory;
            setWorkoutsDataHistory(nextHistory);
            persistHistoryForUser(user?.id, nextHistory);
            console.log("[home weekly summary] apply", {
                source: "workouts.data",
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                requestId: "local-draft-flush",
                applied: true,
                reason: "local draft flush to workouts.data canonical",
                ...getHomeWeeklySummaryDebug(nextHistory),
            });
            return nextHistory;
        });
    }, [exercises, getExUnit, history, logData, logDate, queueWorkoutSessionSync, savedWorkoutDurationSecByDate, todayLabels, user?.id, workoutStartedForDate]); // ← 依存配列

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

        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener("pagehide", flushPendingLog);
        };
    }, [persistCurrentLog]);

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
        markWorkoutContentChanged(logDate, "exercise_delete", { explicitDelete: true });
        const isNameOnly = maybeName === undefined;
        const targetId = isNameOnly ? null : idOrName;
        const targetName = isNameOnly ? idOrName : maybeName;
        let shouldClearDateArtifacts = false;
        const currentDraft = getCurrentLogDraftSnapshot();
        const currentLabels = currentDraft.todayLabels?.length ? currentDraft.todayLabels : todayLabels;
        const currentLogData = currentDraft.logData || {};
        const currentExerciseUnits = currentDraft.exerciseUnits || exerciseUnits;
        const currentSessionExercises = mergeDraftExercisesWithLogData(
            currentDraft.sessionEx !== null ? currentDraft.sessionEx : exercises,
            currentLogData,
            currentLabels
        );
        const nextSession = currentSessionExercises.filter(e => {
            if (targetId !== null) return e.id !== targetId;
            return e.name !== targetName;
        });
        const nextLogData = { ...currentLogData };
        delete nextLogData[targetName];
        const nextExerciseUnits = { ...currentExerciseUnits };
        delete nextExerciseUnits[targetName];

        applyCurrentLogDraft({
            todayLabels: currentLabels,
            logData: nextLogData,
            sessionEx: nextSession,
            exerciseUnits: nextExerciseUnits,
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
        const currentDraft = getCurrentLogDraftSnapshot();
        const currentLabels = currentDraft.todayLabels?.length ? currentDraft.todayLabels : todayLabels;
        const currentLogData = currentDraft.logData || {};
        const currentExerciseUnits = currentDraft.exerciseUnits || exerciseUnits;
        const currentSessionExercises = mergeDraftExercisesWithLogData(
            currentDraft.sessionEx !== null ? currentDraft.sessionEx : exercises,
            currentLogData,
            currentLabels
        );
        const beforeNames = currentSessionExercises.map((e) => e.name);
        const existingExercise = currentSessionExercises.find(
            (e) => normalizeExerciseName(e.name) === normalizedName
        );
        const alreadyInSession = !!existingExercise;

        if (alreadyInSession) {
            console.log("[add-exercise] duplicate ignored", {
                name: trimmed,
                label,
                before: beforeNames,
            });
            requestLogExerciseFocus(existingExercise);
            return;
        }

        markWorkoutContentChanged(logDate, "exercise_add");

        const ex = {
            id: Date.now() + (Math.random() * 1000 | 0),
            name: trimmed,
            label,
            bodyPart: label,
        };
        const nextLogDataForDraft = currentLogData[trimmed]
            ? currentLogData
            : { ...currentLogData, [trimmed]: makeDefaultDraftSets() };
        const nextSessionForDraft = alreadyInSession
            ? currentSessionExercises
            : [...currentSessionExercises, ex];
        const afterNames = nextSessionForDraft.map((exercise) => exercise.name);
        const removedExerciseNames = beforeNames.filter((beforeName) => {
            const normalizedBefore = normalizeExerciseName(beforeName);
            return normalizedBefore && !afterNames.some((afterName) => normalizeExerciseName(afterName) === normalizedBefore);
        });
        const beforeSetCount = beforeNames.reduce((sum, exerciseName) => sum + ((currentLogData[exerciseName] || []).length || 0), 0);
        const afterSetCount = afterNames.reduce((sum, exerciseName) => sum + ((nextLogDataForDraft[exerciseName] || []).length || 0), 0);
        const blockedReason = removedExerciseNames.length
            ? "exercise add would remove existing exercises"
            : afterNames.length < beforeNames.length
                ? "exercise add would reduce exercise count"
                : afterSetCount < beforeSetCount
                    ? "exercise add would reduce set count"
                    : null;

        const action = options.action || "exercise_add";

        console[blockedReason ? "warn" : "log"]("[exercise mutation]", {
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

        if (blockedReason) return;

        console.log("[add-exercise] adding exercise", {
            name: trimmed,
            label,
            before: beforeNames,
            after: afterNames,
        });

        applyCurrentLogDraft({
            todayLabels: currentLabels,
            logData: nextLogDataForDraft,
            sessionEx: nextSessionForDraft,
            exerciseUnits: currentExerciseUnits,
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

        if (!alreadyInSession) {
            requestLogExerciseFocus(ex);
            startWorkoutTimerIfNeeded(logDate, { markAsActivity: true });
        }
    };

    const reorderEx = (fromIdx, toIdx) => {
        markWorkoutContentChanged(logDate, "exercise_reorder");
        const currentDraft = getCurrentLogDraftSnapshot();
        const current = [...mergeDraftExercisesWithLogData(
            currentDraft.sessionEx !== null ? currentDraft.sessionEx : exercises,
            currentDraft.logData || {},
            currentDraft.todayLabels || todayLabels
        )];
        const [moved] = current.splice(fromIdx, 1);
        if (!moved) return;
        current.splice(toIdx, 0, moved);
        applyCurrentLogDraft({
            ...currentDraft,
            todayLabels: currentDraft.todayLabels?.length ? currentDraft.todayLabels : todayLabels,
            sessionEx: current,
        });
    };

    const renameEx = (id, newName) => {
        const trimmed = newName.trim();
        if (!trimmed) return;

        const oldEx = exercises.find((e) => e.id === id);
        if (!oldEx || oldEx.name === trimmed) return;

        markWorkoutContentChanged(logDate, "exercise_rename", {
            explicitEdit: true,
            details: {
                beforeName: oldEx.name,
                afterName: trimmed,
            },
        });

        const currentDraft = getCurrentLogDraftSnapshot();
        const currentLabels = currentDraft.todayLabels?.length ? currentDraft.todayLabels : todayLabels;
        const currentExercises = mergeDraftExercisesWithLogData(
            currentDraft.sessionEx !== null ? currentDraft.sessionEx : exercises,
            currentDraft.logData || {},
            currentLabels
        );
        const nextSessionEx = currentExercises.map((e) =>
            e.id === id || normalizeExerciseName(e.name) === normalizeExerciseName(oldEx.name)
                ? { ...e, name: trimmed }
                : e
        );
        const nextLogData = { ...(currentDraft.logData || {}) };
        const oldDataKey = Object.prototype.hasOwnProperty.call(nextLogData, oldEx.name)
            ? oldEx.name
            : Object.prototype.hasOwnProperty.call(nextLogData, id)
                ? id
                : null;
        if (oldDataKey && oldDataKey !== trimmed) {
            nextLogData[trimmed] = nextLogData[oldDataKey];
            delete nextLogData[oldDataKey];
        }
        const nextUnits = { ...(currentDraft.exerciseUnits || exerciseUnits) };
        if (Object.prototype.hasOwnProperty.call(nextUnits, oldEx.name)) {
            nextUnits[trimmed] = nextUnits[oldEx.name];
            delete nextUnits[oldEx.name];
        }
        applyCurrentLogDraft({
            todayLabels: currentLabels,
            logData: nextLogData,
            sessionEx: nextSessionEx,
            exerciseUnits: nextUnits,
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

    const quickAdd = (name, remove, labelOverride, options = {}) => {
        const tgts = labelOverride
            ? [labelOverride]
            : Array.isArray(addTarget)
                ? addTarget
                : (addTarget ? [addTarget] : []);
        const action = remove ? "exercise_remove" : (options.action || "exercise_add");
        const currentDraft = getCurrentLogDraftSnapshot();
        const currentLabels = currentDraft.todayLabels?.length ? currentDraft.todayLabels : todayLabels;
        const currentLogData = currentDraft.logData || {};
        const currentExerciseUnits = currentDraft.exerciseUnits || exerciseUnits;
        const currentSessionExercises = mergeDraftExercisesWithLogData(
            currentDraft.sessionEx !== null ? currentDraft.sessionEx : exercises,
            currentLogData,
            currentLabels
        );
        const beforeNames = currentSessionExercises.map((exercise) => exercise.name);

        if (!remove) {
            setMuscleEx((prev) => {
                const next = { ...prev };

                tgts.forEach((label) => {
                    const list = next[label] || [];

                    if (!list.find((e) => e.name === name)) {
                        next[label] = [...list, { id: Date.now(), name }];
                    }
                    setExerciseOverrideForLabel(name, label);
                });

                return next;
            });
        }

        if (!remove) {
            addExToSession(name, labelOverride, { action });
        } else {
            const normalizedName = normalizeExerciseName(name);
            const nextSession = currentSessionExercises.filter((exercise) => normalizeExerciseName(exercise.name) !== normalizedName);
            const nextLogData = { ...currentLogData };
            delete nextLogData[name];
            const nextExerciseUnits = { ...currentExerciseUnits };
            delete nextExerciseUnits[name];
            tgts.forEach((label) => clearExerciseOverrideForLabel(name, label));
            const afterNames = nextSession.map((exercise) => exercise.name);
            const removedExerciseNames = beforeNames.filter((beforeName) => {
                const normalizedBefore = normalizeExerciseName(beforeName);
                return normalizedBefore && !afterNames.some((afterName) => normalizeExerciseName(afterName) === normalizedBefore);
            });
            const beforeSetCount = beforeNames.reduce((sum, exerciseName) => sum + ((currentLogData[exerciseName] || []).length || 0), 0);
            const afterSetCount = afterNames.reduce((sum, exerciseName) => sum + ((nextLogData[exerciseName] || []).length || 0), 0);

            console.log("[exercise mutation]", {
                action,
                env: getRuntimeEnvironmentLabel(),
                date: logDate,
                user_id: user?.id || null,
                addedExerciseName: null,
                removedExerciseNames,
                beforeExerciseNames: beforeNames,
                afterExerciseNames: afterNames,
                beforeSetCount,
                afterSetCount,
                selectedBodyPartFilter: labelOverride || todayLabels[0] || null,
                explicitDelete: true,
                allowed: true,
                blockedReason: null,
            });

            markWorkoutContentChanged(logDate, "exercise_delete", { explicitDelete: true });
            applyCurrentLogDraft({
                todayLabels: currentLabels,
                logData: nextLogData,
                sessionEx: nextSession,
                exerciseUnits: nextExerciseUnits,
            });
        }

    };

    const quickAddToSession = (name, remove, labelOverride, options) => {
        quickAdd(name, remove, labelOverride, options);
    };

    const handleAddAiWorkoutPlanToLog = (rawPlan) => {
        const plan = normalizeWorkoutPlan(rawPlan);
        if (!plan.length) return;

        const todayKey = getTodayKey();
        markWorkoutContentChanged(todayKey, "ai_workout_plan_add");
        const currentDraft = {
            todayLabels,
            logData,
            sessionEx,
            exerciseUnits,
        };

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
        const dayExercises = Object.entries(sourceHistory || {})
            .map(([name, recs]) => {
                const rec = (recs || []).find((record) => (
                    String(record?.date || record?.workoutDate || record?.workout_date || "").slice(0, 10) === dateStr
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
        };
    }, [getExUnit, history]);

    const logRestoreDecision = useCallback((dateStr, savedDraft, localDraft, finalDraft, source) => {
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

        const savedDraftForDate = buildSavedWorkoutDraftForDate(logDate, history);
        if (!savedDraftForDate.hasSavedWorkout) return;

        const currentDraft = {
            todayLabels,
            logData,
            sessionEx,
            exerciseUnits,
        };
        const currentDraftSignature = getWorkoutDraftSignature(currentDraft);
        const savedDraftSignature = getWorkoutDraftSignature(savedDraftForDate);
        if (currentDraftSignature === savedDraftSignature) {
            return;
        }

        const localDraft = loadDraftForDate(logDate);
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
            workoutDate: logDate,
        });
        const localMetrics = getDraftMetricsForDate({
            exercises: localDraft.sessionEx || [],
            logData: localDraft.logData || {},
            getExUnit: (name) => localDraft.exerciseUnits?.[name] || getExUnit(name),
            workoutDate: logDate,
        });
        const explicitLocalEdit = Boolean(explicitWorkoutEditDatesRef.current.has(String(logDate || "").slice(0, 10)));
        const localDraftIsCleanPersisted = isCleanPersistedDraft(localDraft);
        const localDraftHasUnsavedChanges = Boolean(localDraft?.meta?.hasUnsavedChanges === true || explicitLocalEdit);
        const localDraftCanOverrideSaved = Boolean(
            hasDraftContent(localDraft) &&
            !localDraftIsCleanPersisted &&
            localDraftHasUnsavedChanges
        );
        const {
            preserve: preserveRawLocalDraft,
            localRawMetrics,
            incomingRawMetrics: savedRawMetrics,
            removedExerciseNames,
        } = shouldPreserveRawDraftOverIncoming(localDraft, savedDraftForDate);

        console.log("[restore] restore_decision", {
            env: getRuntimeEnvironmentLabel(),
            user_id: user?.id || null,
            action: "restore_decision",
            date: logDate,
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

        if (localDraftCanOverrideSaved && (isDestructiveWorkoutRegression(savedMetrics, localMetrics) || preserveRawLocalDraft)) {
            console.warn("[restore] kept richer local draft instead of smaller saved workout", {
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                date: logDate,
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
            applyCurrentLogDraft(localDraft);
            logRestoreDecision(logDate, savedDraftForDate, localDraft, localDraft, "local_draft_richer_than_saved");
            return;
        }

        const cleanSavedDraft = withDraftMeta(savedDraftForDate, {
            source: "remote_supabase",
            remoteVerifiedAt: new Date().toISOString(),
            hasUnsavedChanges: false,
        });
        applyCurrentLogDraft(cleanSavedDraft);
        logRestoreDecision(logDate, cleanSavedDraft, localDraft, cleanSavedDraft, "supabase_saved_workout_refresh");
    }, [
        buildSavedWorkoutDraftForDate,
        applyCurrentLogDraft,
        exerciseUnits,
        history,
        historySyncReady,
        hasDraftContent,
        loadDraftForDate,
        logData,
        logDate,
        logRestoreDecision,
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
                    supabase
                        .from("workouts")
                        .select("date, data")
                        .eq("user_id", user.id)
                        .eq("date", normalizedDate)
                        .limit(1),
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
                        query: "workouts.select(date,data).eq(user_id).eq(date).limit(1)",
                        responseData: workoutsRes.data,
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

                const remoteHistory = buildRemoteHistoryWithWorkoutRowsPriority(
                    workoutsRes.data || [],
                    sessionRes.error ? [] : (sessionRes.data ? [sessionRes.data] : [])
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
                const localDraftHasUnsavedChanges = Boolean(
                    localDraft?.meta?.hasUnsavedChanges === true ||
                    explicitLocalEdit ||
                    pendingLocalEdit
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
                const remoteWorkoutsHistory = buildHistoryFromWorkoutRows(workoutsRes.data || []);
                const nextWorkoutsDataHistory = applyLocalHistoryDates(
                    workoutsDataHistoryRef.current || latestHistoryRef.current || history || {},
                    remoteWorkoutsHistory,
                    [normalizedDate]
                );
                const savedDraftForDate = buildSavedWorkoutDraftForDate(normalizedDate, nextHistory);
                const cleanSavedDraftForDate = withDraftMeta(savedDraftForDate, {
                    source: "remote_supabase",
                    remoteVerifiedAt,
                    hasUnsavedChanges: false,
                });

                console.log("[restore] Supabase date refresh applied", {
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user.id,
                    date: normalizedDate,
                    supabase: remoteMetrics,
                    localStorage: localMetrics,
                    appliedExerciseNames: cleanSavedDraftForDate.sessionEx.map((ex) => ex.name),
                });

                if (serializeHistoryMap(nextHistory) !== serializeHistoryMap(latestHistoryRef.current || history || {})) {
                    setHistory(nextHistory);
                    persistHistoryForUser(user.id, nextHistory);
                }
                if (serializeHistoryMap(nextWorkoutsDataHistory) !== serializeHistoryMap(workoutsDataHistoryRef.current || {})) {
                    workoutsDataHistoryRef.current = nextWorkoutsDataHistory;
                    setWorkoutsDataHistory(nextWorkoutsDataHistory);
                    console.log("[home weekly summary] apply", {
                        source: "workouts.data",
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        requestId: "log-date-refresh",
                        applied: true,
                        reason: "log date workouts.data refresh",
                        ...getHomeWeeklySummaryDebug(nextWorkoutsDataHistory),
                    });
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
        user?.id,
    ]);

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
        const savedDraftForDate = buildSavedWorkoutDraftForDate(dateStr, history);
        const hasSavedWorkout = savedDraftForDate.hasSavedWorkout;
        const savedMetrics = getDraftMetricsForDate({
            exercises: savedDraftForDate.sessionEx,
            logData: savedDraftForDate.logData,
            getExUnit,
            workoutDate: dateStr,
        });
        const localMetrics = getDraftMetricsForDate({
            exercises: draftForDate.sessionEx || [],
            logData: draftForDate.logData || {},
            getExUnit: (name) => draftForDate.exerciseUnits?.[name] || getExUnit(name),
            workoutDate: dateStr,
        });
        const isActiveLocalRecording =
            dateStr === logDate &&
            workoutStartedForDate === dateStr &&
            hasDraftContent(currentDraft);
        const pendingChange = pendingWorkoutContentChangeDatesRef.current.get(String(dateStr || "").slice(0, 10)) || {};
        const explicitLocalEdit = Boolean(
            isExplicitWorkoutEditChange(pendingChange) ||
            explicitWorkoutEditDatesRef.current.has(String(dateStr || "").slice(0, 10))
        );
        const localDraftIsCleanPersisted = isCleanPersistedDraft(draftForDate);
        const localDraftHasUnsavedChanges = Boolean(
            draftForDate?.meta?.hasUnsavedChanges === true ||
            explicitLocalEdit ||
            isActiveLocalRecording
        );
        const localDraftIsRicher = isDestructiveWorkoutRegression(savedMetrics, localMetrics, {
            allowVolumeDecrease: explicitLocalEdit,
        });
        const {
            preserve: preserveRawLocalDraft,
            localRawMetrics,
            incomingRawMetrics: savedRawMetrics,
            removedExerciseNames,
        } = shouldPreserveRawDraftOverIncoming(draftForDate, savedDraftForDate);
        const localDraftCanOverrideSaved = hasDraftContent(draftForDate) &&
            !localDraftIsCleanPersisted &&
            localDraftHasUnsavedChanges;
        const shouldUseLocalDraft = localDraftCanOverrideSaved && (
            explicitLocalEdit ||
            isActiveLocalRecording ||
            localDraftIsRicher ||
            preserveRawLocalDraft
        );
        const shouldUseSavedWorkout = hasSavedWorkout && !shouldUseLocalDraft;

        console.log("[restore] restore_decision", {
            env: getRuntimeEnvironmentLabel(),
            user_id: user?.id || null,
            action: "restore_decision",
            date: dateStr,
            localDraftSource: draftForDate?.meta?.source || null,
            localDraftUpdatedAt: draftForDate?.meta?.updatedAt || null,
            localDraftRemoteVerifiedAt: draftForDate?.meta?.remoteVerifiedAt || null,
            localDraftHasUnsavedChanges: draftForDate?.meta?.hasUnsavedChanges ?? null,
            remoteUpdatedAt: null,
            localSetCount: localMetrics.setCount,
            remoteSetCount: savedMetrics.setCount,
            localIsNewerUnsavedDraft: localDraftCanOverrideSaved,
            appliedSource: shouldUseLocalDraft ? "localDraft" : shouldUseSavedWorkout ? "remoteSupabase" : "emptyDraft",
            rejectedSource: shouldUseLocalDraft ? "remoteSupabase" : "localDraft",
            reason: localDraftIsCleanPersisted
                ? "local draft is clean persisted data"
                : localDraftCanOverrideSaved
                    ? "local draft has unsaved changes"
                    : "local draft is not unsaved; saved workout can be used",
        });

        if (shouldUseLocalDraft) {
            console.warn("[restore] local draft selected for log date", {
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                date: dateStr,
                action: "restore_apply",
                source: "draft_restore",
                dirty: Boolean(explicitLocalEdit || isActiveLocalRecording),
                explicitEdit: explicitLocalEdit,
                localDraftIsRicher,
                preserveRawLocalDraft,
                localRawMetrics,
                savedRawMetrics,
                removedExerciseNames,
                restoreApplied: true,
                overwrittenByRestore: false,
            });
            markWorkoutContentChanged(
                dateStr,
                localDraftIsRicher || explicitLocalEdit ? "local_draft_richer_restore" : "active_local_recording_restore",
                { explicitEdit: explicitLocalEdit }
            );
            applyLogDraftState(draftForDate);
            logRestoreDecision(
                dateStr,
                savedDraftForDate,
                draftForDate,
                draftForDate,
                localDraftIsRicher ? "local_draft_richer_than_saved" : "active_local_recording"
            );
            setScreen("log");
            return;
        }

        if (shouldUseSavedWorkout) {
            const cleanSavedDraft = withDraftMeta(savedDraftForDate, {
                source: "remote_supabase",
                remoteVerifiedAt: new Date().toISOString(),
                hasUnsavedChanges: false,
            });
            saveDraftForDate(dateStr, cleanSavedDraft);
            applyLogDraftState(cleanSavedDraft);
            logRestoreDecision(dateStr, cleanSavedDraft, draftForDate, cleanSavedDraft, "supabase_saved_workout");
            setScreen("log");
            return;
        }

        if (hasDraftContent(draftForDate)) {
            if (localDraftIsRicher && !hasSavedWorkout) {
                console.warn("[restore] using richer local draft for date", {
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user?.id || null,
                    date: dateStr,
                    local: localMetrics,
                    saved: savedMetrics,
                });
            }
            applyLogDraftState(draftForDate);
            logRestoreDecision(dateStr, savedDraftForDate, draftForDate, draftForDate, localDraftIsRicher && !hasSavedWorkout ? "local_draft_richer_than_saved" : "local_draft");
        } else {
            applyLogDraftState({ todayLabels: [], sessionEx: null, logData: {}, exerciseUnits: {} });
            logRestoreDecision(dateStr, savedDraftForDate, draftForDate, { sessionEx: [] }, "empty");
        }

        setScreen("log");
    };


    // ② カレンダークリック用（分岐だけ）
    const handleCalendarDayOpen = (dateStr) => {
        handleLogForDate(dateStr);
    };

    const handleEditHistory = async (exName, updatedRecord, historyIdx) => {
        const editDate = String(updatedRecord?.date || "").slice(0, 10);
        markWorkoutContentChanged(editDate, "history_record_edit", { explicitEdit: true });

        const currentHistory = mergeHistoryMaps(latestHistoryRef.current || {});
        const recs = [...(currentHistory[exName] || [])];
        const idx = historyIdx !== undefined
            ? historyIdx
            : recs.findIndex(r => r.date === updatedRecord.date);
        const sanitizedRecord = sanitizeHistoryRecord(updatedRecord, { allowBodyweight: true });

        if (!sanitizedRecord) return;

        const recsWithoutSameDate = recs.filter((record, recordIndex) => {
            if (idx >= 0 && recordIndex === idx) return false;
            return String(record?.date || record?.workoutDate || record?.workout_date || "").slice(0, 10) !== editDate;
        });

        const nextHistory = {
            ...currentHistory,
            [exName]: [...recsWithoutSameDate, sanitizedRecord].sort((a, b) =>
                String(a?.date || "").localeCompare(String(b?.date || ""))
            ),
        };
        latestHistoryRef.current = nextHistory;
        setHistory(nextHistory);
        workoutsDataHistoryRef.current = applyLocalHistoryDates(
            workoutsDataHistoryRef.current || currentHistory,
            nextHistory,
            [editDate]
        );
        setWorkoutsDataHistory(workoutsDataHistoryRef.current);
        persistHistoryForUser(user?.id, nextHistory);

        let directSyncSucceeded = false;
        if (user?.id && editDate) {
            try {
                const rowResult = await syncWorkoutRowsForDates(user.id, nextHistory, [editDate]);
                if (rowResult.failedDates.includes(editDate) || rowResult.skippedDates.includes(editDate)) {
                    throw new Error(`workouts sync did not apply ${editDate}`);
                }
                const sessionResult = await syncWorkoutSessionSnapshot(user.id, nextHistory, editDate);
                if (sessionResult?.skipped) {
                    throw new Error(`workout_sessions sync skipped ${editDate}`);
                }
                pendingWorkoutContentChangeDatesRef.current.delete(editDate);
                pendingWorkoutSessionSyncDatesRef.current.delete(editDate);
                explicitWorkoutEditDatesRef.current.delete(editDate);
                clearSyncFailure(editDate);
                const savedDraft = withDraftMeta(buildWorkoutDraftForDateFromHistory(editDate, nextHistory), {
                    source: "save_verified",
                    remoteVerifiedAt: new Date().toISOString(),
                    hasUnsavedChanges: false,
                });
                if (savedDraft.hasSavedWorkout) {
                    saveDraftForDate(editDate, savedDraft);
                    if (editDate === logDate) {
                        applyLogDraftState(savedDraft);
                    }
                }
                directSyncSucceeded = true;
            } catch (e) {
                recordSyncFailure(editDate, e, "history_edit");
                console.error("[handleEditHistory] direct sync failed", e);
            }
        }

        if (!directSyncSucceeded) queueWorkoutSessionSync(editDate);
    };

    const handleDeleteHistory = (exName, historyIdx, recordDate, setIdx) => {
        markWorkoutContentChanged(recordDate, setIdx !== undefined ? "set_delete" : "history_record_delete", { explicitDelete: true });
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
            applyLogDraftState({
                todayLabels: dateDraft.todayLabels,
                logData: nextDraftLog,
                sessionEx: nextDraftSession,
                exerciseUnits: nextDraftUnits,
            });
        }
    };

    const deleteAllHistoryForDate = (targetDate) => {
        const normalizedTargetDate = String(targetDate || "").trim();
        if (!normalizedTargetDate) return;
        markWorkoutContentChanged(normalizedTargetDate, "date_delete", { explicitDelete: true });

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
            applyLogDraftState({ todayLabels: [], logData: {}, sessionEx: null, exerciseUnits: {} });
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
        commitHistoryDeleteMarkers({
            dates: (historyDeleteMarkersRef.current?.dates || []).filter((date) => date !== pending.date),
            records: (historyDeleteMarkersRef.current?.records || []).filter((key) => !String(key || "").startsWith(`${pending.date}::`)),
        });

        saveDraftForDate(pending.date, pending.previousDraft || {});
        if (logDate === pending.date) {
            applyLogDraftState(pending.previousDraft || {
                todayLabels: [],
                logData: {},
                sessionEx: null,
                exerciseUnits: {},
            });
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
        applyLogDraftState,
        clearSyncFailure,
        commitHistoryDeleteMarkers,
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
                        <div
                            onPointerDownCapture={handleLogScreenInputPointerDownCapture}
                            onFocusCapture={handleLogScreenFocusCapture}
                            onBlurCapture={handleLogScreenBlurCapture}
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
                                        setWeightMode={setWeightMode}
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
                                        onSetInputFocusChange={handleLogSetInputFocusChange}
                                        focusExerciseRequest={logExerciseFocusRequest}
                                        onFocusExerciseHandled={(request) => {
                                            setLogExerciseFocusRequest((current) =>
                                                current?.nonce === request?.nonce ? null : current
                                            );
                                        }}
                                        lastActiveExercise={lastActiveLogExerciseByDate?.[logDate] || null}
                                        onActiveExerciseChange={handleLogExerciseActiveChange}
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
                        <FriendsScreen
                            mode="feed"
                            history={history}
                            historySyncDiagnostic={historySyncDiagnostic}
                            manualBests={manualBests}
                            sessionSyncVersion={sessionSyncVersion}
                            deletedWorkoutDates={historyDeleteMarkersRef.current?.dates || []}
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
                        <HistoryScreen
                            history={canonicalDisplayHistory}
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
                            onOpenWorkoutDayShare={openWorkoutDayShareModal}
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
                                if (nextScreen === "log") {
                                    handleLogForDate(getTodayKey());
                                    return;
                                }
                                if (screen === "log") {
                                    persistCurrentLog();
                                }
                                setScreen(nextScreen);
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
