import { useState, useCallback } from "react";
import { supabase } from "../utils/supabase";
import { getValidWorkoutDatesFromHistory } from "../utils/helpers";

const DIAGNOSTIC_LOOKBACK_DAYS = 45;

const EMPTY_DIAGNOSTIC = {
    localHistoryDates: [],
    remoteWorkoutDates: [],
    sessionDates: [],
    missingFromRemoteWorkouts: [],
    missingFromWorkoutSessions: [],
    syncFailedDates: [],
    lastSyncErrorByDate: {},
};

export function useWorkoutSummary({
    runDedupeSupabaseFetch,
    syncFailuresByDateRef,
    getDateDaysAgoKey,
    getNextMonthPrefix,
    logRecordFetchError,
}) {
    const [historySyncDiagnostic, setHistorySyncDiagnostic] = useState(EMPTY_DIAGNOSTIC);

    const refreshHistorySyncDiagnostic = useCallback(async (userId, historyMap, { prefix = "" } = {}) => {
        if (!userId) {
            setHistorySyncDiagnostic(EMPTY_DIAGNOSTIC);
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
            if (process.env.NODE_ENV !== "production") {
                console.debug("[sync] history remote diagnostic", {
                    userId,
                    prefix,
                    ...diagnosticPayload,
                });
            }
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
    }, [runDedupeSupabaseFetch, syncFailuresByDateRef, getDateDaysAgoKey, getNextMonthPrefix, logRecordFetchError]);

    return {
        historySyncDiagnostic,
        setHistorySyncDiagnostic,
        refreshHistorySyncDiagnostic,
    };
}
