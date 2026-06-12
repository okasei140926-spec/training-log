// appHelpers.js — module-level utilities extracted from App.jsx
// These are pure helper functions and constants, no React imports needed.

import {
    load,
    save,
    storeW,
    buildHistoryFromWorkoutRowsWithScopes,
    formatDateKey,
    getRecordSourceSets,
    mergeHistoryMaps,
    sanitizeHistoryRecord,
    sanitizeWorkoutSets,
} from "./helpers";
import { buildTrustedHistory } from "../features/workout/buildTrustedHistory";
import { buildWorkoutSessionPayloadFromDraft } from "./workoutSessions";
import { SUGGESTIONS } from "../constants/suggestions";
import { normalizeExerciseName } from "./exerciseName";
import { APP_VERSION, HISTORY_CACHE_SCHEMA_VERSION } from "../appVersion";

export const debugLog = (...args) => {
    if (process.env.NODE_ENV !== "production") console.debug(...args);
};

export const getPerfNow = () => (
    typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now()
);

export const shouldLogPerfDebug = () => {
    if (typeof window === "undefined") return false;
    try {
        return window.localStorage?.getItem("pump_debug_perf") === "1"
            || window.localStorage?.getItem("pump_debug_history") === "1";
    } catch {
        return false;
    }
};

