import { useCallback, useEffect } from "react";
import {
    getCurrentWeekRangeForHomeSummary,
    getHomeWeeklySourceDebug,
    getHomeWeeklyStaleRegressionDecision,
    getHomeWeeklySummaryDebug,
    getRuntimeEnvironmentLabel,
    serializeHistoryMap,
    shouldLogPerfDebug,
} from "../utils/appHelpers";

export function useWorkoutsDataHistorySync({
    workoutsDataHistory,
    workoutsDataHistoryRef,
    user,
    setWorkoutsDataHistory,
}) {
    useEffect(() => {
        const incomingStateHistory = workoutsDataHistory || {};
        const trustedRefHistory = workoutsDataHistoryRef.current || {};
        if (serializeHistoryMap(incomingStateHistory) === serializeHistoryMap(trustedRefHistory)) return;

        const decision = getHomeWeeklyStaleRegressionDecision(
            trustedRefHistory,
            incomingStateHistory,
            getCurrentWeekRangeForHomeSummary()
        );
        if (decision.blocked) {
            console.warn("[home weekly summary] stale state commit blocked", {
                action: "home_weekly_stale_overwrite_blocked",
                source: "workoutsDataHistory state commit",
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                applied: false,
                staleBodyPartCounts: decision.incomingSummary.bodyPartCounts,
                trustedBodyPartCounts: decision.trustedSummary.bodyPartCounts,
                staleShoulderCount: decision.incomingSummary.bodyPartCounts["肩"] || 0,
                staleTricepsCount: decision.incomingSummary.bodyPartCounts["三頭"] || 0,
                staleBicepsCount: decision.incomingSummary.bodyPartCounts["二頭"] || 0,
                trustedShoulderCount: decision.trustedSummary.bodyPartCounts["肩"] || 0,
                trustedTricepsCount: decision.trustedSummary.bodyPartCounts["三頭"] || 0,
                trustedBicepsCount: decision.trustedSummary.bodyPartCounts["二頭"] || 0,
                regressedBodyParts: decision.regressedBodyParts,
                reason: "older workoutsDataHistory state attempted to replace richer ref",
                timestamp: new Date().toISOString(),
            });
            setWorkoutsDataHistory(trustedRefHistory);
            return;
        }

        workoutsDataHistoryRef.current = incomingStateHistory;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, workoutsDataHistory]);

    const applyWorkoutsDataHistorySnapshot = useCallback((nextHistory, {
        allowRegression = false,
        source = "workouts.data",
        reason = "unknown",
        requestId = null,
        weekRange = getCurrentWeekRangeForHomeSummary(),
        workoutsHistory = null,
        summaryHistory = {},
    } = {}) => {
        const incomingHistory = nextHistory || {};
        const trustedHistory = workoutsDataHistoryRef.current || {};
        const decision = getHomeWeeklyStaleRegressionDecision(
            trustedHistory,
            incomingHistory,
            weekRange
        );

        if (!allowRegression && decision.blocked) {
            console.warn("[home weekly summary] stale overwrite blocked", {
                action: "home_weekly_stale_overwrite_blocked",
                source,
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                requestId,
                applied: false,
                reason,
                staleSource: source,
                staleBodyPartCounts: decision.incomingSummary.bodyPartCounts,
                staleShoulderCount: decision.incomingSummary.bodyPartCounts["肩"] || 0,
                staleTricepsCount: decision.incomingSummary.bodyPartCounts["三頭"] || 0,
                staleBicepsCount: decision.incomingSummary.bodyPartCounts["二頭"] || 0,
                trustedBodyPartCounts: decision.trustedSummary.bodyPartCounts,
                trustedShoulderCount: decision.trustedSummary.bodyPartCounts["肩"] || 0,
                trustedTricepsCount: decision.trustedSummary.bodyPartCounts["三頭"] || 0,
                trustedBicepsCount: decision.trustedSummary.bodyPartCounts["二頭"] || 0,
                regressedBodyParts: decision.regressedBodyParts,
                timestamp: new Date().toISOString(),
                ...getHomeWeeklySourceDebug({
                    workoutsHistory: workoutsHistory || incomingHistory,
                    summaryHistory,
                    finalHistory: incomingHistory,
                    weekRange,
                    source,
                    appliedSource: "none",
                    ignoredStaleSource: `${source}: ${reason}`,
                }),
            });
            return false;
        }

        const previousSummary = getHomeWeeklySummaryDebug(trustedHistory, weekRange);
        const nextSummary = getHomeWeeklySummaryDebug(incomingHistory, weekRange);
        const previousSignature = JSON.stringify(previousSummary.bodyPartCounts || {});
        const nextSignature = JSON.stringify(nextSummary.bodyPartCounts || {});

        const changedFromTrusted = serializeHistoryMap(incomingHistory) !== serializeHistoryMap(trustedHistory);
        workoutsDataHistoryRef.current = incomingHistory;
        if (changedFromTrusted) {
            setWorkoutsDataHistory(incomingHistory);
        }

        if (shouldLogPerfDebug() && previousSignature !== nextSignature) {
            console.log("[home weekly summary] render value source changed", {
                action: "home_weekly_render_value_changed",
                source,
                env: getRuntimeEnvironmentLabel(),
                user_id: user?.id || null,
                requestId,
                applied: true,
                reason,
                previousBodyPartCounts: previousSummary.bodyPartCounts,
                nextBodyPartCounts: nextSummary.bodyPartCounts,
                previousSource: "workoutsDataHistoryRef",
                nextSource: source,
                appliedSource: source,
                rejectedSource: null,
                timestamp: new Date().toISOString(),
                shoulderCount: nextSummary.bodyPartCounts["肩"] || 0,
                tricepsCount: nextSummary.bodyPartCounts["三頭"] || 0,
                bicepsCount: nextSummary.bodyPartCounts["二頭"] || 0,
            });
        }

        return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id]);

    return { applyWorkoutsDataHistorySnapshot };
}
