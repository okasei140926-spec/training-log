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
                gridTemplateColumns: "48px 1fr 44px 1fr 44px",
                gap: 8,
                marginBottom: 10,
                alignItems: "center",
            }}
        >
            <button
                onClick={() => setField(ex, idx, "weight", set.weight === "BW" ? "" : "BW")}
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 48,
                    height: 48,
                    borderRadius: 14,
                    background: set.done ? "var(--accent)" : "var(--border)",
                    color: set.done ? "#fff" : "var(--text2)",
                    fontSize: 16,
                    fontWeight: 800,
                    border: "none",
                }}
            >
                {idx + 1}
            </button>

            {set.weight === "BW" ? (
                <button
                    onClick={() => setField(ex, idx, "weight", "")}
                    style={{
                        width: "100%",
                        height: 48,
                        background: "var(--card2)",
                        border: "1px solid var(--border2)",
                        borderRadius: 14,
                        padding: "10px 8px",
                        color: "var(--text2)",
                        fontSize: 15,
                        fontWeight: 700,
                        textAlign: "center",
                    }}
                >
                    自重
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
                        height: 48,
                        background: "var(--card2)",
                        border: "1px solid var(--border2)",
                        borderRadius: 14,
                        padding: "10px 8px",
                        color: "var(--text)",
                        fontSize: 18,
                        fontWeight: 700,
                        textAlign: "center",
                    }}
                />
            )}

            {canCopy && set.weight !== "BW" && onCopyDown ? (
                <button
                    onClick={() => onCopyDown(ex.name, idx - 1)}
                    style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        background: "transparent",
                        border: "1px solid var(--border2)",
                        color: "var(--text3)",
                        fontSize: 16,
                        fontWeight: 700,
                    }}
                >
                    ⎘
                </button>
            ) : (
                <div />
            )}

            <input
                type="text"
                inputMode="numeric"
                value={set.reps}
                onChange={(e) => setField(ex, idx, "reps", e.target.value)}
                placeholder="0"
                style={{
                    width: "100%",
                    height: 48,
                    background: "var(--card2)",
                    border: "1px solid var(--border2)",
                    borderRadius: 14,
                    padding: "10px 8px",
                    color: "var(--text)",
                    fontSize: 18,
                    fontWeight: 700,
                    textAlign: "center",
                }}
            />

            {canCopy && onCopyDownReps ? (
                <button
                    onClick={() => onCopyDownReps(ex.name, idx - 1)}
                    style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        background: "transparent",
                        border: "1px solid var(--border2)",
                        color: "var(--text3)",
                        fontSize: 16,
                        fontWeight: 700,
                    }}
                >
                    ⎘
                </button>
            ) : (
                <div />
            )}
        </div>
    );
}