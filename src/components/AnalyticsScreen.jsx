import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { calc1RM, getRecordSourceSets, sanitizeWorkoutSets } from "../utils/helpers";
import { getBig3ExerciseKey, normalizeExerciseName } from "../utils/exerciseName";
import { buildBodyPartExerciseKey, resolveRecordBodyPartLabel } from "../utils/bodyPartClassification";
import { buildTrainingSummary } from "../utils/trainingSummary";
import TrainingSummaryModal from "./modals/TrainingSummaryModal";

const debugLog = (...args) => {
  if (process.env.NODE_ENV !== "production") console.debug(...args);
};

const PERIODS = [
  { label: "1ヶ月", days: 30 },
  { label: "3ヶ月", days: 90 },
  { label: "6ヶ月", days: 180 },
  { label: "1年", days: 365 },
];
const SUMMARY_SCOPE_OPTIONS = [
  { key: "this_week", label: "今週" },
  { key: "last_week", label: "先週" },
  { key: "this_month", label: "今月" },
  { key: "last_month", label: "先月" },
];

function PeriodSegmentedControl({
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

const FIXED_BODY_PART_LABELS = ["胸", "背中", "四頭", "ハムストリングス", "尻", "肩", "二頭", "三頭", "腹筋", "その他"];
const BIG3_EXERCISES = [
  { key: "bench", label: "ベンチプレス" },
  { key: "squat", label: "スクワット" },
  { key: "deadlift", label: "デッドリフト" },
];
const BODY_PART_CHART_PALETTE = [
  "#0F6B6B",
  "#14958F",
  "#20B8AE",
  "#37CDC4",
  "#65DCD4",
  "#8EE8E2",
  "#5EBFAE",
  "#7ACFC2",
  "#A7EDE8",
  "#B9DAD5",
];
const BODY_PART_CHART_BG = "rgba(18, 199, 194, 0.045)";
const BODY_PART_CHART_GRID = "rgba(15, 94, 99, 0.075)";

const getBodyPartChartFill = (index = 0) =>
  BODY_PART_CHART_PALETTE[Math.min(index, BODY_PART_CHART_PALETTE.length - 1)] || "#20B8AE";

const BodyPartChartTooltip = ({ active, payload, label, valueLabel, unit, formatter }) => {
  if (!active || !payload?.length) return null;
  const rawValue = Number(payload[0]?.value || 0);
  const displayValue = formatter ? formatter(rawValue) : `${rawValue.toLocaleString("ja-JP")}${unit || ""}`;

  return (
    <div
      style={{
        background: "linear-gradient(180deg, var(--card), var(--card2))",
        border: "1px solid rgba(18, 199, 194, 0.18)",
        borderRadius: 16,
        boxShadow: "0 14px 32px rgba(15, 94, 99, 0.14)",
        padding: "11px 13px",
        minWidth: 132,
      }}
    >
      <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 900, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ color: "var(--text2)", fontSize: 12, fontWeight: 700 }}>
        {valueLabel}：<span style={{ color: "var(--accent)", fontSize: 15, fontWeight: 900 }}>{displayValue}</span>
      </div>
    </div>
  );
};

const formatDate = (date) => (date ? date.replace(/-/g, "/") : null);
const getBodyPartDisplayLabel = (bodyPart) =>
  bodyPart === "ハムストリングス" ? "ハム" : bodyPart;

const buildValidSets = (record) =>
  sanitizeWorkoutSets(getRecordSourceSets(record), { allowBodyweight: false });

const getBestSet = (validSets = []) =>
  validSets.reduce((best, set) => {
    const score = calc1RM([set]);
    if (!best || score > best.score) {
      return {
        weight: Number(set.weight),
        reps: Number(set.reps),
        score,
      };
    }
    return best;
  }, null);

const formatSetsText = (sets = []) =>
  sets.map((set) => `${Number(set.weight)}kg × ${Number(set.reps)}rep`).join(" / ");

const sortByDateDesc = (a, b) => {
  const aDate = a?.date || "";
  const bDate = b?.date || "";
  if (aDate !== bDate) return bDate.localeCompare(aDate);
  return (b?.estimated1RM || 0) - (a?.estimated1RM || 0);
};

const sortBodyPartLabels = (labels = []) =>
  [...new Set(labels)].sort((a, b) => {
    const aIndex = FIXED_BODY_PART_LABELS.indexOf(a);
    const bIndex = FIXED_BODY_PART_LABELS.indexOf(b);
    const safeA = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
    const safeB = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
    if (safeA !== safeB) return safeA - safeB;
    return String(a).localeCompare(String(b), "ja");
  });

