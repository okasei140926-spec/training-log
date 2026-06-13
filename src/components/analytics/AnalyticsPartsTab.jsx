import { Bar, BarChart, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import PeriodSegmentedControl from "./PeriodSegmentedControl";
import BodyPartChartTooltip from "./BodyPartChartTooltip";
import {
  SUMMARY_SCOPE_OPTIONS,
  BODY_PART_CHART_BG,
  BODY_PART_CHART_GRID,
  getBodyPartDisplayLabel,
  getBodyPartChartFill,
} from "./analyticsUtils";

export default function AnalyticsPartsTab({
  overviewScope,
  setOverviewScope,
  overviewSummary,
  overviewBodyPartStats,
}) {
  return (
    <div style={{ background: "var(--card)", borderRadius: 22, padding: 18, border: "1px solid rgba(18, 199, 194, 0.10)", boxShadow: "var(--shadow-card)" }}>
      <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)", marginBottom: 12 }}>部位別ボリューム</div>
      <PeriodSegmentedControl
        options={SUMMARY_SCOPE_OPTIONS}
        value={overviewScope}
        onChange={setOverviewScope}
        style={{ marginBottom: 14 }}
      />
      <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 14 }}>{overviewSummary.rangeLabel}</div>

      {(overviewBodyPartStats || []).length > 0 ? (
        <ResponsiveContainer width="100%" height={Math.max(250, Math.min(360, 160 + overviewBodyPartStats.length * 18))}>
          <BarChart
            data={overviewBodyPartStats.map((item, index) => ({
              label: getBodyPartDisplayLabel(item.bodyPart),
              volume: Math.round(item.volume || 0),
              fill: getBodyPartChartFill(index),
            }))}
            margin={{ top: 10, right: 10, left: 4, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={BODY_PART_CHART_GRID} vertical={false} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "var(--text2)", fontWeight: 700 }}
              interval={0}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "var(--text3)" }}
              width={44}
              tickFormatter={(v) => `${(v / 1000).toFixed(v >= 1000 ? 1 : 0)}k`}
            />
            <Tooltip
              content={<BodyPartChartTooltip valueLabel="Volume" formatter={(value) => `${Number(value || 0).toLocaleString("ja-JP")}kg`} />}
              cursor={{ fill: "rgba(15, 94, 99, 0.055)", radius: 12 }}
            />
            <Bar dataKey="volume" radius={[10, 10, 0, 0]} background={{ fill: BODY_PART_CHART_BG, radius: 10 }}>
              {overviewBodyPartStats.map((item, index) => (
                <Cell key={item.bodyPart} fill={getBodyPartChartFill(index)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ color: "var(--text2)", fontSize: 13 }}>まだデータがありません</div>
      )}
    </div>
  );
}
