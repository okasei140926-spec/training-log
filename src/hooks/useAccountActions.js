import { useCallback } from "react";
import { supabase } from "../utils/supabase";
import { formatDateKey } from "../utils/helpers";
import {
    EXERCISE_BODY_PART_OVERRIDES_KEY,
    HISTORY_OWNER_KEY,
} from "../utils/appHelpers";

export function useAccountActions({
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
}) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accountActionBusy, clearLocalAppState, user?.id]);

    return { handleLogout, handleExportData, clearLocalAppState, handleDeleteAccount };
}