const sortByRecentDateDesc = (aDate, bDate) => {
  const safeA = String(aDate || "");
  const safeB = String(bDate || "");
  return safeB.localeCompare(safeA);
};

const sortPrItemsByUsage = (a, b) => {
  const recordCountDiff = Number(b?.recordCount || 0) - Number(a?.recordCount || 0);
  if (recordCountDiff !== 0) return recordCountDiff;

  const latestDateDiff = sortByRecentDateDesc(a?.latestRecordDate, b?.latestRecordDate);
  if (latestDateDiff !== 0) return latestDateDiff;

  const estimatedDiff = Number(b?.estimated1RM || 0) - Number(a?.estimated1RM || 0);
  if (estimatedDiff !== 0) return estimatedDiff;

  return String(a?.displayName || a?.name || "").localeCompare(String(b?.displayName || b?.name || ""), "ja");
};

const getCompositeKey = (bodyPart, exerciseName) =>
  buildBodyPartExerciseKey(bodyPart, normalizeExerciseName(exerciseName));

const resolveAnalyticsBodyPart = (record, exerciseName, ctx) => {
  const bodyPart = resolveRecordBodyPartLabel(record, exerciseName, {
    muscleEx: ctx.muscleEx,
    exerciseBodyPartOverrides: ctx.exerciseBodyPartOverrides,
  });
  if (!bodyPart || ctx.hiddenSet.has(bodyPart)) return null;
  return bodyPart;
};

const buildHistoryBestMap = (history = {}, ctx) => {
  const bestMap = {};

  Object.entries(history || {}).forEach(([exerciseName, records]) => {
    const normalizedName = normalizeExerciseName(exerciseName);

    (records || []).forEach((record) => {
      const bodyPart = resolveAnalyticsBodyPart(record, exerciseName, ctx);
      if (!bodyPart) return;

      const validSets = buildValidSets(record);
      const rm = calc1RM(validSets);
      const bestSet = getBestSet(validSets);
      if (!bestSet || rm <= 0) return;

      const key = getCompositeKey(bodyPart, normalizedName);
      if (!bestMap[key] || rm > bestMap[key].estimated1RM) {
        bestMap[key] = {
          key,
          name: normalizedName,
          displayName: normalizedName,
          bodyPart,
          weight: bestSet.weight,
          reps: bestSet.reps,
          estimated1RM: Math.round(rm),
          date: record?.date || null,
          source: "history",
          sourceLabel: null,
        };
      }
    });
  });

  return bestMap;
};

const buildManualBestMap = (manualBests = [], ctx) => {
  const bestMap = {};

  (manualBests || []).forEach((entry) => {
    if (!entry?.exercise_name) return;
    const normalizedName = normalizeExerciseName(entry.exercise_name);
    const bodyPart = resolveAnalyticsBodyPart({ bodyPart: entry?.body_part }, entry.exercise_name, ctx);
    if (!bodyPart) return;

    const validSets = buildValidSets({ weight: entry.weight, reps: entry.reps });
    const rm = calc1RM(validSets);
    if (!validSets.length || rm <= 0) return;

    const key = getCompositeKey(bodyPart, normalizedName);
    if (!bestMap[key] || rm > bestMap[key].estimated1RM) {
      bestMap[key] = {
        key,
        name: normalizedName,
        displayName: normalizedName,
        bodyPart,
        weight: Number(entry.weight),
        reps: Number(entry.reps),
        estimated1RM: Math.round(rm),
        date: entry.best_date || null,
        source: "manual",
        sourceLabel: "移行記録",
      };
    }
  });

  return bestMap;
};

const buildHistoryRecordMap = (history = {}, ctx) => {
  const recordMap = {};

  Object.entries(history || {}).forEach(([exerciseName, records]) => {
    const normalizedName = normalizeExerciseName(exerciseName);

    (records || []).forEach((record, index) => {
      const bodyPart = resolveAnalyticsBodyPart(record, exerciseName, ctx);
      if (!bodyPart) return;

      const validSets = buildValidSets(record);
      const rm = calc1RM(validSets);
      const bestSet = getBestSet(validSets);
      if (!bestSet || rm <= 0) return;

      const key = getCompositeKey(bodyPart, normalizedName);
      if (!recordMap[key]) recordMap[key] = [];
      recordMap[key].push({
        id: `history-${key}-${record?.date || "nodate"}-${index}`,
        key,
        name: normalizedName,
        displayName: normalizedName,
        bodyPart,
        date: record?.date || null,
        weight: bestSet.weight,
        reps: bestSet.reps,
        estimated1RM: Math.round(rm),
        setsText: formatSetsText(validSets),
        source: "history",
        sourceLabel: null,
      });
    });
  });

  return recordMap;
};

