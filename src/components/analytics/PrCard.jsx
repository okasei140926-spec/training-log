import { formatDate, formatPrSetLabel } from "./analyticsUtils";

export default function PrCard({ item, compact = false, hideEstimated1RM = false, selectedExerciseKey, onSelect }) {
  const isSelected = Boolean(item?.key && item.key === selectedExerciseKey);
  const sharedStyle = {
    width: "100%",
    textAlign: "left",
    background: isSelected
      ? "linear-gradient(135deg, rgba(15, 94, 99, 0.16), rgba(18, 199, 194, 0.14))"
      : compact ? "linear-gradient(180deg, var(--info-soft), var(--card))" : "var(--card2)",
    borderRadius: 16,
    padding: compact ? "12px 14px" : "11px 12px",
    border: isSelected
      ? "1px solid var(--accent)"
      : compact ? "1px solid var(--info-border)" : "1px solid rgba(186, 230, 253, 0.65)",
    boxShadow: isSelected ? "0 12px 26px rgba(15, 94, 99, 0.14)" : compact ? "var(--shadow-card)" : "none",
    cursor: item ? "pointer" : "default",
  };

  if (!item) {
    return (
      <div style={sharedStyle}>
        <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>未記録</div>
        <div style={{ fontSize: compact ? 22 : 15, fontWeight: 800, color: "var(--text4)" }}>0kg</div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(item.key)}
      style={sharedStyle}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 4 }}>
        <div style={{ fontSize: compact ? 11 : 13, fontWeight: 700, color: "var(--text)" }}>
          {item.displayName || item.name}
        </div>
        {!hideEstimated1RM && (
          <div style={{ fontSize: compact ? 22 : 15, fontWeight: 800, color: "var(--text)" }}>
            {item.estimated1RM}kg
          </div>
        )}
      </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 12, color: "var(--text2)" }}>
        <span>{formatPrSetLabel(item)}</span>
        {item.date && <span>{formatDate(item.date)}</span>}
        {!compact && item.bodyPart && (
          <span style={{ padding: "0 6px", borderRadius: 999, background: "var(--info-soft)", border: "1px solid var(--info-border)", color: "var(--accent)", fontSize: 9, fontWeight: 700, lineHeight: 1.5 }}>
            {item.bodyPart}
          </span>
        )}
        {item.source === "manual" && (
          <span style={{ padding: "2px 8px", borderRadius: 999, background: "var(--success-soft)", border: "1px solid var(--success-border)", color: "var(--accent)", fontSize: 11, fontWeight: 700 }}>
            移行記録
          </span>
        )}
      </div>
    </button>
  );
}
