import { logWriteTrace, trackRestoreAttempt } from "../../utils/writeTrace";

const normalizeDateKey = (value) => String(value || "").slice(0, 10);

const DEFAULT_PREFIX = "workoutDraft";

const wpExCount = (draft) =>
    (draft?.exercises || draft?.sessionEx || []).length;

const wpSetCount = (draft) => {
    const logData = draft?.logData || {};
    return Object.values(logData).reduce(
        (sum, sets) => sum + (Array.isArray(sets) ? sets.length : 0),
        0
    );
};

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
  // Explicit intent flags — propagated so downstream guards (e.g. the empty-overwrite
  // guard in saveWorkoutDraft) can distinguish user actions from system auto-saves.
  explicitDelete = false,
  explicitEdit = false,
  // Layer 2 fields (Stage 1 addition)
  layerVersion = 2,
  userEditedAt = null,  // timestamp (ms) of last user gesture; null for system writes
  syncedAt = null,      // timestamp (ms) when this content was confirmed written to Supabase
  // Payload origin — tracks whether content came from remote data vs. local user edits.
  // Preserved so rescueUnsyncedDrafts can skip drafts that originated from canonicalDisplayHistory
  // or fetchedRemoteRows and avoid zombie-restoring deleted exercises at startup.
  payloadOrigin = null,
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
    layerVersion,
    userEditedAt,
    syncedAt,
    ...(payloadOrigin != null ? { payloadOrigin } : {}),
    ...(explicitDelete ? { explicitDelete: true } : {}),
    ...(explicitEdit ? { explicitEdit: true } : {}),
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
  log = false,
  skipIfSame = true,
} = {}) {
  const normalizedDate = normalizeDateKey(date);
  const store = getStorage(storage);
  if (!store || !normalizedDate) return false;

  // ─── One-way valve (原則2) ─────────────────────────────────────────────────
  // Data stamped source:"remote_supabase" originated from a Supabase fetch and
  // must never be written back into Layer 2 (the user's edit buffer).
  // Display still works: callers apply the data to React state before calling
  // saveWorkoutDraft, so the UI shows correctly even though localStorage is not
  // updated.  On next app start, useLogDateRefresh re-fetches and re-applies.
  if (draft?.meta?.source === "remote_supabase") {
    const _valveAttempts = trackRestoreAttempt(normalizedDate, "blocked");
    const _exerciseNames = (draft?.sessionEx || draft?.exercises || []).slice(0, 10).map((ex) => String(ex?.name || "")).filter(Boolean);
    const _payloadDateField = draft?.meta?.date || draft?.meta?.draftDate || draft?.meta?.workoutDate || null;
    logWriteTrace("valve:remote_supabase", {
      date: normalizedDate,
      decision: "block",
      reason: "remote_supabase source rejected by one-way valve — Layer 2 must only hold user edits",
      flags: { explicitEdit: draft?.meta?.explicitEdit, explicitDelete: draft?.meta?.explicitDelete, source: "remote_supabase" },
      exerciseCount: wpExCount(draft),
      setCount: wpSetCount(draft),
      extra: { exerciseNames: _exerciseNames, payloadDateField: _payloadDateField, payloadOrigin: draft?.meta?.payloadOrigin || null, attemptCount: _valveAttempts.count, blockedCount: _valveAttempts.blocked, appliedCount: _valveAttempts.applied },
    });
    logger?.warn?.("[workout draft] one-way valve: remote_supabase rejected", {
      action: "one_way_valve",
      keyDate: normalizedDate,
      source: "remote_supabase",
    });
    return false;
  }

  // Pre-overwrite validation: check the original payload date BEFORE withWorkoutDraftMeta
  // stamps normalizedDate on top of it — otherwise validation is toothless.
  const originalPayloadDate = normalizeDateKey(draft?.date || draft?.meta?.date);
  if (originalPayloadDate && originalPayloadDate !== normalizedDate) {
    logWriteTrace("G4:stale-date", {
      date: normalizedDate,
      decision: "block",
      reason: "payload date does not match key date",
      flags: { explicitEdit: draft?.meta?.explicitEdit, explicitDelete: draft?.meta?.explicitDelete, source: draft?.meta?.source },
      exerciseCount: wpExCount(draft),
      setCount: wpSetCount(draft),
      extra: { keyDate: normalizedDate, payloadDate: originalPayloadDate },
    });
    logger?.warn?.("[workout draft] blocked stale-date draft save", {
      action: "stale_closure_write_blocked",
      keyDate: normalizedDate,
      payloadDate: originalPayloadDate,
      selectedDate: normalizedDate,
      accepted: false,
      rejectedReason: "payload date does not match key date",
      source: draft?.meta?.source || null,
    });
    return false;
  }
  logWriteTrace("G4:stale-date", {
    date: normalizedDate,
    decision: "pass",
    reason: null,
    flags: { explicitEdit: draft?.meta?.explicitEdit, explicitDelete: draft?.meta?.explicitDelete, source: draft?.meta?.source },
    exerciseCount: wpExCount(draft),
    setCount: wpSetCount(draft),
    extra: { keyDate: normalizedDate, payloadDate: originalPayloadDate || null },
  });

  // Guard: do not overwrite a non-empty draft with empty content unless the
  // caller explicitly wants to delete it (explicitDelete flag in meta).
  // This prevents navigation / draft-restore races from silently wiping
  // the user's in-progress workout data.
  const existingRaw = safeParse(getStorage(storage)?.getItem(getWorkoutDraftKey(normalizedDate, prefix)), null);
  const existingHasContent = Boolean(
    existingRaw &&
    ((existingRaw.exercises || []).length > 0 || Object.keys(existingRaw.logData || {}).length > 0)
  );
  const incomingHasContent = Boolean(
    (draft?.exercises || draft?.sessionEx || []).length > 0 ||
    Object.keys(draft?.logData || {}).length > 0
  );
  const isExplicitUserAction = Boolean(draft?.meta?.explicitDelete || draft?.meta?.explicitEdit);
  if (existingHasContent && !incomingHasContent && !isExplicitUserAction) {
    // Block: a system auto-save (stale closure, navigation race, etc.) must not silently
    // wipe in-progress workout data. User-initiated deletes (explicitDelete) and edits
    // (explicitEdit) are allowed to produce empty content intentionally.
    logWriteTrace("G3:empty-overwrite", {
      date: normalizedDate,
      decision: "block",
      reason: "incoming draft has no exercises/sets; existing draft has content",
      flags: { explicitEdit: draft?.meta?.explicitEdit, explicitDelete: draft?.meta?.explicitDelete, source: draft?.meta?.source },
      exerciseCount: wpExCount(draft),
      setCount: wpSetCount(draft),
      extra: { existingHasContent, incomingHasContent, isExplicitUserAction },
    });
    logger?.warn?.("[workout draft] blocked empty-content overwrite of non-empty draft", {
      action: "draft_empty_overwrite_blocked",
      keyDate: normalizedDate,
      source: draft?.meta?.source || null,
      reason: "incoming draft has no exercises/sets; existing draft has content",
    });
    return false;
  }
  logWriteTrace("G3:empty-overwrite", {
    date: normalizedDate,
    decision: "pass",
    reason: null,
    flags: { explicitEdit: draft?.meta?.explicitEdit, explicitDelete: draft?.meta?.explicitDelete, source: draft?.meta?.source },
    exerciseCount: wpExCount(draft),
    setCount: wpSetCount(draft),
    extra: { existingHasContent, incomingHasContent, isExplicitUserAction },
  });

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
  const nextHash = getWorkoutDraftSnapshotHash(nextDraft);
  const previousDraft = safeParse(store.getItem(key), null);
  const previousHash = previousDraft ? getWorkoutDraftSnapshotHash(previousDraft) : "";
  if (skipIfSame) {
    if (
      previousDraft
      && previousHash === nextHash
      && stableStringify(previousDraft?.meta || {}) === stableStringify(nextDraft?.meta || {})
    ) {
      if (log && logger?.log) {
        logger.log("[workout draft] save skipped same snapshot", {
          action: "workout_draft_store_save",
          date: normalizedDate,
          draftHash: nextHash,
          previousDraftHash: previousHash,
          skippedSameSnapshot: true,
          hasUnsavedChanges: Boolean(nextDraft?.meta?.hasUnsavedChanges),
          source: nextDraft?.meta?.source || null,
        });
      }
      return true;
    }
  }

  store.setItem(key, JSON.stringify(nextDraft));
  if (log && logger?.log) {
    logger.log("[workout draft] saved", {
      action: "workout_draft_store_save",
      date: normalizedDate,
      draftHash: nextHash,
      previousDraftHash: previousHash,
      skippedSameSnapshot: false,
      hasUnsavedChanges: Boolean(nextDraft?.meta?.hasUnsavedChanges),
      source: nextDraft?.meta?.source || null,
    });
  }
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
    syncedAt: Date.now(),
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
