import { lazy, Suspense, useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo } from "react";
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
const REMOTE_HISTORY_SESSION_LOOKBACK_DAYS = 180;
const REMOTE_HISTORY_SESSION_LIMIT = 400;
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

const isDestructiveWorkoutRegression = (incomingMetrics, existingMetrics) => {
    if (!existingMetrics?.hasWorkout) return false;
    if (!incomingMetrics?.hasWorkout) return true;

    const incomingNames = new Set((incomingMetrics.exerciseNames || []).map((name) => normalizeExerciseName(name)));
    const missingExistingNames = (existingMetrics.exerciseNames || [])
        .map((name) => normalizeExerciseName(name))
        .filter((name) => name && !incomingNames.has(name));

    return (
        missingExistingNames.length > 0 ||
        incomingMetrics.exerciseCount < existingMetrics.exerciseCount ||
        incomingMetrics.setCount < existingMetrics.setCount ||
        incomingMetrics.volume + 0.01 < existingMetrics.volume
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
    const workoutHistory = buildHistoryFromWorkoutRows(workoutRows || []);
    const sessionHistory = buildHistoryFromWorkoutSessionRows(sessionRows || []);
    const workoutDates = getValidWorkoutDatesFromHistory(workoutHistory);

    return applyPreferredHistoryDates(sessionHistory, workoutHistory, workoutDates);
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
        const meta = {
            updatedAt: new Date().toISOString(),
            exerciseNames: (sessionEx || []).map((exercise) => exercise.name),
            logDataNames: Object.keys(logData),
        };

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
    const [, setAuthReady] = useState(!isSupabaseConfigured);
    const [splashMinElapsed, setSplashMinElapsed] = useState(false);
    const [splashForceDone, setSplashForceDone] = useState(false);
    const processingInviteCodeRef = useRef("");

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
    const [history, setHistory] = useState(() => mergeHistoryMaps(load("history", {})));
    const [manualBests, setManualBests] = useState([]);
    const [historySyncReady, setHistorySyncReady] = useState(false);
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

    // eslint-disable-next-line no-unused-vars
    const { isDark, setIsDark, unit, setUnit, showOnboarding, completeOnboarding } = useSettings();
    const appThemeClassName = isDark ? "app-shell" : "theme-light app-shell";

    const getExUnit = useCallback((name) => {
        return exerciseUnits[name] ?? unit;
    }, [exerciseUnits, unit]);

    const pendingWorkoutContentChangeDatesRef = useRef(new Map());

    const setLogDataAndSaveDraft = useCallback((nextOrUpdater) => {
        setLogData((prev) => {
            const next =
                typeof nextOrUpdater === "function"
                    ? nextOrUpdater(prev)
                    : nextOrUpdater;
            const normalizedDate = String(logDate || "").slice(0, 10);
            if (normalizedDate) {
                const previousChange = pendingWorkoutContentChangeDatesRef.current.get(normalizedDate) || {};
                pendingWorkoutContentChangeDatesRef.current.set(normalizedDate, {
                    reason: "set_update",
                    explicitDelete: Boolean(previousChange.explicitDelete),
                    updatedAt: new Date().toISOString(),
                });
            }

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
        activatePumpPro,
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
    } = useAI(history);

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
        pendingWorkoutContentChangeDatesRef.current.set(normalizedDate, {
            reason,
            explicitDelete: Boolean(previous.explicitDelete || options.explicitDelete),
            updatedAt: new Date().toISOString(),
        });
        queueWorkoutSessionSync(normalizedDate);
    }, [queueWorkoutSessionSync]);

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
                    const wouldDestructivelyOverwrite = isDestructiveWorkoutRegression(incomingMetrics, remoteMetrics);
                    const pendingChange = pendingWorkoutContentChangeDatesRef.current.get(workoutDate) || {};
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
                            : hasWorkoutForDate
                                ? `allowed content edit: ${pendingChange.reason || "unknown"}`
                                : "allowed: no local workout for date",
                        level: wouldDestructivelyOverwrite && !allowDestructiveSave ? "warn" : "log",
                    });
                    console.log("[save] workouts.data before save", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: userId,
                        date: workoutDate,
                        saving: getHistoryDebugSummaryForDate(normalizedHistoryMap, workoutDate),
                        remote: existingWorkoutRow
                            ? getHistoryDebugSummaryForDate(existingWorkoutRow.data || {}, workoutDate)
                            : getHistoryDebugSummaryForDate({}, workoutDate),
                        diffFromRemote: getHistoryDebugDiffForDate(existingWorkoutRow?.data || {}, normalizedHistoryMap, workoutDate),
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

                    const { error } = hasWorkoutForDate
                        ? await supabase
                            .from("workouts")
                            .upsert({
                                user_id: userId,
                                date: workoutDate,
                                data: normalizedHistoryMap,
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
                    console.log("[save] workouts.data after save verified", {
                        env: getRuntimeEnvironmentLabel(),
                        user_id: userId,
                        date: workoutDate,
                        workoutsDataAfterSave: verifyWorkoutRow
                            ? getHistoryDebugSummaryForDate(verifyWorkoutRow.data || {}, workoutDate)
                            : getHistoryDebugSummaryForDate({}, workoutDate),
                        diffSavedVsVerified: getHistoryDebugDiffForDate(normalizedHistoryMap, verifyWorkoutRow?.data || {}, workoutDate),
                    });

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

            const [remoteWorkoutsRes, remoteSessionsRes] = await Promise.all([
                workoutsQuery.limit(500),
                sessionsQuery.limit(500),
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
    }, []);

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
        const wouldDestructivelyOverwrite = isDestructiveWorkoutRegression(incomingMetrics, remoteMetrics);
        const pendingChange = pendingWorkoutContentChangeDatesRef.current.get(normalizedDate) || {};
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
            const currentHistory = mergeHistoryMaps(latestHistoryRef.current || history || {});
            await Promise.all(failedDates.map(async (date) => {
                const hasWorkoutForDate = hasValidWorkoutOnDate(currentHistory, date);
                const previousFailure = syncFailuresByDateRef.current[date] || {};
                const isDeleteRetry = String(previousFailure.stage || "").startsWith("delete_");
                try {
                    if (hasWorkoutForDate) {
                        const rowSyncResults = await syncWorkoutRowsForDates(
                            user.id,
                            currentHistory,
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
                            await syncWorkoutSessionSnapshot(user.id, currentHistory, date);
                        } catch (sessionError) {
                            const remoteAlreadyHasWorkout = await hasRemoteWorkoutForDate(user.id, date);
                            console.error("[sync] workout session retry failed after workout row sync", {
                                date,
                                userId: user.id,
                                records: describeHistoryRecordsForDate(currentHistory, date),
                                error: sessionError,
                                message: sessionError?.message,
                                code: sessionError?.code,
                                details: sessionError?.details,
                                hint: sessionError?.hint,
                            });
                            if (!remoteAlreadyHasWorkout) throw sessionError;
                        }
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
                        await deleteRemoteWorkoutArtifactsForDate(user.id, date, currentHistory);
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
                        records: describeHistoryRecordsForDate(currentHistory, date),
                        error,
                        message: error?.message,
                        code: error?.code,
                        details: error?.details,
                        hint: error?.hint,
                    });
                }
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
        hasRemoteWorkoutForDate,
        history,
        recordSyncFailure,
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
                historyDeleteMarkersRef.current = createEmptyHistoryDeleteMarkers();
                if (isActive) setHistoryLoadError("");
                if (isActive) setHistorySyncReady(true);
                return;
            }

            if (isActive) {
                setHistorySyncReady(false);
                setHistoryLoadError("");
            }

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

            const effectiveDeleteMarkers = getCurrentHistoryDeleteMarkers();

            try {
                const sessionRangeStart = getDateDaysAgoKey(REMOTE_HISTORY_SESSION_LOOKBACK_DAYS);
                const [workoutsRes, sessionsRes] = await Promise.all([
                    supabase
                        .from("workouts")
                        .select("date, data")
                        .eq("user_id", user.id)
                        .gte("date", sessionRangeStart)
                        .order("date", { ascending: true })
                        .limit(REMOTE_HISTORY_SESSION_LIMIT),
                    supabase
                        .from("workout_sessions")
                        .select("workout_date, duration_sec, summary_json")
                        .eq("user_id", user.id)
                        .gte("workout_date", sessionRangeStart)
                        .order("workout_date", { ascending: true })
                        .limit(REMOTE_HISTORY_SESSION_LIMIT),
                ]);

                if (workoutsRes.error) {
                    const context = logRecordFetchError("history_initial_load", "workouts", workoutsRes.error, {
                        userId: user.id,
                        dateRange: { from: sessionRangeStart, limit: REMOTE_HISTORY_SESSION_LIMIT },
                        query: "workouts.select(date,data).eq(user_id).gte(date).order(date asc).limit",
                        responseData: workoutsRes.data,
                    });
                    throw attachRecordFetchContext(workoutsRes.error, context);
                }
                if (sessionsRes.error) {
                    logRecordFetchError("history_initial_load", "workout_sessions", sessionsRes.error, {
                        userId: user.id,
                        dateRange: { from: sessionRangeStart, limit: REMOTE_HISTORY_SESSION_LIMIT },
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

                const remoteHistory = applyHistoryDeleteMarkers(
                    buildRemoteHistoryWithWorkoutRowsPriority(
                        workoutsRes.data || [],
                        sessionsRes.error ? [] : (sessionsRes.data || [])
                    ),
                    effectiveDeleteMarkers
                );
                const hasRemoteWorkout = getValidWorkoutDatesFromHistory(remoteHistory).length > 0;
                const mergedHistory = hasRemoteWorkout
                    ? remoteHistory
                    : applyHistoryDeleteMarkers(localMergeCandidate, effectiveDeleteMarkers);

                console.log("[restore] Supabase priority load", {
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user.id,
                    source: hasRemoteWorkout ? "supabase" : "localStorage_fallback",
                    workoutsRows: workoutsRes.data?.length || 0,
                    sessionRows: sessionsRes.data?.length || 0,
                    supabaseDates: getValidWorkoutDatesFromHistory(remoteHistory),
                    localStorageDates: getValidWorkoutDatesFromHistory(localMergeCandidate),
                    appliedDates: getValidWorkoutDatesFromHistory(mergedHistory),
                });

                if (!isActive) return;

                historyRemoteLoadFailedRef.current = false;
                setHistoryLoadError("");
                setHistory(mergedHistory);
                persistHistoryForUser(user.id, mergedHistory);
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
                setHistoryLoadError(getHistoryLoadErrorMessage(error));
                const fallbackHistory = applyHistoryDeleteMarkers(localMergeCandidate, effectiveDeleteMarkers);
                setHistory(fallbackHistory);
            } finally {
                if (isActive) setHistorySyncReady(true);
            }
        };

        syncHistoryFromSupabase();

        return () => {
            isActive = false;
        };
    }, [getCurrentHistoryDeleteMarkers, historyReloadNonce, user]);

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
            .catch(() => {})
            .then(async () => {
                if (latestUserIdRef.current !== currentUserId) return;
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
                        mergeHistoryMaps(prev, mergedHistory),
                        effectiveDeleteMarkers
                    );
                    return serializeHistoryMap(reconciledHistory) === serializeHistoryMap(prev)
                        ? prev
                        : reconciledHistory;
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
                    pendingWorkoutContentChangeDatesRef.current.delete(date);
                    pendingWorkoutSessionSyncDatesRef.current.delete(date);
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
    ]);

    useEffect(() => {
        if (!user?.id || !historySyncReady) return;
        if (!["history", "calendar", "analytics"].includes(screen)) return;

        let cancelled = false;

        const refreshDisplayHistoryFromSupabase = async () => {
            const sessionRangeStart = getDateDaysAgoKey(REMOTE_HISTORY_SESSION_LOOKBACK_DAYS);
            const queryLabel = "display_history_refresh";

            try {
                const [workoutsRes, sessionsRes] = await Promise.all([
                    supabase
                        .from("workouts")
                        .select("date, data")
                        .eq("user_id", user.id)
                        .gte("date", sessionRangeStart)
                        .order("date", { ascending: true })
                        .limit(REMOTE_HISTORY_SESSION_LIMIT),
                    supabase
                        .from("workout_sessions")
                        .select("workout_date, duration_sec, summary_json")
                        .eq("user_id", user.id)
                        .gte("workout_date", sessionRangeStart)
                        .order("workout_date", { ascending: true })
                        .limit(REMOTE_HISTORY_SESSION_LIMIT),
                ]);

                if (workoutsRes.error) {
                    const context = logRecordFetchError(queryLabel, "workouts", workoutsRes.error, {
                        userId: user.id,
                        dateRange: { from: sessionRangeStart, limit: REMOTE_HISTORY_SESSION_LIMIT },
                        query: "workouts.select(date,data).eq(user_id).gte(date).order(date asc).limit",
                        responseData: workoutsRes.data,
                    });
                    throw attachRecordFetchContext(workoutsRes.error, context);
                }
                if (sessionsRes.error) {
                    logRecordFetchError(queryLabel, "workout_sessions", sessionsRes.error, {
                        userId: user.id,
                        dateRange: { from: sessionRangeStart, limit: REMOTE_HISTORY_SESSION_LIMIT },
                        query: "workout_sessions.select(workout_date,duration_sec,summary_json).eq(user_id).gte(workout_date).order(workout_date asc).limit",
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

                if (cancelled) return;

                const effectiveDeleteMarkers = getCurrentHistoryDeleteMarkers();
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
                if (!remoteDates.length) return;

                const currentHistory = latestHistoryRef.current || {};
                const nextHistory = applyHistoryDeleteMarkers(
                    applyLocalHistoryDates(currentHistory, remoteHistory, remoteDates),
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

                if (serializeHistoryMap(nextHistory) !== serializeHistoryMap(currentHistory)) {
                    setHistory(nextHistory);
                    persistHistoryForUser(user.id, nextHistory);
                }
                setHistoryLoadError("");
            } catch (error) {
                if (cancelled) return;
                console.error("[restore] display history refresh failed", {
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user.id,
                    screen,
                    table: error?.recordFetch?.table || "workouts",
                    query: error?.recordFetch?.query || "workouts.select(date,data).eq(user_id).gte(date).order(date asc).limit",
                    code: error?.code || null,
                    message: error?.message || String(error || "unknown error"),
                    details: error?.details || null,
                    hint: error?.hint || null,
                    responseData: error?.recordFetch?.responseData || null,
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
        historyReloadNonce,
        historySyncReady,
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
        hasRemoteWorkoutForDate,
        history,
        historySyncReady,
        recordSyncFailure,
        refreshHistorySyncDiagnostic,
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



    // ─── Per-exercise default unit ────────────────────
    const toggleExUnit = (name) => {
        markWorkoutContentChanged(logDate, "weight_mode_change");
        const currentUnit = getExUnit(name);
        const CYCLE = { kg: "lbs", lbs: "BW", BW: "kg" };
        const newUnit = CYCLE[currentUnit] || "kg";

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
        const wouldDestructivelyOverwrite = isDestructiveWorkoutRegression(incomingMetrics, existingMetrics);

        logWorkoutPersistenceDecision({
            action: "local_auto_persist_check",
            userId: user?.id,
            date: logDate,
            localMetrics: incomingMetrics,
            remoteMetrics: existingMetrics,
            reason: wouldDestructivelyOverwrite
                ? `pending guarded save: ${pendingChange.reason}`
                : `allowed content edit: ${pendingChange.reason}`,
        });

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
            persistHistoryForUser(user?.id, nextHistory);
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
        const currentSessionExercises = sessionEx !== null ? sessionEx : baseExercises;
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
        const nextSessionForDraft = alreadyInSession
            ? currentSessionExercises
            : [...currentSessionExercises, ex];

        console.log("[add-exercise] adding exercise", {
            name: trimmed,
            label,
            before: beforeNames,
            after: nextSessionForDraft.map((exercise) => exercise.name),
        });

        setSessionEx((p) => {
            const current = p !== null ? p : [...baseExercises];
            if (current.find((e) => normalizeExerciseName(e.name) === normalizedName)) {
                console.log("[add-exercise] duplicate ignored during state update", {
                    name: trimmed,
                    current: current.map((exercise) => exercise.name),
                });
                return current;
            }

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
            requestLogExerciseFocus(ex);
            startWorkoutTimerIfNeeded(logDate, { markAsActivity: true });
        }
    };

    const reorderEx = (fromIdx, toIdx) => {
        markWorkoutContentChanged(logDate, "exercise_reorder");
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
            markWorkoutContentChanged(logDate, "exercise_delete", { explicitDelete: true });
            // sessionExからも削除
            setSessionEx(prev => prev ? prev.filter(ex => ex.name !== name) : prev);
        }

    };

    const quickAddToSession = (name, remove, labelOverride) => {
        quickAdd(name, remove, labelOverride);
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
            const repsValue = Number.isFinite(reps) && reps > 0 ? String(Math.floor(reps)) : "";

            if (normalizedTargetUnit === "BW" || String(set?.weight || "").toUpperCase() === "BW") {
                return {
                    weight: "BW",
                    reps: repsValue,
                    done: Boolean(repsValue),
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
                reps: repsValue,
                done: Boolean(weightValue && repsValue),
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

        if (isDestructiveWorkoutRegression(savedMetrics, localMetrics)) {
            console.warn("[restore] kept richer local draft instead of smaller saved workout", {
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                date: logDate,
                local: localMetrics,
                saved: savedMetrics,
            });
            setTodayLabels(localDraft.todayLabels);
            setSessionEx(localDraft.sessionEx);
            setLogData(localDraft.logData);
            setExerciseUnits(localDraft.exerciseUnits);
            logRestoreDecision(logDate, savedDraftForDate, localDraft, localDraft, "local_draft_richer_than_saved");
            return;
        }

        saveDraftForDate(logDate, savedDraftForDate);
        setTodayLabels(savedDraftForDate.todayLabels);
        setSessionEx(savedDraftForDate.sessionEx);
        setLogData(savedDraftForDate.logData);
        setExerciseUnits(savedDraftForDate.exerciseUnits);
        logRestoreDecision(logDate, savedDraftForDate, localDraft, savedDraftForDate, "supabase_saved_workout_refresh");
    }, [
        buildSavedWorkoutDraftForDate,
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

                if (isDestructiveWorkoutRegression(remoteMetrics, localMetrics)) {
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
                const savedDraftForDate = buildSavedWorkoutDraftForDate(normalizedDate, nextHistory);

                console.log("[restore] Supabase date refresh applied", {
                    env: getRuntimeEnvironmentLabel(),
                    user_id: user.id,
                    date: normalizedDate,
                    supabase: remoteMetrics,
                    localStorage: localMetrics,
                    appliedExerciseNames: savedDraftForDate.sessionEx.map((ex) => ex.name),
                });

                if (serializeHistoryMap(nextHistory) !== serializeHistoryMap(latestHistoryRef.current || history || {})) {
                    setHistory(nextHistory);
                    persistHistoryForUser(user.id, nextHistory);
                }
                saveDraftForDate(normalizedDate, savedDraftForDate);
                setTodayLabels(savedDraftForDate.todayLabels);
                setSessionEx(savedDraftForDate.sessionEx);
                setLogData(savedDraftForDate.logData);
                setExerciseUnits(savedDraftForDate.exerciseUnits);
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
        const localDraftIsRicher = isDestructiveWorkoutRegression(savedMetrics, localMetrics);
        const shouldUseLocalDraft = hasDraftContent(draftForDate) && (localDraftIsRicher || isActiveLocalRecording);
        const shouldUseSavedWorkout = hasSavedWorkout && !shouldUseLocalDraft;

        if (shouldUseLocalDraft) {
            markWorkoutContentChanged(dateStr, localDraftIsRicher ? "local_draft_richer_restore" : "active_local_recording_restore");
            setTodayLabels(draftForDate.todayLabels);
            setSessionEx(draftForDate.sessionEx);
            setLogData(draftForDate.logData);
            setExerciseUnits(draftForDate.exerciseUnits);
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
            saveDraftForDate(dateStr, savedDraftForDate);
            setTodayLabels(savedDraftForDate.todayLabels);
            setSessionEx(savedDraftForDate.sessionEx);
            setLogData(savedDraftForDate.logData);
            setExerciseUnits(savedDraftForDate.exerciseUnits);
            logRestoreDecision(dateStr, savedDraftForDate, draftForDate, savedDraftForDate, "supabase_saved_workout");
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
            setTodayLabels(draftForDate.todayLabels);
            setSessionEx(draftForDate.sessionEx);
            setLogData(draftForDate.logData);
            setExerciseUnits(draftForDate.exerciseUnits);
            logRestoreDecision(dateStr, savedDraftForDate, draftForDate, draftForDate, localDraftIsRicher && !hasSavedWorkout ? "local_draft_richer_than_saved" : "local_draft");
        } else {
            setTodayLabels([]);
            setSessionEx(null);
            setLogData({});
            setExerciseUnits({});
            logRestoreDecision(dateStr, savedDraftForDate, draftForDate, { sessionEx: [] }, "empty");
        }

        setScreen("log");
    };


    // ② カレンダークリック用（分岐だけ）
    const handleCalendarDayOpen = (dateStr) => {
        handleLogForDate(dateStr);
    };

    const handleEditHistory = (exName, updatedRecord, historyIdx) => {
        markWorkoutContentChanged(updatedRecord?.date, "history_record_edit");
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
            setLogData(nextDraftLog);
            setSessionEx(nextDraftSession);
            setExerciseUnits(nextDraftUnits);
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
        commitHistoryDeleteMarkers({
            dates: (historyDeleteMarkersRef.current?.dates || []).filter((date) => date !== pending.date),
            records: (historyDeleteMarkersRef.current?.records || []).filter((key) => !String(key || "").startsWith(`${pending.date}::`)),
        });

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
    const syncFailureSignature = getSyncFailureSignature(syncFailuresByDate);
    const shouldShowSyncFailureBanner =
        isOnline &&
        syncFailureDates.length > 0 &&
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
                        history={displayHistory}
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
                        history={displayHistory}
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
                        history={displayHistory}
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
                        history={displayHistory}
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
                    onStartPro={activatePumpPro}
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
