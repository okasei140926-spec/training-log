export const WORKOUT_STARTED_AT_KEY = "pump_workout_started_at";
export const WORKOUT_STARTED_FOR_DATE_KEY = "pump_workout_started_for_date";
export const WORKOUT_LAST_ACTIVITY_AT_KEY = "pump_workout_last_activity_at";
export const WORKOUT_PAUSED_DURATION_SEC_KEY = "pump_workout_paused_duration_sec";
export const WORKOUT_PAUSE_STARTED_AT_KEY = "pump_workout_pause_started_at";
export const WORKOUT_IS_PAUSED_KEY = "pump_workout_is_paused";
export const WORKOUT_IS_FINISHED_KEY = "pump_workout_is_finished";
export const WORKOUT_FINISHED_AT_KEY = "pump_workout_finished_at";
export const WORKOUT_IDLE_TIMEOUT_MS = 90 * 60 * 1000;

const readStorageValue = (storage, key, fallback = null) => {
  try {
    if (!storage) return fallback;
    const raw = storage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const writeStorageValue = (storage, key, value) => {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {}
};

export const normalizeStoredTimestamp = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

export const normalizeStoredSeconds = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.max(0, Math.floor(numeric)) : 0;
};

export const createEmptyWorkoutTimerState = () => ({
  startedAt: null,
  startedForDate: "",
  lastActivityAt: null,
  pausedDurationSec: 0,
  pauseStartedAt: null,
  isPaused: false,
  isFinished: false,
  finishedAt: null,
});

export const normalizeWorkoutTimerState = (state = {}) => {
  const startedAt = normalizeStoredTimestamp(state.startedAt);
  const startedForDate = String(state.startedForDate || "").trim();
  const lastActivityAt = normalizeStoredTimestamp(state.lastActivityAt);
  const pausedDurationSec = normalizeStoredSeconds(state.pausedDurationSec);
  const pauseStartedAt = normalizeStoredTimestamp(state.pauseStartedAt);
  const finishedAt = normalizeStoredTimestamp(state.finishedAt);
  const isFinished = Boolean(state.isFinished && finishedAt);
  const isPaused = Boolean(!isFinished && state.isPaused && pauseStartedAt);

  if (!startedAt || !startedForDate) {
    return createEmptyWorkoutTimerState();
  }

  return {
    startedAt,
    startedForDate,
    lastActivityAt,
    pausedDurationSec,
    pauseStartedAt: isPaused ? pauseStartedAt : null,
    isPaused,
    isFinished,
    finishedAt: isFinished ? finishedAt : null,
  };
};

export const readWorkoutTimerState = (
  storage = typeof window !== "undefined" ? window.localStorage : null
) =>
  normalizeWorkoutTimerState({
    startedAt: readStorageValue(storage, WORKOUT_STARTED_AT_KEY, null),
    startedForDate: readStorageValue(storage, WORKOUT_STARTED_FOR_DATE_KEY, ""),
    lastActivityAt: readStorageValue(storage, WORKOUT_LAST_ACTIVITY_AT_KEY, null),
    pausedDurationSec: readStorageValue(storage, WORKOUT_PAUSED_DURATION_SEC_KEY, 0),
    pauseStartedAt: readStorageValue(storage, WORKOUT_PAUSE_STARTED_AT_KEY, null),
    isPaused: readStorageValue(storage, WORKOUT_IS_PAUSED_KEY, false),
    isFinished: readStorageValue(storage, WORKOUT_IS_FINISHED_KEY, false),
    finishedAt: readStorageValue(storage, WORKOUT_FINISHED_AT_KEY, null),
  });

export const persistWorkoutTimerState = (
  nextState,
  storage = typeof window !== "undefined" ? window.localStorage : null
) => {
  const state = normalizeWorkoutTimerState(nextState);
  if (!state.startedAt) {
    clearWorkoutTimerState(storage);
    return;
  }

  writeStorageValue(storage, WORKOUT_STARTED_AT_KEY, state.startedAt);
  writeStorageValue(storage, WORKOUT_STARTED_FOR_DATE_KEY, state.startedForDate);
  writeStorageValue(storage, WORKOUT_LAST_ACTIVITY_AT_KEY, state.lastActivityAt);
  writeStorageValue(storage, WORKOUT_PAUSED_DURATION_SEC_KEY, state.pausedDurationSec);
  writeStorageValue(storage, WORKOUT_PAUSE_STARTED_AT_KEY, state.pauseStartedAt);
  writeStorageValue(storage, WORKOUT_IS_PAUSED_KEY, state.isPaused);
  writeStorageValue(storage, WORKOUT_IS_FINISHED_KEY, state.isFinished);
  writeStorageValue(storage, WORKOUT_FINISHED_AT_KEY, state.finishedAt);
};

export const clearWorkoutTimerState = (
  storage = typeof window !== "undefined" ? window.localStorage : null
) => {
  try {
    storage?.removeItem(WORKOUT_STARTED_AT_KEY);
    storage?.removeItem(WORKOUT_STARTED_FOR_DATE_KEY);
    storage?.removeItem(WORKOUT_LAST_ACTIVITY_AT_KEY);
    storage?.removeItem(WORKOUT_PAUSED_DURATION_SEC_KEY);
    storage?.removeItem(WORKOUT_PAUSE_STARTED_AT_KEY);
    storage?.removeItem(WORKOUT_IS_PAUSED_KEY);
    storage?.removeItem(WORKOUT_IS_FINISHED_KEY);
    storage?.removeItem(WORKOUT_FINISHED_AT_KEY);
  } catch {}
};

export const computeWorkoutDurationSec = ({
  startedAt = null,
  endedAt = null,
  pausedDurationSec = 0,
}) => {
  if (!startedAt || !endedAt) return 0;
  const duration = Math.floor((endedAt - startedAt) / 1000) - normalizeStoredSeconds(pausedDurationSec);
  return Math.max(0, duration);
};

export const computeWorkoutDisplayElapsedSec = ({
  startedAt = null,
  pausedDurationSec = 0,
  pauseStartedAt = null,
  isPaused = false,
  finishedAt = null,
  isFinished = false,
}, now = Date.now()) => {
  if (!startedAt) return 0;

  if (isFinished && finishedAt) {
    return computeWorkoutDurationSec({
      startedAt,
      endedAt: finishedAt,
      pausedDurationSec,
    });
  }

  if (isPaused && pauseStartedAt) {
    return computeWorkoutDurationSec({
      startedAt,
      endedAt: pauseStartedAt,
      pausedDurationSec,
    });
  }

  return computeWorkoutDurationSec({
    startedAt,
    endedAt: now,
    pausedDurationSec,
  });
};

export const getWorkoutTimerStatus = (state = {}) => {
  const normalized = normalizeWorkoutTimerState(state);
  if (normalized.isFinished && normalized.finishedAt) return "finished";
  if (normalized.isPaused && normalized.pauseStartedAt) return "paused";
  if (normalized.startedAt) return "active";
  return "idle";
};

export const getWorkoutTimerPersistence = (state = {}, fallbackEndedAt = null) => {
  const normalized = normalizeWorkoutTimerState(state);
  if (!normalized.startedAt || !normalized.startedForDate) return null;

  let endedAt = normalized.lastActivityAt || fallbackEndedAt || null;
  if (normalized.isFinished && normalized.finishedAt) endedAt = normalized.finishedAt;
  if (normalized.isPaused && normalized.pauseStartedAt) endedAt = normalized.pauseStartedAt;
  if (!endedAt) return null;

  return {
    startedAtIso: new Date(normalized.startedAt).toISOString(),
    endedAtIso: new Date(endedAt).toISOString(),
    durationSec: computeWorkoutDurationSec({
      startedAt: normalized.startedAt,
      endedAt,
      pausedDurationSec: normalized.pausedDurationSec,
    }),
  };
};

export const getWorkoutResumePromptState = (state = {}, activeLogDate = "", now = Date.now()) => {
  const normalized = normalizeWorkoutTimerState(state);
  if (!normalized.startedAt || !normalized.startedForDate || normalized.isFinished) {
    return {
      shouldPrompt: false,
      reason: "",
      dateChanged: false,
      idleTimedOut: false,
      signature: "",
    };
  }

  const dateChanged = Boolean(activeLogDate && normalized.startedForDate !== activeLogDate);
  const referenceAt = normalized.lastActivityAt || normalized.startedAt;
  const idleTimedOut = Boolean(referenceAt && now - referenceAt >= WORKOUT_IDLE_TIMEOUT_MS);
  const signature = [
    normalized.startedAt || "",
    normalized.startedForDate,
    normalized.lastActivityAt || "",
    normalized.pauseStartedAt || "",
    normalized.pausedDurationSec,
    normalized.isPaused ? 1 : 0,
    normalized.isFinished ? 1 : 0,
    normalized.finishedAt || "",
  ].join("::");

  return {
    shouldPrompt: dateChanged || idleTimedOut,
    reason: dateChanged ? "date_changed" : idleTimedOut ? "idle_timeout" : "",
    dateChanged,
    idleTimedOut,
    signature,
  };
};
