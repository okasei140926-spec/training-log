import { useState } from "react";
import { SUGGESTIONS } from "../constants/suggestions";
import CalendarView from "./CalendarView";
import HistoryEditModal from "./modals/HistoryEditModal";
import PRGraphModal from "./modals/PRGraphModal";

const EX_TO_LABEL = {};
Object.entries(SUGGESTIONS).forEach(([label, names]) => {
    names.forEach((n) => {
        EX_TO_LABEL[n] = label;
    });
});

const normalizeName = (name) =>
    String(name || "").replace(/\s+/g, "").trim();

const resolveLabel = (exName, muscleEx = {}) => {
    const normalized = normalizeName(exName);

    // まず SUGGESTIONS の完全一致
    if (EX_TO_LABEL[exName]) return EX_TO_LABEL[exName];

    // SUGGESTIONS のあいまい一致
    const suggestionMatch = Object.entries(EX_TO_LABEL).find(([name]) => {
        const base = normalizeName(name);
        return base === normalized || base.includes(normalized) || normalized.includes(base);
    });
    if (suggestionMatch) return suggestionMatch[1];

    // 手入力で追加した種目から探す
    const customMatch = Object.entries(muscleEx || {}).find(([label, list]) =>
        (list || []).some((ex) => {
            const name = typeof ex === "string" ? ex : ex.name;
            const base = normalizeName(name);
            return base === normalized || base.includes(normalized) || normalized.includes(base);
        })
    );

    return customMatch ? customMatch[0] : null;
};

