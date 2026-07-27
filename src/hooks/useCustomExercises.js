import { useCallback, useEffect, useState } from "react";
import { supabase } from "../utils/supabase";

/**
 * Supabase の custom_exercises テーブルからユーザーのカスタム種目を管理する。
 * - fetch: マウント時に取得
 * - addCustomExercise: 手動追加時に upsert
 * - customExercisesByBodyPart: AddExModal の freeItems に合成するための body_part → [{id, name}] マップ
 */
export function useCustomExercises(user) {
    const [customExercises, setCustomExercises] = useState([]);

    useEffect(() => {
        if (!user?.id) return;
        supabase
            .from("custom_exercises")
            .select("id, name, body_part, created_at")
            .eq("user_id", user.id)
            .order("created_at", { ascending: true })
            .then(({ data, error }) => {
                if (!error && data) setCustomExercises(data);
            });
    }, [user?.id]);

    const addCustomExercise = useCallback(async (name, bodyPart) => {
        if (!user?.id || !name?.trim()) return;
        const trimmed = name.trim();

        // Optimistic update: reflect immediately in UI without waiting for Supabase.
        // Keyed by (name, body_part) to support the same exercise under multiple body parts.
        const optimisticId = `opt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        setCustomExercises((prev) => {
            if (prev.some((e) => e.name === trimmed && e.body_part === bodyPart)) return prev;
            return [...prev, { id: optimisticId, name: trimmed, body_part: bodyPart, created_at: new Date().toISOString() }];
        });

        const { data, error } = await supabase
            .from("custom_exercises")
            .upsert(
                { user_id: user.id, name: trimmed, body_part: bodyPart },
                { onConflict: "user_id,name", ignoreDuplicates: true }
            )
            .select("id, name, body_part, created_at")
            .maybeSingle();

        if (!error && data) {
            // Replace optimistic entry with confirmed server data
            setCustomExercises((prev) =>
                prev.map((e) => e.id === optimisticId ? data : e)
            );
        } else if (error) {
            // Roll back optimistic entry on error
            setCustomExercises((prev) => prev.filter((e) => e.id !== optimisticId));
        }
        // If ignoreDuplicates hit (data === null, no error), keep the optimistic entry
        // so the exercise is visible in the current session.
    }, [user?.id]);

    const bulkAddCustomExercises = useCallback(async (exercises) => {
        // exercises: [{name, body_part}]
        if (!user?.id || !exercises?.length) return 0;
        const rows = exercises.map(({ name, body_part }) => ({
            user_id: user.id,
            name: name.trim(),
            body_part,
        }));

        const { data, error } = await supabase
            .from("custom_exercises")
            .upsert(rows, { onConflict: "user_id,name", ignoreDuplicates: true })
            .select("id, name, body_part, created_at");

        if (!error && data?.length) {
            setCustomExercises((prev) => {
                const existingNames = new Set(prev.map((e) => e.name));
                const newOnes = data.filter((e) => !existingNames.has(e.name));
                return [...prev, ...newOnes];
            });
            return data.length;
        }
        return 0;
    }, [user?.id]);

    const renameCustomExercise = useCallback(async (oldName, newName) => {
        if (!user?.id || !oldName?.trim() || !newName?.trim()) return;
        const oldTrimmed = oldName.trim();
        const newTrimmed = newName.trim();
        if (oldTrimmed === newTrimmed) return;

        const { error } = await supabase
            .from("custom_exercises")
            .update({ name: newTrimmed })
            .eq("user_id", user.id)
            .eq("name", oldTrimmed);

        if (!error) {
            setCustomExercises((prev) =>
                prev.map((e) => e.name === oldTrimmed ? { ...e, name: newTrimmed } : e)
            );
        }
    }, [user?.id]);

    // AddExModal の muscleEx と同じ形式: { bodyPart: [{id, name}] }
    const customExercisesByBodyPart = customExercises.reduce((acc, ex) => {
        if (!acc[ex.body_part]) acc[ex.body_part] = [];
        acc[ex.body_part].push({ id: ex.id, name: ex.name });
        return acc;
    }, {});

    return {
        customExercises,
        customExercisesByBodyPart,
        addCustomExercise,
        bulkAddCustomExercises,
        renameCustomExercise,
    };
}
