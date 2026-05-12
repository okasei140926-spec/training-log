import { forwardRef } from "react";
import {
  formatSetCountByBodyPart,
  getSetCountTotal,
} from "../../utils/setCountByBodyPart";

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
const formatAverageVolume = (totalVolume, workoutCount) =>
  `${Math.round(workoutCount > 0 ? Number(totalVolume || 0) / workoutCount : 0).toLocaleString("ja-JP")}kg/回`;

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

const TrainingSummaryShareCard = forwardRef(function TrainingSummaryShareCard(
  { summary, sizeKey = "square" },
  ref
) {
  const preset = PRESET_STYLES[sizeKey] || PRESET_STYLES.square;
  const isStory = sizeKey === "story";
  const setCountSummary =
    formatSetCountByBodyPart(summary.setCountByBodyPart, {
      sort: "count",
      maxParts: 3,
      separator: "\n",
      suffix: "セット",
    }) || "まだありません";
  const totalSetCount = getSetCountTotal(summary.setCountByBodyPart || []);
  const topProgress = summary.prUpdates?.[0] || null;
  const summaryTitle = summary.group === "monthly" ? "月間サマリー" : "週間サマリー";
  const growthLabel = topProgress
    ? `${topProgress.exerciseName}\n+${Math.round(Number(topProgress.diffKg || 0) * 10) / 10}kg`
    : "記録なし";

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
            {summaryTitle}
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: isStory ? 8 : 12, flex: 1 }}>
        {renderMetric("ワークアウト", `${summary.workoutCount}回`)}
        {renderMetric("総ボリューム", formatVolume(summary.totalVolume))}
        {renderMetric("平均ボリューム", formatAverageVolume(summary.totalVolume, summary.workoutCount))}
        {renderMetric("合計セット", `${totalSetCount}セット`)}
        {renderMetric(
          "部位別セット",
          <div style={{ display: "grid", gap: 4 }}>
            <div>{setCountSummary}</div>
          </div>
        )}
        {renderMetric("一番伸びた種目", growthLabel)}
      </div>

      <div style={{ marginTop: isStory ? 8 : 10, fontSize: 11, color: "rgba(255,255,255,0.5)", letterSpacing: 2 }}>
        PUMP
      </div>
    </div>
  );
});

export default TrainingSummaryShareCard;
