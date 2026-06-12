export default function PeriodSegmentedControl({
  options = [],
  value,
  onChange,
  scroll = false,
  style = {},
}) {
  const getOptionValue = (option) => option.value ?? option.key ?? option.month ?? option.days;

  return (
    <div
      style={{
        display: scroll ? "flex" : "grid",
        gridTemplateColumns: scroll ? undefined : `repeat(${Math.max(options.length, 1)}, minmax(0, 1fr))`,
        gap: 8,
        width: "100%",
        padding: 6,
        borderRadius: 999,
        background: "var(--card)",
        border: "1px solid rgba(18, 199, 194, 0.10)",
        boxShadow: "var(--shadow-soft)",
        overflowX: scroll ? "auto" : "visible",
        WebkitOverflowScrolling: scroll ? "touch" : undefined,
        scrollbarWidth: scroll ? "none" : undefined,
        ...style,
      }}
    >
      {options.map((option) => {
        const optionValue = getOptionValue(option);
        const selected = value === optionValue;
        return (
          <button
            key={optionValue}
            type="button"
            onClick={() => onChange?.(optionValue)}
            style={{
              flex: scroll ? "0 0 auto" : undefined,
              minWidth: scroll ? 92 : 0,
              minHeight: 44,
              padding: "10px 14px",
              borderRadius: 999,
              border: selected ? "1px solid transparent" : "1px solid rgba(18, 199, 194, 0.12)",
              background: selected ? "linear-gradient(135deg, #0F5E63, #12C7C2)" : "var(--card2)",
              color: selected ? "#fff" : "var(--text2)",
              fontSize: 13,
              fontWeight: 900,
              cursor: "pointer",
              boxShadow: selected ? "0 10px 22px rgba(15, 94, 99, 0.12)" : "none",
              whiteSpace: "nowrap",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
