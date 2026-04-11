import { useState } from "react";
import { calc1RM, dispW, KG_TO_LBS } from "../utils/helpers";
import { S } from "../utils/styles";
import CalendarView from "./CalendarView";
import HistoryEditModal from "./modals/HistoryEditModal";
import PRGraphModal from "./modals/PRGraphModal";

export default function HistoryScreen({ history, onEditHistory, onDeleteHistory, unit = "kg", onLogForDate }) {
  const [expanded,   setExpanded]   = useState(null);
  const [viewMode,   setViewMode]   = useState("list");
  const [editTarget, setEditTarget] = useState(null);
  const [graphTarget, setGraphTarget] = useState(null);

  return (
    <div className="fade-in" style={{ padding: "20px" }}>
      {/* ヘッダー＋ビュー切替 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={S.sLabel}>Records</div>
        <div style={{ display: "flex", background: "var(--card)", borderRadius: 20, padding: 3, border: "1px solid var(--border)" }}>
          {[{ id: "list", label: "リスト" }, { id: "calendar", label: "カレンダー" }].map(v => (
            <button key={v.id} onClick={() => setViewMode(v.id)}
              style={{ padding: "5px 14px", borderRadius: 16, fontSize: 12, fontWeight: 700, border: "none",
                background: viewMode === v.id ? "var(--text)" : "transparent",
                color:      viewMode === v.id ? "var(--bg)"  : "var(--text2)" }}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* カレンダービュー */}
      {viewMode === "calendar" && (
        <div style={{ background: "var(--card)", borderRadius: 16, padding: "16px", border: "1px solid var(--border)" }}>
          <CalendarView history={history} unit={unit} onEditRecord={(exName, record, historyIdx) => setEditTarget({ exName, record, historyIdx })} onLogForDate={onLogForDate} />
        </div>
      )}

      {/* リストビュー */}
    {viewMode === "list" && (
  <>
    {!Object.keys(history).length && (
      <div style={{ textAlign: "center", color: "var(--text4)", paddingTop: 60, fontSize: 14 }}>
        まだ記録がないで！<br />ワークアウトを始めよう 🏋️
      </div>
    )}

    {(() => {
      // 日付ごとにグループ化
      const byDate = {};
      Object.entries(history).forEach(([name, recs]) => {
        recs.forEach(rec => {
          if (!byDate[rec.date]) byDate[rec.date] = [];
          byDate[rec.date].push({ name, rec });
        });
      });
      return Object.entries(byDate)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, entries]) => (
          <div key={date} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 8, letterSpacing: 1 }}>{date}</div>
            <div style={{ background: "var(--card)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden" }}>
              {entries.map(({ name, rec }, i) => (
                <div key={name} style={{ padding: "12px 16px", borderBottom: i < entries.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{name}</div>
                    <button onClick={() => {
                      const recs = history[name];
                      const historyIdx = recs.findIndex(r => r.date === date);
                      setEditTarget({ exName: name, record: rec, historyIdx });
                    }}
                      style={{ padding: "2px 10px", borderRadius: 10, background: "var(--card2)", border: "1px solid var(--border2)", color: "var(--text2)", fontSize: 11 }}>
                      編集 →
                    </button>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4 }}>
                    {rec.sets?.map(s => `${dispW(s.weight, unit)}${s.weight === "BW" ? "" : unit}×${s.reps}`).join(" / ")}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ));
    })()}
  </>
)}
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
