import { useMemo } from "react";
import { resolveRecordedBodyPartLabel } from "../utils/bodyPartClassification";

const DEFAULT_PARTS = ["胸", "背中", "肩", "二頭", "三頭", "四頭", "ハム", "腹筋"];

const FALLBACK_PART_MAP = {
    "ベンチ": "胸",
    "インクライン": "胸",
    "ペック": "胸",
    "チェスト": "胸",
    "ディップス": "胸",
    "フライ": "胸",

    "ラット": "背中",
    "ロウ": "背中",
    "ロー": "背中",
    "デッド": "背中",
    "懸垂": "背中",
    "チンニング": "背中",
    "プル": "背中",

    "ショルダー": "肩",
    "サイドレイズ": "肩",
    "リアレイズ": "肩",
    "フロントレイズ": "肩",

    "カール": "二頭",
    "二頭": "二頭",

    "プレスダウン": "三頭",
    "トライセプス": "三頭",
    "エクステンション": "三頭",
    "三頭": "三頭",

    "スクワット": "四頭",
    "レッグプレス": "四頭",
    "レッグエクステンション": "四頭",
    "四頭": "四頭",

    "レッグカール": "ハム",
    "ルーマニアン": "ハム",
    "ハム": "ハム",

    "腹": "腹筋",
    "クランチ": "腹筋",
    "レッグレイズ": "腹筋",
    "プランク": "腹筋",
};

const RECOVERY_META = {
    excellent: { label: "非常に良好", color: "#16d7d2" },
    good: { label: "良好", color: "#55d89e" },
    tired: { label: "やや疲労", color: "#f6a623" },
    bad: { label: "疲労あり", color: "#ff4d4d" },
};

function resolveBodyPart(exName, muscleEx, overrides) {
    if (overrides?.[exName]) return overrides[exName];

    const found = Object.entries(muscleEx || {}).find(([, exs]) =>
        Array.isArray(exs) && exs.some(e => {
            const name = typeof e === "string" ? e : e?.name;
            return name === exName;
        })
    );
    if (found?.[0]) return found[0];

    const key = Object.keys(FALLBACK_PART_MAP).find(k => exName.includes(k));
    return key ? FALLBACK_PART_MAP[key] : "その他";
}

function getWeekRange() {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const mon = new Date(now);
    mon.setHours(0, 0, 0, 0);
    mon.setDate(now.getDate() + diff);

    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);

    const fmt = d => `${d.getMonth() + 1}/${d.getDate()}`;
    return {
        label: `${fmt(mon)} - ${fmt(sun)}`,
        start: mon.toISOString().slice(0, 10),
        end: sun.toISOString().slice(0, 10),
    };
}

function getRecordSets(record) {
    if (Array.isArray(record?.sets)) {
        return record.sets.filter(s => Number(s?.reps) > 0);
    }
    return [];
}

function getRecordVolume(record) {
    return getRecordSets(record).reduce((sum, s) => {
        const weight = Number(s.weight || 0);
        const reps = Number(s.reps || 0);
        return sum + weight * reps;
    }, 0);
}

function calcRecovery(history, bodyPart, muscleEx, overrides) {
    const now = Date.now();
    let lastMs = null;
    let recentSetCount = 0;

    Object.entries(history || {}).forEach(([exName, records]) => {
        const bp = resolveBodyPart(exName, muscleEx, overrides);
        if (bp !== bodyPart) return;

        (records || []).forEach(record => {
            const d = new Date(record.date + "T00:00:00");
            if (Number.isNaN(d.getTime())) return;

            const ms = d.getTime();
            if (!lastMs || ms > lastMs) lastMs = ms;

            const hoursAgo = (now - ms) / 3600000;
            if (hoursAgo <= 168) {
                const sets = getRecordSets(record);
                recentSetCount += sets.length || Number(record.setCount || 0);
            }
        });
    });

    if (!lastMs) return { pct: 100, status: "excellent" };

    const hours = (now - lastMs) / 3600000;
    let pct = 25;

    if (hours >= 96) pct = 100;
    else if (hours >= 72) pct = 85 + ((hours - 72) / 24) * 15;
    else if (hours >= 48) pct = 65 + ((hours - 48) / 24) * 20;
    else if (hours >= 24) pct = 40 + ((hours - 24) / 24) * 25;
    else pct = 20 + (hours / 24) * 20;

    if (recentSetCount >= 18) pct -= 18;
    else if (recentSetCount >= 12) pct -= 10;
    else if (recentSetCount >= 8) pct -= 5;

    pct = Math.max(20, Math.min(100, Math.round(pct)));

    const status = pct >= 80 ? "excellent"
        : pct >= 60 ? "good"
        : pct >= 40 ? "tired"
        : "bad";

    return { pct, status };
}

