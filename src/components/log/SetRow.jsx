import { useState } from "react";

const normalizeUnitLabel = (unit) => {
    const value = String(unit || "kg").toLowerCase();
    if (value === "lbs" || value === "lb" || value === "pound" || value === "pounds") return "lb";
    if (value === "bw" || value === "bodyweight") return "自重";
    return "kg";
};

const normalizeUnitKey = (unit) => {
    const label = normalizeUnitLabel(unit);
    if (label === "lb") return "lb";
    if (label === "自重") return "BW";
    return "kg";
};

const formatWeightValue = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return String(value || "");
    return Number.isInteger(num) ? String(num) : String(Math.round(num * 10) / 10);
};

const KG_TO_LB = 2.20462;

const getSourceUnit = (set, fallbackUnit) =>
    normalizeUnitKey(set?.displayUnit || set?.unit || set?.weightUnit || set?.weight_unit || fallbackUnit || "kg");

const convertWeightForUnit = (weight, sourceUnit, targetUnit) => {
    const rawWeight = String(weight ?? "").trim();
    if (!rawWeight) return "";
    if (rawWeight.toUpperCase() === "BW" || targetUnit === "BW") return rawWeight;

    const num = Number(rawWeight);
    if (!Number.isFinite(num)) return rawWeight;

    if (sourceUnit === targetUnit) return num;
    if (sourceUnit === "kg" && targetUnit === "lb") return num * KG_TO_LB;
    if (sourceUnit === "lb" && targetUnit === "kg") return num / KG_TO_LB;
    return num;
};

const formatPreviousSet = (previousSet, fallbackUnit, targetUnit) => {
    if (!previousSet) return "前回 -";

    const reps = Number(previousSet.reps);
    const repsLabel = Number.isFinite(reps) && reps > 0 ? formatWeightValue(reps) : "-";
    const rawWeight = String(previousSet.displayWeight ?? previousSet.weight ?? "").trim();
    const normalizedTargetUnit = normalizeUnitKey(targetUnit);

    const sourceUnit = getSourceUnit(previousSet, fallbackUnit);

    if (sourceUnit === "BW" || rawWeight.toUpperCase() === "BW") {
        return `前回 自重 × ${repsLabel}`;
    }

    const displayUnit = normalizedTargetUnit === "BW" ? sourceUnit : normalizedTargetUnit;
    const convertedWeight = convertWeightForUnit(rawWeight, sourceUnit, displayUnit);
    const weightLabel = convertedWeight !== "" ? formatWeightValue(convertedWeight) : "-";
    const unitLabel = normalizeUnitLabel(displayUnit);
    return `前回 ${weightLabel}${unitLabel} × ${repsLabel}`;
};

