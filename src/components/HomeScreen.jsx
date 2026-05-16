import { useMemo, useState } from "react";
import { resolveRecordedBodyPartLabel, resolveVisibleBodyPartLabel } from "../utils/bodyPartClassification";

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
    "プレスダウン": "三頭",
    "トライセプス": "三頭",
    "エクステンション": "三頭",
    "スクワット": "四頭",
    "レッグプレス": "四頭",
    "レッグエクステンション": "四頭",
    "レッグカール": "ハム",
    "ルーマニアン": "ハム",
    "腹": "腹筋",
    "クランチ": "腹筋",
    "レッグレイズ": "腹筋",
    "プランク": "腹筋",
};


function normalizeHomeBodyPart(label) {
    const raw = String(label || "").trim();
    if (!raw) return "その他";

    const map = {
        "ハムストリングス": "ハム",
        "ハムストリング": "ハム",
        "大腿二頭筋": "ハム",
        "お尻": "尻",
        "臀部": "尻",
        "ケツ": "尻",
        "腹": "腹筋",
        "腹部": "腹筋",
    };

    return map[raw] || raw;
}

const detailPill = {
    padding: "7px 11px",
    borderRadius: 999,
    background: "rgba(18,199,194,0.13)",
    border: "1px solid rgba(18,199,194,0.22)",
    color: "var(--accent)",
    fontSize: 12,
    fontWeight: 900,
};

const RECOVERY_META = {
    excellent: { label: "非常に良好", color: "#16D7D2" },
    good: { label: "良好", color: "#55D89E" },
    tired: { label: "やや疲労", color: "#F6A623" },
    bad: { label: "疲労あり", color: "#FF4D4D" },
};

