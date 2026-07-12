import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";
import { formatDateKey } from "../utils/helpers";
import {
    clearWorkoutTimerState,
    computeWorkoutDisplayElapsedSec,
    createEmptyWorkoutTimerState,
    getWorkoutAutoFinishState,
    getWorkoutTimerStatus,
    normalizeWorkoutTimerState,
    persistWorkoutTimerState,
    readWorkoutTimerState,
} from "../utils/workoutTimer";

export function useWorkoutSession({ getTodayKey, user }) {
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

    const workoutTimerStateRef = useRef(initialWorkoutTimerState);

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

        // When returning from background, setInterval may have been paused.
        // Re-sync immediately on visibility restore.
        const onVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                syncElapsed();
            }
        };
        document.addEventListener("visibilitychange", onVisibilityChange);

        return () => {
            window.clearInterval(timerId);
            document.removeEventListener("visibilitychange", onVisibilityChange);
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

    return {
        workoutStartedAt,
        workoutFinishedAt,
        workoutStartedForDate,
        setWorkoutStartedForDate,
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
        applyWorkoutTimerState,
    };
}
