import { useEffect, useMemo, useRef, useState } from "react";
import { sanitizeHistoryRecord } from "../utils/helpers";
import {
    DEFAULT_PARTS,
    WEEKLY_CONSISTENCY_DATES,
    RECOVERY_META,
    getPerfNow,
    shouldLogHomePerfDebug,
    formatDate,
    getWeekRange,
    calcRecovery,
    collectRecentSessions,
    collectWeeklySets,
    collectWeeklyAggregationDebug,
    collectWeeklySetsFromSessions,
    collectWeeklyPartDetailFromSessions,
    collectPartDetail,
    summarizeSessionsByDate,
    summarizeExercisesForDates,
    sumBodyPartCounts,
    getRegressedBodyParts,
    bodyPartCountsSignature,
} from "./home/homeUtils";
import WeeklyTrainingModal from "./home/WeeklyTrainingModal";
import RecoveryModal from "./home/RecoveryModal";
import SessionModal from "./home/SessionModal";

export default function HomeScreen({
    history,
    muscleEx,
    exerciseBodyPartOverrides,
    hiddenBodyParts,
    onStartLog,
    user,
    workoutDurationSecByDate = {},
    recordsLoading = false,
    historyRemoteReady = false,
    remoteLoadFailed = false,
}) {
    const renderStartedAt = getPerfNow();
    const [selectedSession, setSelectedSession] = useState(null);
    const [selectedRecovery, setSelectedRecovery] = useState(null);
    const [selectedWeeklyPart, setSelectedWeeklyPart] = useState(null);
    const [selectedRecoveryPart, setSelectedRecoveryPart] = useState(null);
    const [homeMetricsReady, setHomeMetricsReady] = useState(false);
    const [trustedHomeSnapshot, setTrustedHomeSnapshot] = useState(null);
    const trustedHomeSnapshotRef = useRef(null);
    const renderCountRef = useRef(0);
    const lastRenderTraceAtRef = useRef(0);
    const homeSnapshotLogSignatureRef = useRef("");
    const weeklyConsistencyLogSignatureRef = useRef("");
    const homeRenderStateLogSignatureRef = useRef("");
    const week = getWeekRange();
    const weekKey = `${week.start}:${week.end}`;
    renderCountRef.current += 1;

    useEffect(() => {
        if (!shouldLogHomePerfDebug()) return;
        const now = getPerfNow();
        if (now - lastRenderTraceAtRef.current < 1000) return;
        lastRenderTraceAtRef.current = now;
        console.log("[perf]", {
            action: "perf_render_trace",
            component: "HomeScreen",
            renderCount: renderCountRef.current,
            timestamp: new Date().toISOString(),
            historyLength: Object.keys(history || {}).length,
            trustedHistoryLength: Object.values(history || {}).reduce((sum, records) => (
                sum + (Array.isArray(records) ? records.length : 0)
            ), 0),
            durationMs: Math.round((getPerfNow() - renderStartedAt) * 10) / 10,
        });
    });

    useEffect(() => {
        const timeoutId = window.setTimeout(() => setHomeMetricsReady(true), 80);
        return () => window.clearTimeout(timeoutId);
    }, []);

    const allSessions = useMemo(() => (
        homeMetricsReady && !recordsLoading
            ? collectRecentSessions(history, muscleEx, exerciseBodyPartOverrides, workoutDurationSecByDate)
            : []
    ), [homeMetricsReady, recordsLoading, history, muscleEx, exerciseBodyPartOverrides, workoutDurationSecByDate]);

    const incomingWeeklySessions = useMemo(() => (
        allSessions.filter((session) => session.date >= week.start && session.date <= week.end)
    ), [allSessions, week.end, week.start]);

    const incomingWeeklySets = useMemo(() => (
        collectWeeklySetsFromSessions(incomingWeeklySessions)
    ), [incomingWeeklySessions]);

    const incomingHomeSnapshot = useMemo(() => ({
        weekKey,
        weekRange: { start: week.start, end: week.end },
        sessions: allSessions,
        weeklySessions: incomingWeeklySessions,
        weeklySets: incomingWeeklySets,
        source: "trusted allSessions",
        createdAt: Date.now(),
    }), [allSessions, incomingWeeklySessions, incomingWeeklySets, week.end, week.start, weekKey]);

    useEffect(() => {
        if (!homeMetricsReady || recordsLoading) return;

        const previous = trustedHomeSnapshotRef.current;
        const previousCounts = previous?.weeklySets || {};
        const nextCounts = incomingHomeSnapshot.weeklySets || {};
        const sameWeek = previous?.weekKey === incomingHomeSnapshot.weekKey;
        const previousTotal = sumBodyPartCounts(previousCounts);
        const nextTotal = sumBodyPartCounts(nextCounts);
        const regressedBodyParts = sameWeek ? getRegressedBodyParts(previousCounts, nextCounts) : [];
        const staleOverwrite = Boolean(
            previous &&
            sameWeek &&
            previousTotal > 0 &&
            nextTotal > 0 &&
            nextTotal <= previousTotal &&
            regressedBodyParts.length > 0
        );

        if (staleOverwrite) {
            if (shouldLogHomePerfDebug()) {
                const signature = JSON.stringify({
                    action: "home_weekly_stale_overwrite_blocked",
                    weekKey,
                    nextCounts,
                    previousCounts,
                    regressedBodyParts,
                });
                if (homeSnapshotLogSignatureRef.current !== signature) {
                    homeSnapshotLogSignatureRef.current = signature;
                    console.warn("[home weekly consistency]", {
                        action: "home_weekly_stale_overwrite_blocked",
                        staleSource: incomingHomeSnapshot.source,
                        staleBodyPartCounts: nextCounts,
                        staleShoulderCount: nextCounts["肩"] || 0,
                        staleTricepsCount: nextCounts["三頭"] || 0,
                        trustedBodyPartCounts: previousCounts,
                        trustedShoulderCount: previousCounts["肩"] || 0,
                        trustedTricepsCount: previousCounts["三頭"] || 0,
                        trustedBicepsCount: previousCounts["二頭"] || 0,
                        applied: false,
                        reason: "incoming weekly summary regressed from trusted allSessions snapshot",
                        regressedBodyParts,
                        timestamp: new Date().toISOString(),
                        recentSessionsDates: previous.sessions?.slice(0, 4).map((session) => session.date) || [],
                        allSessionsDates: incomingHomeSnapshot.sessions.map((session) => session.date),
                    });
                }
            }
            return;
        }

        const previousSignature = bodyPartCountsSignature(previousCounts);
        const nextSignature = bodyPartCountsSignature(nextCounts);
        if (shouldLogHomePerfDebug() && (!previous || !sameWeek || previousSignature !== nextSignature)) {
            console.log("[home weekly consistency]", {
                action: "home_weekly_render_value_changed",
                previousBodyPartCounts: previousCounts,
                nextBodyPartCounts: nextCounts,
                previousSource: previous?.source || null,
                nextSource: incomingHomeSnapshot.source,
                appliedSource: incomingHomeSnapshot.source,
                rejectedSource: null,
                reason: !previous ? "initial trusted home snapshot" : sameWeek ? "weekly values changed from trusted allSessions" : "week changed",
                timestamp: new Date().toISOString(),
                recentSessionsDates: incomingHomeSnapshot.sessions.slice(0, 4).map((session) => session.date),
                allSessionsDates: incomingHomeSnapshot.sessions.map((session) => session.date),
                shoulderCount: nextCounts["肩"] || 0,
                tricepsCount: nextCounts["三頭"] || 0,
                bicepsCount: nextCounts["二頭"] || 0,
            });
        }

        trustedHomeSnapshotRef.current = incomingHomeSnapshot;
        setTrustedHomeSnapshot(incomingHomeSnapshot);
    }, [homeMetricsReady, incomingHomeSnapshot, recordsLoading, weekKey]);

    const activeHomeSnapshot = trustedHomeSnapshot?.weekKey === weekKey
        ? trustedHomeSnapshot
        : incomingHomeSnapshot;

    const weeklySessions = useMemo(
        () => activeHomeSnapshot.weeklySessions || [],
        [activeHomeSnapshot]
    );
    const recentSessions = useMemo(
        () => (activeHomeSnapshot.sessions || []).slice(0, 4),
        [activeHomeSnapshot]
    );
    const weeklySets = useMemo(
        () => activeHomeSnapshot.weeklySets || {},
        [activeHomeSnapshot]
    );

    useEffect(() => {
        if (!shouldLogHomePerfDebug()) return;
        if (!homeMetricsReady || recordsLoading) return;
        const nextWeeklySets = collectWeeklySetsFromSessions(weeklySessions);
        const directHistoryWeeklySets = collectWeeklySets(history, muscleEx, exerciseBodyPartOverrides);
        const directSignature = JSON.stringify(directHistoryWeeklySets);
        const sessionSignature = JSON.stringify(nextWeeklySets);
        const mismatchDetected = directSignature !== sessionSignature;
        const signature = JSON.stringify({
            weekKey,
            sessionSignature,
            directSignature,
            recentDates: recentSessions.map((session) => session.date),
            weeklyDates: weeklySessions.map((session) => session.date),
        });
        if (!mismatchDetected) return;
        if (weeklyConsistencyLogSignatureRef.current === signature) return;
        weeklyConsistencyLogSignatureRef.current = signature;
        const directDebug = collectWeeklyAggregationDebug(history, muscleEx, exerciseBodyPartOverrides);
        console.warn("[home weekly consistency]", {
            action: "home_weekly_consistency_check",
            ...directDebug,
            weekRange: { start: week.start, end: week.end },
            recentRecordsSource: activeHomeSnapshot.source,
            weeklySummarySource: activeHomeSnapshot.source,
            trustedHistoryLength: Object.values(history || {}).reduce((sum, records) => sum + (Array.isArray(records) ? records.length : 0), 0),
            recentRecordsDates: recentSessions.map((session) => session.date),
            weeklyAggregationDates: weeklySessions.map((session) => session.date).sort(),
            exercisesByDate: summarizeExercisesForDates(weeklySessions, WEEKLY_CONSISTENCY_DATES),
            bodyPartCounts: nextWeeklySets,
            directHistoryBodyPartCounts: directHistoryWeeklySets,
            recentRecordsTotalSetsByDate: summarizeSessionsByDate(recentSessions),
            shoulderSetCount: nextWeeklySets["肩"] || 0,
            tricepsSetCount: nextWeeklySets["三頭"] || 0,
            bicepsSetCount: nextWeeklySets["二頭"] || 0,
            mismatchDetected,
            mismatchReason: mismatchDetected
                ? "direct weekly aggregation differed from recentRecords/trustedHistory session aggregation"
                : null,
            appliedSource: activeHomeSnapshot.source,
            ignoredStaleSource: mismatchDetected ? "history_cache/summary_json/stale weekly summary" : null,
        });
        console.log("[home weekly consistency]", {
            action: "home_screen_received_sessions",
            receivedSessionsLength: allSessions.length,
            receivedDates: allSessions.map((session) => session.date),
            recentSessionsDatesAndCounts: summarizeSessionsByDate(recentSessions),
            weeklySetsInputDatesAndCounts: summarizeSessionsByDate(weeklySessions),
            finalBodyPartCounts: nextWeeklySets,
            shoulderCount: nextWeeklySets["肩"] || 0,
            tricepsCount: nextWeeklySets["三頭"] || 0,
            bicepsCount: nextWeeklySets["二頭"] || 0,
            backCount: nextWeeklySets["背中"] || 0,
        });
    }, [
        activeHomeSnapshot.source,
        allSessions,
        exerciseBodyPartOverrides,
        history,
        homeMetricsReady,
        muscleEx,
        recentSessions,
        recordsLoading,
        week.end,
        weekKey,
        week.start,
        weeklySessions,
    ]);

    const partsToShow = useMemo(() => {
        const base = DEFAULT_PARTS.filter(p => !(hiddenBodyParts || []).includes(p));
        const trained = Object.keys(weeklySets).filter(p => !base.includes(p));
        return [...base, ...trained];
    }, [hiddenBodyParts, weeklySets]);

    const recoveries = useMemo(() => (
        homeMetricsReady && !recordsLoading
            ? partsToShow.map(part => ({
                part,
                ...calcRecovery(history, part, muscleEx, exerciseBodyPartOverrides),
            }))
            : partsToShow.map(part => ({
                part,
                pct: 100,
                status: "excellent",
            }))
    ), [homeMetricsReady, recordsLoading, history, muscleEx, exerciseBodyPartOverrides, partsToShow]);

    const monthlyVolume = useMemo(() => {
        if (!homeMetricsReady || recordsLoading) return null;
        const now = new Date();
        const todayDay = String(now.getDate()).padStart(2, "0");
        const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
        // 先月の同期カットオフ: 先月の1日〜今日と同じ日付まで
        const prevMonthCutoff = `${prevMonth}-${todayDay}`;
        let thisVol = 0;
        let prevVol = 0;
        (allSessions || []).forEach(session => {
            const m = session.date.slice(0, 7);
            if (m === thisMonth) thisVol += session.volume || 0;
            else if (m === prevMonth && session.date <= prevMonthCutoff) prevVol += session.volume || 0;
        });
        if (thisVol === 0 && prevVol === 0) return null;
        return { thisVol: Math.round(thisVol), prevVol: Math.round(prevVol) };
    }, [homeMetricsReady, recordsLoading, allSessions]);

    const weeklyDisplay = partsToShow
        .map(part => ({ part, sets: weeklySets[part] || 0 }))
        .filter(x => x.sets > 0);
    const weeklyItems = weeklyDisplay.length
        ? weeklyDisplay
        : recordsLoading
            ? []
            : partsToShow.slice(0, 4).map(part => ({ part, sets: 0 }));

    useEffect(() => {
        if (!shouldLogHomePerfDebug() && !recordsLoading && !remoteLoadFailed) return;
        const historyDatesCount = Object.keys(history || {}).length;
        const historySetCount = Object.values(history || {}).reduce((dateTotal, record) => {
            const safeRecord = sanitizeHistoryRecord(record);
            return dateTotal + Object.values(safeRecord || {}).reduce((exerciseTotal, sets) => (
                exerciseTotal + (Array.isArray(sets) ? sets.length : 0)
            ), 0);
        }, 0);
        const weeklyLoading = Boolean(recordsLoading);
        const recentLoading = Boolean(recordsLoading);
        const loadingReason = recordsLoading
            ? !historyRemoteReady
                ? remoteLoadFailed
                    ? "remote load failed"
                    : "waiting for trusted remote history"
                : "recordsLoading prop is still true"
            : "ready";
        const signature = JSON.stringify({
            historyRemoteReady,
            remoteLoadFailed,
            weeklyLoading,
            recentLoading,
            weeklySummaryExists: weeklyDisplay.length > 0,
            recentRecordsCount: recentSessions.length,
            historyDatesCount,
            loadingReason,
        });
        if (homeRenderStateLogSignatureRef.current === signature) return;
        homeRenderStateLogSignatureRef.current = signature;

        console.log("[home render state]", {
            historyRemoteReady,
            remoteLoadFailed,
            homeWeeklyLoading: weeklyLoading,
            recentRecordsLoading: recentLoading,
            historyLoading: recordsLoading,
            weeklySummaryExists: weeklyDisplay.length > 0,
            recentRecordsCount: recentSessions.length,
            workoutsDataHistoryCount: historyDatesCount,
            workoutsDataHistorySetCount: historySetCount,
            reason: loadingReason,
        });
    }, [
        history,
        historyRemoteReady,
        recordsLoading,
        recentSessions.length,
        remoteLoadFailed,
        weeklyDisplay.length,
    ]);

    return (
        <div className="fade-in" style={{
            padding: "16px 14px var(--bottom-nav-scroll-padding)",
            background: "var(--home-bg)",
            color: "var(--home-text)",
        }}>
            <section style={{
                borderRadius: 20,
                padding: "14px 12px",
                marginBottom: 14,
                background: "var(--home-card)",
                border: "1px solid var(--home-card-border)",
                boxShadow: "var(--home-shadow)",
                overflow: "hidden",
            }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 950, letterSpacing: 0.2, color: "var(--home-title)" }}>回復状況</h2>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {Object.values(RECOVERY_META).map(meta => (
                            <div key={meta.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <span style={{ width: 7, height: 7, borderRadius: 99, background: meta.color }} />
                                <span style={{ fontSize: 10, color: "var(--home-muted2)", fontWeight: 750 }}>{meta.label}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 部位タブ */}
                <div style={{ display: "flex", gap: 7, overflowX: "auto", marginBottom: 14, paddingBottom: 2, scrollbarWidth: "none" }}>
                    {recoveries.map(item => {
                        const meta = RECOVERY_META[item.status];
                        const isActive = (selectedRecoveryPart || recoveries[0]?.part) === item.part;
                        return (
                            <button
                                key={item.part}
                                type="button"
                                onClick={() => setSelectedRecoveryPart(item.part)}
                                style={{
                                    flexShrink: 0,
                                    padding: "6px 13px",
                                    borderRadius: 999,
                                    border: `1.5px solid ${isActive ? meta.color : "var(--home-inner-border)"}`,
                                    background: isActive ? `${meta.color}22` : "var(--home-inner-card)",
                                    color: isActive ? meta.color : "var(--home-muted2)",
                                    fontSize: 13,
                                    fontWeight: 900,
                                }}
                            >
                                {item.part}
                            </button>
                        );
                    })}
                </div>

                {/* 選択部位のプログレスバー */}
                {(() => {
                    const activePart = selectedRecoveryPart || recoveries[0]?.part;
                    const item = recoveries.find(r => r.part === activePart);
                    if (!item) return null;
                    const meta = RECOVERY_META[item.status];
                    return (
                        <div
                            onClick={() => {
                                const detail = collectPartDetail(history, muscleEx, exerciseBodyPartOverrides, item.part);
                                setSelectedRecovery({ ...item, detail });
                            }}
                            style={{ cursor: "pointer", padding: "0 2px" }}
                        >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 9 }}>
                                <span style={{ fontSize: 28, fontWeight: 950, color: meta.color, letterSpacing: "-1px", lineHeight: 1 }}>
                                    {item.pct}%
                                </span>
                                <span style={{ fontSize: 13, fontWeight: 900, color: meta.color }}>
                                    {meta.label}
                                </span>
                            </div>
                            <div style={{ height: 12, borderRadius: 999, background: "rgba(130,150,155,0.18)", overflow: "hidden" }}>
                                <div style={{
                                    height: "100%",
                                    width: `${item.pct}%`,
                                    borderRadius: 999,
                                    background: meta.color,
                                    boxShadow: `0 0 12px ${meta.color}66`,
                                    transition: "width 0.35s ease",
                                }} />
                            </div>
                        </div>
                    );
                })()}
            </section>

            <section style={{
                borderRadius: 18,
                padding: "17px 18px",
                marginBottom: 14,
                background: "var(--home-card)",
                border: "1px solid var(--home-card-border)",
                boxShadow: "var(--home-shadow)",
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 950, color: "var(--home-title)" }}>今週のトレーニング</h2>
                    <span style={{ color: "var(--home-muted)", fontSize: 14, fontWeight: 850 }}>{week.label}</span>
                </div>

                {recordsLoading ? (
                    <div style={{ padding: "18px 0 4px", textAlign: "center", color: "var(--home-muted)", fontWeight: 800 }}>
                        取得中
                    </div>
                ) : (
                    <div style={{
                        display: "grid",
                        gridTemplateColumns: `repeat(${Math.min(Math.max(weeklyItems.length, 1), 8)}, minmax(0, 1fr))`,
                        gap: 0,
                    }}>
                        {weeklyItems.map((x, index, arr) => (
                        <button
                            key={x.part}
                            onClick={() => {
                                const detail = collectWeeklyPartDetailFromSessions(weeklySessions, x.part);
                                setSelectedWeeklyPart(detail);
                            }}
                            style={{
                                textAlign: "center",
                                border: "none",
                                borderRight: index !== arr.length - 1 ? "1px solid var(--home-row-border)" : "none",
                                padding: "0 5px",
                                background: "transparent",
                                cursor: "pointer",
                            }}
                        >
                            <div style={{ fontSize: 14, color: "var(--home-text)", fontWeight: 900 }}>{x.part}</div>
                            <div style={{ fontSize: 30, color: "var(--home-text)", fontWeight: 950, marginTop: 7, lineHeight: 1 }}>{x.sets}</div>
                            <div style={{ fontSize: 13, color: "var(--home-muted)", fontWeight: 800, marginTop: 2 }}>set</div>
                        </button>
                        ))}
                    </div>
                )}
                {monthlyVolume && (
                    <div style={{
                        marginTop: 14,
                        paddingTop: 12,
                        borderTop: "1px solid var(--home-row-border)",
                        display: "flex",
                        alignItems: "baseline",
                        gap: 8,
                    }}>
                        <span style={{ fontSize: 12, color: "var(--home-muted)", fontWeight: 800 }}>今月</span>
                        <span style={{ fontSize: 17, fontWeight: 950, color: "var(--home-text)" }}>
                            {monthlyVolume.thisVol.toLocaleString("ja-JP")}kg
                        </span>
                        {monthlyVolume.prevVol > 0 && (() => {
                            const diff = monthlyVolume.thisVol - monthlyVolume.prevVol;
                            const pct = Math.round(Math.abs(diff) / monthlyVolume.prevVol * 100);
                            const isUp = diff >= 0;
                            return (
                                <span style={{ fontSize: 12, fontWeight: 800, color: isUp ? "var(--accent)" : "var(--home-muted)" }}>
                                    {isUp ? "▲" : "▼"}{pct}% 先月同期比
                                </span>
                            );
                        })()}
                    </div>
                )}
            </section>

            <section style={{
                borderRadius: 18,
                padding: "17px 18px 8px",
                background: "var(--home-card)",
                border: "1px solid var(--home-card-border)",
                boxShadow: "var(--home-shadow)",
            }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 950, color: "var(--home-title)" }}>最近の記録</h2>
                    <span />
                </div>

                {recordsLoading ? (
                    <div style={{ padding: "28px 0", textAlign: "center", color: "var(--home-muted)", fontWeight: 800 }}>
                        記録を取得しています
                    </div>
                ) : recentSessions.length === 0 ? (
                    <div style={{ padding: "28px 0", textAlign: "center", color: "var(--home-muted)", fontWeight: 800 }}>
                        まだ記録がありません
                    </div>
                ) : recentSessions.map((s, index) => (
                    <div
                        key={s.date}
                        onClick={() => setSelectedSession(s)}
                        style={{
                        display: "grid",
                        cursor: "pointer",
                        gridTemplateColumns: "74px minmax(0, 1fr) 48px 76px 38px 12px",
                        alignItems: "center",
                        gap: 5,
                        padding: "13px 0",
                        borderBottom: index !== recentSessions.length - 1 ? "1px solid var(--home-row-border)" : "none",
                    }}>
                        <div style={{ color: "var(--home-muted2)", fontSize: 12, fontWeight: 850 }}>
                            {formatDate(s.date)}
                        </div>
                        <div style={{
                            color: "var(--home-text)",
                            fontSize: 13,
                            fontWeight: 930,
                            minWidth: 0,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                        }}>
                            {s.parts.length ? s.parts.join("・") : "記録"}
                        </div>
                        <div style={{ color: "var(--home-text)", textAlign: "right", fontSize: 12, fontWeight: 850 }}>{s.sets} set</div>
                        <div style={{ color: "var(--home-text)", textAlign: "right", fontSize: 12, fontWeight: 850 }}>{s.volume.toLocaleString()} kg</div>
                        <div style={{ color: "var(--home-muted2)", textAlign: "right", fontSize: 12, fontWeight: 850 }}>{s.minutes ? `${s.minutes}分` : ""}</div>
                        <div style={{ color: "var(--home-muted)", fontSize: 22 }}>›</div>
                    </div>
                ))}
            </section>

            <WeeklyTrainingModal
                selectedWeeklyPart={selectedWeeklyPart}
                onClose={() => setSelectedWeeklyPart(null)}
            />

            <RecoveryModal
                selectedRecovery={selectedRecovery}
                onClose={() => setSelectedRecovery(null)}
            />

            <SessionModal
                selectedSession={selectedSession}
                onClose={() => setSelectedSession(null)}
            />

        </div>
    );
}
