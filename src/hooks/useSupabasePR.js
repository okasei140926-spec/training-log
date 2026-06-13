import { useState, useEffect, useRef } from "react";
import { supabase } from "../utils/supabase";
import { normalizeExerciseName } from "../utils/exerciseName";

/**
 * Fetches all-time PR data for a user via Supabase RPC.
 * Returns a prCache map keyed by normalizedExerciseName → { max_weight, max_reps, best_date }.
 * Used as a fallback in useWorkout when local history (30-day window) has no data.
 */
export function useSupabasePR({ userId }) {
    const [prCache, setPrCache] = useState({});
    const fetchedForRef = useRef(null);

    useEffect(() => {
        if (!userId) return;
        if (fetchedForRef.current === userId) return;

        let cancelled = false;

        (async () => {
            try {
                const { data, error } = await supabase.rpc("get_pr_by_exercise", {
                    p_user_id: userId,
                });

                if (cancelled) return;
                if (error) {
                    console.warn("[useSupabasePR] RPC error", error);
                    return;
                }

                const map = {};
                (data || []).forEach((row) => {
                    if (!row?.exercise_name) return;
                    const key = normalizeExerciseName(row.exercise_name);
                    map[key] = {
                        exercise_name: row.exercise_name,
                        max_weight: row.max_weight,
                        max_reps: row.max_reps,
                        best_date: row.best_date,
                    };
                });

                fetchedForRef.current = userId;
                setPrCache(map);
            } catch (err) {
                if (!cancelled) console.warn("[useSupabasePR] unexpected error", err);
            }
        })();

        return () => { cancelled = true; };
    }, [userId]);

    return { prCache };
}
