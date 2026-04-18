export default function SetRow({
    ex,
    set,
    idx,
    setField,
    onCopyDown,
    onCopyDownReps,
}) {
    const canCopy = idx > 0;

    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "24px 1fr 32px 1fr 32px",
                gap: 6,
                marginBottom: 8,
                alignItems: "stretch",
            }}
        >
            {/* セット番号 */}
            <button
                onClick={() =>
                    setField(ex, idx, "weight", set.weight === "BW" ? "" : "BW")
                }
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 24,
                    height: 40,
                    borderRadius: 8,
                    background: set.done ? "var(--accent)" : "var(--border)",
                    color: set.done ? "#fff" : "var(--text2)",
                    fontSize: 12,
                    fontWeight: 800,
                    border: "none",
                }}
            >
                {idx + 1}
            </button>

            {/* weight */}
            {set.weight === "BW" ? (
                <button
                    onClick={() => setField(ex, idx, "weight", "")}
                    style={{
                        width: "100%",
                        background: "var(--card2)",
                        border: "2px solid var(--border2)",
                        borderRadius: 10,
                        padding: "10px 8px",
                        color: "var(--text2)",
                        fontSize: 14,
                        fontWeight: 700,
                        textAlign: "center",
                    }}
                >
                    自重 <span style={{ fontSize: 10 }}>タップでkg</span>
                </button>
            ) : (
                <input
                    type="text"
                    inputMode="decimal"
                    value={set.weight}
                    onChange={(e) => setField(ex, idx, "weight", e.target.value)}
                    placeholder="0"
                    style={{
                        width: "100%",
                        background: "var(--card2)",
                        border: "1px solid var(--border2)",
                        borderRadius: 10,
                        padding: "10px 8px",
                        fontSize: 16,
                        fontWeight: 700,
                        textAlign: "center",
                    }}
                />
            )}

            {/* weight copy */}
            {canCopy && set.weight !== "BW" && onCopyDown ? (
                <button onClick={() => onCopyDown(ex.name, idx - 1)}>⎘</button>
            ) : (
                <div />
            )}

            {/* reps */}
            <input
                type="text"
                inputMode="numeric"
                value={set.reps}
                onChange={(e) => setField(ex, idx, "reps", e.target.value)}
                placeholder="0"
            />

            {/* reps copy */}
            {canCopy && onCopyDownReps ? (
                <button onClick={() => onCopyDownReps(ex.name, idx - 1)}>
                    ⎘
                </button>
            ) : (
                <div />
            )}
        </div>
    );
}