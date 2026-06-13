import { Bar, BarChart, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { PERIODS, formatDate, formatPrSetLabel } from "./analyticsUtils";

export default function PrDetailView({
  selectedExercise,
  screenScrollRef,
  handlePrDetailTouchStart,
  handlePrDetailTouchEnd,
  setSelectedExerciseKey,
  period,
  setPeriod,
  selectedChartData,
  selectedChartTicks,
  selectedChartDomain,
  selectedRecords,
}) {
  const compactChartTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const point = payload[0]?.payload;
    if (!point) return null;

    return (
      <div
        style={{
          background: "rgba(255,255,255,0.96)",
          border: "1px solid rgba(18, 199, 194, 0.16)",
          borderRadius: 12,
          boxShadow: "0 8px 18px rgba(15, 94, 99, 0.10)",
          padding: "8px 10px",
          minWidth: 74,
        }}
      >
        <div style={{ fontSize: 11, color: "var(--text2)", fontWeight: 700, marginBottom: 3 }}>
          {point.rawDate ? point.rawDate.slice(5).replace("-", "/") : point.date}
        </div>
        <div style={{ fontSize: 16, color: "var(--accent)", fontWeight: 900, lineHeight: 1.1 }}>
          {point.weight}kg
        </div>
        {point.setLabel && (
          <div style={{ fontSize: 11, color: "var(--text2)", fontWeight: 700, marginTop: 4 }}>
            {point.setLabel}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      key={selectedExercise.key}
      ref={screenScrollRef}
      onTouchStart={handlePrDetailTouchStart}
      onTouchEnd={handlePrDetailTouchEnd}
      style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}
    >
      <button
        onClick={() => setSelectedExerciseKey(null)}
        style={{ alignSelf: "flex-start", background: "none", border: "none", color: "var(--text2)", fontSize: 14, cursor: "pointer", padding: 0 }}
      >
        ← PR一覧に戻る
      </button>

      <div style={{ background: "var(--card)", borderRadius: 20, padding: 16, border: "1px solid var(--border2)", boxShadow: "var(--shadow-card)" }}>
        <div style={{ fontSize: 10, letterSpacing: 2.5, color: "var(--text3)", marginBottom: 10 }}>
          CURRENT PR
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)" }}>
            {selectedExercise.displayName || selectedExercise.name}
          </div>
          {selectedExercise.bodyPart && (
            <span style={{ padding: "1px 7px", borderRadius: 999, background: "var(--info-soft)", border: "1px solid var(--info-border)", color: "var(--accent)", fontSize: 9, fontWeight: 700, lineHeight: 1.45 }}>
              {selectedExercise.bodyPart}
            </span>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          <div style={{ background: "var(--card2)", borderRadius: 16, padding: 12, border: "1px solid var(--border2)" }}>
            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>現在PR</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text)" }}>{selectedExercise.estimated1RM}kg</div>
            <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 6 }}>
              {formatPrSetLabel(selectedExercise)}
            </div>
          </div>
          <div style={{ background: "var(--card2)", borderRadius: 16, padding: 12, border: "1px solid var(--border2)" }}>
            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>記録日</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>
              {formatDate(selectedExercise.date) || "日付なし"}
            </div>
            {selectedExercise.source === "manual" && (
              <div style={{ marginTop: 8, display: "inline-flex", padding: "3px 8px", borderRadius: 999, background: "var(--success-soft)", border: "1px solid var(--success-border)", color: "var(--accent)", fontSize: 11, fontWeight: 700 }}>
                移行記録
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ background: "var(--card)", borderRadius: 20, padding: 16, border: "1px solid var(--border2)", boxShadow: "var(--shadow-card)" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {PERIODS.map((item) => (
            <button
              key={item.days}
              onClick={() => setPeriod(item.days)}
              style={{
                flex: 1,
                padding: "9px 0",
                borderRadius: 12,
                border: period === item.days ? "1px solid transparent" : "1px solid var(--border2)",
                background: period === item.days ? "linear-gradient(135deg, var(--accent), #4ADE80)" : "var(--card)",
                color: period === item.days ? "#fff" : "var(--text2)",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: period === item.days ? "var(--shadow-soft)" : "var(--shadow-card)",
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {selectedChartData.length >= 2 ? (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={selectedChartData} margin={{ top: 8, right: 6, left: -10, bottom: 2 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(18, 199, 194, 0.10)" />
              <XAxis
                dataKey="date"
                ticks={selectedChartTicks}
                interval={0}
                tick={{ fontSize: 10, fill: "var(--text3)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={selectedChartDomain}
                tick={{ fontSize: 10, fill: "var(--text3)" }}
                axisLine={false}
                tickLine={false}
                width={40}
              />
              <Tooltip
                content={compactChartTooltip}
                cursor={{ stroke: "rgba(15, 94, 99, 0.18)", strokeWidth: 1.5 }}
              />
              <Line
                type="monotone"
                dataKey="weight"
                stroke="var(--accent)"
                strokeWidth={2.5}
                dot={(props) => {
                  const { cx, cy, payload } = props;
                  const emphasized = payload?.isLatest || payload?.isPeak;
                  return (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={emphasized ? 5 : 3.5}
                      fill={emphasized ? "#0F5E63" : "var(--accent)"}
                      stroke="#fff"
                      strokeWidth={emphasized ? 2 : 1.5}
                    />
                  );
                }}
                activeDot={{ r: 5.5, stroke: "#fff", strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ textAlign: "center", color: "var(--text3)", fontSize: 13, padding: "28px 0 18px" }}>
            まだ推移を表示するには記録が少ないです
          </div>
        )}
      </div>

      <div style={{ background: "var(--card)", borderRadius: 20, padding: 16, border: "1px solid var(--border2)", boxShadow: "var(--shadow-card)" }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text3)", marginBottom: 12 }}>
          過去記録一覧
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {selectedRecords.map((record) => (
            <div key={record.id} style={{ background: "var(--card2)", borderRadius: 16, padding: 12, border: "1px solid rgba(186, 230, 253, 0.65)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>
                  {formatDate(record.date) || "日付なし"}
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>
                  推定1RM {record.estimated1RM}kg
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 6 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>
                  {formatPrSetLabel(record)}
                </div>
                {record.bodyPart && (
                  <span style={{ padding: "2px 8px", borderRadius: 999, background: "var(--info-soft)", border: "1px solid var(--info-border)", color: "var(--accent)", fontSize: 11, fontWeight: 700 }}>
                    {record.bodyPart}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
                {record.setsText}
              </div>
              {record.source === "manual" && (
                <div style={{ marginTop: 8, display: "inline-flex", padding: "3px 8px", borderRadius: 999, background: "var(--success-soft)", border: "1px solid var(--success-border)", color: "var(--accent)", fontSize: 11, fontWeight: 700 }}>
                  移行記録
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
