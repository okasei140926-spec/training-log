import { QUICK_LABELS } from "../../constants/suggestions";

export default function DayEditModal({ dayName, labels, toggleLabel, customLabel, setCustomLabel, onConfirm, onClose, onClear }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000cc", zIndex: 200, display: "flex", alignItems: "flex-end" }}>
      <div style={{ width: "100%", maxWidth: 430, margin: "0 auto", background: "var(--card-modal)", borderRadius: "20px 20px 0 0", padding: "24px 20px 40px", maxHeight: "80vh", overflowY: "auto" }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: "var(--text)" }}>{dayName}曜日の部位</div>
        <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 16 }}>複数タップで組み合わせ可能</div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {QUICK_LABELS.map(q => {
            const sel = labels.includes(q);
            return (
              <button key={q} onClick={() => toggleLabel(q)}
                style={{ padding: "8px 16px", borderRadius: 20, fontSize: 13, fontWeight: 600,
                  background: sel ? "var(--text)" : "var(--card2)",
                  color:      sel ? "var(--bg)"   : "var(--text2)",
                  border: sel ? "none" : "1px solid var(--border2)" }}>
                {sel ? "✓ " : ""}{q}
              </button>
            );
          })}
        </div>

        <input value={customLabel} onChange={e => setCustomLabel(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && customLabel.trim()) { toggleLabel(customLabel.trim()); setCustomLabel(""); } }}
          placeholder="その他（入力してEnter）"
          style={{ width: "100%", padding: "13px 16px", borderRadius: 12, background: "var(--card2)", border: "1px solid var(--border2)", color: "var(--text)", fontSize: 15, marginBottom: 12 }} />

        {labels.length > 0 && (
          <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 12 }}>
            選択中: <span style={{ color: "var(--text)" }}>{labels.join("・")}</span>
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClear} style={{ padding: "13px 14px", borderRadius: 12, background: "var(--card2)", color: "var(--text2)", fontSize: 13 }}>休みにする</button>
          <button onClick={onClose} style={{ flex: 1, padding: "13px", borderRadius: 12, background: "var(--card2)", color: "var(--text2)", fontSize: 15 }}>戻る</button>
          <button onClick={onConfirm} style={{ flex: 2, padding: "13px", borderRadius: 12, background: "var(--text)", color: "var(--bg)", fontSize: 15, fontWeight: 800 }}>保存</button>
        </div>
      </div>
    </div>
  );
}
