import { useMemo } from "react";
import { getSetCountByBodyPart } from "../utils/setCountByBodyPart";

const BODY_PARTS = ["胸", "背中", "肩", "二頭", "三頭", "四頭", "ハム", "腹筋"];

const RECOVERY_COLORS = {
    "非常に良好": "#12C7C2",
    "良好": "#22c55e",
    "やや疲労": "#f59e0b",
    "疲労あり": "#ef4444",
};

function calcRecovery(history, bodyPart, muscleEx, exerciseBodyPartOverrides) {
    const now = Date.now();
    const exercises = Object.entries(history || {});
    let lastTrainedMs = null;
    let recentSets = 0;

    exercises.forEach(([exName, records]) => {
        const bp = exerciseBodyPartOverrides?.[exName] ||
            Object.entries(muscleEx || {}).find(([, exs]) =>
                exs.some(e => e.name === exName))?.[0];
        if (bp !== bodyPart) return;

        records?.forEach(record => {
            const d = new Date(record.date);
            if (isNaN(d)) return;
            const ms = d.getTime();
            if (!lastTrainedMs || ms > lastTrainedMs) lastTrainedMs = ms;
            const hoursAgo = (now - ms) / 3600000;
            if (hoursAgo < 168) {
                recentSets += Array.isArray(record.sets)
                    ? record.sets.filter(s => s?.reps > 0).length
                    : (record.setCount || 0);
            }
        });
    });

    if (!lastTrainedMs) return { pct: 100, label: "非常に良好", hoursAgo: null };

    const hoursAgo = (now - lastTrainedMs) / 3600000;
    let pct;
    if (hoursAgo >= 72) pct = 100;
    else if (hoursAgo >= 48) pct = 80 + ((hoursAgo - 48) / 24) * 20;
    else if (hoursAgo >= 24) pct = 50 + ((hoursAgo - 24) / 24) * 30;
    else pct = Math.max(20, (hoursAgo / 24) * 50);

    if (recentSets > 20) pct = Math.max(20, pct - 20);
    else if (recentSets > 12) pct = Math.max(30, pct - 10);

    pct = Math.round(pct);
    let label;
    if (pct >= 80) label = "非常に良好";
    else if (pct >= 60) label = "良好";
    else if (pct >= 40) label = "やや疲労";
    else label = "疲労あり";

    return { pct, label, hoursAgo: Math.round(hoursAgo) };
}

function getWeekRange() {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const mon = new Date(now);
    mon.setDate(now.getDate() + diff);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const fmt = d => `${d.getMonth() + 1}/${d.getDate()}`;
    return { label: `${fmt(mon)} - ${fmt(sun)}`, mon, sun };
}

function getWeekEntries(history, muscleEx, exerciseBodyPartOverrides, bodyPart) {
    const { mon, sun } = getWeekRange();
    const monStr = mon.toISOString().slice(0, 10);
    const sunStr = sun.toISOString().slice(0, 10);
    let sets = 0;

    Object.entries(history || {}).forEach(([exName, records]) => {
        const bp = exerciseBodyPartOverrides?.[exName] ||
            Object.entries(muscleEx || {}).find(([, exs]) =>
                exs.some(e => e.name === exName))?.[0];
        if (bp !== bodyPart) return;
        records?.forEach(r => {
            if (r.date >= monStr && r.date <= sunStr) {
                sets += Array.isArray(r.sets)
                    ? r.sets.filter(s => s?.reps > 0).length
                    : (r.setCount || 0);
            }
        });
    });
    return sets;
}

function getRecentSessions(history, muscleEx, exerciseBodyPartOverrides) {
    const sessionMap = {};
    Object.entries(history || {}).forEach(([exName, records]) => {
        records?.forEach(r => {
            if (!r.date) return;
            if (!sessionMap[r.date]) sessionMap[r.date] = { parts: new Set(), sets: 0, volume: 0, date: r.date };
            const bp = exerciseBodyPartOverrides?.[exName] ||
                Object.entries(muscleEx || {}).find(([, exs]) =>
                    exs.some(e => e.name === exName))?.[0] || "その他";
            sessionMap[r.date].parts.add(bp);
            const cnt = Array.isArray(r.sets) ? r.sets.filter(s => s?.reps > 0).length : (r.setCount || 0);
            sessionMap[r.date].sets += cnt;
            if (Array.isArray(r.sets)) {
                r.sets.forEach(s => {
                    if (s?.reps > 0 && s?.weight > 0) sessionMap[r.date].volume += s.weight * s.reps;
                });
            }
        });
    });

    return Object.values(sessionMap)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 4)
        .map(s => ({
            ...s,
            parts: [...s.parts].slice(0, 3),
            volume: Math.round(s.volume),
        }));
}

