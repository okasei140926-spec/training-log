import { S } from "../../utils/styles";

export default function AppHeader({
    title,
    showLogTimer,
    timerLeft,
    onTimerClick,
    isDark,
    onToggleTheme,
}) {
    return (
        <div style={S.header}>
            <div>
                <div style={S.appLabel}>PUMP</div>
                <div style={S.headerTitle}>{title}</div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {showLogTimer && (
                    <button
                        onClick={onTimerClick}
                        style={{
                            padding: "9px 13px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 800,
                            border: timerLeft !== null ? "1px solid transparent" : "1px solid rgba(18, 199, 194, 0.12)",
                            background: timerLeft !== null ? (timerLeft === 0 ? "linear-gradient(135deg, var(--accent), #4ADE80)" : timerLeft <= 10 ? "linear-gradient(135deg, #ef4444, #fb7185)" : "linear-gradient(135deg, var(--accent2), #7DD3FC)") : "linear-gradient(180deg, var(--card), var(--card2))",
                            color: timerLeft !== null ? "#fff" : "var(--text2)",
                            boxShadow: timerLeft !== null ? "var(--shadow-soft)" : "0 8px 18px rgba(15,94,99,0.08)",
                        }}
                    >
                        {timerLeft !== null ? (timerLeft === 0 ? "GO!💪" : `⏱ ${Math.floor(timerLeft / 60)}:${String(timerLeft % 60).padStart(2, "0")}`) : "⏱"}
                    </button>
                )}
                <button onClick={onToggleTheme} style={S.pillBtn}>{isDark ? "☀️" : "🌙"}</button>
            </div>
        </div>
    );
}
