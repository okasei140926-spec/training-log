export default function InviteCard({ copied, onCopyInvite }) {
    return (
        <div style={{ background: "var(--card)", borderRadius: 16, padding: "20px", border: "1px dashed var(--border2)", textAlign: "center", marginTop: 8 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>👥</div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: "var(--text)" }}>友達を招待</div>
            <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 14 }}>一緒にトレーニングを記録しよう</div>
            <button
                onClick={onCopyInvite}
                style={{ padding: "10px 28px", borderRadius: 20, background: copied ? "#4ade80" : "var(--text)", color: copied ? "#000" : "var(--bg)", fontWeight: 700, fontSize: 13, border: "none", transition: "background 0.2s" }}
            >
                {copied ? "コピーしました ✓" : "招待リンクをコピー 🔗"}
            </button>
        </div>
    );
}