function formatDate(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    const days = ["日", "月", "火", "水", "木", "金", "土"];
    return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`;
}

export default function HomeScreen({ history, muscleEx, exerciseBodyPartOverrides, hiddenBodyParts, onStartLog, user }) {
    const recoveries = useMemo(() =>
        BODY_PARTS.filter(bp => !(hiddenBodyParts || []).includes(bp))
            .map(bp => ({ bp, ...calcRecovery(history, bp, muscleEx, exerciseBodyPartOverrides) })),
        [history, muscleEx, exerciseBodyPartOverrides, hiddenBodyParts]
    );

    const { label: weekLabel } = getWeekRange();

    const weekSets = useMemo(() =>
        BODY_PARTS.filter(bp => !(hiddenBodyParts || []).includes(bp))
            .map(bp => ({ bp, sets: getWeekEntries(history, muscleEx, exerciseBodyPartOverrides, bp) }))
            .filter(x => x.sets > 0),
        [history, muscleEx, exerciseBodyPartOverrides, hiddenBodyParts]
    );

    const recentSessions = useMemo(() =>
        getRecentSessions(history, muscleEx, exerciseBodyPartOverrides),
        [history, muscleEx, exerciseBodyPartOverrides]
    );

    const userName = user?.user_metadata?.display_name || user?.email?.split("@")[0] || "ゲスト";

    return (
        <div className="fade-in" style={{ paddingBottom: 20 }}>
            {/* ヘッダー */}
            <div style={{ padding: "16px 20px 8px" }}>
                <div style={{ fontSize: 11, color: "var(--text3)", letterSpacing: 2, textTransform: "uppercase", marginBottom: 2 }}>PUMP</div>
                <div style={{ fontSize: 24, fontWeight: 900 }}>おかえり、{userName} 👋</div>
            </div>

            {/* 回復状況 */}
            <div style={{ margin: "12px 16px", background: "var(--card)", borderRadius: 20, padding: 16, border: "1px solid rgba(18,199,194,0.1)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ fontSize: 14, fontWeight: 800 }}>回復状況</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {Object.entries(RECOVERY_COLORS).map(([label, color]) => (
                            <div key={label} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                                <div style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
                                <span style={{ fontSize: 9, color: "var(--text3)" }}>{label}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                    {recoveries.map(({ bp, pct, label }) => {
                        const color = RECOVERY_COLORS[label];
                        const bars = Math.round(pct / 20);
                        return (
                            <div key={bp} style={{
                                background: "var(--card2)",
                                borderRadius: 14,
                                padding: "12px 8px",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: 4,
                                border: "1px solid rgba(18,199,194,0.06)",
                            }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)" }}>{bp}</div>
                                <div style={{ fontSize: 22, fontWeight: 900, color }}>{pct}%</div>
                                <div style={{ fontSize: 10, color, fontWeight: 700 }}>{label}</div>
                                <div style={{ display: "flex", gap: 2, marginTop: 2 }}>
                                    {[1,2,3,4,5].map(i => (
                                        <div key={i} style={{
                                            width: 10, height: 3, borderRadius: 2,
                                            background: i <= bars ? color : "var(--border2)",
                                        }} />
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 今週のトレーニング */}
            {weekSets.length > 0 && (
                <div style={{ margin: "0 16px 12px", background: "var(--card)", borderRadius: 20, padding: 16, border: "1px solid rgba(18,199,194,0.1)" }}>
                    <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 2 }}>今週のトレーニング</div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 12 }}>{weekLabel}</div>
                    <div style={{ display: "flex", gap: 12, overflowX: "auto" }}>
                        {weekSets.map(({ bp, sets }) => (
                            <div key={bp} style={{ textAlign: "center", minWidth: 44 }}>
                                <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 4 }}>{bp}</div>
                                <div style={{ fontSize: 22, fontWeight: 900 }}>{sets}</div>
                                <div style={{ fontSize: 10, color: "var(--text3)" }}>set</div>
                                <div style={{ height: 2, background: "var(--accent)", borderRadius: 1, marginTop: 4 }} />
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 最近の記録 */}
            <div style={{ margin: "0 16px 12px", background: "var(--card)", borderRadius: 20, padding: 16, border: "1px solid rgba(18,199,194,0.1)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ fontSize: 14, fontWeight: 800 }}>最近の記録</div>
                    <div style={{ fontSize: 12, color: "var(--accent)", fontWeight: 700 }}>すべて見る &gt;</div>
                </div>
                {recentSessions.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text3)", fontSize: 13 }}>
                        まだ記録がありません
                    </div>
                ) : (
                    recentSessions.map(s => (
                        <div key={s.date} style={{
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                            padding: "10px 0", borderBottom: "1px solid var(--border2)",
                        }}>
                            <div style={{ fontSize: 13, color: "var(--text2)", minWidth: 80 }}>{formatDate(s.date)}</div>
                            <div style={{ fontSize: 13, fontWeight: 700, flex: 1, paddingLeft: 8 }}>{s.parts.join("・")}</div>
                            <div style={{ fontSize: 12, color: "var(--text3)", textAlign: "right" }}>
                                <div>{s.sets} set</div>
                                {s.volume > 0 && <div>{s.volume.toLocaleString()} kg</div>}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
