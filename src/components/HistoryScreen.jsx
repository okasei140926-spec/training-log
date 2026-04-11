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

          {Object.entries(history).map(([name, recs]) => {
            const last   = recs[recs.length - 1];
            const prev   = recs[recs.length - 2];
            const toU    = (kg) => unit === "lbs" ? kg * KG_TO_LBS : kg;
            const last1RM = toU(calc1RM(last.sets) || Number(last.weight) * (1 + Number(last.reps) / 30));
            const prev1RM = prev ? toU(calc1RM(prev.sets) || Number(prev.weight) * (1 + Number(prev.reps) / 30)) : 0;
            const improved = prev && last1RM > prev1RM;
            const isOpen   = expanded === name;

            const graphRecs = recs.slice(-6);
            const vals      = graphRecs.map(r => calc1RM(r.sets) || Number(r.weight) * (1 + Number(r.reps) / 30));
            const maxVal    = Math.max(...vals) || 1;

            const allRMs    = recs.map(r => toU(calc1RM(r.sets) || Number(r.weight) * (1 + Number(r.reps) / 30)));
            const prValue   = Math.max(...allRMs);
            const prDate    = recs[allRMs.indexOf(prValue)]?.date;
            const prIsLatest = allRMs.indexOf(prValue) === recs.length - 1;

            return (
              <div key={name} style={{ background: "var(--card)", borderRadius: 16, marginBottom: 10, border: "1px solid var(--border)", overflow: "hidden" }}>
                <button onClick={() => setExpanded(isOpen ? null : name)}
                  style={{ width: "100%", background: "none", border: "none", padding: "16px", textAlign: "left" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{name}</div>
                      <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>{last.date} · {recs.length}回</div>
                    </div>
                    <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: improved ? "#4ade80" : "var(--text)" }}>{Math.round(last1RM)}{unit}</div>
                        <div style={{ fontSize: 10, color: "var(--text3)" }}>推定1RM</div>
                      </div>
                      <div style={{ fontSize: 16, color: "var(--text3)" }}>{isOpen ? "▲" : "▼"}</div>
                    </div>
                  </div>

                  {vals.length > 1 && (
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 36 }}>
                      {vals.map((v, i) => (
                        <div key={i} style={{ flex: 1 }}>
                          <div style={{ width: "100%", borderRadius: 4, height: `${Math.max(8, Math.round((v / maxVal) * 36))}px`,
                            background: i === vals.length - 1 ? (improved ? "#4ade80" : "var(--text)") : "var(--border2)" }} />
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    <div className="pressable" onClick={e => { e.stopPropagation(); setGraphTarget(name); }} style={{ padding: "4px 10px", background: "#FFD70020", border: "1px solid #FFD70066", borderRadius: 20, fontSize: 11, color: "#FFD700" }}>
                      🏆 PR {Math.round(prValue)}{unit} · {prDate} 📈
                    </div>
                    {improved && !prIsLatest && (
                      <div style={{ padding: "4px 10px", background: "#4ade8020", border: "1px solid #4ade8040", borderRadius: 20, fontSize: 11, color: "#4ade80" }}>
                        ↑ +{Math.round(last1RM - prev1RM)}{unit} 前回比
                      </div>
                    )}
                    {prIsLatest && (
                      <div style={{ padding: "4px 10px", background: "#4ade8020", border: "1px solid #4ade8040", borderRadius: 20, fontSize: 11, color: "#4ade80" }}>
                        ↑ 最新がPR！
                      </div>
                    )}
                  </div>
                </button>

                {isOpen && (
                  <div style={{ borderTop: "1px solid var(--border)" }}>
                    {[...recs].reverse().map((rec, i) => {
                      const rm = toU(calc1RM(rec.sets) || Number(rec.weight) * (1 + Number(rec.reps) / 30));
                      const historyIdx = recs.length - 1 - i;
                      return (
                        <div key={i} style={{ padding: "12px 16px", borderBottom: i < recs.length - 1 ? "1px solid var(--border)" : "none" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div style={{ fontSize: 12, color: "var(--text2)" }}>{rec.date}</div>
                              <button onClick={() => setEditTarget({ exName: name, record: rec, historyIdx })}
                                style={{ padding: "2px 10px", borderRadius: 10, background: "var(--card2)", border: "1px solid var(--border2)", color: "var(--text2)", fontSize: 11 }}>
                                編集
                              </button>
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text3)" }}>{Math.round(rm)}{unit} 1RM</div>
                          </div>
                          {rec.sets && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {rec.sets.map((s, j) => (
                                <div key={j} style={{ padding: "4px 10px", borderRadius: 8, background: "var(--card2)", fontSize: 12, color: "var(--text3)" }}>
                                  {dispW(s.weight, unit)}{unit} × {s.reps}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
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