const buildManualRecordMap = (manualBests = [], ctx) => {
  const recordMap = {};

  (manualBests || []).forEach((entry, index) => {
    if (!entry?.exercise_name) return;
    const normalizedName = normalizeExerciseName(entry.exercise_name);
    const bodyPart = resolveAnalyticsBodyPart({ bodyPart: entry?.body_part }, entry.exercise_name, ctx);
    if (!bodyPart) return;

    const validSets = buildValidSets({ weight: entry.weight, reps: entry.reps });
    const rm = calc1RM(validSets);
    if (!validSets.length || rm <= 0) return;

    const key = getCompositeKey(bodyPart, normalizedName);
    if (!recordMap[key]) recordMap[key] = [];
    recordMap[key].push({
      id: `manual-${key}-${entry?.best_date || "nodate"}-${entry?.id || index}`,
      key,
      name: normalizedName,
      displayName: normalizedName,
      bodyPart,
      date: entry.best_date || null,
      weight: Number(entry.weight),
      reps: Number(entry.reps),
      estimated1RM: Math.round(rm),
      setsText: `${Number(entry.weight)}kg × ${Number(entry.reps)}rep`,
      source: "manual",
      sourceLabel: "移行記録",
    });
  });

  return recordMap;
};

const buildChartData = (records = [], period) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - period);

  const grouped = {};
  records.forEach((record) => {
    if (!record?.date) return;
    const recordDate = new Date(`${record.date}T00:00:00`);
    if (recordDate < cutoff) return;

    if (!grouped[record.date] || record.estimated1RM > grouped[record.date].estimated1RM) {
      grouped[record.date] = record;
    }
  });

  const sorted = Object.values(grouped)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

  const maxWeight = sorted.reduce((max, record) => Math.max(max, Number(record.estimated1RM || 0)), 0);
  const latestDate = sorted[sorted.length - 1]?.date || null;

  return sorted.map((record) => ({
    rawDate: record.date,
    date: record.date.slice(5),
    weight: Number(record.estimated1RM || 0),
    setWeight: record.weight,
    reps: record.reps,
    isLatest: record.date === latestDate,
    isPeak: Number(record.estimated1RM || 0) === maxWeight,
  }));
};

const buildChartDomain = (chartData = []) => {
  if (!chartData.length) return [0, 100];

  const values = chartData.map((item) => Number(item.weight || 0)).filter(Number.isFinite);
  if (!values.length) return [0, 100];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 1);
  const minRange = Math.max(8, Math.ceil(max * 0.08));
  const paddedSpread = Math.max(spread, minRange);
  const padding = Math.max(2, Math.ceil(paddedSpread * 0.15));

  let domainMin = Math.floor((min - padding) / 5) * 5;
  let domainMax = Math.ceil((max + padding) / 5) * 5;

  if (domainMax - domainMin < minRange) {
    const midpoint = (max + min) / 2;
    domainMin = Math.floor((midpoint - minRange / 2) / 5) * 5;
    domainMax = Math.ceil((midpoint + minRange / 2) / 5) * 5;
  }

  if (domainMin < 0) domainMin = 0;
  if (domainMax <= domainMin) domainMax = domainMin + minRange;

  return [domainMin, domainMax];
};

const buildChartTicks = (chartData = []) => {
  if (chartData.length <= 3) return chartData.map((item) => item.date);
  const midIndex = Math.floor((chartData.length - 1) / 2);
  return [...new Set([
    chartData[0]?.date,
    chartData[midIndex]?.date,
    chartData[chartData.length - 1]?.date,
  ].filter(Boolean))];
};

