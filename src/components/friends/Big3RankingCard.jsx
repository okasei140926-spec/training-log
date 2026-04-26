export default function Big3RankingCard({ ranking }) {
    return (
        <div style={{ background: "var(--card)", borderRadius: 16, padding: "16px", marginBottom: 12, border: "1px solid var(--border2)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>
                BIG3合計ランキング
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {ranking.map((entry, index) => (
                    <div
                        key={`big3-${entry.isMe ? "me" : entry.name}-${index}`}
                        style={{
                            padding: "12px",
                            borderRadius: 12,
                            background: entry.isMe ? "var(--card2)" : "transparent",
                            border: entry.isMe ? "1px solid var(--border)" : "1px solid transparent",
                        }}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                <div style={{ width: 22, fontSize: 12, fontWeight: 800, color: index === 0 ? "#FFD700" : "var(--text3)" }}>
                                    {index + 1}位
                                </div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {entry.name}
                                </div>
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>
                                {entry.total}kg
                            </div>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.5 }}>
                            ベンチ {entry.bench} / スクワット {entry.squat} / デッド {entry.deadlift}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
