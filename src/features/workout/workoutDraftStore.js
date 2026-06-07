const normalizeDateKey = (value) => String(value || "").slice(0, 10);

const DEFAULT_PREFIX = "workoutDraft";

const safeParse = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const getStorage = (storage) => {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage || null;
};

const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
};

export const getWorkoutDraftSnapshotHash = (draft = {}) => stableStringify({
  date: normalizeDateKey(draft?.date || draft?.meta?.date),
  exercises: (draft?.exercises || []).map((exercise) => ({
    id: exercise?.id || "",
    name: exercise?.name || exercise?.exerciseName || "",
    bodyPart: exercise?.bodyPart || exercise?.body_part || exercise?.label || "",
    sets: (exercise?.sets || []).map((set) => ({
      weight: set?.weight ?? "",
      reps: set?.reps ?? "",
      unit: set?.unit || set?.displayUnit || set?.weightUnit || set?.weight_unit || "",
      done: Boolean(set?.done),
    })),
  })),
  logData: draft?.logData || {},
  exerciseUnits: draft?.exerciseUnits || {},
});

export const getWorkoutDraftKey = (date, prefix = DEFAULT_PREFIX) =>
  `${prefix}:${normalizeDateKey(date)}`;

export const makeWorkoutDraftMeta = ({
  date,
  source = "user_edit",
  hasUnsavedChanges = true,
  remoteVerifiedAt = "",
  updatedAt = new Date().toISOString(),
} = {}) => {
  const normalizedDate = normalizeDateKey(date);
  return {
    date: normalizedDate,
    keyDate: normalizedDate,
    draftDate: normalizedDate,
    workoutDate: normalizedDate,
    source,
    hasUnsavedChanges: Boolean(hasUnsavedChanges),
    remoteVerifiedAt,
    updatedAt,
  };
};

export const withWorkoutDraftMeta = (date, draft = {}, meta = {}) => {
  const normalizedDate = normalizeDateKey(date);
  return {
    ...draft,
    date: normalizedDate,
    meta: makeWorkoutDraftMeta({
      ...(draft.meta || {}),
      ...meta,
      date: normalizedDate,
    }),
  };
};

export const validateWorkoutDraftDate = (keyDate, draft = {}) => {
  const normalizedKeyDate = normalizeDateKey(keyDate);
  const payloadDate = normalizeDateKey(
    draft?.date
    || draft?.meta?.date
    || draft?.meta?.draftDate
    || draft?.meta?.workoutDate
    || draft?.workoutDate
    || draft?.workout_date
  );

  if (!normalizedKeyDate) {
    return {
      accepted: false,
      keyDate: normalizedKeyDate,
      payloadDate,
      rejectedReason: "missing key date",
    };
  }

  if (payloadDate && payloadDate !== normalizedKeyDate) {
    return {
      accepted: false,
      keyDate: normalizedKeyDate,
      payloadDate,
      rejectedReason: "draft date does not match key date",
    };
  }

  return {
    accepted: true,
    keyDate: normalizedKeyDate,
    payloadDate: payloadDate || normalizedKeyDate,
    rejectedReason: "",
  };
};

export function loadWorkoutDraft(date, {
  storage,
  prefix = DEFAULT_PREFIX,
  logger = console,
  log = false,
} = {}) {
  const normalizedDate = normalizeDateKey(date);
  const store = getStorage(storage);
  if (!store || !normalizedDate) return null;

  const key = getWorkoutDraftKey(normalizedDate, prefix);
  const draft = safeParse(store.getItem(key), null);
  if (!draft) return null;

  const validation = validateWorkoutDraftDate(normalizedDate, draft);
  if (!validation.accepted) {
    logger?.warn?.("[workout draft] rejected date-mismatched draft", {
      action: "draft_restore_date_check",
      keyDate: validation.keyDate,
      payloadDate: validation.payloadDate,
      selectedDate: normalizedDate,
      accepted: false,
      rejectedReason: validation.rejectedReason,
    });
    return null;
  }

  if (log && logger?.log) {
    logger.log("[workout draft] loaded", {
      action: "draft_restore_date_check",
      keyDate: normalizedDate,
      payloadDate: validation.payloadDate,
      selectedDate: normalizedDate,
      accepted: true,
      rejectedReason: "",
    });
  }

  return withWorkoutDraftMeta(normalizedDate, draft, draft.meta || {});
}

export function saveWorkoutDraft(date, draft, {
  storage,
  prefix = DEFAULT_PREFIX,
  logger = console,
  skipIfSame = true,
} = {}) {
  const normalizedDate = normalizeDateKey(date);
  const store = getStorage(storage);
  if (!store || !normalizedDate) return false;

  const nextDraft = withWorkoutDraftMeta(normalizedDate, draft, draft?.meta || {});
  const validation = validateWorkoutDraftDate(normalizedDate, nextDraft);
  if (!validation.accepted) {
    logger?.warn?.("[workout draft] blocked date-mismatched save", {
      action: "draft_restore_date_check",
      keyDate: validation.keyDate,
      payloadDate: validation.payloadDate,
      selectedDate: normalizedDate,
      accepted: false,
      rejectedReason: validation.rejectedReason,
    });
    return false;
  }

  const key = getWorkoutDraftKey(normalizedDate, prefix);
  if (skipIfSame) {
    const previousDraft = safeParse(store.getItem(key), null);
    if (
      previousDraft
      && getWorkoutDraftSnapshotHash(previousDraft) === getWorkoutDraftSnapshotHash(nextDraft)
      && stableStringify(previousDraft?.meta || {}) === stableStringify(nextDraft?.meta || {})
    ) {
      return true;
    }
  }

  store.setItem(key, JSON.stringify(nextDraft));
  return true;
}

export function markWorkoutDraftVerified(date, draft, {
  storage,
  prefix = DEFAULT_PREFIX,
  remoteVerifiedAt = new Date().toISOString(),
} = {}) {
  return saveWorkoutDraft(date, makeVerifiedWorkoutDraft(date, draft, { remoteVerifiedAt }), {
    storage,
    prefix,
  });
}

export function makeVerifiedWorkoutDraft(date, draft, {
  remoteVerifiedAt = new Date().toISOString(),
} = {}) {
  return withWorkoutDraftMeta(date, draft, {
    source: "save_verified",
    hasUnsavedChanges: false,
    remoteVerifiedAt,
  });
}

export function clearWorkoutDraft(date, {
  storage,
  prefix = DEFAULT_PREFIX,
} = {}) {
  const normalizedDate = normalizeDateKey(date);
  const store = getStorage(storage);
  if (!store || !normalizedDate) return false;
  store.removeItem(getWorkoutDraftKey(normalizedDate, prefix));
  return true;
}
