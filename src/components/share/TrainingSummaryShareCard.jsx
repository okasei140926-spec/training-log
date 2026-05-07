import { forwardRef } from "react";
import {
  formatExerciseCountByBodyPart,
  getExerciseCountTotal,
} from "../../utils/exerciseCountByBodyPart";

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
    <div style={{ fontSize: 18, fontWeight: 900, color: "#fff", lineHeight: 1.35 }}>{value}</div>
  </div>
);

const buildTrendLabels = (trend = [], isWeekly) => {
  if (isWeekly) {
    return trend.map((item) => ({ ...item, displayLabel: item.label }));
  }

  const count = trend.length;
  if (count <= 6) {
    return trend.map((item) => ({ ...item, displayLabel: item.label }));
  }

  const step = Math.max(1, Math.ceil((count - 1) / 3));
  return trend.map((item, index) => ({
    ...item,
    displayLabel:
      index === 0 || index === count - 1 || index % step === 0
        ? item.label
        : "",
  }));
};

const TrainingSummaryShareCard = forwardRef(function TrainingSummaryShareCard(
  { summary, sizeKey = "square" },
  ref
) {
  const preset = PRESET_STYLES[sizeKey] || PRESET_STYLES.square;
  const maxTrend = Math.max(...summary.trend.map((item) => item.volume), 1);
  const isStory = sizeKey === "story";
  const isWeekly = summary.group === "weekly";
  const trendItems = buildTrendLabels(summary.trend, isWeekly);
  const storyHighlights = summary.highlights.slice(0, 2);
  const exerciseCountSummary =
    formatExerciseCountByBodyPart(summary.exerciseCountByBodyPart, {
      sort: "count",
      maxParts: 2,
      separator: " / ",
      suffix: "",
    }) || "まだありません";
  const totalExerciseCount = getExerciseCountTotal(summary.exerciseCountByBodyPart || []);

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
        padding: isStory ? "20px 20px 20px" : "22px 22px 20px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: isStory ? 14 : 16 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 2.8, color: "rgba(255,255,255,0.6)", marginBottom: isStory ? 6 : 8 }}>PUMP</div>
          <div style={{ fontSize: isStory ? 26 : 30, fontWeight: 900, color: "#fff", marginBottom: 6, lineHeight: isStory ? 1.02 : 1.08 }}>
            {summary.shareLabel}
          </div>
          <div style={{ fontSize: isStory ? 12 : 13, color: "rgba(255,255,255,0.78)" }}>{summary.rangeLabel}</div>
        </div>
        <div
          style={{
            padding: isStory ? "7px 11px" : "8px 12px",
            borderRadius: 999,
            background: "rgba(249,115,22,0.14)",
            border: "1px solid rgba(249,115,22,0.32)",
            color: "#FDBA74",
            fontSize: isStory ? 10 : 11,
            fontWeight: 800,
          }}
        >
          {summary.shortLabel}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: isStory ? 8 : 12, marginBottom: isStory ? 12 : 16 }}>
        {renderMetric("WORKOUTS", `${summary.workoutCount}回`)}
        {renderMetric("VOLUME", formatVolume(summary.totalVolume))}
        {renderMetric(
          "EXERCISES",
          <div style={{ display: "grid", gap: 4 }}>
            <div>{exerciseCountSummary}</div>
            {totalExerciseCount > 0 && (
              <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.68)" }}>
                合計 {totalExerciseCount}種目
              </div>
            )}
          </div>
        )}
        {renderMetric("MOST TRAINED", summary.topBodyPart)}
        {renderMetric("PR UPDATES", `${summary.prUpdateCount}件`)}
        {renderMetric("STREAK", `${summary.streak}日`)}
      </div>

      {isStory && (
        <div
          style={{
            background: "rgba(24, 24, 27, 0.78)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 20,
            padding: "12px 12px 10px",
            marginBottom: 10,
          }}
        >
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.65)", letterSpacing: 1.4, marginBottom: 10 }}>
            VOLUME TREND
          </div>
          {trendItems.length > 0 ? (
            <div style={{ display: "flex", alignItems: "flex-end", gap: trendItems.length > 10 ? 4 : 6, height: 112 }}>
              {trendItems.map((item) => (
                <div
                  key={item.date}
                  style={{
                    flex: 1,
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: 6,
                    minWidth: 0,
                  }}
                >
                  <div style={{ width: "100%", flex: 1, display: "flex", alignItems: "flex-end" }}>
                    <div
                      style={{
                        width: "100%",
                        height: `${Math.max((item.volume / maxTrend) * 100, 8)}%`,
                        borderRadius: 999,
                        background:
                          item.volume > 0
                            ? "linear-gradient(180deg, #FB923C 0%, #F97316 100%)"
                            : "rgba(255,255,255,0.08)",
                        boxShadow:
                          item.volume > 0 ? "0 8px 20px rgba(249,115,22,0.22)" : "none",
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 8, color: "rgba(255,255,255,0.72)", minHeight: 10 }}>
                    {item.displayLabel}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.72)" }}>この期間の記録はまだありません</div>
          )}
        </div>
      )}

      {isStory && (
        <div
          style={{
            background: "rgba(24, 24, 27, 0.78)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 20,
            padding: "12px 12px 10px",
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.65)", letterSpacing: 1.4, marginBottom: 8 }}>
            HIGHLIGHTS
          </div>
          {storyHighlights.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {storyHighlights.map((item) => (
                <div
                  key={item.key}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "9px 10px",
                    borderRadius: 16,
                    background: "rgba(255,255,255,0.04)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.exerciseName}
                    </div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.62)", marginTop: 3 }}>
                      {item.bodyPart} · {item.setCount}セット
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: "right" }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: "#FDBA74" }}>{formatVolume(item.volume)}</div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.62)", marginTop: 3 }}>
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
      )}

      <div style={{ marginTop: isStory ? 8 : 10, fontSize: 11, color: "rgba(255,255,255,0.5)", letterSpacing: 2 }}>
        PUMP
      </div>
    </div>
  );
});

export default TrainingSummaryShareCard;
