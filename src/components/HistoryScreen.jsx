import { useState } from "react";
import { SUGGESTIONS } from "../constants/suggestions";
import { S } from "../utils/styles";
import CalendarView from "./CalendarView";
import HistoryEditModal from "./modals/HistoryEditModal";
import PRGraphModal from "./modals/PRGraphModal";

const EX_TO_LABEL = {};
Object.entries(SUGGESTIONS).forEach(([label, names]) => {
    names.forEach((n) => {
        EX_TO_LABEL[n] = label;
    });
});


export default function HistoryScreen({ history, onEditHistory, onDeleteHistory, unit = "kg", onLogForDate }) {
    const [editTarget, setEditTarget] = useState(null);
    const [graphTarget, setGraphTarget] = useState(null);


    const today = new Date();

    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    const toDateKey = (d) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;


    return (
        <div className="fade-in" style={{ padding: "20px" }}>
            {/* ヘッダー＋ビュー切替 */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={S.sLabel}>Records</div>
            </div>


            {sortedWeekStats.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 10, letterSpacing: 2, color: "var(--text3)", marginBottom: 8 }}>
                        WEEKLY SPLIT
                    </div>

                    <div
                        style={{
                            fontSize: 17,
                            fontWeight: 800,
                            lineHeight: 1.8,
                            color: "var(--text)",
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "4px 16px",
                        }}
                    >
                        {sortedWeekStats.map(([label, count]) => (
                            <span key={label}>
                                {label} {count}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* カレンダービュー */}
            <div style={{ background: "var(--card)", borderRadius: 16, padding: "16px", border: "1px solid var(--border)" }}>
                <CalendarView history={history} onDayOpen={onLogForDate} />
            </div>


            {editTarget && (
                <HistoryEditModal
                    exName={editTarget.exName}
                    record={editTarget.record}
                    onSave={(exName, updatedRecord) => { onEditHistory(exName, updatedRecord, editTarget.historyIdx); setEditTarget(null); }}
                    onDelete={() => { onDeleteHistory(editTarget.exName, editTarget.historyIdx, editTarget.record?.date); setEditTarget(null); }}
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
