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
