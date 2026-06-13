export default function OverviewMetricModal({ activeOverviewMetric, onClose }) {
  if (!activeOverviewMetric) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 999,
        padding: "16px",
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 430,
          background: "var(--card)",
          borderRadius: 20,
          padding: "18px 16px calc(20px + var(--safe-bottom, 0px))",
          border: "1px solid var(--border2)",
          maxHeight: "70vh",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            width: 44,
            height: 5,
            borderRadius: 999,
            background: "var(--border2)",
            margin: "0 auto 14px",
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>
              {activeOverviewMetric.title}
            </div>
            <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4 }}>
              {activeOverviewMetric.rangeLabel}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text3)",
              fontSize: 20,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {activeOverviewMetric.summaryRows?.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: activeOverviewMetric.summaryRows.length > 1 ? "repeat(2, minmax(0, 1fr))" : "1fr",
              gap: 8,
              marginBottom: 16,
            }}
          >
            {activeOverviewMetric.summaryRows.map((row) => (
              <div
                key={row.label}
                style={{
                  background: "linear-gradient(180deg, var(--card2), var(--card))",
                  borderRadius: 16,
                  padding: "12px 13px",
                  border: "1px solid rgba(18, 199, 194, 0.10)",
                }}
              >
                <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>
                  {row.label}
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>
                  {row.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeOverviewMetric.empty ? (
          <div
            style={{
              background: "linear-gradient(180deg, var(--card2), var(--card))",
              borderRadius: 18,
              padding: "18px 14px",
              border: "1px dashed rgba(18, 199, 194, 0.24)",
              textAlign: "center",
              fontSize: 13,
              color: "var(--text2)",
              lineHeight: 1.5,
            }}
          >
            まだデータがありません
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {activeOverviewMetric.sections?.map((section) => (
              <div key={section.title}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text3)", marginBottom: 8 }}>
                  {section.title}
                </div>
                {section.items?.length ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {section.items.map((item) => (
                      <div
                        key={item.key}
                        style={{
                          background: "linear-gradient(180deg, var(--card2), var(--card))",
                          borderRadius: 16,
                          padding: "11px 12px",
                          border: "1px solid rgba(18, 199, 194, 0.10)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: item.meta || item.onAction ? 4 : 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", minWidth: 0 }}>
                            {item.title}
                          </div>
                          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", flexShrink: 0 }}>
                            {item.value}
                          </div>
                        </div>
                        {(item.meta || item.onAction) && (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                            <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.45 }}>
                              {item.meta}
                            </div>
                            {item.onAction && (
                              <button
                                type="button"
                                onClick={item.onAction}
                                style={{
                                  padding: "6px 10px",
                                  borderRadius: 999,
                                  border: "1px solid rgba(18, 199, 194, 0.12)",
                                  background: "var(--card)",
                                  color: "var(--accent)",
                                  fontSize: 11,
                                  fontWeight: 800,
                                  flexShrink: 0,
                                }}
                              >
                                {item.actionLabel || "詳細"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: "var(--text2)" }}>
                    まだデータがありません
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
