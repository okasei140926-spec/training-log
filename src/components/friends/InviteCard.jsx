export default function InviteCard({ copied, onCopyInvite }) {
    return (
        <div style={{ background: "var(--card)", borderRadius: 18, padding: "18px 18px 16px", border: "1px solid var(--border2)", textAlign: "center", marginTop: 8, boxShadow: "var(--shadow-card)" }}>
            <div style={{ fontSize: 26, marginBottom: 6 }}>👥</div>
            <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 6, color: "var(--text)" }}>友達を招待</div>
            <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 16, lineHeight: 1.5 }}>一緒にトレーニングを記録しよう</div>
            <button
                onClick={onCopyInvite}
                style={{ width: "100%", maxWidth: 280, padding: "13px 18px", borderRadius: 18, background: copied ? "#4ade80" : "linear-gradient(135deg, #0F4B52, #184E54)", color: copied ? "#062910" : "#fff", fontWeight: 800, fontSize: 14, border: "none", transition: "background 0.2s", boxShadow: copied ? "none" : "0 10px 18px rgba(15, 75, 82, 0.22)" }}
            >
                {copied ? "コピーしました ✓" : "招待リンクをコピー"}
            </button>
        </div>
    );
}
