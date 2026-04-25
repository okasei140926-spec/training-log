import { calc1RM, dispW } from "../../utils/helpers";

const normalizeRecord = (record) => {
  const hasFallbackSet =
    (record?.weight === "BW" || Number(record?.weight) > 0) &&
    Number(record?.reps) > 0;

  const rawSets = Array.isArray(record?.sets) && record.sets.length > 0
    ? record.sets
    : hasFallbackSet
      ? [{ weight: record.weight, reps: record.reps }]
      : [];

  const sets = rawSets
    .filter((set) => {
      const reps = Number(set?.reps);
      if (!Number.isFinite(reps) || reps <= 0) return false;
      if (set?.weight === "BW") return true;

      const weight = Number(set?.weight);
      return Number.isFinite(weight) && weight > 0;
    })
    .map((set) => ({
      weight: set.weight === "BW" ? "BW" : Number(set.weight),
      reps: Number(set.reps),
    }));

  return {
    date: record?.date || "",
    sets,
  };
};

const formatWeight = (weight, unit) =>
  weight === "BW" ? "自重" : `${dispW(weight, unit)}${unit}`;

export default function LogExerciseHistoryModal({
  exName,
  records,
  weightDisplayUnit = "kg",
  onClose,
}) {
  const normalizedRecords = (records || [])
    .map(normalizeRecord)
    .filter((record) => record.date && record.sets.length > 0);

  const allSets = normalizedRecords.flatMap((record) => record.sets);
  const numericSets = allSets.filter((set) => set.weight !== "BW");
  const hasBodyweightSet = allSets.some((set) => set.weight === "BW");

  const maxWeight = numericSets.length > 0
    ? Math.max(...numericSets.map((set) => Number(set.weight)))
    : null;
  const maxEstimated1RM = normalizedRecords.length > 0
    ? Math.max(...normalizedRecords.map((record) => calc1RM(record.sets)), 0)
    : 0;

  let bestSet = null;
  let bestSetScore = -1;
  let fallbackBodyweightSet = null;
  let fallbackBodyweightReps = -1;

  normalizedRecords.forEach((record) => {
    record.sets.forEach((set) => {
      if (set.weight === "BW") {
        if (fallbackBodyweightSet === null || set.reps > fallbackBodyweightReps) {
          fallbackBodyweightSet = set;
          fallbackBodyweightReps = set.reps;
        }
        return;
      }

      const score = Number(set.weight) * (1 + Number(set.reps) / 30);
      if (score > bestSetScore) {
        bestSet = set;
        bestSetScore = score;
      }
    });
  });

  if (!bestSet && fallbackBodyweightSet) {
    bestSet = fallbackBodyweightSet;
  }

  const maxWeightLabel = maxWeight !== null
    ? formatWeight(maxWeight, weightDisplayUnit)
    : hasBodyweightSet
      ? "自重"
      : "—";
  const bestSetLabel = bestSet
    ? `${formatWeight(bestSet.weight, weightDisplayUnit)} × ${bestSet.reps}rep`
    : "—";
  const maxEstimated1RMLabel = maxEstimated1RM > 0
    ? `${dispW(Math.round(maxEstimated1RM * 10) / 10, weightDisplayUnit)}${weightDisplayUnit}`
    : "—";

  const chartData = normalizedRecords
    .map((record) => ({
      date: record.date,
      rm: calc1RM(record.sets),
    }))
    .filter((point) => point.rm > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const canShowChart = chartData.length >= 2;
  const chartMax = canShowChart ? Math.max(...chartData.map((point) => point.rm)) : 0;
  const chartMin = canShowChart ? Math.min(...chartData.map((point) => point.rm)) : 0;

  const chartWidth = 320;
  const chartHeight = 120;
  const chartPadX = 14;
  const chartPadTop = 22;
  const chartPadBottom = 24;
  const chartRange = Math.max(chartMax - chartMin, 1);
  const chartInnerWidth = chartWidth - chartPadX * 2;
  const chartInnerHeight = chartHeight - chartPadTop - chartPadBottom;

  const chartPoints = canShowChart
    ? chartData.map((point, idx) => {
      const x = chartData.length === 1
        ? chartWidth / 2
        : chartPadX + (idx / (chartData.length - 1)) * chartInnerWidth;
      const y = chartPadTop + ((chartMax - point.rm) / chartRange) * chartInnerHeight;

      return {
        ...point,
        x,
        y,
      };
    })
    : [];

  const chartPolyline = chartPoints.map((point) => `${point.x},${point.y}`).join(" ");

  const formatChartValue = (value) =>
    `${dispW(Math.round(value * 10) / 10, weightDisplayUnit)}${weightDisplayUnit}`;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 400,
        padding: "16px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 430,
          background: "var(--card-modal)",
          borderRadius: 20,
          border: "1px solid var(--border2)",
          padding: "18px 16px 20px",
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
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

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>
              {exName}
            </div>
            <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>
              種目の過去記録
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: "none",
              color: "var(--text2)",
              fontSize: 22,
              padding: "4px 8px",
            }}
          >
            ×
          </button>
        </div>

        {normalizedRecords.length === 0 ? (
          <div
            style={{
              background: "var(--card2)",
              borderRadius: 16,
              padding: "28px 20px",
              textAlign: "center",
              color: "var(--text2)",
              fontSize: 14,
            }}
          >
            まだ過去の記録がありません
          </div>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 10,
                marginBottom: 18,
              }}
            >
              <div style={{ background: "var(--card2)", borderRadius: 12, padding: "12px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>
                  {maxWeightLabel}
                </div>
                <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 4 }}>
                  最高重量
                </div>
              </div>

              <div style={{ background: "var(--card2)", borderRadius: 12, padding: "12px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>
                  {bestSetLabel}
                </div>
                <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 4 }}>
                  ベスト記録
                </div>
              </div>

              <div style={{ background: "var(--card2)", borderRadius: 12, padding: "12px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>
                  {maxEstimated1RMLabel}
                </div>
                <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 4 }}>
                  最高推定1RM
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, letterSpacing: 2, color: "var(--text3)", marginBottom: 10 }}>
                推定1RM推移
              </div>

              <div
                style={{
                  background: "var(--card2)",
                  borderRadius: 14,
                  padding: "14px 12px 12px",
                }}
              >
                {canShowChart && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      marginBottom: 10,
                      fontSize: 10,
                      color: "var(--text3)",
                      fontWeight: 700,
                    }}
                  >
                    <div>MAX {formatChartValue(chartMax)}</div>
                    <div>MIN {formatChartValue(chartMin)}</div>
                  </div>
                )}

                {canShowChart ? (
                  <svg
                    width="100%"
                    viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                    style={{ display: "block", overflow: "visible" }}
                  >
                    <line
                      x1={chartPadX}
                      y1={chartPadTop + chartInnerHeight}
                      x2={chartWidth - chartPadX}
                      y2={chartPadTop + chartInnerHeight}
                      stroke="var(--border2)"
                      strokeWidth="1"
                    />

                    <polyline
                      points={chartPolyline}
                      fill="none"
                      stroke="#4ade80"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />

                    {chartPoints.map((point, idx) => (
                      <g key={`${point.date}-${idx}`}>
                        <circle
                          cx={point.x}
                          cy={point.y}
                          r="3.5"
                          fill={idx === chartPoints.length - 1 ? "#4ade80" : "var(--card2)"}
                          stroke="#4ade80"
                          strokeWidth="2"
                        />
                        {idx === chartPoints.length - 1 && (
                          <text
                            x={point.x}
                            y={point.y - 8}
                            textAnchor="middle"
                            fontSize="10"
                            fill="#4ade80"
                            fontWeight="700"
                          >
                            {formatChartValue(point.rm)}
                          </text>
                        )}
                      </g>
                    ))}

                    {chartPoints.map((point, idx) => (
                      <text
                        key={`label-${point.date}-${idx}`}
                        x={point.x}
                        y={chartHeight - 8}
                        textAnchor="middle"
                        fontSize="9"
                        fill="var(--text3)"
                      >
                        {point.date.slice(5)}
                      </text>
                    ))}
                  </svg>
                ) : (
                  <div
                    style={{
                      textAlign: "center",
                      color: "var(--text2)",
                      fontSize: 13,
                      padding: "18px 8px",
                    }}
                  >
                    グラフ表示には記録が足りません
                  </div>
                )}
              </div>
            </div>

            <div style={{ fontSize: 12, letterSpacing: 2, color: "var(--text3)", marginBottom: 10 }}>
              直近の履歴一覧
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {normalizedRecords.map((record, recordIdx) => (
                <div
                  key={`${record.date}-${recordIdx}`}
                  style={{
                    background: "var(--card2)",
                    borderRadius: 14,
                    padding: "14px 14px 12px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 10,
                      gap: 8,
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
                      {record.date}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text3)" }}>
                      {record.sets.length}セット
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {record.sets.map((set, idx) => (
                      <div
                        key={`${record.date}-${idx}`}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          borderTop: idx === 0 ? "none" : "1px solid var(--border2)",
                          paddingTop: idx === 0 ? 0 : 6,
                          color: "var(--text2)",
                          fontSize: 13,
                        }}
                      >
                        <span>{idx + 1}セット目</span>
                        <span>{formatWeight(set.weight, weightDisplayUnit)} × {set.reps}rep</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
