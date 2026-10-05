/**
 * [WP] Write Path Tracer
 *
 * Permanent diagnostic for the workout save pipeline.
 * Traces all 12 guards and every write stage from UI to Supabase.
 *
 * Toggle OFF (session): localStorage.setItem('wp_trace_disabled', '1')
 * Toggle ON  (session): localStorage.removeItem('wp_trace_disabled')
 *
 * Default: ON
 */

const isEnabled = () => {
    try {
        return typeof window !== "undefined"
            && localStorage.getItem("wp_trace_disabled") !== "1";
    } catch {
        return true;
    }
};

/**
 * Log a single write-path stage.
 *
 * @param {string} stage  - Stage identifier (e.g. "mutateExercises", "G3", "supabase:upsert")
 * @param {object} payload
 *   @param {string|null}  payload.date          - Target workout date (YYYY-MM-DD)
 *   @param {string}       payload.decision      - "pass" | "block" | "skip" | "hold" | "executed"
 *   @param {string|null}  [payload.reason]      - Human-readable reason for block/skip/hold
 *   @param {object}       [payload.flags]       - { explicitEdit, explicitDelete, source }
 *   @param {number|null}  [payload.exerciseCount]
 *   @param {number|null}  [payload.setCount]
 *   @param {object}       [payload.extra]       - Any additional stage-specific fields
 */
export function logWriteTrace(stage, payload = {}) {
    if (!isEnabled()) return;

    const flags = payload.flags || {};
    const out = {
        stage,
        date: payload.date ?? null,
        decision: payload.decision ?? null,
        reason: payload.reason ?? null,
        flags: {
            explicitEdit: flags.explicitEdit,
            explicitDelete: flags.explicitDelete,
            source: flags.source,
        },
        exerciseCount: payload.exerciseCount ?? null,
        setCount: payload.setCount ?? null,
        ...(payload.extra || {}),
    };

    // Use warn for blocks so they stand out in Xcode console
    const level = (payload.decision === "block" || payload.decision === "skip") ? "warn" : "log";
    // eslint-disable-next-line no-console
    console[level](`[WP] ${stage}`, out);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Count exercises from an array (log screen exercises state). */
export const wpCountExercises = (exercises) =>
    Array.isArray(exercises) ? exercises.length : null;

/** Count total sets from logData map ({ exerciseName: [...sets] }). */
export const wpCountSetsFromLogData = (logData) => {
    if (!logData || typeof logData !== "object") return null;
    return Object.values(logData).reduce(
        (sum, sets) => sum + (Array.isArray(sets) ? sets.length : 0),
        0
    );
};

/** Count exercises that have at least one record for the given date in a history map. */
export const wpCountExercisesFromHistory = (historyMap, date) => {
    if (!historyMap || !date) return null;
    const d = String(date).slice(0, 10);
    return Object.keys(historyMap).filter(
        (name) => (historyMap[name] || []).some(
            (r) => String(r?.date || "").slice(0, 10) === d
        )
    ).length;
};

/** Count total sets across all exercises for the given date in a history map. */
export const wpCountSetsFromHistory = (historyMap, date) => {
    if (!historyMap || !date) return null;
    const d = String(date).slice(0, 10);
    let count = 0;
    Object.values(historyMap).forEach((records) => {
        (records || []).forEach((r) => {
            if (String(r?.date || "").slice(0, 10) === d) {
                count += Array.isArray(r?.sets) ? r.sets.length : 0;
            }
        });
    });
    return count;
};

// ─── ■4 Restore loop counter ─────────────────────────────────────────────────
// Module-level so it is shared across useDraftStore, workoutDraftStore, and
// useLogDateRefresh without prop-drilling. Keyed by date string.
const _restoreAttempts = {};

/**
 * Track a restore attempt, blocked valve, or successful apply for a given date.
 * @param {string} date  - YYYY-MM-DD
 * @param {"attempt"|"blocked"|"applied"} type
 * @returns {{ count: number, firstTs: number, blocked: number, applied: number }}
 */
export function trackRestoreAttempt(date, type) {
    const d = String(date || "").slice(0, 10);
    if (!d) return { count: 0, firstTs: Date.now(), blocked: 0, applied: 0 };
    const now = Date.now();
    const prev = _restoreAttempts[d] || { count: 0, firstTs: now, blocked: 0, applied: 0 };
    const withinWindow = now - prev.firstTs < 15_000;
    const base = withinWindow ? prev : { count: 0, firstTs: now, blocked: 0, applied: 0 };
    _restoreAttempts[d] = {
        count:   base.count   + (type === "attempt" ? 1 : 0),
        firstTs: withinWindow ? base.firstTs : now,
        blocked: base.blocked + (type === "blocked"  ? 1 : 0),
        applied: base.applied + (type === "applied"  ? 1 : 0),
    };
    return _restoreAttempts[d];
}

/** Read the current counter for a date without incrementing. */
export function getRestoreAttempts(date) {
    return _restoreAttempts[String(date || "").slice(0, 10)] || null;
}

// ─── ■5 Restore loop suppression ─────────────────────────────────────────────
// After ≥3 remote_supabase attempts within 15s, suppress further attempts for
// 10s. Module-level so it is shared across useDraftStore and useLogDateRefresh.
// Auto-expires; no manual clear is required (explicit user edits use a different
// source and are never blocked by this suppression).
const _restoreSuppress = {}; // { [date]: suppressUntilMs }

/** Activate suppression for a date for the given duration (default 10s). */
export function suppressRestoreLoop(date, durationMs = 10_000) {
    const d = String(date || "").slice(0, 10);
    if (d) _restoreSuppress[d] = Date.now() + durationMs;
}

/**
 * Returns remaining suppression seconds for a date (0 = not suppressed).
 * Side-effect: deletes the entry once it has expired.
 */
export function getRestoreLoopSuppressionRemainingSec(date) {
    const d = String(date || "").slice(0, 10);
    if (!d) return 0;
    const until = _restoreSuppress[d];
    if (!until) return 0;
    const remaining = Math.ceil((until - Date.now()) / 1000);
    if (remaining <= 0) {
        delete _restoreSuppress[d];
        return 0;
    }
    return remaining;
}
