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
                            padding: "4px 12px",
                            borderRadius: 20,
                            fontSize: 12,
                            fontWeight: 700,
                            border: "none",
                            background: timerLeft !== null ? (timerLeft === 0 ? "#4ade80" : timerLeft <= 10 ? "#FF4D4D" : "var(--text)") : "var(--card2)",
                            color: timerLeft !== null ? (timerLeft === 0 ? "#000" : "var(--bg)") : "var(--text2)",
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
