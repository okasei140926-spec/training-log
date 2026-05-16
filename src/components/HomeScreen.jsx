import { useMemo } from "react";

const BODY_PARTS = ["胸", "背中", "肩", "二頭", "三頭", "四頭", "ハム", "腹筋"];

const RECOVERY_COLORS = {
    "非常に良好": "#12C7C2",
    "良好": "#4FD29B",
    "やや疲労": "#F59E0B",
    "疲労あり": "#EF4444",
};

function resolveBodyPart(exName, muscleEx, overrides) {
    if (overrides?.[exName]) return overrides[exName];
    const found = Object.entries(muscleEx || {}).find(([, exs]) =>
        exs.some(e => e.name === exName)
    );
    return found?.[0] || "その他";
}

function calcRecovery(history, bodyPart, muscleEx, overrides) {
    const now = Date.now();
    let lastTrainedMs = null;
    let recentSets = 0;

    Object.entries(history || {}).forEach(([exName, records]) => {
        const bp = resolveBodyPart(exName, muscleEx, overrides);
        if (bp !== bodyPart) return;

        records?.forEach(record => {
            const d = new Date(record.date);
            if (isNaN(d)) return;
            const ms = d.getTime();
            if (!lastTrainedMs || ms > lastTrainedMs) lastTrainedMs = ms;

            const hoursAgo = (now - ms) / 3600000;
            if (hoursAgo < 168) {
                recentSets += Array.isArray(record.sets)
                    ? record.sets.filter(s => Number(s?.reps) > 0).length
                    : Number(record.setCount || 0);
            }
        });
    });

    if (!lastTrainedMs) return { pct: 100, label: "非常に良好" };

    const hoursAgo = (now - lastTrainedMs) / 3600000;
    let pct;
    if (hoursAgo >= 72) pct = 100;
    else if (hoursAgo >= 48) pct = 80 + ((hoursAgo - 48) / 24) * 20;
    else if (hoursAgo >= 24) pct = 50 + ((hoursAgo - 24) / 24) * 30;
    else pct = Math.max(20, (hoursAgo / 24) * 50);

    if (recentSets > 20) pct -= 20;
    else if (recentSets > 12) pct -= 10;

    pct = Math.max(20, Math.min(100, Math.round(pct)));

    const label = pct >= 80 ? "非常に良好"
        : pct >= 60 ? "良好"
        : pct >= 40 ? "やや疲労"
        : "疲労あり";

    return { pct, label };
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

function getWeekSets(history, muscleEx, overrides, bodyPart) {
    const { mon, sun } = getWeekRange();
    const monStr = mon.toISOString().slice(0, 10);
    const sunStr = sun.toISOString().slice(0, 10);
    let sets = 0;

    Object.entries(history || {}).forEach(([exName, records]) => {
        const bp = resolveBodyPart(exName, muscleEx, overrides);
        if (bp !== bodyPart) return;

        records?.forEach(r => {
            if (r.date >= monStr && r.date <= sunStr) {
                sets += Array.isArray(r.sets)
                    ? r.sets.filter(s => Number(s?.reps) > 0).length
                    : Number(r.setCount || 0);
            }
        });
    });

    return sets;
}

function getRecentSessions(history, muscleEx, overrides) {
    const sessionMap = {};

    Object.entries(history || {}).forEach(([exName, records]) => {
        records?.forEach(r => {
            if (!r.date) return;

            if (!sessionMap[r.date]) {
                sessionMap[r.date] = {
                    date: r.date,
                    parts: new Set(),
                    sets: 0,
                    volume: 0,
                    minutes: r.elapsedMinutes || r.durationMinutes || null,
                };
            }

            const bp = resolveBodyPart(exName, muscleEx, overrides);
            sessionMap[r.date].parts.add(bp);

            const sets = Array.isArray(r.sets) ? r.sets.filter(s => Number(s?.reps) > 0) : [];
            sessionMap[r.date].sets += sets.length || Number(r.setCount || 0);

            sets.forEach(s => {
                const w = Number(s.weight || 0);
                const reps = Number(s.reps || 0);
                if (w > 0 && reps > 0) sessionMap[r.date].volume += w * reps;
            });
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
    return `${d.getMonth() + 1}/${d.getDate()} (${days[d.getDay()]})`;
}

export default function HomeScreen({ history, muscleEx, exerciseBodyPartOverrides, hiddenBodyParts }) {
    const visibleParts = BODY_PARTS.filter(bp => !(hiddenBodyParts || []).includes(bp));

    const recoveries = useMemo(() =>
        visibleParts
            .map(bp => ({ bp, ...calcRecovery(history, bp, muscleEx, exerciseBodyPartOverrides) }))
            .slice(0, 8),
        [history, muscleEx, exerciseBodyPartOverrides, hiddenBodyParts, visibleParts]
    );

    const { label: weekLabel } = getWeekRange();

    const weekSets = useMemo(() =>
        visibleParts
            .map(bp => ({ bp, sets: getWeekSets(history, muscleEx, exerciseBodyPartOverrides, bp) }))
            .filter(x => x.sets > 0)
            .slice(0, 8),
        [history, muscleEx, exerciseBodyPartOverrides, hiddenBodyParts, visibleParts]
    );

    const recentSessions = useMemo(() =>
        getRecentSessions(history, muscleEx, exerciseBodyPartOverrides),
        [history, muscleEx, exerciseBodyPartOverrides]
    );

    return (
        <div className="fade-in" style={{ padding: "18px 16px 22px" }}>
            <section style={{
                background: "var(--card)",
                borderRadius: 22,
                padding: 14,
                border: "1px solid rgba(18,199,194,0.10)",
                boxShadow: "var(--shadow-card)",
                marginBottom: 14,
            }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <div style={{ fontSize: 16, fontWeight: 900 }}>回復状況</div>
                        <div style={{ color: "var(--text3)", fontSize: 12 }}>●</div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {Object.entries(RECOVERY_COLORS).map(([label, color]) => (
                            <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <span style={{ width: 7, height: 7, borderRadius: 99, background: color, display: "inline-block" }} />
                                <span style={{ fontSize: 10, color: "var(--text2)", fontWeight: 700 }}>{label}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 9 }}>
                    {recoveries.map(({ bp, pct, label }) => {
                        const color = RECOVERY_COLORS[label];
                        const bars = Math.round(pct / 20);
                        return (
                            <button key={bp} style={{
                                background: "linear-gradient(180deg, var(--card2), var(--card))",
                                border: "1px solid rgba(255,255,255,0.05)",
                                borderRadius: 15,
                                padding: "12px 6px",
                                minHeight: 114,
                                boxShadow: "inset 0 0 0 1px rgba(18,199,194,0.04)",
                            }}>
                                <div style={{ fontSize: 14, fontWeight: 900, color: "var(--text)" }}>{bp}</div>
                                <div style={{ fontSize: 29, lineHeight: 1.1, fontWeight: 900, color, marginTop: 10 }}>{pct}%</div>
                                <div style={{ fontSize: 12, fontWeight: 900, color, marginTop: 5 }}>{label}</div>
                                <div style={{ display: "flex", gap: 3, justifyContent: "center", marginTop: 11 }}>
                                    {[1,2,3,4,5].map(i => (
                                        <span key={i} style={{
                                            width: 13,
                                            height: 5,
                                            borderRadius: 99,
                                            background: i <= bars ? color : "rgba(130,150,155,0.22)",
                                        }} />
                                    ))}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </section>

            <section style={{
                background: "var(--card)",
                borderRadius: 18,
                padding: "15px 18px",
                border: "1px solid rgba(18,199,194,0.10)",
                boxShadow: "var(--shadow-card)",
                marginBottom: 14,
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                    <div style={{ fontSize: 16, fontWeight: 900 }}>今週のトレーニング</div>
                    <div style={{ fontSize: 13, color: "var(--text3)", fontWeight: 800 }}>{weekLabel}</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(Math.max(weekSets.length, 1), 8)}, 1fr)`, gap: 0 }}>
                    {(weekSets.length ? weekSets : visibleParts.slice(0, 4).map(bp => ({ bp, sets: 0 }))).map(({ bp, sets }) => (
                        <div key={bp} style={{
                            textAlign: "center",
                            borderRight: "1px solid rgba(130,150,155,0.16)",
                            padding: "2px 4px",
                        }}>
                            <div style={{ fontSize: 13, fontWeight: 900, color: "var(--text)" }}>{bp}</div>
                            <div style={{ fontSize: 27, fontWeight: 900, color: "var(--text)", marginTop: 6 }}>{sets}</div>
                            <div style={{ fontSize: 12, color: "var(--text3)", fontWeight: 800 }}>set</div>
                        </div>
                    ))}
                </div>
            </section>

            <section style={{
                background: "var(--card)",
                borderRadius: 18,
                padding: "16px 18px",
                border: "1px solid rgba(18,199,194,0.10)",
                boxShadow: "var(--shadow-card)",
            }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <div style={{ fontSize: 17, fontWeight: 900 }}>最近の記録</div>
                    <button style={{ background: "transparent", color: "var(--accent)", fontSize: 13, fontWeight: 900 }}>
                        すべて見る 〉
                    </button>
                </div>

                {recentSessions.length === 0 ? (
                    <div style={{ padding: "22px 0", color: "var(--text3)", textAlign: "center", fontWeight: 700 }}>
                        まだ記録がありません
                    </div>
                ) : recentSessions.map((s, index) => (
                    <div key={s.date} style={{
                        display: "grid",
                        gridTemplateColumns: "86px 1fr 58px 82px 48px 18px",
                        alignItems: "center",
                        gap: 8,
                        padding: "12px 0",
                        borderBottom: index < recentSessions.length - 1 ? "1px solid rgba(130,150,155,0.18)" : "none",
                    }}>
                        <div style={{ fontSize: 13, color: "var(--text2)", fontWeight: 800 }}>{formatDate(s.date)}</div>
                        <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 900 }}>{s.parts.join("・")}</div>
                        <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 800, textAlign: "right" }}>{s.sets} set</div>
                        <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 800, textAlign: "right" }}>{s.volume.toLocaleString()} kg</div>
                        <div style={{ fontSize: 13, color: "var(--text2)", fontWeight: 800, textAlign: "right" }}>{s.minutes || 72}分</div>
                        <div style={{ color: "var(--text3)", fontSize: 24 }}>›</div>
                    </div>
                ))}
            </section>
        </div>
    );
}
