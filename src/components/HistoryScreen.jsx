import { useState } from "react";
import { S } from "../utils/styles";
import CalendarView from "./CalendarView";
import HistoryEditModal from "./modals/HistoryEditModal";
import PRGraphModal from "./modals/PRGraphModal";


export default function HistoryScreen({ history, onEditHistory, onDeleteHistory, unit = "kg", onLogForDate }) {
  const [editTarget, setEditTarget] = useState(null);
  const [graphTarget, setGraphTarget] = useState(null);

  return (
    <div className="fade-in" style={{ padding: "20px" }}>
      {/* ヘッダー＋ビュー切替 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={S.sLabel}>Records</div>
      </div>

      {/* カレンダービュー */}
      <div style={{ background: "var(--card)", borderRadius: 16, padding: "16px", border: "1px solid var(--border)" }}>
  <CalendarView history={history}  onDayOpen={onLogForDate} />
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
