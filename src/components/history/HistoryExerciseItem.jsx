export default function HistoryExerciseItem({
    name,
    count,
    sets,
    isOpen,
    onToggle,
    onDeleteSet,
}) {
    return (
        <div
            style={{
                background: "var(--card2)",
                borderRadius: 12,
                padding: "8px 12px",
            }}
        >
            <div
                onClick={onToggle}
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    cursor: "pointer",
                    borderRadius: 12,
                    padding: "12px 16px",
                    transition: "all 0.15s",
                }}
                onTouchStart={(e) => {
                    e.currentTarget.style.opacity = 0.6;
                }}
                onTouchEnd={(e) => {
                    e.currentTarget.style.opacity = 1;
                }}
            >
                <span>{name}</span>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span>{count}セット</span>
                    <span style={{ opacity: 0.4 }}>
                        {isOpen ? "▼" : "›"}
                    </span>
                </div>
            </div>

            {isOpen && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                    {sets.map((s, i) => (
                        <div
                            key={i}
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                paddingTop: 6,
                                borderTop: "1px solid var(--border2)",
                            }}
                        >
                            <span>
                                {i + 1}{" "}
                                {s.weight === "BW"
                                    ? `自重 × ${s.reps}reps`
                                    : `${s.weight}kg × ${s.reps}reps`}
                            </span>

                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteSet(i);
                                }}
                                style={{
                                    background: "none",
                                    border: "none",
                                    color: "var(--text3)",
                                    fontSize: 18,
                                    cursor: "pointer",
                                }}
                            >
                                ×
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}