import { Bar, BarChart, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import PeriodSegmentedControl from "./PeriodSegmentedControl";
import BodyPartChartTooltip from "./BodyPartChartTooltip";
import {
  SUMMARY_SCOPE_OPTIONS,
  BODY_PART_CHART_BG,
  BODY_PART_CHART_GRID,
} from "./analyticsUtils";

function OverviewMetricButton({ metricKey, label, value, accent, accentColor = "var(--accent)", valueNode = null, compactValue = false, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(metricKey)}
      key={label}
      style={{
        background: "var(--card)",
        borderRadius: 18,
        padding: "14px 14px 12px",
        border: "1px solid rgba(18, 199, 194, 0.10)",
        boxShadow: "var(--shadow-soft)",
        textAlign: "left",
        position: "relative",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          fontSize: 11,
          color: "var(--text3)",
          fontWeight: 800,
        }}
      >
        詳細
      </div>
      <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>{label}</div>
      {valueNode ? (
        <div
          style={{
            fontSize: compactValue ? 13 : 24,
            fontWeight: compactValue ? 700 : 800,
            color: "var(--text)",
            lineHeight: compactValue ? 1.45 : 1.1,
            whiteSpace: "pre-line",
          }}
        >
          {valueNode}
        </div>
      ) : (
        <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text)" }}>{value}</div>
      )}
      {accent && (
        <div style={{ fontSize: 11, color: accentColor, fontWeight: 700, marginTop: 6 }}>
          {accent}
        </div>
      )}
    </button>
  );
}

export default function AnalyticsOverviewTab({
  overviewScope,
  setOverviewScope,
  overviewSummary,
  totalOverviewSets,
  overviewBodyPartChart,
  setSelectedOverviewMetric,
  setActiveSummaryKey,
}) {
  return (
    <>
      <PeriodSegmentedControl
        options={SUMMARY_SCOPE_OPTIONS}
        value={overviewScope}
        onChange={setOverviewScope}
      />

      <div style={{ textAlign: "center", fontSize: 12, color: "var(--text2)", fontWeight: 700, marginBottom: 4 }}>
        {overviewSummary.rangeLabel}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        {[
          {
            key: "volume",
            label: "Volume",
            value: `${overviewSummary.totalVolume.toLocaleString("ja-JP")}kg`,
            accent: overviewSummary.shortLabel,
          },
          {
            key: "workouts",
            label: "トレーニング",
            value: `${overviewSummary.workoutCount}回`,
            accent: overviewSummary.shortLabel,
          },
          {
            key: "exercises",
            label: "種目数",
            value: `${overviewSummary.exerciseCount || 0}種目`,
            compactValue: false,
            accent: null,
          },
          {
            key: "sets",
            label: "セット数",
            value: `${totalOverviewSets}セット`,
            accent: null,
          },
        ].map((item) => (
          <OverviewMetricButton
            key={item.key}
            metricKey={item.key}
            label={item.label}
            value={item.value}
            accent={item.accent}
            accentColor={item.accentColor}
            valueNode={item.valueNode}
            compactValue={item.compactValue}
            onSelect={setSelectedOverviewMetric}
          />
        ))}
      </div>

      <div style={{ background: "var(--card)", borderRadius: 22, padding: 18, border: "1px solid rgba(18, 199, 194, 0.10)", boxShadow: "var(--shadow-card)" }}>
        <div style={{ marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>部位別セット</div>
            <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4 }}>
              {overviewSummary.rangeLabel}
            </div>
          </div>
        </div>

        {overviewBodyPartChart.length > 0 ? (
          <>
            <div style={{ fontSize: 12, color: "var(--text3)", fontWeight: 700, marginBottom: 10 }}>
              合計 {totalOverviewSets}セット
            </div>
            <ResponsiveContainer width="100%" height={Math.max(250, Math.min(360, 160 + overviewBodyPartChart.length * 18))}>
              <BarChart data={overviewBodyPartChart} margin={{ top: 10, right: 10, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={BODY_PART_CHART_GRID} vertical={false} />
                <XAxis
                  dataKey="label"
                  type="category"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "var(--text2)", fontWeight: 700 }}
                  interval={0}
                />
                <YAxis
                  type="number"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "var(--text3)" }}
                  width={34}
                  allowDecimals={false}
                />
                <Tooltip
                  content={<BodyPartChartTooltip valueLabel="セット数" formatter={(value) => `${Math.round(Number(value) || 0)}セット`} />}
                  cursor={{ fill: "rgba(15, 94, 99, 0.055)", radius: 12 }}
                />
                <Bar
                  dataKey="sets"
                  radius={[10, 10, 0, 0]}
                  background={{ fill: BODY_PART_CHART_BG, radius: 10 }}
                >
                  {overviewBodyPartChart.map((item) => (
                    <Cell key={item.label} fill={item.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </>
        ) : (
          <div
            style={{
              background: "linear-gradient(180deg, var(--card2), var(--card))",
              borderRadius: 18,
              padding: "36px 14px",
              border: "1px dashed rgba(18, 199, 194, 0.22)",
              textAlign: "center",
              fontSize: 13,
              color: "var(--text2)",
              lineHeight: 1.6,
            }}
          >
            まだデータがありません
          </div>
        )}
      </div>

      <div style={{
        background: "var(--card)",
        borderRadius: 22,
        padding: 16,
        border: "1px solid rgba(18, 199, 194, 0.10)",
        boxShadow: "var(--shadow-card)",
      }}>
        <div style={{ fontSize: 17, fontWeight: 900, color: "var(--text)", marginBottom: 4 }}>
          サマリーをシェア
        </div>
        <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 12 }}>
          Instagramやストーリー用に記録サマリーを作成します
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          <button
            type="button"
            onClick={() => setActiveSummaryKey("weekly")}
            style={{
              padding: "14px 10px",
              borderRadius: 16,
              border: "1px solid rgba(18, 199, 194, 0.18)",
              background: "linear-gradient(180deg, var(--card2), var(--card))",
              color: "var(--text)",
              fontSize: 13,
              fontWeight: 900,
            }}
          >
            週間サマリー
          </button>

          <button
            type="button"
            onClick={() => setActiveSummaryKey("monthly")}
            style={{
              padding: "14px 10px",
              borderRadius: 16,
              border: "1px solid var(--success-border)",
              background: "var(--success-soft)",
              color: "var(--accent)",
              fontSize: 13,
              fontWeight: 900,
            }}
          >
            月間サマリー
          </button>
        </div>
      </div>
    </>
  );
}