function toNumber(value) {
    const n = parseFloat(String(value ?? "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
}

function resolveBodyPart(exName, muscleEx, overrides, record = null) {
    // 1. 記録に保存された部位を最優先
    if (record) {
        const recorded = resolveRecordedBodyPartLabel(record, exName, {
            muscleEx,
            exerciseBodyPartOverrides: overrides,
        });
        if (recorded && recorded !== "その他") {
            return normalizeHomeBodyPart(recorded);
        }
    }

    // 2. 既存の部位分類ロジックを使う
    const visible = resolveVisibleBodyPartLabel(exName, {
        muscleEx,
        exerciseBodyPartOverrides: overrides,
    });
    if (visible && visible !== "その他") {
        return normalizeHomeBodyPart(visible);
    }

    // 3. 手動override
    if (overrides?.[exName]) {
        return normalizeHomeBodyPart(overrides[exName]);
    }

    // 4. muscleExから直接探す
    const found = Object.entries(muscleEx || {}).find(([, exs]) =>
        Array.isArray(exs) && exs.some(e => {
            const name = typeof e === "string" ? e : e?.name;
            return name === exName;
        })
    );
    if (found?.[0]) {
        return normalizeHomeBodyPart(found[0]);
    }

    // 5. 最後の保険
    const key = Object.keys(FALLBACK_PART_MAP).find(k => String(exName || "").includes(k));
    return key ? normalizeHomeBodyPart(FALLBACK_PART_MAP[key]) : "その他";
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
        return record.sets.filter(s => toNumber(s?.reps) > 0);
    }
    return [];
}

function getRecordSetCount(record) {
    const sets = getRecordSets(record);
    return sets.length || toNumber(record?.setCount);
}

function getRecordVolume(record) {
    return getRecordSets(record).reduce((sum, s) => {
        const weight = String(s?.weight || "").toUpperCase() === "BW" ? 0 : toNumber(s?.weight);
        const reps = toNumber(s?.reps);
        return sum + weight * reps;
    }, 0);
}

function calcRecovery(history, bodyPart, muscleEx, overrides) {
    const now = Date.now();
    let lastMs = null;
    let recentSetCount = 0;

    Object.entries(history || {}).forEach(([exName, records]) => {
        (records || []).forEach(record => {
            const bp = resolveBodyPart(exName, muscleEx, overrides, record);
            if (bp !== bodyPart) return;

            const d = new Date(record.date + "T00:00:00");
            if (Number.isNaN(d.getTime())) return;

            const ms = d.getTime();
            if (!lastMs || ms > lastMs) lastMs = ms;

            const hoursAgo = (now - ms) / 3600000;
            if (hoursAgo <= 168) recentSetCount += getRecordSetCount(record);
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
        (records || []).forEach(record => {
            if (!record.date || record.date < start || record.date > end) return;
            const bp = resolveBodyPart(exName, muscleEx, overrides, record);
            if (bp === "その他") return;
            map[bp] = (map[bp] || 0) + getRecordSetCount(record);
        });
    });

    return map;
}

function collectRecentSessions(history, muscleEx, overrides) {
    const sessions = {};

    Object.entries(history || {}).forEach(([exName, records]) => {
        (records || []).forEach(record => {
            if (!record.date) return;

            if (!sessions[record.date]) {
                sessions[record.date] = {
                    date: record.date,
                    parts: new Set(),
                    sets: 0,
                    volume: 0,
                    minutes: record.elapsedMinutes || record.durationMinutes || null,
                    exercises: [],
                };
            }

            const bp = resolveBodyPart(exName, muscleEx, overrides, record);
            if (bp !== "その他") sessions[record.date].parts.add(bp);

            const setCount = getRecordSetCount(record);
            const volume = getRecordVolume(record);

            sessions[record.date].sets += setCount;
            sessions[record.date].volume += volume;

            sessions[record.date].exercises.push({
                name: exName,
                bodyPart: bp,
                setCount,
                volume: Math.round(volume),
                sets: getRecordSets(record).map(s => ({
                    weight: s.weight,
                    reps: s.reps,
                })),
            });
        });
    });

    return Object.values(sessions)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 4)
        .map(s => ({
            ...s,
            parts: [...s.parts].slice(0, 3),
            volume: Number.isFinite(s.volume) ? Math.round(s.volume) : 0,
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
    const pctFont = pct >= 100 ? 25 : 29;

    return (
        <button style={{
            minWidth: 0,
            overflow: "hidden",
            border: "1px solid var(--home-inner-border)",
            borderRadius: 15,
            padding: "12px 4px 11px",
            background: "var(--home-inner-card)",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.025)",
        }}>
            <div style={{ color: "var(--home-text)", fontSize: 14, fontWeight: 900, marginBottom: 10 }}>{part}</div>
            <div style={{
                color: meta.color,
                fontSize: pctFont,
                fontWeight: 950,
                lineHeight: 1,
                letterSpacing: "-1.6px",
                whiteSpace: "nowrap",
                textShadow: `0 0 14px ${meta.color}44`,
            }}>{pct}%</div>
            <div style={{ color: meta.color, fontSize: 12, fontWeight: 900, marginTop: 7 }}>{meta.label}</div>
            <div style={{ display: "flex", justifyContent: "center", gap: 3, marginTop: 12 }}>
                {[1,2,3,4,5].map(i => (
                    <span key={i} style={{
                        width: 12,
                        height: 5,
                        borderRadius: 99,
                        background: i <= activeBars ? meta.color : "rgba(130,150,155,0.22)",
                        boxShadow: i <= activeBars ? `0 0 10px ${meta.color}55` : "none",
                    }} />
                ))}
            </div>
        </button>
    );
}

export default function HomeScreen({ history, muscleEx, exerciseBodyPartOverrides, hiddenBodyParts }) {
    const [selectedSession, setSelectedSession] = useState(null);
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
            background: "var(--home-bg)",
            color: "var(--home-text)",
            minHeight: "calc(100vh - 170px)",
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
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 13 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 950, letterSpacing: 0.2, color: "var(--home-title)" }}>回復状況</h2>
                        <span style={{
                            width: 17,
                            height: 17,
                            borderRadius: 99,
                            display: "grid",
                            placeItems: "center",
                            background: "rgba(130,150,155,0.20)",
                            color: "var(--home-muted2)",
                            fontSize: 11,
                            fontWeight: 900,
                        }}>i</span>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {Object.values(RECOVERY_META).map(meta => (
                            <div key={meta.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <span style={{ width: 7, height: 7, borderRadius: 99, background: meta.color }} />
                                <span style={{ fontSize: 10, color: "var(--home-muted2)", fontWeight: 750 }}>{meta.label}</span>
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
                background: "var(--home-card)",
                border: "1px solid var(--home-card-border)",
                boxShadow: "var(--home-shadow)",
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 950, color: "var(--home-title)" }}>今週のトレーニング</h2>
                    <span style={{ color: "var(--home-muted)", fontSize: 14, fontWeight: 850 }}>{week.label}</span>
                </div>

                <div style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${Math.min(Math.max(weeklyDisplay.length, 1), 8)}, minmax(0, 1fr))`,
                    gap: 0,
                }}>
                    {(weeklyDisplay.length ? weeklyDisplay : partsToShow.slice(0, 4).map(part => ({ part, sets: 0 }))).map((x, index, arr) => (
                        <div key={x.part} style={{
                            textAlign: "center",
                            borderRight: index !== arr.length - 1 ? "1px solid var(--home-row-border)" : "none",
                            padding: "0 5px",
                        }}>
                            <div style={{ fontSize: 14, color: "var(--home-text)", fontWeight: 900 }}>{x.part}</div>
                            <div style={{ fontSize: 30, color: "var(--home-text)", fontWeight: 950, marginTop: 7, lineHeight: 1 }}>{x.sets}</div>
                            <div style={{ fontSize: 13, color: "var(--home-muted)", fontWeight: 800, marginTop: 2 }}>set</div>
                        </div>
                    ))}
                </div>
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
                    <button style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--accent)",
                        fontSize: 13,
                        fontWeight: 900,
                    }}>
                        すべて見る 〉
                    </button>
                </div>

                {recentSessions.length === 0 ? (
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
                        <div style={{ color: "var(--home-muted2)", textAlign: "right", fontSize: 12, fontWeight: 850 }}>{s.minutes || 72}分</div>
                        <div style={{ color: "var(--home-muted)", fontSize: 22 }}>›</div>
                    </div>
                ))}
            </section>

            {selectedSession && (
                <div
                    onClick={() => setSelectedSession(null)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 9999,
                        background: "rgba(0,0,0,0.58)",
                        backdropFilter: "blur(10px)",
                        display: "flex",
                        alignItems: "flex-end",
                        justifyContent: "center",
                        padding: "18px 14px",
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: "100%",
                            maxWidth: 430,
                            maxHeight: "82vh",
                            overflowY: "auto",
                            borderRadius: 24,
                            background: "var(--home-card)",
                            border: "1px solid var(--home-card-border)",
                            boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
                            padding: 20,
                            color: "var(--home-text)",
                        }}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                            <div>
                                <div style={{ color: "var(--home-muted2)", fontSize: 13, fontWeight: 850 }}>
                                    {formatDate(selectedSession.date)}
                                </div>
                                <h2 style={{ margin: "6px 0 4px", fontSize: 23, fontWeight: 950, color: "var(--home-title)" }}>
                                    {selectedSession.parts?.length ? selectedSession.parts.join("・") : "ワークアウト"}
                                </h2>
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                                    <span style={detailPill}>{selectedSession.sets} set</span>
                                    <span style={detailPill}>{selectedSession.volume.toLocaleString()} kg</span>
                                    <span style={detailPill}>{selectedSession.minutes || 72}分</span>
                                </div>
                            </div>

                            <button
                                onClick={() => setSelectedSession(null)}
                                style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 999,
                                    border: "1px solid var(--home-card-border)",
                                    background: "rgba(130,150,155,0.12)",
                                    color: "var(--home-text)",
                                    fontSize: 22,
                                    fontWeight: 800,
                                }}
                            >
                                ×
                            </button>
                        </div>

                        <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
                            {(selectedSession.exercises || []).map((ex, idx) => (
                                <div
                                    key={`${ex.name}-${idx}`}
                                    style={{
                                        borderRadius: 18,
                                        border: "1px solid var(--home-inner-border)",
                                        background: "var(--home-inner-card)",
                                        padding: 14,
                                    }}
                                >
                                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                        <div>
                                            <div style={{ fontSize: 16, fontWeight: 950, color: "var(--home-title)" }}>
                                                {ex.name}
                                            </div>
                                            <div style={{ marginTop: 5, color: "var(--home-muted2)", fontSize: 12, fontWeight: 800 }}>
                                                {ex.bodyPart} ・ {ex.setCount} set ・ {ex.volume.toLocaleString()} kg
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{ marginTop: 12, display: "grid", gap: 7 }}>
                                        {(ex.sets || []).length > 0 ? (
                                            ex.sets.map((set, setIdx) => (
                                                <div
                                                    key={setIdx}
                                                    style={{
                                                        display: "flex",
                                                        justifyContent: "space-between",
                                                        alignItems: "center",
                                                        padding: "8px 10px",
                                                        borderRadius: 12,
                                                        background: "rgba(130,150,155,0.10)",
                                                        color: "var(--home-text)",
                                                        fontWeight: 850,
                                                    }}
                                                >
                                                    <span style={{ color: "var(--home-muted2)" }}>{setIdx + 1} set</span>
                                                    <span>{set.weight}kg × {set.reps}</span>
                                                </div>
                                            ))
                                        ) : (
                                            <div style={{ color: "var(--home-muted)", fontWeight: 800 }}>
                                                セット詳細なし
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
