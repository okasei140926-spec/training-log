const BodyPartChartTooltip = ({ active, payload, label, valueLabel, unit, formatter }) => {
  if (!active || !payload?.length) return null;
  const rawValue = Number(payload[0]?.value || 0);
  const displayValue = formatter ? formatter(rawValue) : `${rawValue.toLocaleString("ja-JP")}${unit || ""}`;

  return (
    <div
      style={{
        background: "linear-gradient(180deg, var(--card), var(--card2))",
        border: "1px solid rgba(18, 199, 194, 0.18)",
        borderRadius: 16,
        boxShadow: "0 14px 32px rgba(15, 94, 99, 0.14)",
        padding: "11px 13px",
        minWidth: 132,
      }}
    >
      <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 900, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ color: "var(--text2)", fontSize: 12, fontWeight: 700 }}>
        {valueLabel}：<span style={{ color: "var(--accent)", fontSize: 15, fontWeight: 900 }}>{displayValue}</span>
      </div>
    </div>
  );
};

export default BodyPartChartTooltip;