export const draftRestoreDateCheckLogSignatures = new Set();
export const logDraftRestoreDateCheck = (payload) => {
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

export const EX_TO_LABEL = {};
Object.entries(SUGGESTIONS).forEach(([label, names]) => {
    names.forEach((n) => {
        EX_TO_LABEL[n] = label;
    });
});

export const getExerciseRecordBodyPart = (exercise, fallbackLabel) =>
    exercise?.bodyPart || exercise?.label || fallbackLabel || EX_TO_LABEL[exercise?.name] || null;

export const TRACKED_WORKOUT_DEBUG_EXERCISES = [
    "シーテッドレッグカール",
    "ルーマニアンデッドリフト",
    "ハイパーエクステンション",
    "アダクター",
    "懸垂",
];

export const mergeDraftExercisesWithLogData = (exercises = [], logData = {}, labels = []) => {
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

export const normalizeSetWeightMode = (value) => {
    const unit = String(value || "kg").toLowerCase();
    if (unit === "lbs" || unit === "lb" || unit === "pound" || unit === "pounds") return "lbs";
    if (unit === "bw" || unit === "bodyweight") return "BW";
    return "kg";
};

export const getSetWeightMode = (set, fallbackUnit = "kg") =>
    normalizeSetWeightMode(
        set?.weightMode
        || set?.weightType
        || set?.displayUnit
        || set?.unit
        || set?.weightUnit
        || set?.weight_unit
        || fallbackUnit
    );

export const getSetDisplayUnit = (set, fallbackUnit = "kg") => {
    const mode = getSetWeightMode(set, fallbackUnit);
    return mode === "lbs" ? "lb" : mode;
};

export const storeSetWeightForUnit = (set, fallbackUnit = "kg") => {
    const mode = getSetWeightMode(set, fallbackUnit);
    if (mode === "BW" || String(set?.weight || "").toUpperCase() === "BW") return "BW";
    return storeW(set?.weight, mode);
};

export const normalizeDraftSetFromRecord = (set, fallbackUnit = "kg") => {
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

export const HISTORY_OWNER_KEY = "historyOwnerUserId";
export const getUserHistoryCacheKey = (userId) => `history_cache_${userId}`;
export const getHistoryDeleteMarkersKey = (userId) => `historyDeleteMarkers_${userId}`;
export const EXERCISE_BODY_PART_OVERRIDES_KEY = "exerciseBodyPartOverrides";
export const isPlainObject = (value) =>
    !!value && typeof value === "object" && !Array.isArray(value);

export const serializeHistoryMap = (historyMap) => JSON.stringify(historyMap || {});
export const PUSH_PROMPT_LATER_KEY = "pushPromptLaterDate";
export const APP_VERSION_STORAGE_KEY = "pumpAppVersion";

export const getDateDaysAgoKey = (days) => {
    const date = new Date();
    date.setDate(date.getDate() - Number(days || 0));
    return formatDateKey(date);
};

export const getNextMonthPrefix = (prefix) => {
    const [year, month] = String(prefix || "").split("-").map(Number);
    if (!year || !month) return "";
    const date = new Date(year, month, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

export const logRecordFetchError = (operation, table, error, context = {}) => {
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

export const attachRecordFetchContext = (error, context) => {
    if (error && typeof error === "object") {
        error.__recordFetchContext = context;
        return error;
    }
    const wrapped = new Error(String(error || "Supabase fetch failed"));
    wrapped.__recordFetchContext = context;
    return wrapped;
};

export const getHistoryLoadErrorMessage = (error) => {
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

export const getRuntimeEnvironmentLabel = () => {
    if (typeof window === "undefined") return "server";
    const protocol = window.location?.protocol || "";
    if (protocol === "capacitor:") return "ios-capacitor";
    return protocol.replace(":", "") || "web";
};

export const isTransientSupabaseFetchError = (error) => {
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

export const getWorkoutDraftSignature = (draft) => JSON.stringify({
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

export const unwrapVersionedHistoryCache = (value, { allowLegacy = false } = {}) => {
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

export const buildVersionedHistoryCache = (historyMap) => ({
    __schema: "pump.history_cache",
    schemaVersion: HISTORY_CACHE_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    savedAt: new Date().toISOString(),
    history: historyMap || {},
});

export const loadTrustedHistoryCache = (key, fallback = null) => {
    const raw = load(key, null);
    const trusted = unwrapVersionedHistoryCache(raw, { allowLegacy: false });
    return trusted || fallback;
};

export const persistHistoryForUser = (userId, nextHistory) => {
    const versionedHistory = buildVersionedHistoryCache(nextHistory);
    save("history", versionedHistory);

    if (userId) {
        save(getUserHistoryCacheKey(userId), versionedHistory);
        save(HISTORY_OWNER_KEY, userId);
    }
};

export const clearVersionedAppCachesIfNeeded = () => {
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

export const createEmptyHistoryDeleteMarkers = () => ({
    dates: [],
    records: [],
});

export const normalizeHistoryDeleteMarkers = (markers) => {
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

export const buildHistoryRecordDeleteKey = (date, exerciseName) =>
    `${String(date || "").slice(0, 10)}::${normalizeExerciseName(exerciseName)}`;

export const applyHistoryDeleteMarkers = (historyMap, markers) => {
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

export const describeHistoryRecordsForDate = (historyMap, targetDate) => {
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

export const EXPLICIT_SET_EDIT_REASONS = new Set(["weight_change", "reps_change", "unit_change", "set_input_change", "explicit_set_edit"]);
export const EXPLICIT_WORKOUT_EDIT_REASONS = new Set([
    ...EXPLICIT_SET_EDIT_REASONS,
    "history_record_edit",
    "exercise_add",
    "set_add",
    "exercise_reorder",
]);

export const isExplicitWorkoutEditChange = (pendingChange = {}) =>
    Boolean(pendingChange.explicitEdit || EXPLICIT_WORKOUT_EDIT_REASONS.has(pendingChange.reason));

export const normalizeWorkoutEditSource = (source) =>
    String(source || "").replace(/^useWorkoutLog:/, "");

export const getWorkoutEditReasonFromSource = (source) => {
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

export const isUnsavedUserWorkoutDraft = (draft = {}) =>
    Boolean(
        draft?.meta?.hasUnsavedChanges === true &&
        getWorkoutEditReasonFromSource(draft?.meta?.source)
    );

export const getSetEditUnit = (set, fallbackUnit = "kg") =>
    normalizeSetWeightMode(
        set?.weightMode
        || set?.weightType
        || set?.displayUnit
        || set?.unit
        || set?.weightUnit
        || set?.weight_unit
        || fallbackUnit
    );

export const getSetEditDisplayWeight = (set) => {
    const value = set?.displayWeight ?? set?.weight;
    return String(value ?? "").trim();
};

export const getSetEditSummary = (set, fallbackUnit = "kg") => ({
    weight: getSetEditDisplayWeight(set),
    unit: getSetEditUnit(set, fallbackUnit),
    reps: String(set?.reps ?? "").trim(),
});

export const normalizeEditCompareValue = (value) => {
    const text = String(value ?? "").trim();
    if (!text) return "";
    if (text.toUpperCase() === "BW") return "BW";
    const num = Number(text);
    return Number.isFinite(num) ? String(Math.round(num * 1000) / 1000) : text;
};

export const findEditedSetInHistory = (historyMap, targetDate, exerciseName, setIndex = 0) => {
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

export const isEditedSetPersisted = (expectedSet, actualSet) => {
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

export const getEmptyWorkoutMetrics = (updatedAt = null) => ({
    hasWorkout: false,
    exerciseCount: 0,
    setCount: 0,
    volume: 0,
    exerciseNames: [],
    updatedAt: updatedAt || null,
});

export const roundWorkoutMetric = (value) => Math.round(Number(value || 0) * 10) / 10;

export const getHistoryMetricsForDate = (historyMap, targetDate, { updatedAt = null } = {}) => {
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

export const getWorkoutSummaryMetrics = (summaryJson, { totalVolume = null, exerciseCount = null, updatedAt = null } = {}) => {
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

export const getWorkoutPayloadMetrics = (payload, { updatedAt = null } = {}) =>
    getWorkoutSummaryMetrics(payload?.session?.summary_json, {
        totalVolume: payload?.session?.total_volume,
        exerciseCount: payload?.session?.exercise_count,
        updatedAt,
    });

export const getDraftMetricsForDate = ({ exercises = [], logData = {}, getExUnit, workoutDate }) => {
    const payload = buildWorkoutSessionPayloadFromDraft({
        exercises: mergeDraftExercisesWithLogData(exercises, logData),
        logData,
        getExUnit,
        workoutDate,
    });
    return getWorkoutPayloadMetrics(payload);
};

export const isDestructiveWorkoutRegression = (incomingMetrics, existingMetrics, options = {}) => {
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

export const getWorkoutRegressionDetails = (incomingMetrics = {}, existingMetrics = {}) => {
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

export const getWorkoutSaveGuardDecision = ({
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

export const isMetricPersistenceMismatch = (expectedMetrics, actualMetrics) => {
    if (!expectedMetrics?.hasWorkout && !actualMetrics?.hasWorkout) return false;
    if (expectedMetrics?.exerciseCount !== actualMetrics?.exerciseCount) return true;
    if (expectedMetrics?.setCount !== actualMetrics?.setCount) return true;
    if (Math.abs(Number(expectedMetrics?.volume || 0) - Number(actualMetrics?.volume || 0)) > 0.01) return true;

    const expectedNames = [...new Set((expectedMetrics?.exerciseNames || []).map((name) => normalizeExerciseName(name)).filter(Boolean))].sort();
    const actualNames = [...new Set((actualMetrics?.exerciseNames || []).map((name) => normalizeExerciseName(name)).filter(Boolean))].sort();
    return JSON.stringify(expectedNames) !== JSON.stringify(actualNames);
};

export const logWorkoutPersistenceDecision = ({
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

export const buildHistoryFromWorkoutSessionRows = (sessionRows = []) => {
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

export const removeHistoryDateFromMap = (historyMap, targetDate) => {
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

export const applyPreferredHistoryDates = (baseHistory, preferredHistory, dates = []) => {
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

export const removeExerciseRecordOnDate = (historyMap, exerciseName, targetDate) => {
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

export const buildRemoteHistoryWithWorkoutRowsPriority = (workoutRows = [], sessionRows = []) => {
    return buildTrustedHistory({
        workoutRows,
        sessionRows,
        source: "remote_workouts_priority",
        log: shouldLogPerfDebug(),
    }).history;
};

export const normalizeTrustedWorkoutRowDate = (row) => (
    String(row?.date || row?.workout_date || row?.workoutDate || "").slice(0, 10)
);

export const normalizeTrustedSessionRowDate = (row) => (
    String(row?.workout_date || row?.date || row?.workoutDate || "").slice(0, 10)
);

export const sortTrustedRowsByDate = (rows = [], getDate = normalizeTrustedWorkoutRowDate) => (
    [...(rows || [])].sort((a, b) => getDate(a).localeCompare(getDate(b)))
);

export const mergeTrustedRowsByDate = (currentRows = [], incomingRows = [], getDate = normalizeTrustedWorkoutRowDate) => {
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

export const serializeTrustedRows = (rows = [], getDate = normalizeTrustedWorkoutRowDate) => (
    JSON.stringify(sortTrustedRowsByDate(rows || [], getDate).map((row) => ({
        date: getDate(row),
        data: row?.data ?? row?.summary_json ?? row,
        duration_sec: row?.duration_sec ?? null,
        total_volume: row?.total_volume ?? null,
        updated_at: row?.updated_at ?? null,
    })))
);

export const serializeTrustedRow = (row, getDate = normalizeTrustedWorkoutRowDate) => (
    JSON.stringify({
        date: getDate(row),
        data: row?.data ?? row?.summary_json ?? row,
        duration_sec: row?.duration_sec ?? null,
        total_volume: row?.total_volume ?? null,
        updated_at: row?.updated_at ?? null,
    })
);

export const buildTrustedRowSignatureMap = (rows = [], getDate = normalizeTrustedWorkoutRowDate) => {
    const map = new Map();
    (rows || []).forEach((row) => {
        const date = getDate(row);
        if (date) map.set(date, serializeTrustedRow(row, getDate));
    });
    return map;
};

export const buildDraftHistoryForDate = ({
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

export const getHistoryDebugSummaryForDate = (historyMap, targetDate) => {
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

export const getHistoryDebugDiffForDate = (beforeHistory, afterHistory, targetDate) => {
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

export const getDraftInputDebugSummary = ({ exercises = [], logData = {}, labels = [] } = {}) => {
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

export const getRawDraftSetMetrics = ({ exercises = [], logData = {}, labels = [] } = {}) => {
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

export const getRemovedRawDraftExerciseNames = (beforeDraft = {}, afterDraft = {}) => {
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

export const shouldPreserveRawDraftOverIncoming = (localDraft = {}, incomingDraft = {}) => {
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

export const makeDraftMeta = (meta = {}, overrides = {}) => {
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

export const withDraftMeta = (draft = {}, overrides = {}) => ({
    ...draft,
    meta: makeDraftMeta(draft?.meta || {}, overrides),
});

export const normalizeDraftDateKey = (value) => String(value || "").slice(0, 10);

export const getDraftDateCandidates = (draft = {}) => {
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

export const getDraftPayloadDate = (draft = {}) => {
    const candidates = getDraftDateCandidates(draft);
    return Object.values(candidates).find(Boolean) || "";
};

export const getDraftDateValidation = (keyDate, draft = {}, selectedDate = keyDate) => {
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

export const withDraftDateMeta = (dateStr, draft = {}, overrides = {}) => {
    const normalizedDate = normalizeDraftDateKey(dateStr);
    return withDraftMeta(draft, {
        ...overrides,
        date: normalizedDate,
        keyDate: normalizedDate,
        draftDate: normalizedDate,
        workoutDate: normalizedDate,
    });
};

export const isCleanPersistedDraft = (draft = {}) => (
    draft?.meta?.hasUnsavedChanges === false &&
    ["save_verified", "remote_supabase"].includes(draft?.meta?.source)
);

export const getTimestampMs = (value) => {
    const ms = Date.parse(value || "");
    return Number.isFinite(ms) ? ms : 0;
};

export const isDraftNewerThan = (draft = {}, timestamp) => {
    const draftMs = getTimestampMs(draft?.meta?.updatedAt);
    const targetMs = getTimestampMs(timestamp);
    return draftMs > 0 && targetMs > 0 && draftMs > targetMs;
};

export const normalizeLogDraftState = (draft = {}) => {
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

export const getCurrentWeekRangeForHomeSummary = () => {
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

export const getHistoryOverallMetrics = (historyMap) => {
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

export const getWorkoutRowsDebugSummary = (rows = []) => {
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

export const getWorkoutSessionRowsDebugSummary = (rows = []) => ({
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

export const normalizeHomeSummaryBodyPart = (label) => {
    const raw = String(label || "").trim();
    if (raw === "ハムストリングス" || raw === "ハムストリング" || raw === "大腿二頭筋") return "ハム";
    if (raw === "腹") return "腹筋";
    return raw || "その他";
};

export const getHomeWeeklySummaryDebug = (historyMap, { start, end } = getCurrentWeekRangeForHomeSummary()) => {
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

export const HOME_WEEKLY_DEBUG_DATE = "2026-06-03";

export const getHistoryDatesInRange = (historyMap, { start, end } = getCurrentWeekRangeForHomeSummary()) => {
    const dates = new Set();
    Object.values(historyMap || {}).forEach((records) => {
        (records || []).forEach((record) => {
            const date = String(record?.date || record?.workoutDate || record?.workout_date || "").slice(0, 10);
            if (date && date >= start && date <= end) dates.add(date);
        });
    });
    return [...dates].sort();
};

export const getHomeWeeklyDateDebug = (historyMap, targetDate = HOME_WEEKLY_DEBUG_DATE) => {
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

export const getHomePropsDateDebug = (historyMap, targetDates = []) => {
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

export const getHomeWeeklySourceDebug = ({
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

export const getHomeWeeklyStaleRegressionDecision = (
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

export const attachWorkoutDurationToHistoryDate = (historyMap, targetDate, durationSecValue) => {
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

export const buildWorkoutDraftForDateFromHistory = (dateStr, sourceHistory = {}) => {
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