export default function SetRow({
    ex,
    set,
    idx,
    setField,
    onWeightModeChange,
    previousSet,
    previousUnit = "kg",
    unit = "kg",
}) {
    const [showUnitMenu, setShowUnitMenu] = useState(false);
    const unitLabel = normalizeUnitLabel(unit);
    const previousLabel = formatPreviousSet(previousSet, previousUnit, unit);
    const isBodyweight = normalizeUnitKey(unit) === "BW" || String(set.weight || "").toUpperCase() === "BW";
    const unitOptions = [
        { mode: "kg", label: "kg" },
        { mode: "lbs", label: "lb" },
        { mode: "BW", label: "自重" },
    ];

    const inputWrapStyle = {
        position: "relative",
        minWidth: 0,
    };
    const weightControlStyle = {
        position: "relative",
        display: "grid",
        gridTemplateColumns: isBodyweight ? "1fr" : "minmax(64px, 1fr) 42px",
        minWidth: 0,
        borderRadius: 16,
        boxShadow: "var(--shadow-soft)",
    };
    const inputStyle = {
        width: "100%",
        minHeight: 48,
        background: "var(--input-bg)",
        border: "1px solid var(--border2)",
        borderRadius: 16,
        padding: "12px 6px",
        color: "var(--text)",
        fontSize: 17,
        fontWeight: 900,
        textAlign: "center",
        boxSizing: "border-box",
        minWidth: 0,
    };
    const weightInputStyle = {
        ...inputStyle,
        borderTopRightRadius: 0,
        borderBottomRightRadius: 0,
        borderRight: "none",
    };
    const unitChipStyle = {
        minHeight: 48,
        border: "1px solid var(--border2)",
        borderTopRightRadius: 16,
        borderBottomRightRadius: 16,
        borderTopLeftRadius: 0,
        borderBottomLeftRadius: 0,
        background: "var(--card2)",
        color: "var(--text2)",
        fontSize: 11.5,
        fontWeight: 900,
        padding: "0 4px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        whiteSpace: "nowrap",
    };
    const repsSuffixStyle = {
        position: "absolute",
        right: 13,
        top: "50%",
        transform: "translateY(-50%)",
        color: "var(--text3)",
        fontSize: 12,
        fontWeight: 800,
        pointerEvents: "none",
    };
    const toggleUnitMenu = (event) => {
        event.preventDefault();
        event.stopPropagation();
        setShowUnitMenu((prev) => !prev);
    };
    const selectUnit = (event, mode) => {
        event.preventDefault();
        event.stopPropagation();
        setShowUnitMenu(false);
        if (typeof onWeightModeChange === "function") onWeightModeChange(mode);
    };

    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "34px minmax(74px, 0.74fr) minmax(116px, 1.28fr) minmax(66px, 0.68fr)",
                gap: 8,
                alignItems: "center",
                marginBottom: 10,
                padding: "10px",
                borderRadius: 18,
                background:
                    idx === 0
                        ? "var(--success-soft)"
                        : "var(--card2)",
                border: "1px solid var(--border2)",
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
                    background: idx === 0 ? "var(--success-soft)" : "var(--btn-secondary)",
                    color: idx === 0 ? "var(--accent)" : "var(--text2)",
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
                <div style={weightControlStyle}>
                    <button
                        type="button"
                        onClick={toggleUnitMenu}
                        style={{
                            width: "100%",
                            minHeight: 48,
                            borderRadius: 16,
                            border: "1px solid var(--border2)",
                            background: "linear-gradient(135deg, rgba(15, 94, 99, 0.95), rgba(18, 199, 194, 0.86))",
                            color: "#fff",
                            fontSize: 14,
                            fontWeight: 900,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            boxShadow: "var(--shadow-soft)",
                            cursor: "pointer",
                        }}
                    >
                        自重▼
                    </button>
                    {showUnitMenu && (
                        <div style={{
                            position: "absolute",
                            right: 0,
                            top: "calc(100% + 6px)",
                            zIndex: 25,
                            display: "flex",
                            gap: 4,
                            padding: 5,
                            borderRadius: 14,
                            border: "1px solid var(--border2)",
                            background: "var(--card)",
                            boxShadow: "var(--shadow-card)",
                        }}>
                            {unitOptions.map((option) => (
                                <button
                                    key={option.mode}
                                    type="button"
                                    onClick={(event) => selectUnit(event, option.mode)}
                                    style={{
                                        minWidth: 42,
                                        padding: "7px 8px",
                                        borderRadius: 10,
                                        border: "1px solid var(--border2)",
                                        background: normalizeUnitKey(unit) === normalizeUnitKey(option.mode) ? "linear-gradient(135deg, #0F5E63, #12C7C2)" : "var(--card2)",
                                        color: normalizeUnitKey(unit) === normalizeUnitKey(option.mode) ? "#fff" : "var(--text2)",
                                        fontSize: 12,
                                        fontWeight: 900,
                                    }}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <div style={weightControlStyle}>
                    <input
                        type="text"
                        inputMode="decimal"
                        value={set.weight}
                        onChange={(e) => setField(ex, idx, "weight", e.target.value)}
                        placeholder="0"
                        style={weightInputStyle}
                    />
                    <button type="button" onClick={toggleUnitMenu} style={unitChipStyle}>
                        {unitLabel}▼
                    </button>
                    {showUnitMenu && (
                        <div style={{
                            position: "absolute",
                            right: 0,
                            top: "calc(100% + 6px)",
                            zIndex: 25,
                            display: "flex",
                            gap: 4,
                            padding: 5,
                            borderRadius: 14,
                            border: "1px solid var(--border2)",
                            background: "var(--card)",
                            boxShadow: "var(--shadow-card)",
                        }}>
                            {unitOptions.map((option) => (
                                <button
                                    key={option.mode}
                                    type="button"
                                    onClick={(event) => selectUnit(event, option.mode)}
                                    style={{
                                        minWidth: 42,
                                        padding: "7px 8px",
                                        borderRadius: 10,
                                        border: "1px solid var(--border2)",
                                        background: normalizeUnitKey(unit) === normalizeUnitKey(option.mode) ? "linear-gradient(135deg, #0F5E63, #12C7C2)" : "var(--card2)",
                                        color: normalizeUnitKey(unit) === normalizeUnitKey(option.mode) ? "#fff" : "var(--text2)",
                                        fontSize: 12,
                                        fontWeight: 900,
                                    }}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div style={inputWrapStyle}>
                <input
                    type="text"
                    inputMode="numeric"
                    value={set.reps}
                    onChange={(e) => setField(ex, idx, "reps", e.target.value)}
                    placeholder="0"
                    style={{ ...inputStyle, paddingRight: 39, boxShadow: "var(--shadow-soft)" }}
                />
                <span style={repsSuffixStyle}>回</span>
            </div>
        </div>
    );
}
