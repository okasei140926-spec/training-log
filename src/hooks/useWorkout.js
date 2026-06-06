import { calc1RM, getRecordSourceSets, sanitizeWorkoutSets } from "../utils/helpers";
import { normalizeExerciseName } from "../utils/exerciseName";
import { buildBodyPartExerciseKey, resolveRecordBodyPartLabel } from "../utils/bodyPartClassification";
import {
    copySetDownHelper,
    copyRepDownHelper,
} from "../utils/workoutHelpers";

export const useWorkout = ({
    history,
    manualBests = [],
    sessionHistory,
    setLogData,
    getExSets,
    getExUnit,
    KG_TO_LBS,
    muscleEx = {},
    exerciseBodyPartOverrides = {},
}) => {
    const buildValidSets = (record) => {
        return sanitizeWorkoutSets(getRecordSourceSets(record), { allowBodyweight: false });
    };

    const getRecordScopeFlags = (record) => {
        const sourceText = String(
            record?.historyScope
            || record?.sourceScope
            || record?.source
            || record?.sourceTable
            || record?.recordSource
            || ""
        ).toLowerCase();

        return {
            exactHistoryUsed: record?.exactHistory === true || sourceText.includes("exact") || sourceText.includes("workouts.data"),
            legacyHistoryUsed: record?.legacyHistory === true || sourceText.includes("legacy"),
            summaryJsonUsed: sourceText.includes("summary_json") || sourceText.includes("workout_session"),
            cacheUsed: sourceText.includes("cache") || sourceText.includes("localstorage"),
        };
    };

    const isStalePrCandidate = (candidate) => (
        Boolean(candidate?.scopeFlags?.legacyHistoryUsed)
        || Boolean(candidate?.scopeFlags?.summaryJsonUsed)
        || Boolean(candidate?.scopeFlags?.cacheUsed)
    );

    const getDisplayUnit = (set, record) => {
        const rawUnit = set?.displayUnit || set?.unit || set?.weightUnit || set?.weight_unit
            || record?.displayUnit || record?.unit || record?.weightUnit || record?.weight_unit || "kg";
        const normalized = String(rawUnit || "kg").toLowerCase();
        if (normalized === "lbs" || normalized === "lb" || normalized === "pounds" || normalized === "pound") return "lb";
        if (normalized === "bw" || normalized === "bodyweight" || normalized === "自重") return "BW";
        return "kg";
    };

    const getDisplayWeight = (set) => {
        if (!set) return null;
        if (set.weight === "BW") return "BW";
        return set.displayWeight ?? set.originalWeight ?? set.inputWeight ?? set.weight;
    };

    const getBestRmSet = (sets = []) => {
        return (sets || []).reduce((best, set) => {
            const rm = calc1RM([set]);
            if (!Number.isFinite(rm) || rm <= 0) return best;
            if (!best || rm > best.rm) return { set, rm };
            return best;
        }, null);
    };

    const logPrCalculationDebug = (payload) => {
        console.log("[workout pr]", {
            action: "pr_calculation_debug",
            ...payload,
        });
    };

    const getTargetInfo = (target) => {
        if (typeof target === "string") {
            return {
                name: target,
                normalizedName: normalizeExerciseName(target),
                bodyPart: null,
            };
        }

        return {
            name: target?.name || "",
            normalizedName: normalizeExerciseName(target?.name),
            bodyPart: String(target?.bodyPart || target?.label || "").trim() || null,
        };
    };

    const buildRecordKey = (historyName, record, targetInfo) => {
        const bodyPart = resolveRecordBodyPartLabel(record, historyName, {
            muscleEx,
            exerciseBodyPartOverrides,
        });
        if (!bodyPart) return null;
        return buildBodyPartExerciseKey(bodyPart, targetInfo?.normalizedName || historyName);
    };

    const buildManualEntryKey = (entry) => {
        const bodyPart = resolveRecordBodyPartLabel(
            { bodyPart: entry?.body_part },
            entry?.exercise_name,
            { muscleEx, exerciseBodyPartOverrides }
        );
        if (!bodyPart) return null;
        return buildBodyPartExerciseKey(bodyPart, entry?.exercise_name);
    };

    const isTargetMatch = (key, targetInfo) => {
        if (!key || !targetInfo?.normalizedName) return false;
        if (!targetInfo.bodyPart) return key.endsWith(`::${targetInfo.normalizedName}`) || key === buildBodyPartExerciseKey("", targetInfo.normalizedName);
        return key === buildBodyPartExerciseKey(targetInfo.bodyPart, targetInfo.normalizedName);
    };

    const getPrev = (target) => {
        const targetInfo = getTargetInfo(target);
        const records = (sessionHistory || history)[targetInfo.name];
        if (!records?.length) return null;

        const filtered = records.filter((record) => {
            const key = buildRecordKey(targetInfo.name, record, targetInfo);
            return isTargetMatch(key, targetInfo);
        });

        return filtered.length ? filtered[filtered.length - 1] : null;
    };

    const getHistoryPrCandidates = (targetInfo, { excludeDate } = {}) => {
        const candidates = [];

        Object.entries(history || {}).forEach(([historyName, recs]) => {
            if (normalizeExerciseName(historyName) !== targetInfo.normalizedName) return;

            (recs || []).forEach((r) => {
                const recordDate = String(r?.date || r?.workoutDate || r?.workout_date || "").slice(0, 10);
                if (excludeDate && recordDate === excludeDate) return;
                const key = buildRecordKey(historyName, r, targetInfo);
                if (!isTargetMatch(key, targetInfo)) return;

                const validSets = buildValidSets(r);
                const rm = calc1RM(validSets);
                if (!validSets.length || !Number.isFinite(rm) || rm <= 0) return;

                const scopeFlags = getRecordScopeFlags(r);
                const bestSetEntry = getBestRmSet(validSets);
                const bestSet = bestSetEntry?.set || validSets[0];
                candidates.push({
                    record: r,
                    historyName,
                    date: recordDate || r?.date || null,
                    validSets,
                    rm,
                    scopeFlags,
                    bestSet,
                });
            });
        });

        const hasTrustedCandidate = candidates.some((candidate) => !isStalePrCandidate(candidate));
        const exactDates = new Set(
            candidates
                .filter((candidate) => candidate.scopeFlags.exactHistoryUsed)
                .map((candidate) => candidate.date)
                .filter(Boolean)
        );

        return candidates.filter((candidate) => {
            const rejectedByExactSameDate = Boolean(
                candidate.date
                && exactDates.has(candidate.date)
                && !candidate.scopeFlags.exactHistoryUsed
            );
            const rejectedByTrustedHistory = hasTrustedCandidate && isStalePrCandidate(candidate);
            const rejected = rejectedByExactSameDate || rejectedByTrustedHistory;

            if (rejected) {
                logPrCalculationDebug({
                    exerciseName: targetInfo.name || targetInfo.normalizedName,
                    chosenPRDate: candidate.date || null,
                    chosenOriginalWeight: getDisplayWeight(candidate.bestSet),
                    chosenOriginalUnit: getDisplayUnit(candidate.bestSet, candidate.record),
                    chosenReps: candidate.bestSet?.reps ?? null,
                    normalizedKg: candidate.bestSet?.weight ?? null,
                    displayWeight: getDisplayWeight(candidate.bestSet),
                    displayUnit: getDisplayUnit(candidate.bestSet, candidate.record),
                    source: candidate.record?.recordSource || candidate.record?.source || candidate.record?.sourceTable || "history",
                    usedTrustedHistory: !isStalePrCandidate(candidate),
                    usedLegacyHistory: Boolean(candidate.scopeFlags.legacyHistoryUsed),
                    usedSummaryJson: Boolean(candidate.scopeFlags.summaryJsonUsed),
                    usedManualBest: false,
                    rejectedStalePR: true,
                    rejectedReason: rejectedByExactSameDate
                        ? "exactHistory exists for same date"
                        : "trusted history exists; stale source ignored",
                });
            }

            return !rejected;
        });
    };

    const getBestHistoryPR = (targetInfo, options = {}) => {
        const candidates = getHistoryPrCandidates(targetInfo, options);
        const bestCandidate = candidates.reduce((best, candidate) => {
            if (!best || candidate.rm > best.rm) return candidate;
            return best;
        }, null);

        if (!bestCandidate) return null;

        logPrCalculationDebug({
            exerciseName: targetInfo.name || targetInfo.normalizedName,
            chosenPRDate: bestCandidate.date || null,
            chosenOriginalWeight: getDisplayWeight(bestCandidate.bestSet),
            chosenOriginalUnit: getDisplayUnit(bestCandidate.bestSet, bestCandidate.record),
            chosenReps: bestCandidate.bestSet?.reps ?? null,
            normalizedKg: bestCandidate.bestSet?.weight ?? null,
            displayWeight: getDisplayWeight(bestCandidate.bestSet),
            displayUnit: getDisplayUnit(bestCandidate.bestSet, bestCandidate.record),
            source: bestCandidate.record?.recordSource || bestCandidate.record?.source || bestCandidate.record?.sourceTable || "history",
            usedTrustedHistory: !isStalePrCandidate(bestCandidate),
            usedLegacyHistory: Boolean(bestCandidate.scopeFlags.legacyHistoryUsed),
            usedSummaryJson: Boolean(bestCandidate.scopeFlags.summaryJsonUsed),
            usedManualBest: false,
            rejectedStalePR: false,
            rejectedReason: null,
        });

        return {
            ...bestCandidate.record,
            sets: bestCandidate.validSets,
            rm: bestCandidate.rm,
        };
    };

    const getManualPR = (targetInfo, existingHistoryBest = null) => {
        if (existingHistoryBest) {
            const ignored = manualBests.some((entry) => normalizeExerciseName(entry?.exercise_name) === targetInfo.normalizedName);
            if (ignored) {
                logPrCalculationDebug({
                    exerciseName: targetInfo.name || targetInfo.normalizedName,
                    chosenPRDate: existingHistoryBest?.date || null,
                    chosenOriginalWeight: null,
                    chosenOriginalUnit: null,
                    chosenReps: null,
                    normalizedKg: null,
                    displayWeight: null,
                    displayUnit: null,
                    source: "manual_bests",
                    usedTrustedHistory: true,
                    usedLegacyHistory: false,
                    usedSummaryJson: false,
                    usedManualBest: true,
                    rejectedStalePR: true,
                    rejectedReason: "trusted history exists; manual_bests ignored",
                });
            }
            return null;
        }

        let best = null;
        let bestRM = 0;

        manualBests
            .filter((entry) => normalizeExerciseName(entry?.exercise_name) === targetInfo.normalizedName)
            .forEach((entry) => {
                const key = buildManualEntryKey(entry);
                if (!isTargetMatch(key, targetInfo)) return;

                const validSets = buildValidSets({
                    weight: entry.weight,
                    reps: entry.reps,
                });
                const rm = calc1RM(validSets);

                if (rm > bestRM && validSets.length) {
                    bestRM = rm;
                    best = {
                        date: entry.best_date || null,
                        weight: Number(entry.weight),
                        reps: Number(entry.reps),
                        sets: validSets,
                        rm,
                        isManualBest: true,
                        id: entry.id,
                    };
                }
            });

        if (best) {
            logPrCalculationDebug({
                exerciseName: targetInfo.name || targetInfo.normalizedName,
                chosenPRDate: best.date || null,
                chosenOriginalWeight: best.weight,
                chosenOriginalUnit: "kg",
                chosenReps: best.reps,
                normalizedKg: best.weight,
                displayWeight: best.weight,
                displayUnit: "kg",
                source: "manual_bests",
                usedTrustedHistory: false,
                usedLegacyHistory: false,
                usedSummaryJson: false,
                usedManualBest: true,
                rejectedStalePR: false,
                rejectedReason: null,
            });
        }

        return best;
    };

    const getPR = (target) => {
        const targetInfo = getTargetInfo(target);
        const historyBest = getBestHistoryPR(targetInfo);
        if (historyBest) {
            getManualPR(targetInfo, historyBest);
            return historyBest;
        }
        return getManualPR(targetInfo);
    };

    const getPreviousPR = (target, { excludeDate } = {}) => {
        const targetInfo = getTargetInfo(target);
        const historyBest = getBestHistoryPR(targetInfo, { excludeDate });
        if (historyBest) {
            getManualPR(targetInfo, historyBest);
            return historyBest;
        }
        return getManualPR(targetInfo);
    };

    const copySetDown = (name, idx) => {
        setLogData((p) => {
            const base = getExSets({ name });
            const current = [...(p[name] || base)];

            return {
                ...p,
                [name]: copySetDownHelper({ currentSets: current, idx }),
            };
        });
    };

    const copyRepDown = (name, idx) => {
        setLogData((p) => {
            const base = getExSets({ name });
            const current = [...(p[name] || base)];

            return {
                ...p,
                [name]: copyRepDownHelper({ currentSets: current, idx }),
            };
        });
    };

    return {
        getPrev,
        getPR,
        getPreviousPR,
        copySetDown,
        copyRepDown,
    };
};
