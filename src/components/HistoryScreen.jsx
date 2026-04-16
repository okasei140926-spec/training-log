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


export default function HistoryScreen({ history, muscleEx, onEditHistory, onDeleteHistory, unit = "kg", onLogForDate }) {
    const [editTarget, setEditTarget] = useState(null);
    const [graphTarget, setGraphTarget] = useState(null);


    const today = new Date();

    const [activeLabel, setActiveLabel] = useState(null);

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
        const label =
            EX_TO_LABEL[exName] ||
            Object.keys(muscleEx || {}).find((l) =>
                (muscleEx[l] || []).some((ex) => ex.name === exName)
            );

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
        const label =
            EX_TO_LABEL[exName] ||
            Object.keys(muscleEx || {}).find((l) =>
                (muscleEx[l] || []).some((ex) => ex.name === exName)
            );

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

    return (
        <div className="fade-in" style={{ padding: "20px" }}>

            {/* WEEKLY SPLIT */}
            {sortedWeekStats.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 10, letterSpacing: 2.5, color: "var(--text3)", marginBottom: 16 }}>
                        週のセット数
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

                    {/* 詳細 */}
                    {activeLabel && detailMap[activeLabel] && (
                        <div style={{ marginTop: 16 }}>
                            <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 6 }}>
                                {activeLabel} の内訳
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto", paddingRight: 4, }}>
                                {Object.entries(detailMap[activeLabel])
                                    .sort((a, b) => b[1] - a[1])
                                    .map(([name, count]) => (
                                        <div
                                            key={name}
                                            style={{
                                                display: "flex",
                                                justifyContent: "space-between",
                                                alignItems: "center",
                                                fontSize: 13,
                                                fontWeight: 600,
                                                color: "var(--text)",
                                                padding: "8px 10px",
                                                background: "var(--card)",
                                                borderRadius: 10,
                                                border: "1px solid var(--border2)",
                                            }}
                                        >
                                            <span>{name}</span>
                                            <span>{count}</span>
                                        </div>
                                    ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* カレンダー（←ここ外に出すのが超重要） */}
            <div style={{
                background: "var(--card)",
                borderRadius: 16,
                padding: "16px",
                border: "1px solid var(--border)"
            }}>
                <CalendarView history={history} onDayOpen={onLogForDate} />
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
        </div>
    );
}