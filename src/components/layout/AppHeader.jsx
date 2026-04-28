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
                <div style={S.appLabel}>IRON LOG</div>
                <div style={S.headerTitle}>{title}</div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {showLogTimer && (
                    <button
                        onClick={onTimerClick}
                        style={{
                            padding: "6px 12px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 700,
                            border: timerLeft !== null ? "1px solid transparent" : "1px solid var(--border2)",
                            background: timerLeft !== null ? (timerLeft === 0 ? "linear-gradient(135deg, var(--accent), #4ADE80)" : timerLeft <= 10 ? "#FF4D4D" : "linear-gradient(135deg, var(--accent2), #7DD3FC)") : "var(--card)",
                            color: timerLeft !== null ? "#fff" : "var(--text2)",
                            boxShadow: timerLeft !== null ? "var(--shadow-soft)" : "var(--shadow-card)",
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