export default function HistoryScreen({ history, muscleEx, onEditHistory, onDeleteHistory, onDeleteDate, unit = "kg", onLogForDate }) {
    const [editTarget, setEditTarget] = useState(null);
    const [graphTarget, setGraphTarget] = useState(null);


    const today = new Date();

    const [activeLabel, setActiveLabel] = useState(null);
    const [selectedDate, setSelectedDate] = useState(null);

    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    const toDateKey = (d) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const weekStartStr = toDateKey(startOfWeek);
    const weekEndStr = toDateKey(endOfWeek);

    const weekStats = {};
    Object.entries(history || {}).forEach(([exName, recs]) => {
        const label = resolveLabel(exName, muscleEx);

        if (!label) return;

        (recs || []).forEach((r) => {
            if (!r?.date) return;
            if (r.date < weekStartStr || r.date > weekEndStr) return;

            const setCount = (r.sets || []).filter((s) => s.weight && s.reps).length;
            if (!setCount) return;

            weekStats[label] = (weekStats[label] || 0) + setCount;
        });
    });

    const detailMap = {};
    Object.entries(history || {}).forEach(([exName, recs]) => {
        const label = resolveLabel(exName, muscleEx);
        if (!label) return;

        (recs || []).forEach((r) => {
            if (!r?.date) return;
            if (r.date < weekStartStr || r.date > weekEndStr) return;

            const sets = (r.sets || []).filter((s) => s.weight && s.reps).length;
            if (!sets) return;

            if (!detailMap[label]) detailMap[label] = {};
            detailMap[label][exName] = (detailMap[label][exName] || 0) + sets;
        });
    });

    const sortedWeekStats = Object.entries(weekStats)
        .sort((a, b) => b[1] - a[1]);

    const daySummary = {};

    Object.entries(history || {}).forEach(([exName, recs]) => {
        (recs || []).forEach((r) => {
            if (r.date !== selectedDate) return;

            const sets = (r.sets || []).filter(s => s.weight && s.reps).length;
            if (!sets) return;

            daySummary[exName] = (daySummary[exName] || 0) + sets;
        });
    });

    const workedLabels = [...new Set(
        Object.keys(daySummary)
            .map((exName) => resolveLabel(exName, muscleEx))
            .filter(Boolean)
    )];

    console.log("daySummary", daySummary);
    console.log("workedLabels", workedLabels);

    const totalSets = Object.values(daySummary).reduce((a, b) => a + b, 0);

    return (
        <div className="fade-in" style={{ padding: "20px" }}>

            {/* WEEKLY SPLIT */}
            {sortedWeekStats.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 10, letterSpacing: 2.5, color: "var(--text3)", marginBottom: 16 }}>
                        今週のセット数
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                        {sortedWeekStats.map(([label, count]) => {
                            const isActive = activeLabel === label;

                            return (
                                <div
                                    key={label}
                                    onClick={() => setActiveLabel(isActive ? null : label)}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                        padding: "10px 14px",
                                        borderRadius: 999,
                                        cursor: "pointer",
                                        background: isActive ? "var(--text)" : "var(--card2)",
                                        border: "1px solid var(--border)",
                                    }}
                                >
                                    <span style={{
                                        fontSize: 13,
                                        fontWeight: 700,
                                        color: isActive ? "#fff" : "var(--text2)",
                                    }}>
                                        {label}
                                    </span>

                                    <span style={{
                                        fontSize: 18,
                                        fontWeight: 800,
                                        color: isActive ? "#fff" : "var(--text)",
                                    }}>
                                        {count}
                                    </span>
                                </div>
                            );
                        })}
                    </div>

                </div>
            )}



            {/* カレンダー（←ここ外に出すのが超重要） */}
            <div style={{
                background: "var(--card)",
                borderRadius: 16,
                padding: "16px",
                border: "1px solid var(--border)"
            }}>
                <CalendarView
                    history={history}
                    onDayOpen={(date) => {
                        const hasData = Object.values(history || {}).some((recs) =>
                            (recs || []).some((r) => r.date === date)
                        );

                        if (hasData) {
                            setSelectedDate(date);
                        } else {
                            onLogForDate(date);
                        }
                    }}
                />
            </div>

            {/* モーダル */}
            {editTarget && (
                <HistoryEditModal
                    exName={editTarget.exName}
                    record={editTarget.record}
                    onSave={(exName, updatedRecord) => {
                        onEditHistory(exName, updatedRecord, editTarget.historyIdx);
                        setEditTarget(null);
                    }}
                    onDelete={() => {
                        onDeleteHistory(editTarget.exName, editTarget.historyIdx, editTarget.record?.date);
                        setEditTarget(null);
                    }}
                    onClose={() => setEditTarget(null)}
                />
            )}

            {graphTarget && (
                <PRGraphModal
                    exName={graphTarget}
                    history={history}
                    unit={unit}
                    onClose={() => setGraphTarget(null)}
                />
            )}

            {activeLabel && detailMap[activeLabel] && (
                <div
                    onClick={() => setActiveLabel(null)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(0,0,0,0.35)",
                        display: "flex",
                        alignItems: "flex-end",
                        justifyContent: "center",
                        zIndex: 999, // ←上げる
                        padding: "16px",
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: "100%",
                            maxWidth: 430,
                            background: "var(--card)",
                            borderRadius: 20,
                            padding: "18px 16px 20px",
                            border: "1px solid var(--border2)",
                            maxHeight: "60vh",
                            overflowY: "auto",
                            boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
                        }}
                    >
                        <div
                            style={{
                                width: 44,
                                height: 5,
                                borderRadius: 999,
                                background: "var(--border2)",
                                margin: "0 auto 14px",
                            }}
                        />

                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: 12,
                            }}
                        >
                            <div style={{ fontSize: 18, fontWeight: 800 }}>
                                {activeLabel}
                            </div>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {Object.entries(detailMap[activeLabel])
                                .sort((a, b) => b[1] - a[1])
                                .map(([name, count]) => (
                                    <div
                                        key={name}
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            padding: "10px 12px",
                                            background: "var(--card2)",
                                            borderRadius: 12,
                                        }}
                                    >
                                        <span>{name}</span>
                                        <span>{count}</span>
                                    </div>
                                ))}
                        </div>
                    </div>
                </div>
            )}

            {selectedDate && Object.keys(daySummary).length > 0 && (
                <div
                    onClick={() => setSelectedDate(null)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(0,0,0,0.35)",
                        display: "flex",
                        alignItems: "flex-end",
                        justifyContent: "center",
                        zIndex: 999,
                        padding: "16px",
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: "100%",
                            maxWidth: 430,
                            background: "var(--card)",
                            borderRadius: 20,
                            padding: "18px 16px 20px",
                            border: "1px solid var(--border2)",
                            maxHeight: "60vh",
                            overflowY: "auto",
                        }}
                    >
                        <div
                            style={{
                                width: 44,
                                height: 5,
                                borderRadius: 999,
                                background: "var(--border2)",
                                margin: "0 auto 14px",
                            }}
                        />

                        <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 18, fontWeight: 800 }}>
                                {selectedDate}
                            </div>
                        </div>

                        <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 12 }}>
                            合計 {totalSets} セット
                        </div>

                        <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 12 }}>
                            {workedLabels.join(" / ")}
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {Object.entries(daySummary)
                                .sort((a, b) => b[1] - a[1])
                                .map(([name, count]) => (
                                    <div
                                        key={name}
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            padding: "8px 12px",
                                            background: "var(--card2)",
                                            borderRadius: 12,
                                        }}
                                    >
                                        <span>{name}</span>
                                        <span>{count}</span>
                                    </div>
                                ))}
                        </div>

                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 14,
                                marginTop: 20,
                                paddingTop: 6,
                            }}
                        >
                            <button
                                onClick={() => {
                                    if (!selectedDate) return;
                                    onDeleteDate?.(selectedDate);
                                    setSelectedDate(null);
                                }}
                                style={{
                                    width: "100%",
                                    border: "1px solid var(--border2)",
                                    borderRadius: 18,
                                    padding: "16px",
                                    fontSize: 14,
                                    fontWeight: 700,
                                    background: "var(--card2)",
                                    color: "var(--text2)",
                                }}
                            >
                                この日の記録を削除
                            </button>

                            <button
                                onClick={() => onLogForDate(selectedDate)}
                                style={{
                                    width: "100%",
                                    border: "none",
                                    borderRadius: 18,
                                    padding: "18px 16px",
                                    fontSize: 15,
                                    fontWeight: 800,
                                    background: "#000",
                                    color: "#fff",
                                }}
                            >
                                記録を開く
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}