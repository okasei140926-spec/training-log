export default function SummaryModal({ summary, onClose }) {
    if (!summary) return null;

    const handleShare = async () => {
        const text = `今日のトレーニング完了！💪\n種目数: ${summary.exCount}種目\nセット数: ${summary.setCount}セット${summary.prs.length ? `\nPR更新: ${summary.prs.map(p => p.name).join(", ")}` : ""}\n#IRONLOG #筋トレ`;
        if (navigator.share) {
            try {
                await navigator.share({ title: "IRON LOG", text });
            } catch { }
        } else {
            try { await navigator.clipboard.writeText(text); } catch { }
            alert("テキストをコピーしました！");
        }
    };

    return (
        <div style={{ position: "fixed", inset: 0, background: "#000000dd", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
            <div style={{ width: "100%", maxWidth: 390, background: "var(--card-modal)", borderRadius: 24, padding: "32px 24px", textAlign: "center" }}>
                <div style={{ fontSize: 48, marginBottom: 8 }}>🎉</div>
                <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 4 }}>お疲れ！</div>
                <div style={{ fontSize: 14, color: "var(--text2)", marginBottom: 28 }}>ワークアウト完了</div>

                <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
                    <div style={{ flex: 1, background: "var(--card2)", borderRadius: 14, padding: "16px 8px" }}>
                        <div style={{ fontSize: 28, fontWeight: 900, color: "var(--text)" }}>{summary.exCount}</div>
                        <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>種目</div>
                    </div>
                    <div style={{ flex: 1, background: "var(--card2)", borderRadius: 14, padding: "16px 8px" }}>
                        <div style={{ fontSize: 28, fontWeight: 900, color: "var(--text)" }}>{summary.setCount}</div>
                        <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>{count}セット</div>
                    </div>
                </div>

                {summary.prs.length > 0 && (
                    <div style={{ background: "#4ade8015", border: "1px solid #4ade8033", borderRadius: 14, padding: "14px", marginBottom: 20 }}>
                        <div style={{ fontSize: 12, color: "#4ade80", fontWeight: 700, marginBottom: 8 }}>🏆 PR更新！</div>
                        {summary.prs.map((pr, i) => (
                            <div key={i} style={{ fontSize: 13, color: "#4ade80" }}>
                                {pr.name} <span style={{ fontWeight: 800 }}>+{pr.diff}kg</span>
                            </div>
                        ))}
                    </div>
                )}

                <div style={{ display: "flex", gap: 10 }}>
                    <button onClick={handleShare}
                        style={{ flex: 1, padding: "14px", borderRadius: 14, background: "var(--card2)", color: "var(--text2)", fontWeight: 700, fontSize: 14, border: "1px solid var(--border2)" }}>
                        シェア 📤
                    </button>
                    <button onClick={onClose}
                        style={{ flex: 2, padding: "14px", borderRadius: 14, background: "var(--text)", color: "var(--bg)", fontWeight: 800, fontSize: 16, border: "none" }}>
                        閉じる
                    </button>
                </div>
            </div>
        </div>
    );
}
