import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import PeriodSegmentedControl from "./PeriodSegmentedControl";

export default function AnalyticsTrendsTab({ history, selectedTrendMonth, setSelectedTrendMonth }) {
  // 月別集計
  const monthlyMap = {};
  Object.values(history || {}).forEach((records) => {
    (records || []).forEach((record) => {
      if (!record.date) return;
      const month = record.date.slice(0, 7);
      if (!monthlyMap[month]) monthlyMap[month] = { volume: 0, sets: 0, workouts: new Set() };
      monthlyMap[month].volume += (record.sets || []).reduce((s, set) => {
        const w = Number(set.weight); const r = Number(set.reps);
        return s + (Number.isFinite(w) && Number.isFinite(r) ? w * r : 0);
      }, 0);
      monthlyMap[month].sets += (record.sets || []).length || 1;
      monthlyMap[month].workouts.add(record.date);
    });
  });
  const sortedMonthlyEntries = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b));
  const hasMultipleYears = new Set(sortedMonthlyEntries.map(([month]) => month.slice(0, 4))).size > 1;
  const formatMonthLabel = (month) => {
    const year = month.slice(0, 4);
    const monthNumber = Number(month.slice(5));
    return hasMultipleYears ? `${year}/${monthNumber}` : `${monthNumber}月`;
  };
  const monthlyList = sortedMonthlyEntries
    .map(([month, data]) => ({
      month,
      label: formatMonthLabel(month),
      volume: Math.round(data.volume),
      sets: data.sets,
      workouts: data.workouts.size,
    }));
  const monthlyTableList = monthlyList.slice().reverse();
  const latestTrendMonth = monthlyTableList[0]?.month || null;
  const selectedMonthExists = selectedTrendMonth && monthlyList.some((item) => item.month === selectedTrendMonth);
  const activeTrendMonth = selectedMonthExists ? selectedTrendMonth : latestTrendMonth;
  const activeTrendData = monthlyList.find((item) => item.month === activeTrendMonth) || monthlyTableList[0] || null;
  const activeTrendIndex = monthlyList.findIndex((item) => item.month === activeTrendMonth);
  const previousTrendData = activeTrendIndex > 0 ? monthlyList[activeTrendIndex - 1] : null;
  const selectedVolDiff =
    previousTrendData && previousTrendData.volume > 0 && activeTrendData
      ? Math.round(((activeTrendData.volume - previousTrendData.volume) / previousTrendData.volume) * 100)
      : null;
  const maxMonthlyVolume = Math.max(0, ...monthlyList.map((item) => Number(item.volume) || 0));
  const yStep = maxMonthlyVolume > 50000 ? 20000 : maxMonthlyVolume > 10000 ? 5000 : 1000;
  const yUpper = Math.max(yStep, Math.ceil(maxMonthlyVolume / yStep) * yStep);
  const yLower = -Math.max(Math.round(yUpper * 0.08), Math.round(yStep * 0.4));
  const yTicks = Array.from({ length: Math.floor(yUpper / yStep) + 1 }, (_, index) => index * yStep);

  return (
    <>
      <div style={{ background: "var(--card)", borderRadius: 22, padding: 18, border: "1px solid rgba(18, 199, 194, 0.10)", boxShadow: "var(--shadow-card)" }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)", marginBottom: 14 }}>推移</div>
        {monthlyTableList.length > 0 ? (
          <PeriodSegmentedControl
            options={monthlyTableList.map((monthItem) => ({
              key: monthItem.month,
              label: monthItem.label,
            }))}
            value={activeTrendMonth}
            onChange={setSelectedTrendMonth}
            scroll
            style={{ marginBottom: 12 }}
          />
        ) : (
          <div style={{ color: "var(--text3)", fontSize: 12, marginBottom: 12 }}>月別データがありません</div>
        )}
        <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 14 }}>{activeTrendData?.label || "-"}</div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginBottom: 20 }}>
          {[
            { label: "Volume", value: `${(activeTrendData?.volume || 0).toLocaleString("ja-JP")}kg`, diff: selectedVolDiff, sub: activeTrendData?.label || "-" },
            { label: "セット数", value: `${activeTrendData?.sets || 0}set`, diff: null, sub: activeTrendData?.label || "-" },
            { label: "トレ回数", value: `${activeTrendData?.workouts || 0}回`, diff: null, sub: activeTrendData?.label || "-" },
          ].map((card) => (
            <div key={card.label} style={{ borderRadius: 16, border: "1px solid rgba(18, 199, 194, 0.10)", background: "linear-gradient(180deg, var(--card2), var(--card))", padding: "12px 10px" }}>
              <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 4 }}>{card.label}</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text)" }}>{card.value}</div>
              {card.diff !== null && (
                <div style={{ fontSize: 10, fontWeight: 800, color: card.diff >= 0 ? "var(--accent)" : "#ff6b6b", marginTop: 3 }}>
                  前月比 {card.diff >= 0 ? "+" : ""}{card.diff}%
                </div>
              )}
            </div>
          ))}
        </div>

        {monthlyList.length > 0 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", marginBottom: 10 }}>Volumeの推移</div>
            <ResponsiveContainer width="100%" height={205}>
              <LineChart data={monthlyList} margin={{ top: 8, right: 12, left: 4, bottom: 22 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(18, 199, 194, 0.10)" vertical={false} />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "var(--text2)", fontWeight: 700 }}
                  interval={monthlyList.length > 8 ? "preserveStartEnd" : 0}
                  minTickGap={0}
                  padding={{ left: 10, right: 10 }}
                  dy={8}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "var(--text3)" }}
                  width={40}
                  domain={[yLower, yUpper]}
                  ticks={yTicks}
                  tickFormatter={(v) => `${Math.round(v/1000)}k`}
                />
                <Tooltip
                  contentStyle={{ background: "var(--card)", border: "1px solid rgba(18, 199, 194, 0.12)", borderRadius: 14, fontSize: 12 }}
                  formatter={(v) => [`${Number(v).toLocaleString("ja-JP")}kg`, "Volume"]}
                  labelFormatter={(_label, payload) => payload?.[0]?.payload?.label || _label}
                />
                <Line
                  type="monotone"
                  dataKey="volume"
                  stroke="var(--accent)"
                  strokeWidth={2.5}
                  dot={{ fill: "var(--accent)", stroke: "var(--card)", strokeWidth: 2, r: 5 }}
                  activeDot={{ r: 7, stroke: "var(--card)", strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </div>

      <div style={{ background: "var(--card)", borderRadius: 22, padding: 18, border: "1px solid rgba(18, 199, 194, 0.10)", boxShadow: "var(--shadow-card)" }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: "var(--text)", marginBottom: 12 }}>月別比較</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {monthlyTableList.map((m, i) => {
            const prev = monthlyTableList[i + 1];
            const diff = prev && prev.volume > 0 ? Math.round(((m.volume - prev.volume) / prev.volume) * 100) : null;
            return (
              <div key={m.month} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(18,199,194,0.07)", paddingBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>{m.label}</div>
                <div style={{ fontSize: 13, fontWeight: 900, color: "var(--text)" }}>{m.volume.toLocaleString("ja-JP")} kg</div>
                {diff !== null && (
                  <div style={{ fontSize: 11, fontWeight: 800, color: diff >= 0 ? "var(--accent)" : "#ff6b6b", minWidth: 50, textAlign: "right" }}>
                    {diff >= 0 ? "+" : ""}{diff}%
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
