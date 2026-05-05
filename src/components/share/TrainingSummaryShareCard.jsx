import { forwardRef } from "react";

const PRESET_STYLES = {
  square: {
    width: 360,
    height: 360,
  },
  story: {
    width: 360,
    height: 640,
  },
};

const formatVolume = (value) => `${Math.round(Number(value || 0)).toLocaleString("ja-JP")}kg`;

const renderMetric = (label, value) => (
  <div
    key={label}
    style={{
      background: "rgba(24, 24, 27, 0.78)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 18,
      padding: "12px 14px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
    }}
  >
    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.65)", letterSpacing: 1.4 }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 900, color: "#fff" }}>{value}</div>
  </div>
);

const TrainingSummaryShareCard = forwardRef(function TrainingSummaryShareCard(
  { summary, sizeKey = "square" },
  ref
) {
  const preset = PRESET_STYLES[sizeKey] || PRESET_STYLES.square;
  const maxTrend = Math.max(...summary.trend.map((item) => item.volume), 1);

  return (
    <div
      ref={ref}
      style={{
        width: preset.width,
        height: preset.height,
        borderRadius: 30,
        overflow: "hidden",
        background: "radial-gradient(circle at top right, rgba(249,115,22,0.28), transparent 32%), linear-gradient(160deg, #09090b 0%, #18181b 38%, #27272a 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 30px 60px rgba(15, 23, 42, 0.28)",
        display: "flex",
        flexDirection: "column",
        padding: sizeKey === "story" ? "24px 24px 26px" : "20px 20px 22px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 2.8, color: "rgba(255,255,255,0.6)", marginBottom: 8 }}>PUMP</div>
          <div style={{ fontSize: sizeKey === "story" ? 28 : 24, fontWeight: 900, color: "#fff", marginBottom: 6 }}>
            {summary.shareLabel}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.78)" }}>{summary.rangeLabel}</div>
        </div>
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 999,
            background: "rgba(249,115,22,0.14)",
            border: "1px solid rgba(249,115,22,0.32)",
            color: "#FDBA74",
            fontSize: 11,
            fontWeight: 800,
          }}
        >
          {summary.shortLabel}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginBottom: 16 }}>
        {renderMetric("WORKOUTS", `${summary.workoutCount}回`)}
        {renderMetric("VOLUME", formatVolume(summary.totalVolume))}
        {renderMetric("EXERCISES", `${summary.exerciseCount}種目`)}
        {renderMetric("TOP BODY PART", summary.topBodyPart)}
        {renderMetric("PR UPDATES", `${summary.prUpdateCount}件`)}
        {renderMetric("STREAK", `${summary.streak}日`)}
      </div>

      <div
        style={{
          background: "rgba(24, 24, 27, 0.78)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 20,
          padding: "14px 14px 12px",
          marginBottom: 14,
        }}
      >
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", letterSpacing: 1.4, marginBottom: 12 }}>
          VOLUME TREND
        </div>
        {summary.trend.length > 0 ? (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: sizeKey === "story" ? 136 : 92 }}>
            {summary.trend.map((item) => (
              <div key={item.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <div
                  style={{
                    width: "100%",
                    height: `${Math.max((item.volume / maxTrend) * 100, 8)}%`,
                    borderRadius: 999,
                    background: "linear-gradient(180deg, #FB923C 0%, #F97316 100%)",
                    boxShadow: "0 8px 20px rgba(249,115,22,0.22)",
                  }}
                />
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.72)" }}>{item.label}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.72)" }}>この期間の記録はまだありません</div>
        )}
      </div>

      <div
        style={{
          background: "rgba(24, 24, 27, 0.78)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 20,
          padding: "14px 14px 12px",
          flex: 1,
          minHeight: 0,
        }}
      >
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", letterSpacing: 1.4, marginBottom: 10 }}>
          HIGHLIGHTS
        </div>
        {summary.highlights.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {summary.highlights.map((item) => (
              <div
                key={item.key}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 16,
                  background: "rgba(255,255,255,0.04)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.exerciseName}
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.62)", marginTop: 3 }}>
                    {item.bodyPart} · {item.setCount}セット
                  </div>
                </div>
                <div style={{ flexShrink: 0, textAlign: "right" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#FDBA74" }}>{formatVolume(item.volume)}</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.62)", marginTop: 3 }}>
                    最大 {Math.round(Number(item.maxWeight || 0) * 10) / 10 || 0}kg
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.72)" }}>ハイライト種目はまだありません</div>
        )}
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: "rgba(255,255,255,0.5)", letterSpacing: 2 }}>
        PUMP
      </div>
    </div>
  );
});

export default TrainingSummaryShareCard;