export default function AnalyticsScreen({
  history,
  manualBests = [],
  muscleEx = {},
  hiddenBodyParts = [],
  exerciseBodyPartOverrides = {},
  onOpenPhotoCompare,
}) {
  const [selectedExerciseKey, setSelectedExerciseKey] = useState(null);
  const [period, setPeriod] = useState(90);
  const [activeSummaryKey, setActiveSummaryKey] = useState(null);
  const [overviewScope, setOverviewScope] = useState("this_week");
  const [selectedTrendMonth, setSelectedTrendMonth] = useState(null);
  const [activeAnalysisTab, setActiveAnalysisTab] = useState("overview");
  const [selectedOverviewMetric, setSelectedOverviewMetric] = useState(null);
  const [selectedPrBodyPart, setSelectedPrBodyPart] = useState(null);
  const [showAllBodyPartPr, setShowAllBodyPartPr] = useState(false);
  const screenScrollRef = useRef(null);
  const prDetailTouchRef = useRef({ startX: 0, startY: 0, tracking: false });

  const scrollAnalyticsScreenToTop = () => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    if (document.scrollingElement) {
      document.scrollingElement.scrollTop = 0;
    }
    let node = screenScrollRef.current;
    while (node) {
      if (typeof node.scrollTop === "number") {
        node.scrollTop = 0;
      }
      if (typeof node.scrollTo === "function") {
        node.scrollTo({ top: 0, behavior: "auto" });
      }
      node = node.parentElement;
    }
  };

  const resolutionContext = useMemo(
    () => ({
      muscleEx,
      exerciseBodyPartOverrides,
      hiddenSet: new Set(hiddenBodyParts || []),
    }),
    [muscleEx, exerciseBodyPartOverrides, hiddenBodyParts]
  );

  const historyBestMap = useMemo(
    () => buildHistoryBestMap(history, resolutionContext),
    [history, resolutionContext]
  );
  const manualBestMap = useMemo(
    () => buildManualBestMap(manualBests, resolutionContext),
    [manualBests, resolutionContext]
  );
  const historyRecordMap = useMemo(
    () => buildHistoryRecordMap(history, resolutionContext),
    [history, resolutionContext]
  );
  const manualRecordMap = useMemo(
    () => buildManualRecordMap(manualBests, resolutionContext),
    [manualBests, resolutionContext]
  );
  const combinedRecordMap = useMemo(() => {
    const allKeys = [...new Set([...Object.keys(historyRecordMap), ...Object.keys(manualRecordMap)])];
    return Object.fromEntries(
      allKeys.map((key) => [
        key,
        [
          ...(historyRecordMap[key] || []),
          ...(manualRecordMap[key] || []),
        ].sort(sortByDateDesc),
      ])
    );
  }, [historyRecordMap, manualRecordMap]);

  const prData = useMemo(() => {
    const allKeys = [...new Set([...Object.keys(historyBestMap), ...Object.keys(manualBestMap)])];

    const merged = allKeys.map((key) => {
      const historyBest = historyBestMap[key];
      const manualBest = manualBestMap[key];
      if (!historyBest) return manualBest;
      if (!manualBest) return historyBest;
      return manualBest.estimated1RM > historyBest.estimated1RM ? manualBest : historyBest;
    }).filter(Boolean).map((item) => {
      const records = combinedRecordMap[item.key] || [];
      return {
        ...item,
        recordCount: records.length,
        latestRecordDate: records[0]?.date || item.date || null,
      };
    });

    const groupLabels = sortBodyPartLabels(merged.map((item) => item.bodyPart));
    const groupedByBodyPart = groupLabels.map((bodyPart) => ({
      bodyPart,
      items: merged
        .filter((item) => item.bodyPart === bodyPart)
        .sort(sortPrItemsByUsage),
    }));

    const big3 = BIG3_EXERCISES.map(({ key, label }) => {
      const match = merged
        .filter((item) => getBig3ExerciseKey(item.name) === key)
        .sort((a, b) => b.estimated1RM - a.estimated1RM)[0] || null;

      return {
        key,
        label,
        item: match ? { ...match, displayName: label } : null,
        estimated1RM: match?.estimated1RM || 0,
      };
    });

    const itemMap = Object.fromEntries(merged.map((item) => [item.key, item]));

    return {
      groupedByBodyPart,
      big3,
      big3Total: big3.reduce((sum, item) => sum + item.estimated1RM, 0),
      itemMap,
    };
  }, [historyBestMap, manualBestMap, combinedRecordMap]);

  const selectedExercise = selectedExerciseKey ? prData.itemMap[selectedExerciseKey] || null : null;
  const thisWeekSummary = useMemo(
    () =>
      buildTrainingSummary({
        history,
        period: "this_week",
        muscleEx,
        hiddenBodyParts,
        exerciseBodyPartOverrides,
      }),
    [history, muscleEx, hiddenBodyParts, exerciseBodyPartOverrides]
  );
  const lastWeekSummary = useMemo(
    () =>
      buildTrainingSummary({
        history,
        period: "last_week",
        muscleEx,
        hiddenBodyParts,
        exerciseBodyPartOverrides,
      }),
    [history, muscleEx, hiddenBodyParts, exerciseBodyPartOverrides]
  );
  const thisMonthSummary = useMemo(
    () =>
      buildTrainingSummary({
        history,
        period: "this_month",
        muscleEx,
        hiddenBodyParts,
        exerciseBodyPartOverrides,
      }),
    [history, muscleEx, hiddenBodyParts, exerciseBodyPartOverrides]
  );
  const lastMonthSummary = useMemo(
    () =>
      buildTrainingSummary({
        history,
        period: "last_month",
        muscleEx,
        hiddenBodyParts,
        exerciseBodyPartOverrides,
      }),
    [history, muscleEx, hiddenBodyParts, exerciseBodyPartOverrides]
  );
  const weeklySummary = useMemo(
    () => ({
      ...thisWeekSummary,
      relatedSummaries: {
        last_week: lastWeekSummary,
      },
    }),
    [thisWeekSummary, lastWeekSummary]
  );
  const monthlySummary = useMemo(
    () => ({
      ...thisMonthSummary,
      relatedSummaries: {
        last_month: lastMonthSummary,
      },
    }),
    [thisMonthSummary, lastMonthSummary]
  );
  const displayWeeklySummary = overviewScope === "last_week"
    ? {
        ...lastWeekSummary,
        relatedSummaries: {
          this_week: thisWeekSummary,
        },
      }
    : weeklySummary;
  const displayMonthlySummary = overviewScope === "last_month"
    ? {
        ...lastMonthSummary,
        relatedSummaries: {
          this_month: thisMonthSummary,
        },
      }
    : monthlySummary;
  const activeSummary =
    activeSummaryKey === "weekly"
      ? displayWeeklySummary
      : activeSummaryKey === "monthly"
        ? displayMonthlySummary
        : null;
  useEffect(() => {
    const labels = prData.groupedByBodyPart.map((group) => group.bodyPart);
    if (!labels.length) {
      setSelectedPrBodyPart(null);
      return;
    }

    setSelectedPrBodyPart((prev) => (prev && labels.includes(prev) ? prev : labels[0]));
  }, [prData.groupedByBodyPart]);

  const selectedRecords = useMemo(() => {
    if (!selectedExerciseKey) return [];
    return combinedRecordMap[selectedExerciseKey] || [];
  }, [selectedExerciseKey, combinedRecordMap]);

  const selectedChartData = useMemo(
    () => buildChartData(selectedRecords, period),
    [selectedRecords, period]
  );
  const selectedChartDomain = useMemo(
    () => buildChartDomain(selectedChartData),
    [selectedChartData]
  );
  const selectedChartTicks = useMemo(
    () => buildChartTicks(selectedChartData),
    [selectedChartData]
  );

  const overviewSummary =
    overviewScope === "last_week"
      ? lastWeekSummary
      : overviewScope === "this_month"
        ? thisMonthSummary
        : overviewScope === "last_month"
          ? lastMonthSummary
          : thisWeekSummary;
  const selectedPrGroup = prData.groupedByBodyPart.find((group) => group.bodyPart === selectedPrBodyPart) || null;
  const overviewBodyPartStats = overviewSummary?.bodyPartStats || [];
  const overviewBodyPartChart = overviewBodyPartStats.map((item, index) => ({
    label: getBodyPartDisplayLabel(item.bodyPart),
    sets: item.sets,
    fill: getBodyPartChartFill(index),
  }));
  const totalOverviewSets = overviewBodyPartStats.reduce((sum, item) => sum + item.sets, 0);
  const overviewMetricDetails = useMemo(
    () => ({
      volume: {
        title: "Volume詳細",
        rangeLabel: overviewSummary.rangeLabel,
        empty: overviewSummary.totalVolume <= 0,
        summaryRows: [
          { label: "合計", value: `${overviewSummary.totalVolume.toLocaleString("ja-JP")}kg` },
          {
            label: "平均",
            value:
              overviewSummary.workoutCount > 0
                ? `${Math.round(overviewSummary.totalVolume / overviewSummary.workoutCount).toLocaleString("ja-JP")}kg / 回`
                : "0kg / 回",
          },
        ],
        sections: [
          {
            title: "日別",
            items: (overviewSummary.dailyStats || []).slice().reverse().map((item) => ({
              key: `day-${item.date}`,
              title: formatDate(item.date),
              meta: `${item.setCount}セット`,
              value: `${item.volume.toLocaleString("ja-JP")}kg`,
            })),
          },
          {
            title: "種目別",
            items: (overviewSummary.exerciseStats || []).slice(0, 8).map((item) => ({
              key: `exercise-${item.key}`,
              title: item.exerciseName,
              meta: `${item.bodyPart}・${item.setCount}セット`,
              value: `${Math.round(item.volume).toLocaleString("ja-JP")}kg`,
            })),
          },
        ],
      },
      workouts: {
        title: "トレーニング詳細",
        rangeLabel: overviewSummary.rangeLabel,
        empty: overviewSummary.workoutCount <= 0,
        summaryRows: [
          { label: "回数", value: `${overviewSummary.workoutCount}回` },
          { label: "セット", value: `${overviewSummary.totalSets || 0}セット` },
        ],
        sections: [
          {
            title: "実施日",
            items: (overviewSummary.dailyStats || []).slice().reverse().map((item) => ({
              key: `workout-${item.date}`,
              title: formatDate(item.date),
              meta: `${item.bodyParts.join("・") || "未分類"} / ${item.setCount}セット`,
              value: `${item.volume.toLocaleString("ja-JP")}kg`,
            })),
          },
        ],
      },
      exercises: {
        title: "種目数詳細",
        rangeLabel: overviewSummary.rangeLabel,
        empty: (overviewSummary.exerciseCount || 0) <= 0,
        summaryRows: [
          {
            label: "合計種目数",
            value: `${overviewSummary.exerciseCount || 0}種目`,
          },
        ],
        sections: [
          {
            title: "部位別種目数",
            items: (overviewSummary.exerciseCountByBodyPart || []).map((item) => ({
              key: `exercise-body-part-${item.bodyPart}`,
              title: item.bodyPart,
              meta: `${item.count}種目`,
              value: "",
            })),
          },
        ],
      },
      sets: {
        title: "セット数詳細",
        rangeLabel: overviewSummary.rangeLabel,
        empty: (overviewSummary.totalSets || 0) <= 0,
        summaryRows: [{ label: "合計セット数", value: `${overviewSummary.totalSets || 0}セット` }],
        sections: [
          {
            title: "種目別",
            items: (overviewSummary.exerciseStats || []).map((item) => ({
              key: `sets-${item.key}`,
              title: item.exerciseName,
              meta: `${item.bodyPart}・${Math.round(item.volume).toLocaleString("ja-JP")}kg`,
              value: `${item.setCount}セット`,
            })),
          },
        ],
      },
    }),
    [overviewSummary]
  );
  const activeOverviewMetric = selectedOverviewMetric ? overviewMetricDetails[selectedOverviewMetric] || null : null;

  const renderOverviewMetric = (
    key,
    label,
    value,
    accent = null,
    { accentColor = "var(--accent)", valueNode = null, compactValue = false } = {}
  ) => (
    <button
      type="button"
      onClick={() => setSelectedOverviewMetric(key)}
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

  useEffect(() => {
    if (!showAllBodyPartPr) return undefined;

    const body = document.body;
    const html = document.documentElement;
    const scrollTop = window.scrollY || window.pageYOffset || 0;
    const previousBody = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      touchAction: body.style.touchAction,
    };
    const previousHtml = {
      overflow: html.style.overflow,
      overscrollBehavior: html.style.overscrollBehavior,
    };

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollTop}px`;
    body.style.width = "100%";
    body.style.touchAction = "none";
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";

    return () => {
      body.style.overflow = previousBody.overflow || "";
      body.style.position = previousBody.position || "";
      body.style.top = previousBody.top || "";
      body.style.width = previousBody.width || "";
      body.style.touchAction = previousBody.touchAction || "";
      html.style.overflow = previousHtml.overflow || "";
      html.style.overscrollBehavior = previousHtml.overscrollBehavior || "";
      window.scrollTo(0, scrollTop);
    };
  }, [showAllBodyPartPr]);

  useLayoutEffect(() => {
    if (!selectedExerciseKey) return;

    const firstFrame = requestAnimationFrame(() => {
      scrollAnalyticsScreenToTop();
      requestAnimationFrame(() => {
        scrollAnalyticsScreenToTop();
        requestAnimationFrame(scrollAnalyticsScreenToTop);
      });
      setTimeout(scrollAnalyticsScreenToTop, 0);
      setTimeout(scrollAnalyticsScreenToTop, 40);
      setTimeout(scrollAnalyticsScreenToTop, 120);
    });

    return () => cancelAnimationFrame(firstFrame);
  }, [selectedExerciseKey]);

  const handleSelectExercise = (exerciseKey) => {
    setSelectedExerciseKey(exerciseKey);
    requestAnimationFrame(() => {
      scrollAnalyticsScreenToTop();
      requestAnimationFrame(scrollAnalyticsScreenToTop);
      setTimeout(scrollAnalyticsScreenToTop, 0);
      setTimeout(scrollAnalyticsScreenToTop, 40);
    });
  };

  const handlePrDetailTouchStart = (event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    prDetailTouchRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      tracking: touch.clientX <= 48,
    };
  };

  const handlePrDetailTouchEnd = (event) => {
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    const { startX, startY, tracking } = prDetailTouchRef.current;
    prDetailTouchRef.current = { startX: 0, startY: 0, tracking: false };
    if (!tracking) return;

    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;
    if (deltaX > 72 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      setSelectedExerciseKey(null);
    }
  };

  useEffect(() => {
    if (!selectedExercise) return;
    debugLog("[pr-detail] selected exercise records", {
      exerciseName: selectedExercise.displayName || selectedExercise.name,
      totalRecords: selectedRecords.length,
      records: selectedRecords.map((r) => ({
        date: r.date || r.workoutDate || r.dateKey,
        estimatedOneRepMax: r.estimated1RM,
        weight: r.weight,
        reps: r.reps,
      })),
    });
  }, [selectedExercise, selectedRecords]);

  useEffect(() => {
    if (!selectedExercise) return;
    debugLog("[pr-detail] chart records", {
      range: period,
      chartRecords: selectedChartData.map((r) => ({
        date: r.rawDate || r.date,
        value: r.weight,
      })),
    });
  }, [selectedExercise, period, selectedChartData]);

  const renderPRCard = (item, { compact = false, hideEstimated1RM = false } = {}) => {
    const isSelected = Boolean(item?.key && item.key === selectedExerciseKey);
    const sharedStyle = {
      width: "100%",
      textAlign: "left",
      background: isSelected
        ? "linear-gradient(135deg, rgba(15, 94, 99, 0.16), rgba(18, 199, 194, 0.14))"
        : compact ? "linear-gradient(180deg, var(--info-soft), var(--card))" : "var(--card2)",
      borderRadius: 16,
      padding: compact ? "12px 14px" : "11px 12px",
      border: isSelected
        ? "1px solid var(--accent)"
        : compact ? "1px solid var(--info-border)" : "1px solid rgba(186, 230, 253, 0.65)",
      boxShadow: isSelected ? "0 12px 26px rgba(15, 94, 99, 0.14)" : compact ? "var(--shadow-card)" : "none",
      cursor: item ? "pointer" : "default",
    };

    if (!item) {
      return (
        <div style={sharedStyle}>
          <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>未記録</div>
          <div style={{ fontSize: compact ? 22 : 15, fontWeight: 800, color: "var(--text4)" }}>0kg</div>
        </div>
      );
    }

    return (
      <button
        type="button"
        onClick={() => handleSelectExercise(item.key)}
        style={sharedStyle}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontSize: compact ? 11 : 13, fontWeight: 700, color: "var(--text)" }}>
            {item.displayName || item.name}
          </div>
          {!hideEstimated1RM && (
            <div style={{ fontSize: compact ? 22 : 15, fontWeight: 800, color: "var(--text)" }}>
              {item.estimated1RM}kg
            </div>
          )}
        </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 12, color: "var(--text2)" }}>
          <span>{item.weight}kg × {item.reps}rep</span>
          {item.date && <span>{formatDate(item.date)}</span>}
          {!compact && item.bodyPart && (
            <span style={{ padding: "0 6px", borderRadius: 999, background: "var(--info-soft)", border: "1px solid var(--info-border)", color: "var(--accent)", fontSize: 9, fontWeight: 700, lineHeight: 1.5 }}>
              {item.bodyPart}
            </span>
          )}
          {item.source === "manual" && (
            <span style={{ padding: "2px 8px", borderRadius: 999, background: "var(--success-soft)", border: "1px solid var(--success-border)", color: "var(--accent)", fontSize: 11, fontWeight: 700 }}>
              移行記録
            </span>
          )}
        </div>
      </button>
    );
  };

  if (selectedExercise) {
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
          {Number(point.setWeight || 0) > 0 && Number(point.reps || 0) > 0 && (
            <div style={{ fontSize: 11, color: "var(--text2)", fontWeight: 700, marginTop: 4 }}>
              {point.setWeight}kg × {point.reps}rep
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
                {selectedExercise.weight}kg × {selectedExercise.reps}rep
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
                    {record.weight}kg × {record.reps}rep
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

  return (
    <div ref={screenScrollRef} style={{ padding: "20px 20px var(--bottom-nav-clearance)", display: "flex", flexDirection: "column", gap: 18 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 4,
          padding: 5,
          borderRadius: 16,
          background: "var(--card)",
          border: "1px solid rgba(18, 199, 194, 0.10)",
          boxShadow: "var(--shadow-soft)",
        }}
      >
        {[
          { key: "overview", label: "概要" },
          { key: "parts", label: "部位" },
          { key: "pr", label: "PR履歴" },
          { key: "trends", label: "推移" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveAnalysisTab(tab.key)}
            style={{
              padding: "10px 0",
              borderRadius: 12,
              border: "none",
              background: activeAnalysisTab === tab.key
                ? "linear-gradient(135deg, #0F5E63, #12C7C2)"
                : "transparent",
              color: activeAnalysisTab === tab.key ? "#fff" : "var(--text2)",
              fontSize: 11,
              fontWeight: 900,
              cursor: "pointer",
              boxShadow: activeAnalysisTab === tab.key
                ? "0 10px 22px rgba(15, 94, 99, 0.13)"
                : "none",
              whiteSpace: "nowrap",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeAnalysisTab === "parts" && (
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
      )}



      {activeAnalysisTab === "trends" && (() => {
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
      })()}
      {activeAnalysisTab === "overview" && (<>
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
        ].map((item) =>
          renderOverviewMetric(item.key, item.label, item.value, item.accent, {
            accentColor: item.accentColor,
            valueNode: item.valueNode,
            compactValue: item.compactValue,
          })
        )}
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

      </>)}

      {activeAnalysisTab === "overview" && (
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
      )}

      {activeAnalysisTab === "pr" && (<>
      <div style={{ background: "var(--card)", borderRadius: 22, padding: 18, border: "1px solid rgba(18, 199, 194, 0.10)", boxShadow: "var(--shadow-card)" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)", marginBottom: 12 }}>
          自己ベスト
        </div>
        {prData.groupedByBodyPart.length > 0 ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginBottom: 14 }}>
              {prData.groupedByBodyPart.map((group) => (
                <button
                  key={group.bodyPart}
                  type="button"
                  onClick={() => setSelectedPrBodyPart(selectedPrBodyPart === group.bodyPart ? null : group.bodyPart)}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 14,
                    border: "1px solid rgba(18, 199, 194, 0.12)",
                    background:
                      selectedPrBodyPart === group.bodyPart
                        ? "linear-gradient(135deg, rgba(15, 94, 99, 0.14), rgba(18, 199, 194, 0.12))"
                        : "linear-gradient(180deg, var(--card2), var(--card))",
                    color: "var(--text)",
                    textAlign: "left",
                    boxShadow:
                      selectedPrBodyPart === group.bodyPart ? "0 10px 22px rgba(15, 94, 99, 0.10)" : "none",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 900, color: selectedPrBodyPart === group.bodyPart ? "var(--accent)" : "var(--text)" }}>
                    {group.bodyPart}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text2)", fontWeight: 700, marginTop: 2 }}>
                    {group.items.length}種目
                  </div>
                </button>
              ))}
            </div>

            {selectedPrGroup && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {selectedPrGroup.items.map((item) => (
                  <div key={item.key}>
                    {renderPRCard(item, { hideEstimated1RM: true })}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 13, color: "var(--text2)" }}>
            まだPRデータがありません
          </div>
        )}
      </div>

      </>)}

      {activeAnalysisTab === "overview" && (
        <>
        </>
      )}

      <TrainingSummaryModal
        isOpen={Boolean(activeSummary)}
        onClose={() => setActiveSummaryKey(null)}
        summary={activeSummary}
      />

      {activeOverviewMetric && (
        <div
          onClick={() => setSelectedOverviewMetric(null)}
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
                onClick={() => setSelectedOverviewMetric(null)}
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
      )}

      {showAllBodyPartPr && selectedPrGroup && (
        <div
          onClick={() => setShowAllBodyPartPr(false)}
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
              padding: "18px 16px 20px",
              border: "1px solid var(--border2)",
              maxHeight: "65vh",
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
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>
                {selectedPrGroup.bodyPart}の部位別PR
              </div>
              <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4 }}>
                全{selectedPrGroup.items.length}件
              </div>
            </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {selectedPrGroup.items.map((item) => (
                  <div key={`all-${item.key}`}>
                    {renderPRCard(item, { hideEstimated1RM: true })}
                  </div>
                ))}
              </div>
          </div>
        </div>
      )}

    </div>
  );
}
