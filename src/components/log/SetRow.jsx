import { useEffect, useState } from "react";

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

const formatTargetRepsValue = (value) => {
    const text = String(value ?? "").trim();
    if (!text) return "";
    const num = Number(text);
    if (!Number.isFinite(num) || num <= 0) return text;
    return formatWeightValue(num);
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
    onSetInputFocusChange,
    inputId,
    previousSet,
    previousUnit = "kg",
    unit = "kg",
}) {
    const [showUnitMenu, setShowUnitMenu] = useState(false);
    const [keyboardInset, setKeyboardInset] = useState(0);
    const unitLabel = normalizeUnitLabel(unit);
    const previousLabel = formatPreviousSet(previousSet, previousUnit, unit);
    const isBodyweight = normalizeUnitKey(unit) === "BW" || String(set.weight || "").toUpperCase() === "BW";
    const currentUnitKey = normalizeUnitKey(unit);
    const targetRepsLabel = formatTargetRepsValue(set?.targetReps ?? set?.target_reps ?? set?.goalReps);

    useEffect(() => {
        if (!showUnitMenu) return undefined;

        const updateKeyboardInset = () => {
            const viewport = window.visualViewport;
            if (!viewport) {
                setKeyboardInset(0);
                return;
            }
            const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
            setKeyboardInset(inset);
        };

        updateKeyboardInset();
        window.visualViewport?.addEventListener("resize", updateKeyboardInset);
        window.visualViewport?.addEventListener("scroll", updateKeyboardInset);
        return () => {
            window.visualViewport?.removeEventListener("resize", updateKeyboardInset);
            window.visualViewport?.removeEventListener("scroll", updateKeyboardInset);
        };
    }, [showUnitMenu]);

    const inputWrapStyle = {
        position: "relative",
        minWidth: 0,
    };
    const weightControlStyle = {
        position: "relative",
        display: "grid",
        gridTemplateColumns: isBodyweight ? "1fr" : "minmax(78px, 1fr) 38px",
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
        padding: "11px 8px",
        color: "var(--text)",
        fontSize: 18,
        fontWeight: 900,
        textAlign: "center",
        boxSizing: "border-box",
        minWidth: 0,
        fontVariantNumeric: "tabular-nums",
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
        fontSize: 11,
        fontWeight: 900,
        padding: "0 4px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        whiteSpace: "nowrap",
    };
    const bodyweightChipStyle = {
        width: "100%",
        minHeight: 48,
        borderRadius: 16,
        border: "1px solid rgba(18, 199, 194, 0.30)",
        background: "linear-gradient(135deg, rgba(15, 94, 99, 0.50), rgba(18, 199, 194, 0.38))",
        color: "var(--text)",
        fontSize: 14,
        fontWeight: 900,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 8px 18px rgba(15, 94, 99, 0.10)",
        cursor: "pointer",
    };
    const repsSuffixStyle = {
        position: "absolute",
        right: 10,
        top: "50%",
        transform: "translateY(-50%)",
        color: "var(--text3)",
        fontSize: 11,
        fontWeight: 800,
        pointerEvents: "none",
    };
    const toggleUnitMenu = (event) => {
        event.preventDefault();
        event.stopPropagation();
        setShowUnitMenu((prev) => !prev);
    };
    const applyQuickUnit = (mode) => {
        setShowUnitMenu(false);
        if (typeof onWeightModeChange === "function") onWeightModeChange(mode);
    };
    const notifyInputFocus = (field) => {
        if (typeof onSetInputFocusChange !== "function") return;
        onSetInputFocusChange(`${inputId || `${ex?.name || "set"}-${idx}`}:${field}`);
    };
    const notifyInputBlur = () => {
        if (typeof onSetInputFocusChange !== "function") return;
        window.setTimeout(() => {
            const activeElement = document.activeElement;
            if (activeElement?.getAttribute?.("data-log-set-input") === "true") return;
            const viewport = window.visualViewport;
            const keyboardInset = viewport
                ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
                : 0;
            if (keyboardInset > 80) return;
            onSetInputFocusChange(null);
        }, 350);
    };
    const closeKeyboard = () => {
        setShowUnitMenu(false);
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
    };
    const quickBarBottom = keyboardInset > 0
        ? keyboardInset + 8
        : "calc(var(--bottom-nav-clearance, 96px) + 8px)";
    const quickBarOptionStyle = (mode) => {
        const selected = currentUnitKey === normalizeUnitKey(mode);
        return {
            minWidth: mode === "BW" ? 72 : 54,
            height: 38,
            borderRadius: 12,
            border: selected ? "1px solid rgba(18, 199, 194, 0.70)" : "1px solid var(--border2)",
            background: selected
                ? "linear-gradient(135deg, rgba(15, 94, 99, 0.96), rgba(18, 199, 194, 0.86))"
                : "var(--card2)",
            color: selected ? "#fff" : "var(--text2)",
            fontSize: 13,
            fontWeight: 900,
            boxShadow: selected ? "0 8px 18px rgba(18, 199, 194, 0.16)" : "none",
        };
    };

    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "30px minmax(48px, 0.48fr) minmax(126px, 1.42fr) minmax(78px, 0.82fr)",
                gap: 7,
                alignItems: "center",
                marginBottom: 10,
                padding: "9px",
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
                    width: 30,
                    height: 30,
                    borderRadius: 15,
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
                    fontSize: 11,
                    fontWeight: 750,
                    lineHeight: 1.28,
                    minWidth: 0,
                    whiteSpace: "normal",
                    overflowWrap: "anywhere",
                    opacity: 0.82,
                }}
            >
                {previousLabel}
            </div>

            {isBodyweight ? (
                <div style={weightControlStyle}>
                    <button
                        type="button"
                        onClick={toggleUnitMenu}
                        style={bodyweightChipStyle}
                    >
                        自重▼
                    </button>
                </div>
            ) : (
                <div style={weightControlStyle}>
                    <input
                        type="text"
                        inputMode="decimal"
                        data-log-set-input="true"
                        data-log-set-input-id={`${inputId || `${ex?.name || "set"}-${idx}`}:weight`}
                        value={set.weight}
                        onChange={(e) => setField(ex, idx, "weight", e.target.value)}
                        onFocus={() => {
                            setShowUnitMenu(false);
                            notifyInputFocus("weight");
                        }}
                        onBlur={notifyInputBlur}
                        placeholder="0"
                        style={weightInputStyle}
                    />
                    <button type="button" onClick={toggleUnitMenu} style={unitChipStyle}>
                        {unitLabel}▼
                    </button>
                </div>
            )}

            <div style={inputWrapStyle}>
                <input
                    type="text"
                    inputMode="numeric"
                    data-log-set-input="true"
                    data-log-set-input-id={`${inputId || `${ex?.name || "set"}-${idx}`}:reps`}
                    value={set.reps}
                    onChange={(e) => setField(ex, idx, "reps", e.target.value)}
                    onFocus={() => notifyInputFocus("reps")}
                    onBlur={notifyInputBlur}
                    placeholder="0"
                    style={{ ...inputStyle, paddingRight: 28, boxShadow: "var(--shadow-soft)" }}
                />
                <span style={repsSuffixStyle}>回</span>
                {targetRepsLabel && (
                    <div style={{
                        marginTop: 4,
                        color: "var(--text3)",
                        fontSize: 10,
                        fontWeight: 850,
                        textAlign: "center",
                        lineHeight: 1.15,
                    }}>
                        目標 {targetRepsLabel}回
                    </div>
                )}
            </div>

            {showUnitMenu && (
                <div
                    onMouseDown={(event) => event.preventDefault()}
                    style={{
                        position: "fixed",
                        left: "50%",
                        bottom: quickBarBottom,
                        transform: "translateX(-50%)",
                        zIndex: 260,
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        padding: "7px",
                        borderRadius: 18,
                        border: "1px solid var(--border2)",
                        background: "var(--card)",
                        boxShadow: "0 14px 34px rgba(0, 0, 0, 0.20)",
                    }}
                >
                    <button type="button" onClick={() => applyQuickUnit("BW")} style={quickBarOptionStyle("BW")}>自重</button>
                    <button type="button" onClick={() => applyQuickUnit("kg")} style={quickBarOptionStyle("kg")}>kg</button>
                    <button type="button" onClick={() => applyQuickUnit("lbs")} style={quickBarOptionStyle("lbs")}>lb</button>
                    <button
                        type="button"
                        onClick={closeKeyboard}
                        style={{
                            minWidth: 58,
                            height: 38,
                            borderRadius: 12,
                            border: "1px solid rgba(18, 199, 194, 0.32)",
                            background: "rgba(18, 199, 194, 0.10)",
                            color: "var(--accent)",
                            fontSize: 13,
                            fontWeight: 900,
                        }}
                    >
                        完了
                    </button>
                </div>
            )}
        </div>
    );
}
