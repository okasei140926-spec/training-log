import {
  calc1RM,
  getBestRmSet,
  hasMeaningfulPRIncrease,
  PR_UPDATE_TOLERANCE_KG,
} from "./helpers";
import { normalizeExerciseName } from "./exerciseName";
import { normalizeBodyPartLabel } from "./bodyPartClassification";

/**
 * Shared PR calculation function.
 *
 * Counts PRs per exercise (種目単位), deduplicated by
 * `normalizeBodyPartLabel(bodyPart)::normalizeExerciseName(exerciseName)`.
 *
 * @param {Array<{ exerciseName: string, bodyPart: string, sets: Array }>} entries
 *   Normalized entries — each entry has already-sanitized sets (weight stored in kg).
 * @param {Function} getPreviousPR
 *   (exerciseObj, { beforeDate }) => { sets, rm } | null
 *   Where exerciseObj = { name, bodyPart }.
 *   Return null / undefined when no history exists.
 * @param {string} workoutDate
 *   ISO date string (YYYY-MM-DD) of the workout being evaluated.
 *   Passed to getPreviousPR as beforeDate so only records strictly before this date are used as baseline.
 * @param {Object} [options]
 * @param {number|null} [options.bodyWeightKg]  Body weight for BW sets (default null = no BW).
 * @param {number}      [options.tolerance]     1RM tolerance override (default PR_UPDATE_TOLERANCE_KG).
 * @returns {Array<{
 *   exerciseName: string,
 *   bodyPart: string,
 *   weight: number|"BW",
 *   reps: number,
 *   unit: string,
 *   currentRm: number,
 *   baselineRm: number,
 *   rmGain: number,
 * }>} Sorted by rmGain descending. Length = prCount.
 */
export function calcPrEntries(entries, getPreviousPR, workoutDate, options = {}) {
  const {
    bodyWeightKg = null,
    tolerance = PR_UPDATE_TOLERANCE_KG,
  } = options;

  const dedupeMap = new Map(); // key => entry with highest rmGain

  for (const entry of (entries || [])) {
    const exerciseName = String(entry?.exerciseName || "").trim();
    const bodyPart = entry?.bodyPart ?? "";
    const sets = entry?.sets || [];

    if (!exerciseName || !sets.length) continue;

    // Build dedup key (same as buildWorkoutDaySummaryPrKey)
    const key = `${normalizeBodyPartLabel(bodyPart, "")}::${normalizeExerciseName(exerciseName)}`;

    // Get previous PR for this exercise
    const prevPr = typeof getPreviousPR === "function"
      ? getPreviousPR({ name: exerciseName, bodyPart }, { beforeDate: workoutDate })
      : null;

    const previousSets = prevPr?.sets || [];
    const previousRm = (prevPr?.rm != null && Number.isFinite(prevPr.rm) && prevPr.rm > 0)
      ? prevPr.rm
      : calc1RM(previousSets, { bodyWeightKg });

    // Check if this is a PR
    const isPr = hasMeaningfulPRIncrease(
      sets,
      previousSets,
      previousRm,
      tolerance,
      { bodyWeightKg }
    );

    if (!isPr) continue;

    // Capture best set for display
    const bestSet = getBestRmSet(sets, { allowBodyweight: true, bodyWeightKg });
    if (!bestSet) continue;

    const currentRm = bestSet.rm ?? calc1RM(sets, { bodyWeightKg });
    const baselineRm = previousRm;
    const rmGain = currentRm - baselineRm;

    const candidate = {
      exerciseName,
      bodyPart,
      weight: bestSet.weight,
      reps: Number(bestSet.reps),
      unit: bestSet.displayUnit || bestSet.unit || "kg",
      currentRm,
      baselineRm,
      rmGain,
    };

    // Deduplicate: keep the candidate with the higher rmGain
    const existing = dedupeMap.get(key);
    if (!existing || rmGain > existing.rmGain) {
      dedupeMap.set(key, candidate);
    }
  }

  // Sort by rmGain descending
  return Array.from(dedupeMap.values()).sort((a, b) => b.rmGain - a.rmGain);
}
