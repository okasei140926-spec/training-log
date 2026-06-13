import { useCallback } from "react";
import { supabase } from "../utils/supabase";
import {
    fetchWorkoutRowsForDates as fetchWorkoutRowsForDatesFromRepository,
    deleteWorkoutForDate as deleteWorkoutForDateFromRepository,
    registerPendingDelete,
    clearPendingDelete,
} from "../features/workout/workoutRepository";
import {
    getValidWorkoutDatesFromHistory,
    mergeHistoryMaps,
} from "../utils/helpers";
import {
    applyPreferredHistoryDates,
    buildDraftHistoryForDate,
} from "../utils/appHelpers";

export function useWorkoutSyncHelpers({
    applyTrustedWorkoutRowsSnapshot,
    loadDraftForDate,
    hasDraftContent,
    getExUnit,
    savedWorkoutDurationSecByDate,
}) {
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

    const deleteRemoteWorkoutArtifactsForDate = useCallback(async (userId, workoutDate, nextHistoryMap = null) => {
        const normalizedDate = String(workoutDate || "").slice(0, 10);
        if (!userId || !normalizedDate) return;

        // Register as pending immediately so pagehide flush can pick it up if needed
        registerPendingDelete(userId, normalizedDate);

        try {
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

            // Delete workouts + workout_exercises in parallel (via repository),
            // workout_sets are CASCADE-deleted by workout_exercises deletion.
            const { ok: deleteOk, error: deleteWorkoutError } =
                await deleteWorkoutForDateFromRepository({
                    userId,
                    date: normalizedDate,
                    supabase,
                });

            if (deleteWorkoutError) throw deleteWorkoutError;
            if (!deleteOk) throw new Error(`deleteWorkoutForDate returned ok=false for ${normalizedDate}`);
        } finally {
            // Always clear the pending marker (whether delete succeeded or failed)
            clearPendingDelete(userId, normalizedDate);
        }

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

    return {
        fetchRemoteWorkoutRowsForDates,
        hasRemoteWorkoutForDate,
        buildLatestLocalHistoryForRetryDate,
        deleteRemoteWorkoutArtifactsForDate,
    };
}