function collectWeeklySets(history, muscleEx, overrides) {
    const { start, end } = getWeekRange();
    const map = {};

    Object.entries(history || {}).forEach(([exName, records]) => {
        const bp = resolveBodyPart(exName, muscleEx, overrides);
        if (bp === "その他") return;

        (records || []).forEach(record => {
            if (!record.date || record.date < start || record.date > end) return;
            const sets = getRecordSets(record);
            const count = sets.length || Number(record.setCount || 0);
            map[bp] = (map[bp] || 0) + count;
        });
    });

    return map;
}

function collectRecentSessions(history, muscleEx, overrides) {
    const sessions = {};

    Object.entries(history || {}).forEach(([exName, records]) => {
        (records || []).forEach(record => {
            const bp = resolveRecordedBodyPartLabel(record, exName, {
                muscleEx,
                exerciseBodyPartOverrides: overrides,
            }) || resolveBodyPart(exName, muscleEx, overrides);
            if (!record.date) return;

            if (!sessions[record.date]) {
                sessions[record.date] = {
                    date: record.date,
                    parts: new Set(),
                    sets: 0,
                    volume: 0,
                    minutes: record.elapsedMinutes || record.durationMinutes || null,
                };
            }

            if (bp !== "その他") sessions[record.date].parts.add(bp);

            const sets = getRecordSets(record);
            sessions[record.date].sets += sets.length || Number(record.setCount || 0);
            sessions[record.date].volume += getRecordVolume(record);
        });
    });

    return Object.values(sessions)
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

function RecoveryCard({ part, pct, status }) {
    const meta = RECOVERY_META[status];
    const activeBars = Math.max(1, Math.round(pct / 20));

    return (
        <button style={{
            minWidth: 0,
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 15,
            padding: "12px 6px 11px",
            background: "linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.025))",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.025)",
        }}>
            <div style={{ color: "#fff", fontSize: 14, fontWeight: 900, marginBottom: 10 }}>{part}</div>
            <div style={{ color: meta.color, fontSize: 30, fontWeight: 950, lineHeight: 1 }}>{pct}%</div>
            <div style={{ color: meta.color, fontSize: 12, fontWeight: 900, marginTop: 7 }}>{meta.label}</div>
            <div style={{ display: "flex", justifyContent: "center", gap: 3, marginTop: 12 }}>
                {[1,2,3,4,5].map(i => (
                    <span key={i} style={{
                        width: 13,
                        height: 5,
                        borderRadius: 99,
                        background: i <= activeBars ? meta.color : "rgba(255,255,255,0.14)",
                        boxShadow: i <= activeBars ? `0 0 10px ${meta.color}55` : "none",
                    }} />
                ))}
            </div>
        </button>
    );
}

