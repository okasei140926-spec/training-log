const normalizeUnitLabel = (unit) => {
    const value = String(unit || "kg").toLowerCase();
    if (value === "lbs" || value === "lb" || value === "pound" || value === "pounds") return "lb";
    if (value === "bw" || value === "bodyweight") return "自重";
    return "kg";
};

const formatWeightValue = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return String(value || "");
    return Number.isInteger(num) ? String(num) : String(Math.round(num * 10) / 10);
};

const getSavedUnitLabel = (set, fallbackUnit) =>
    normalizeUnitLabel(set?.displayUnit || set?.unit || set?.weightUnit || set?.weight_unit || fallbackUnit || "kg");

const formatPreviousSet = (previousSet, fallbackUnit) => {
    if (!previousSet) return "前回 -";

    const reps = Number(previousSet.reps);
    const repsLabel = Number.isFinite(reps) && reps > 0 ? formatWeightValue(reps) : "-";
    const rawWeight = String(previousSet.displayWeight ?? previousSet.weight ?? "").trim();

    if (rawWeight.toUpperCase() === "BW") {
        return `前回 自重 × ${repsLabel}`;
    }

    const weightLabel = rawWeight ? formatWeightValue(rawWeight) : "-";
    const unitLabel = getSavedUnitLabel(previousSet, fallbackUnit);
    return `前回 ${weightLabel}${unitLabel} × ${repsLabel}`;
};

export default function SetRow({
    ex,
    set,
    idx,
    setField,
    previousSet,
    previousUnit = "kg",
    unit = "kg",
}) {
    const unitLabel = normalizeUnitLabel(unit);
    const previousLabel = formatPreviousSet(previousSet, previousUnit);
    const isBodyweight = String(set.weight || "").toUpperCase() === "BW";

    const inputWrapStyle = {
        position: "relative",
        minWidth: 0,
    };
    const inputStyle = {
        width: "100%",
        minHeight: 48,
        background: "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(247, 253, 253, 0.94))",
        border: "1px solid rgba(18, 199, 194, 0.18)",
        borderRadius: 16,
        padding: "12px 39px 12px 12px",
        color: "var(--text)",
        fontSize: 18,
        fontWeight: 900,
        textAlign: "center",
        boxShadow: "0 8px 20px rgba(15, 94, 99, 0.04)",
        boxSizing: "border-box",
    };
    const suffixStyle = {
        position: "absolute",
        right: 13,
        top: "50%",
        transform: "translateY(-50%)",
        color: "var(--text3)",
        fontSize: 12,
        fontWeight: 800,
        pointerEvents: "none",
    };

    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "34px minmax(82px, 1fr) minmax(84px, 0.9fr) minmax(74px, 0.75fr)",
                gap: 8,
                alignItems: "center",
                marginBottom: 10,
                padding: "10px",
                borderRadius: 18,
                background:
                    idx === 0
                        ? "linear-gradient(135deg, rgba(18, 199, 194, 0.11), rgba(18, 199, 194, 0.045))"
                        : "rgba(18, 199, 194, 0.035)",
                border: "1px solid rgba(18, 199, 194, 0.12)",
            }}
        >
            <div
                style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: idx === 0 ? "rgba(18, 199, 194, 0.16)" : "rgba(18, 199, 194, 0.08)",
                    color: idx === 0 ? "#0F5E63" : "var(--text2)",
                    fontSize: 14,
                    fontWeight: 900,
                    flexShrink: 0,
                }}
            >
                {idx + 1}
            </div>

            <div
                style={{
                    color: "var(--text2)",
                    fontSize: 12,
                    fontWeight: 800,
                    lineHeight: 1.35,
                    minWidth: 0,
                    whiteSpace: "normal",
                }}
            >
                {previousLabel}
            </div>

            {isBodyweight ? (
                <button
                    type="button"
                    onClick={() => setField(ex, idx, "weight", "")}
                    style={{
                        minHeight: 48,
                        borderRadius: 16,
                        border: "1px solid rgba(18, 199, 194, 0.24)",
                        background: "linear-gradient(135deg, rgba(15, 94, 99, 0.95), rgba(18, 199, 194, 0.86))",
                        color: "#fff",
                        fontSize: 14,
                        fontWeight: 900,
                    }}
                >
                    自重
                </button>
            ) : (
                <div style={inputWrapStyle}>
                    <input
                        type="text"
                        inputMode="decimal"
                        value={set.weight}
                        onChange={(e) => setField(ex, idx, "weight", e.target.value)}
                        placeholder="0"
                        style={inputStyle}
                    />
                    <span style={suffixStyle}>{unitLabel}</span>
                </div>
            )}

            <div style={inputWrapStyle}>
                <input
                    type="text"
                    inputMode="numeric"
                    value={set.reps}
                    onChange={(e) => setField(ex, idx, "reps", e.target.value)}
                    placeholder="0"
                    style={inputStyle}
                />
                <span style={suffixStyle}>回</span>
            </div>
        </div>
    );
}
