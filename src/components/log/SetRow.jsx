import { isCompletedWorkoutSet } from "../../utils/helpers";

export default function SetRow({
    ex,
    set,
    idx,
    setField,
    onCopyDown,
    onCopyDownReps,
}) {
    const canCopy = idx > 0;
    const isCompleted = isCompletedWorkoutSet(set);

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
            <button
                onClick={() =>
                    setField(ex, idx, "weight", set.weight === "BW" ? "" : "BW")
                }
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 24,
                    height: 36,
                    borderRadius: 9,
                    background: isCompleted
                        ? "rgba(18, 199, 194, 0.14)"
                        : "rgba(18, 199, 194, 0.08)",
                    color: isCompleted ? "#0F5E63" : "var(--text2)",
                    fontSize: 11,
                    fontWeight: 800,
                    alignSelf: "center",
                    border: "1px solid rgba(18, 199, 194, 0.14)",
                    boxShadow: "0 6px 14px rgba(15, 94, 99, 0.04)",
                }}
            >
                {idx + 1}
            </button>

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
                    自重{" "}
                    <span style={{ fontSize: 10, color: "var(--text4)" }}>
                        タップでkg
                    </span>
                </button>
            ) : (
                <input
                    type="text"
                    inputMode="decimal"
                    value={set.weight}
                    onChange={(e) => {
                        setField(ex, idx, "weight", e.target.value);
                    }}
                    placeholder="0"
                    style={{
                        width: "100%",
                        background: "var(--card2)",
                        border: "1px solid var(--border2)",
                        borderRadius: 10,
                        padding: "10px 8px",
                        color: "var(--text)",
                        fontSize: 16,
                        fontWeight: 700,
                        textAlign: "center",
                    }}
                />
            )}

            {canCopy && set.weight !== "BW" && onCopyDown ? (
                <button
                    onClick={() => onCopyDown(ex.name, idx - 1)}
                    style={{
                        width: "100%",
                        height: "100%",
                        borderRadius: 8,
                        background: "transparent",
                        border: "1px solid var(--border2)",
                        color: "var(--text3)",
                        fontSize: 15,
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
                onChange={(e) => {
                    setField(ex, idx, "reps", e.target.value);
                }}
                placeholder="0"
                style={{
                    width: "100%",
                    background: "var(--card2)",
                    border: "1px solid var(--border2)",
                    borderRadius: 10,
                    padding: "10px 8px",
                    color: "var(--text)",
                    fontSize: 16,
                    fontWeight: 700,
                    textAlign: "center",
                }}
            />

            {canCopy && onCopyDownReps ? (
                <button
                    onClick={() => onCopyDownReps(ex.name, idx - 1)}
                    style={{
                        width: "100%",
                        height: "100%",
                        borderRadius: 8,
                        background: "transparent",
                        border: "1px solid var(--border2)",
                        color: "var(--text3)",
                        fontSize: 15,
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