export default function HomeScreen({ history, muscleEx, exerciseBodyPartOverrides, hiddenBodyParts }) {
    const week = getWeekRange();

    const weeklySets = useMemo(() => (
        collectWeeklySets(history, muscleEx, exerciseBodyPartOverrides)
    ), [history, muscleEx, exerciseBodyPartOverrides]);

    const partsToShow = useMemo(() => {
        const base = DEFAULT_PARTS.filter(p => !(hiddenBodyParts || []).includes(p));
        const trained = Object.keys(weeklySets).filter(p => !base.includes(p));
        return [...base, ...trained].slice(0, 8);
    }, [hiddenBodyParts, weeklySets]);

    const recoveries = useMemo(() => (
        partsToShow.map(part => ({
            part,
            ...calcRecovery(history, part, muscleEx, exerciseBodyPartOverrides),
        }))
    ), [history, muscleEx, exerciseBodyPartOverrides, partsToShow]);

    const recentSessions = useMemo(() => (
        collectRecentSessions(history, muscleEx, exerciseBodyPartOverrides)
    ), [history, muscleEx, exerciseBodyPartOverrides]);

    const weeklyDisplay = partsToShow
        .map(part => ({ part, sets: weeklySets[part] || 0 }))
        .filter(x => x.sets > 0)
        .slice(0, 8);

    return (
        <div className="fade-in" style={{
            padding: "16px 14px 28px",
            background: "linear-gradient(180deg, #05090b 0%, #071012 52%, #05090b 100%)",
            color: "#fff",
            minHeight: "calc(100vh - 170px)",
        }}>
            <section style={{
                borderRadius: 20,
                padding: "14px 12px",
                marginBottom: 14,
                background: "linear-gradient(180deg, rgba(13,22,25,0.96), rgba(8,14,17,0.98))",
                border: "1px solid rgba(255,255,255,0.07)",
                boxShadow: "0 18px 40px rgba(0,0,0,0.42)",
                overflow: "hidden",
            }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 13 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 950, letterSpacing: 0.2 }}>回復状況</h2>
                        <span style={{
                            width: 17,
                            height: 17,
                            borderRadius: 99,
                            display: "grid",
                            placeItems: "center",
                            background: "rgba(255,255,255,0.16)",
                            color: "rgba(255,255,255,0.72)",
                            fontSize: 11,
                            fontWeight: 900,
                        }}>i</span>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {Object.values(RECOVERY_META).map(meta => (
                            <div key={meta.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <span style={{ width: 7, height: 7, borderRadius: 99, background: meta.color }} />
                                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.78)", fontWeight: 750 }}>{meta.label}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                    gap: 9,
                }}>
                    {recoveries.map(item => (
                        <RecoveryCard key={item.part} {...item} />
                    ))}
                </div>
            </section>

            <section style={{
                borderRadius: 18,
                padding: "17px 18px",
                marginBottom: 14,
                background: "linear-gradient(180deg, rgba(13,22,25,0.96), rgba(8,14,17,0.98))",
                border: "1px solid rgba(255,255,255,0.07)",
                boxShadow: "0 16px 34px rgba(0,0,0,0.35)",
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 950 }}>今週のトレーニング</h2>
                    <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 14, fontWeight: 850 }}>{week.label}</span>
                </div>

                <div style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${Math.min(Math.max(weeklyDisplay.length, 1), 8)}, minmax(0, 1fr))`,
                    gap: 0,
                }}>
                    {(weeklyDisplay.length ? weeklyDisplay : partsToShow.slice(0, 4).map(part => ({ part, sets: 0 }))).map((x, index, arr) => (
                        <div key={x.part} style={{
                            textAlign: "center",
                            borderRight: index !== arr.length - 1 ? "1px solid rgba(255,255,255,0.10)" : "none",
                            padding: "0 5px",
                        }}>
                            <div style={{ fontSize: 14, color: "#fff", fontWeight: 900 }}>{x.part}</div>
                            <div style={{ fontSize: 30, color: "#fff", fontWeight: 950, marginTop: 7, lineHeight: 1 }}>{x.sets}</div>
                            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.62)", fontWeight: 800, marginTop: 2 }}>set</div>
                        </div>
                    ))}
                </div>
            </section>

            <section style={{
                borderRadius: 18,
                padding: "17px 18px 8px",
                background: "linear-gradient(180deg, rgba(13,22,25,0.96), rgba(8,14,17,0.98))",
                border: "1px solid rgba(255,255,255,0.07)",
                boxShadow: "0 16px 34px rgba(0,0,0,0.35)",
            }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 950 }}>最近の記録</h2>
                    <button style={{
                        background: "transparent",
                        border: "none",
                        color: "#16d7d2",
                        fontSize: 13,
                        fontWeight: 900,
                    }}>
                        すべて見る 〉
                    </button>
                </div>

                {recentSessions.length === 0 ? (
                    <div style={{ padding: "28px 0", textAlign: "center", color: "rgba(255,255,255,0.55)", fontWeight: 800 }}>
                        まだ記録がありません
                    </div>
                ) : recentSessions.map((s, index) => (
                    <div key={s.date} style={{
                        display: "grid",
                        gridTemplateColumns: "82px 1fr 58px 82px 44px 16px",
                        alignItems: "center",
                        gap: 7,
                        padding: "13px 0",
                        borderBottom: index !== recentSessions.length - 1 ? "1px solid rgba(255,255,255,0.08)" : "none",
                    }}>
                        <div style={{ color: "rgba(255,255,255,0.66)", fontSize: 13, fontWeight: 850 }}>
                            {formatDate(s.date)}
                        </div>
                        <div style={{ color: "#fff", fontSize: 14, fontWeight: 930, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {s.parts.length ? s.parts.join("・") : "記録"}
                        </div>
                        <div style={{ color: "#fff", textAlign: "right", fontSize: 13, fontWeight: 850 }}>{s.sets} set</div>
                        <div style={{ color: "#fff", textAlign: "right", fontSize: 13, fontWeight: 850 }}>{s.volume.toLocaleString()} kg</div>
                        <div style={{ color: "rgba(255,255,255,0.72)", textAlign: "right", fontSize: 13, fontWeight: 850 }}>{s.minutes || 72}分</div>
                        <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 24 }}>›</div>
                    </div>
                ))}
            </section>
        </div>
    );
}
