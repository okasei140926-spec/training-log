import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../utils/supabase";
import {
    load,
    save,
    buildHistoryFromWorkoutRows,
    formatDateKey,
    getValidWorkoutDatesFromHistory,
} from "../utils/helpers";

// ─── Constants ───────────────────────────────────────────────────────────────
const REMOTE_HISTORY_SESSION_LOOKBACK_DAYS = 180;

// ─── Free tier date limit ─────────────────────────────────────────────────────
// Returns the date key for exactly 3 months ago (YYYY-MM-DD).
const getThreeMonthsAgoKey = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().slice(0, 10);
};

// For free users: ensure sessionRangeStart is never earlier than 3 months ago.
// "max(指定日, 3ヶ月前)" — if dateKey is already newer, keep it as-is.
const clampStartForFreeTier = (dateKey, isPro) => {
    if (isPro) return dateKey;
    const limit = getThreeMonthsAgoKey();
    return dateKey >= limit ? dateKey : limit;
};
const REMOTE_HISTORY_SESSION_LIMIT = 400;
const INITIAL_HOME_HISTORY_LOOKBACK_DAYS = 30;
const INITIAL_HOME_HISTORY_LIMIT = 80;
const HISTORY_RECOVERY_LIMIT = 250;

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useHistorySync({
    user,
    isPro = false,
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
    // module-level helpers from App.jsx passed as params
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
}) {
    // ─── State ────────────────────────────────────────────────────────────────
    const [trustedWorkoutRows, setTrustedWorkoutRows] = useState([]);
    const [trustedSessionRows, setTrustedSessionRows] = useState([]);
    const [historySyncReady, setHistorySyncReady] = useState(false);
    const [historyRemoteReady, setHistoryRemoteReady] = useState(false);
    const [historyLoadError, setHistoryLoadError] = useState("");

    // ─── Refs ─────────────────────────────────────────────────────────────────
    const historyRemoteLoadFailedRef = useRef(false);
    const trustedWorkoutRowsRef = useRef(trustedWorkoutRows);
    const trustedSessionRowsRef = useRef(trustedSessionRows);
    const trustedWorkoutRowSignaturesRef = useRef(buildTrustedRowSignatureMap(trustedWorkoutRows, normalizeTrustedWorkoutRowDate));
    const trustedSessionRowSignaturesRef = useRef(buildTrustedRowSignatureMap(trustedSessionRows, normalizeTrustedSessionRowDate));
    const trustedRowsOwnerRef = useRef(null);
    const displayHistoryRefreshRequestIdRef = useRef(0);
    const homeWeeklySummaryRequestIdRef = useRef(0);
    const historyHasTrustedRemoteSnapshotRef = useRef(false);
    const supabaseFetchInFlightRef = useRef(new Map());
    const supabaseFetchBackoffRef = useRef({});
    const supabaseFetchFreshUntilRef = useRef({});

    // ─── Callbacks ────────────────────────────────────────────────────────────

    const applyTrustedWorkoutRowsSnapshot = useCallback((rows = [], {
        replace = false,
        source = "workouts.data",
    } = {}) => {
        const deletedDates = new Set(historyDeleteMarkersRef.current?.dates || []);
        const incomingRows = (rows || [])
            .filter((row) => normalizeTrustedWorkoutRowDate(row))
            .filter((row) => !deletedDates.has(normalizeTrustedWorkoutRowDate(row)));
        if (!replace) {
            const hasIncomingChange = incomingRows.some((row) => {
                const date = normalizeTrustedWorkoutRowDate(row);
                return trustedWorkoutRowSignaturesRef.current.get(date) !== serializeTrustedRow(row, normalizeTrustedWorkoutRowDate);
            });
            if (!hasIncomingChange) {
                if (shouldLogPerfDebug()) {
                    const previousSignature = serializeTrustedRows(trustedWorkoutRowsRef.current || [], normalizeTrustedWorkoutRowDate);
                    console.log("[history] trusted row cache update", {
                        action: "trusted_row_cache_update",
                        source,
                        rowsCount: incomingRows.length,
                        rowsHash: previousSignature,
                        previousRowsHash: previousSignature,
                        skippedSameSnapshot: true,
                        stateUpdated: false,
                    });
                }
                return false;
            }
        }
        const nextRows = replace
            ? sortTrustedRowsByDate(incomingRows, normalizeTrustedWorkoutRowDate)
            : mergeTrustedRowsByDate(trustedWorkoutRowsRef.current || [], incomingRows, normalizeTrustedWorkoutRowDate);
        const previousSignature = serializeTrustedRows(trustedWorkoutRowsRef.current || [], normalizeTrustedWorkoutRowDate);
        const nextSignature = serializeTrustedRows(nextRows, normalizeTrustedWorkoutRowDate);
        if (previousSignature === nextSignature) {
            if (shouldLogPerfDebug()) {
                console.log("[history] trusted row cache update", {
                    action: "trusted_row_cache_update",
                    source,
                    rowsCount: nextRows.length,
                    rowsHash: nextSignature,
                    previousRowsHash: previousSignature,
                    skippedSameSnapshot: true,
                    stateUpdated: false,
                });
            }
            return false;
        }
        trustedWorkoutRowsRef.current = nextRows;
        trustedWorkoutRowSignaturesRef.current = buildTrustedRowSignatureMap(nextRows, normalizeTrustedWorkoutRowDate);
        setTrustedWorkoutRows(nextRows);
        if (shouldLogPerfDebug()) {
            console.log("[history] trusted row cache update", {
                action: "trusted_row_cache_update",
                source,
                replace,
                rowsCount: nextRows.length,
                rowsHash: nextSignature,
                previousRowsHash: previousSignature,
                skippedSameSnapshot: false,
                stateUpdated: true,
                dates: nextRows.map(normalizeTrustedWorkoutRowDate),
            });
        }
        return true;
    }, [
        historyDeleteMarkersRef,
        normalizeTrustedWorkoutRowDate,
        serializeTrustedRow,
        shouldLogPerfDebug,
        serializeTrustedRows,
        sortTrustedRowsByDate,
        mergeTrustedRowsByDate,
        buildTrustedRowSignatureMap,
    ]);

    const applyTrustedSessionRowsSnapshot = useCallback((rows = [], {
        replace = false,
        source = "workout_sessions.summary_json",
    } = {}) => {
        const incomingRows = (rows || []).filter((row) => normalizeTrustedSessionRowDate(row));
        if (!replace) {
            const hasIncomingChange = incomingRows.some((row) => {
                const date = normalizeTrustedSessionRowDate(row);
                return trustedSessionRowSignaturesRef.current.get(date) !== serializeTrustedRow(row, normalizeTrustedSessionRowDate);
            });
            if (!hasIncomingChange) {
                if (shouldLogPerfDebug()) {
                    const previousSignature = serializeTrustedRows(trustedSessionRowsRef.current || [], normalizeTrustedSessionRowDate);
                    console.log("[history] trusted row cache update", {
                        action: "trusted_row_cache_update",
                        source,
                        rowsCount: incomingRows.length,
                        rowsHash: previousSignature,
                        previousRowsHash: previousSignature,
                        skippedSameSnapshot: true,
                        stateUpdated: false,
                    });
                }
                return false;
            }
        }
        const nextRows = replace
            ? sortTrustedRowsByDate(incomingRows, normalizeTrustedSessionRowDate)
            : mergeTrustedRowsByDate(trustedSessionRowsRef.current || [], incomingRows, normalizeTrustedSessionRowDate);
        const previousSignature = serializeTrustedRows(trustedSessionRowsRef.current || [], normalizeTrustedSessionRowDate);
        const nextSignature = serializeTrustedRows(nextRows, normalizeTrustedSessionRowDate);
        if (previousSignature === nextSignature) {
            if (shouldLogPerfDebug()) {
                console.log("[history] trusted row cache update", {
                    action: "trusted_row_cache_update",
                    source,
                    rowsCount: nextRows.length,
                    rowsHash: nextSignature,
                    previousRowsHash: previousSignature,
                    skippedSameSnapshot: true,
                    stateUpdated: false,
                });
            }
            return false;
        }
        trustedSessionRowsRef.current = nextRows;
        trustedSessionRowSignaturesRef.current = buildTrustedRowSignatureMap(nextRows, normalizeTrustedSessionRowDate);
        setTrustedSessionRows(nextRows);
        if (shouldLogPerfDebug()) {
            console.log("[history] trusted row cache update", {
                action: "trusted_row_cache_update",
                source,
                replace,
                rowsCount: nextRows.length,
                rowsHash: nextSignature,
                previousRowsHash: previousSignature,
                skippedSameSnapshot: false,
                stateUpdated: true,
                dates: nextRows.map(normalizeTrustedSessionRowDate),
            });
        }
        return true;
    }, [
        normalizeTrustedSessionRowDate,
        serializeTrustedRow,
        shouldLogPerfDebug,
        serializeTrustedRows,
        sortTrustedRowsByDate,
        mergeTrustedRowsByDate,
        buildTrustedRowSignatureMap,
    ]);

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
    }, [isSupabaseFetchFresh, markSupabaseFetchFresh, getRuntimeEnvironmentLabel, isTransientSupabaseFetchError]);

    // ─── User owner reset effect ───────────────────────────────────────────────
    useEffect(() => {
        const nextOwner = user?.id || null;
        if (trustedRowsOwnerRef.current === nextOwner) return;
        trustedRowsOwnerRef.current = nextOwner;
        trustedWorkoutRowsRef.current = [];
        trustedSessionRowsRef.current = [];
        trustedWorkoutRowSignaturesRef.current = new Map();
        trustedSessionRowSignaturesRef.current = new Map();
        setTrustedWorkoutRows([]);
        setTrustedSessionRows([]);
    }, [user?.id]);

    // ─── syncHistoryFromSupabase effect ───────────────────────────────────────
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
                const sessionRangeStart = clampStartForFreeTier(
                    getDateDaysAgoKey(INITIAL_HOME_HISTORY_LOOKBACK_DAYS),
                    isPro
                );
                console.log("[history-limit] syncHistory initial", {
                    isPro,
                    sessionRangeStart,
                    threeMonthsAgo: getThreeMonthsAgoKey(),
                    clampApplied: !isPro && sessionRangeStart !== getDateDaysAgoKey(INITIAL_HOME_HISTORY_LOOKBACK_DAYS),
                });
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
                    const recoveryMinDate = clampStartForFreeTier("0000-01-01", isPro);
                    const recoveryFetchKey = `history_recovery_latest:${user.id}:${HISTORY_RECOVERY_LIMIT}:${recoveryMinDate}`;
                    console.log("[history-limit] recovery fetch", {
                        isPro,
                        recoveryMinDate,
                        clampApplied: !isPro,
                    });
                    const recoveryFetch = await runDedupeSupabaseFetch(
                        recoveryFetchKey,
                        async () => {
                            let recoveryWorkoutsQuery = supabase
                                .from("workouts")
                                .select("date, data")
                                .eq("user_id", user.id)
                                .order("date", { ascending: false })
                                .limit(HISTORY_RECOVERY_LIMIT);
                            let recoverySessionsQuery = supabase
                                .from("workout_sessions")
                                .select("workout_date, duration_sec, total_volume, exercise_count, summary_json")
                                .eq("user_id", user.id)
                                .order("workout_date", { ascending: false })
                                .limit(HISTORY_RECOVERY_LIMIT);
                            if (!isPro) {
                                recoveryWorkoutsQuery = recoveryWorkoutsQuery.gte("date", recoveryMinDate);
                                recoverySessionsQuery = recoverySessionsQuery.gte("workout_date", recoveryMinDate);
                            }
                            const [recoveryWorkoutsRes, recoverySessionsRes] = await Promise.all([
                                recoveryWorkoutsQuery,
                                recoverySessionsQuery,
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
                        applyTrustedWorkoutRowsSnapshot(workoutsRes.data || [], {
                            source: "history_initial_load conversion fallback",
                        });
                        if (!sessionsRes.error && !sessionsRes.skipped) {
                            applyTrustedSessionRowsSnapshot(sessionsRes.data || [], {
                                source: "history_initial_load conversion fallback",
                            });
                        }
                        applyWorkoutsDataHistorySnapshot(workoutsOnlyHistory, {
                            source: "workouts.data",
                            reason: "history_initial_load conversion fallback",
                            requestId: "initial-load",
                            weekRange: getCurrentWeekRangeForHomeSummary(),
                            workoutsHistory: workoutsOnlyHistory,
                        });
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
                markSupabaseFetchFresh(`display_history:history:${user.id}:${currentWeekRange.start}:${currentWeekRange.end}:${INITIAL_HOME_HISTORY_LIMIT}`, 45000);
                const initialSummaryHistory = sessionsRes.error || sessionsRes.skipped
                    ? {}
                    : buildHistoryFromWorkoutSessionRows(sessionsRes.data || []);
                const initialWorkoutsDataApplied = applyWorkoutsDataHistorySnapshot(appliedWorkoutsDataHistory, {
                    source: "workouts.data",
                    reason: "history_initial_load",
                    requestId: "initial-load",
                    weekRange: currentWeekRange,
                    workoutsHistory: appliedWorkoutsDataHistory,
                    summaryHistory: initialSummaryHistory,
                });

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
                if (shouldLogPerfDebug()) {
                    console.log("[home weekly summary] apply", {
                        source: "workouts.data",
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        requestId: "initial-load",
                        applied: initialWorkoutsDataApplied,
                        reason: "history_initial_load",
                        ...getHomeWeeklySummaryDebug(appliedWorkoutsDataHistory),
                        ...getHomeWeeklySourceDebug({
                            workoutsHistory: appliedWorkoutsDataHistory,
                            summaryHistory: initialSummaryHistory,
                            finalHistory: appliedWorkoutsDataHistory,
                            weekRange: currentWeekRange,
                            source: "workouts.data",
                            appliedSource: initialWorkoutsDataApplied ? "workouts.data" : "none",
                            ignoredStaleSource: sessionsRes.skipped
                                ? "summary_json skipped on initial load"
                                : "summary_json ignored for home weekly",
                        }),
                    });
                }

                if (!isActive) return;

                historyRemoteLoadFailedRef.current = false;
                historyHasTrustedRemoteSnapshotRef.current = true;
                applyTrustedWorkoutRowsSnapshot(workoutsRes.data || [], {
                    source: "history_initial_load",
                });
                if (!sessionsRes.error && !sessionsRes.skipped) {
                    applyTrustedSessionRowsSnapshot(sessionsRes.data || [], {
                        source: "history_initial_load",
                    });
                }
                setHistoryRemoteReady(true);
                setHistoryLoadError("");
                setHistory(mergedHistory);
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
        applyTrustedSessionRowsSnapshot,
        applyTrustedWorkoutRowsSnapshot,
        applyWorkoutsDataHistorySnapshot,
        getCurrentHistoryDeleteMarkers,
        historyReloadNonce,
        markSupabaseFetchFresh,
        runDedupeSupabaseFetch,
        user,
        HISTORY_OWNER_KEY,
        applyHistoryDeleteMarkers,
        attachRecordFetchContext,
        buildHistoryFromWorkoutSessionRows,
        buildRemoteHistoryWithWorkoutRowsPriority,
        buildVersionedHistoryCache,
        createEmptyHistoryDeleteMarkers,
        getCurrentWeekRangeForHomeSummary,
        getDateDaysAgoKey,
        getHistoryDeleteMarkersKey,
        getHistoryLoadErrorMessage,
        getHistoryOverallMetrics,
        getHomeWeeklySourceDebug,
        getHomeWeeklySummaryDebug,
        getRuntimeEnvironmentLabel,
        getUserHistoryCacheKey,
        getWorkoutRowsDebugSummary,
        getWorkoutSessionRowsDebugSummary,
        historyDeleteMarkersRef,
        isPlainObject,
        latestHistoryRef,
        loadTrustedHistoryCache,
        logRecordFetchError,
        normalizeHistoryDeleteMarkers,
        persistHistoryForUser,
        setHistory,
        setWorkoutsDataHistory,
        shouldLogPerfDebug,
        workoutsDataHistoryRef,
        isPro,
    ]);

    // ─── refreshDisplayHistoryFromSupabase effect ─────────────────────────────
    useEffect(() => {
        if (!user?.id || !historySyncReady) return;
        if (!["home", "calendar", "analytics", "log", "history"].includes(screen)) return;
        const trustedDisplayHistory = (workoutsDataHistory || {});
        const trustedHistoryMetrics = getHistoryOverallMetrics(trustedDisplayHistory);
        if (trustedHistoryMetrics.setCount > 0 && !["analytics", "home", "log", "history"].includes(screen)) {
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
        if (trustedHistoryMetrics.setCount > 0 && ["analytics", "home", "log", "history"].includes(screen)) {
            console.log("[home fetch] display_history background refresh for analytics PR", {
                env: getRuntimeEnvironmentLabel(),
                user_id: user.id,
                screen,
                source: "trustedHistory",
                applied: false,
                skipped: false,
                reason: "analytics PR refreshes workouts.data so stale PR/cache/manual data cannot remain authoritative",
                trustedHistory: trustedHistoryMetrics,
            });
        }

        let cancelled = false;

        const refreshDisplayHistoryFromSupabase = async () => {
            const requestId = displayHistoryRefreshRequestIdRef.current + 1;
            displayHistoryRefreshRequestIdRef.current = requestId;
            const queryLabel = "display_history_refresh";
            const weekRange = getCurrentWeekRangeForHomeSummary();
            const rawSessionRangeStart = screen === "calendar"
                ? `${formatDateKey(new Date()).slice(0, 7)}-01`
                : getDateDaysAgoKey(120);
            const sessionRangeStart = clampStartForFreeTier(rawSessionRangeStart, isPro);
            console.log("[history-limit] refreshDisplay", {
                isPro,
                screen,
                rawSessionRangeStart,
                sessionRangeStart,
                threeMonthsAgo: getThreeMonthsAgoKey(),
                clampApplied: sessionRangeStart !== rawSessionRangeStart,
            });
            const sessionRangeEnd = screen === "calendar"
                ? `${getNextMonthPrefix(formatDateKey(new Date()).slice(0, 7))}-01`
                : null;
            const displayHistoryLimit = screen === "calendar" ? 80 : 180;

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
                console.log("[refreshDisplay] about to runDedupeSupabaseFetch", {
                    screen,
                    displayFetchKey,
                    isFresh: isSupabaseFetchFresh(displayFetchKey),
                });
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
                    if (shouldLogPerfDebug()) console.log("[home weekly summary] ignore stale", {
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
                console.log("[refreshDisplay] dates after filter", {
                    screen,
                    workoutsRowsReturned: workoutsRes.data?.length || 0,
                    allRemoteDates: getValidWorkoutDatesFromHistory(remoteHistory),
                    remoteDatesAfterFilter: remoteDates,
                    pendingLocalDates: [...pendingLocalDates],
                    earlyReturn: !remoteDates.length && !workoutsDates.length,
                });
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
                applyTrustedWorkoutRowsSnapshot(workoutsRes.data || [], {
                    source: "display_history_refresh",
                });
                if (!sessionsRes.error) {
                    applyTrustedSessionRowsSnapshot(sessionsRes.data || [], {
                        source: "display_history_refresh",
                    });
                }
                if (serializeHistoryMap(nextHistory) !== serializeHistoryMap(currentHistory)) {
                    setHistory(nextHistory);
                    persistHistoryForUser(user.id, nextHistory);
                }
                const displayWorkoutsDataApplied = applyWorkoutsDataHistorySnapshot(nextWorkoutsDataHistory, {
                    source: "workouts.data",
                    reason: "display refresh workouts.data canonical",
                    requestId,
                    weekRange,
                    workoutsHistory: workoutsOnlyHistory,
                    summaryHistory: sessionsRes.error ? {} : buildHistoryFromWorkoutSessionRows(sessionsRes.data || []),
                });
                if (shouldLogPerfDebug()) {
                    console.log("[home weekly summary] apply", {
                        source: "workouts.data",
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        requestId,
                        applied: displayWorkoutsDataApplied,
                        reason: "display refresh workouts.data canonical",
                        ...getHomeWeeklySummaryDebug(nextWorkoutsDataHistory, weekRange),
                        ...getHomeWeeklySourceDebug({
                            workoutsHistory: workoutsOnlyHistory,
                            summaryHistory: sessionsRes.error ? {} : buildHistoryFromWorkoutSessionRows(sessionsRes.data || []),
                            finalHistory: nextWorkoutsDataHistory,
                            weekRange,
                            source: "workouts.data",
                            appliedSource: displayWorkoutsDataApplied ? "workouts.data" : "none",
                            ignoredStaleSource: displayWorkoutsDataApplied ? "summary_json/history_cache/localStorage" : "stale display history refresh",
                        }),
                    });
                }
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
        applyTrustedSessionRowsSnapshot,
        applyTrustedWorkoutRowsSnapshot,
        applyWorkoutsDataHistorySnapshot,
        applyLocalHistoryDates,
        getCurrentHistoryDeleteMarkers,
        historySyncReady,
        historyReloadNonce,
        runDedupeSupabaseFetch,
        screen,
        sessionSyncVersion,
        user?.id,
        workoutsDataHistory,
        applyHistoryDeleteMarkers,
        attachRecordFetchContext,
        buildHistoryFromWorkoutSessionRows,
        buildRemoteHistoryWithWorkoutRowsPriority,
        getCurrentWeekRangeForHomeSummary,
        getDateDaysAgoKey,
        getHistoryLoadErrorMessage,
        getHistoryMetricsForDate,
        getHistoryOverallMetrics,
        getHomeWeeklySourceDebug,
        getHomeWeeklySummaryDebug,
        getNextMonthPrefix,
        getRuntimeEnvironmentLabel,
        latestHistoryRef,
        logRecordFetchError,
        pendingWorkoutContentChangeDatesRef,
        persistHistoryForUser,
        serializeHistoryMap,
        setHistory,
        shouldLogPerfDebug,
        workoutsDataHistoryRef,
        isPro,
        isSupabaseFetchFresh,
    ]);

    // ─── home weekly summary effect ────────────────────────────────────────────
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
                applyTrustedWorkoutRowsSnapshot(data || [], {
                    source: "home_weekly_summary_refresh",
                });

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
                    if (shouldLogPerfDebug()) console.log("[home weekly summary] ignore stale", {
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

                const homeWeeklyApplied = applyWorkoutsDataHistorySnapshot(nextWorkoutsDataHistory, {
                    source: "workouts.data",
                    reason: "home screen workouts.data refresh",
                    requestId,
                    weekRange,
                    workoutsHistory: remoteWorkoutsHistory,
                });
                historyHasTrustedRemoteSnapshotRef.current = true;
                historyRemoteLoadFailedRef.current = false;
                setHistoryLoadError("");

                if (shouldLogPerfDebug()) {
                    console.log("[home weekly summary] apply", {
                        source: "workouts.data",
                        env: getRuntimeEnvironmentLabel(),
                        user_id: user.id,
                        requestId,
                        applied: homeWeeklyApplied,
                        reason: "home screen workouts.data refresh",
                        ...getHomeWeeklySummaryDebug(nextWorkoutsDataHistory, weekRange),
                        ...getHomeWeeklySourceDebug({
                            workoutsHistory: remoteWorkoutsHistory,
                            finalHistory: nextWorkoutsDataHistory,
                            weekRange,
                            source: "workouts.data",
                            appliedSource: homeWeeklyApplied ? "workouts.data" : "none",
                            ignoredStaleSource: homeWeeklyApplied
                                ? "summary_json/history_cache/localStorage"
                                : "stale home_weekly_summary_refresh",
                        }),
                    });
                }
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
        applyTrustedWorkoutRowsSnapshot,
        applyWorkoutsDataHistorySnapshot,
        applyLocalHistoryDates,
        getCurrentHistoryDeleteMarkers,
        historyReloadNonce,
        historySyncReady,
        runDedupeSupabaseFetch,
        screen,
        sessionSyncVersion,
        user?.id,
        applyHistoryDeleteMarkers,
        getCurrentWeekRangeForHomeSummary,
        getHistoryOverallMetrics,
        getHomeWeeklySourceDebug,
        getHomeWeeklySummaryDebug,
        getRuntimeEnvironmentLabel,
        latestHistoryRef,
        logRecordFetchError,
        pendingWorkoutContentChangeDatesRef,
        shouldLogPerfDebug,
        workoutsDataHistoryRef,
    ]);

    // ─── Return ───────────────────────────────────────────────────────────────
    return {
        trustedWorkoutRows,
        trustedSessionRows,
        historyRemoteReady,
        historyLoadError,
        setHistoryLoadError,
        historySyncReady,
        historyRemoteLoadFailedRef,
        applyTrustedWorkoutRowsSnapshot,
        applyTrustedSessionRowsSnapshot,
        markSupabaseFetchFresh,
        isSupabaseFetchFresh,
        runDedupeSupabaseFetch,
    };
}

export {
    REMOTE_HISTORY_SESSION_LOOKBACK_DAYS,
    REMOTE_HISTORY_SESSION_LIMIT,
    INITIAL_HOME_HISTORY_LOOKBACK_DAYS,
    INITIAL_HOME_HISTORY_LIMIT,
    HISTORY_RECOVERY_LIMIT,
};
