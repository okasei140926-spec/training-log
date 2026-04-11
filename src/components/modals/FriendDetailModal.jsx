export default function FriendDetailModal({ friend, onClose, onCopyMenu }) {
  const allSessions = [
    ...(friend.today ? [{ date: "今日", label: friend.today.label, exercises: friend.today.exercises }] : []),
    ...friend.recentLogs,
  ];

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000cc", zIndex: 200, display: "flex", alignItems: "flex-end" }}
      onClick={onClose}>
      <div style={{ width: "100%", maxWidth: 430, margin: "0 auto", background: "var(--card-modal)", borderRadius: "20px 20px 0 0", padding: "24px 20px 36px", maxHeight: "85vh", overflowY: "auto" }}
        onClick={e => e.stopPropagation()}>

        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
          <div style={{ width: 48, height: 48, borderRadius: 24, background: friend.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 900, color: "#000", flexShrink: 0 }}>
            {friend.name[0]}
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>{friend.name}</div>
            <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>最近のトレーニング</div>
          </div>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", color: "var(--text2)", fontSize: 22, lineHeight: 1 }}>×</button>
        </div>

        {allSessions.map((session, si) => (
          <div key={si} style={{ background: "var(--card)", borderRadius: 16, padding: "16px", marginBottom: 12, border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: friend.color }}>{session.label}</div>
                <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>{session.date}</div>
              </div>
              <button onClick={() => onCopyMenu(session.exercises)}
                style={{ padding: "7px 16px", borderRadius: 20, background: friend.color + "22", border: `1px solid ${friend.color}55`, color: friend.color, fontSize: 12, fontWeight: 700 }}>
                コピーして始める
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 1fr 1fr", gap: 0, marginBottom: 6 }}>
              <div />
              <div style={{ fontSize: 10, color: "var(--text3)", paddingLeft: 2 }}>種目</div>
              <div style={{ fontSize: 10, color: "var(--text3)", textAlign: "center" }}>重量</div>
              <div style={{ fontSize: 10, color: "var(--text3)", textAlign: "center" }}>回数</div>
            </div>
            {session.exercises.map((ex, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "28px 1fr 1fr 1fr", gap: 0, alignItems: "center", padding: "9px 0", borderTop: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 700 }}>{i + 1}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{ex.name}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: friend.color, textAlign: "center" }}>
                  {ex.weight > 0 ? `${ex.weight}kg` : "BW"}
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text3)", textAlign: "center" }}>{ex.reps}rep</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
