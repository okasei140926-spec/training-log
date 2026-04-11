import { useState } from "react";
import { calc1RM } from "../../utils/helpers";

export default function HistoryEditModal({ exName, record, onSave, onDelete, onClose }) {
  const [sets, setSets] = useState(
    (record.sets?.length ? record.sets : [{ weight: record.weight ?? "", reps: record.reps ?? "" }])
      .map(s => ({ ...s }))
  );

  const setField = (idx, field, val) =>
    setSets(p => p.map((s, i) => i === idx ? { ...s, [field]: val } : s));

  const addSet = () => {
    const last = sets[sets.length - 1] || { weight: "", reps: "" };
    setSets(p => [...p, { weight: last.weight, reps: last.reps, done: true }]);
  };

  const removeSet = (idx) => {
    if (sets.length <= 1) return;
    setSets(p => p.filter((_, i) => i !== idx));
  };

  const handleSave = () => {
    const valid = sets.filter(s => (s.weight || s.weight === 0) && s.reps);
    if (!valid.length) return;
    onSave(exName, { ...record, sets: valid, weight: Number(valid[0].weight) || 0, reps: Number(valid[0].reps) || 0 });
  };

  const new1RM = Math.round(calc1RM(sets.filter(s => s.weight && s.reps)));

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000cc", zIndex: 300, display: "flex", alignItems: "flex-end" }}
      onClick={onClose}>
      <div style={{ width: "100%", maxWidth: 430, margin: "0 auto", background: "var(--card-modal)", borderRadius: "20px 20px 0 0", padding: "24px 20px 36px", maxHeight: "80vh", overflowY: "auto" }}
        onClick={e => e.stopPropagation()}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{exName}</div>
          <button onClick={onClose} style={{ background: "none", color: "var(--text2)", fontSize: 22 }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 20 }}>
          {record.date} · 推定1RM: <span style={{ color: "var(--text)", fontWeight: 700 }}>{new1RM}kg</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 1fr 32px", gap: 8, marginBottom: 8 }}>
          <div />
          <div style={{ fontSize: 10, color: "var(--text2)", textAlign: "center" }}>kg</div>
          <div style={{ fontSize: 10, color: "var(--text2)", textAlign: "center" }}>rep</div>
          <div />
        </div>

        {sets.map((s, idx) => (
          <div key={idx} style={{ display: "grid", gridTemplateColumns: "24px 1fr 1fr 32px", gap: 8, marginBottom: 8, alignItems: "center" }}>
            <div style={{ fontSize: 11, color: "var(--text2)", textAlign: "center", fontWeight: 700 }}>{idx + 1}</div>
            <input type="text" inputMode="decimal" value={s.weight}
              onChange={e => setField(idx, "weight", e.target.value)}
              style={{ width: "100%", background: "var(--card2)", border: "1px solid var(--border2)", borderRadius: 10, padding: "10px 8px", color: "var(--text)", fontSize: 16, fontWeight: 700, textAlign: "center" }} />
            <input type="text" inputMode="numeric" value={s.reps}
              onChange={e => setField(idx, "reps", e.target.value)}
              style={{ width: "100%", background: "var(--card2)", border: "1px solid var(--border2)", borderRadius: 10, padding: "10px 8px", color: "var(--text)", fontSize: 16, fontWeight: 700, textAlign: "center" }} />
            <button onClick={() => removeSet(idx)}
              style={{ background: "none", color: sets.length <= 1 ? "var(--border2)" : "var(--text3)", fontSize: 20 }}>×</button>
          </div>
        ))}

        <button onClick={addSet}
          style={{ width: "100%", padding: "10px", borderRadius: 10, background: "transparent", border: "1px dashed var(--border2)", color: "var(--text3)", fontSize: 13, marginBottom: 16 }}>
          ＋ セット追加
        </button>

        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: "13px", borderRadius: 12, background: "var(--card2)", color: "var(--text2)", fontSize: 15 }}>
            キャンセル
          </button>
          <button onClick={handleSave}
            style={{ flex: 2, padding: "13px", borderRadius: 12, background: "var(--text)", color: "var(--bg)", fontSize: 15, fontWeight: 800 }}>
            保存
          </button>
        </div>
        {onDelete && (
          <button onClick={onDelete}
            style={{ width: "100%", padding: "11px", borderRadius: 12, background: "transparent", border: "1px solid #FF4D4D44", color: "#FF4D4D", fontSize: 13 }}>
            この記録を削除
          </button>
        )}
      </div>
    </div>
  );
}
