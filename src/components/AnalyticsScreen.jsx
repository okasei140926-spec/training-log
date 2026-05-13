import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { calc1RM, getRecordSourceSets, sanitizeWorkoutSets } from "../utils/helpers";
import { getBig3ExerciseKey, normalizeExerciseName } from "../utils/exerciseName";
import { buildBodyPartExerciseKey, resolveRecordBodyPartLabel } from "../utils/bodyPartClassification";
import { buildTrainingSummary } from "../utils/trainingSummary";
import TrainingSummaryModal from "./modals/TrainingSummaryModal";

const PERIODS = [
  { label: "1ヶ月", days: 30 },
  { label: "3ヶ月", days: 90 },
  { label: "6ヶ月", days: 180 },
  { label: "1年", days: 365 },
];

const FIXED_BODY_PART_LABELS = ["胸", "背中", "四頭", "ハムストリングス", "尻", "肩", "二頭", "三頭", "腹筋", "その他"];
const BIG3_EXERCISES = [
  { key: "bench", label: "ベンチプレス" },
  { key: "squat", label: "スクワット" },
  { key: "deadlift", label: "デッドリフト" },
];
const BODY_PART_CHART_COLORS = {
  胸: "#12C7C2",
  背中: "#0F5E63",
  四頭: "#33E1DB",
  ハムストリングス: "#50BFA5",
  尻: "#3B82F6",
  肩: "#8B5CF6",
  二頭: "#F59E0B",
  三頭: "#EF4444",
  腹筋: "#14B8A6",
  その他: "#94A3B8",
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

  return Object.values(grouped)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .map((record) => ({
      date: record.date.slice(5),
      weight: record.estimated1RM,
    }));
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
  const [selectedOverviewMetric, setSelectedOverviewMetric] = useState(null);
  const [selectedPrBodyPart, setSelectedPrBodyPart] = useState(null);
  const [showAllBodyPartPr, setShowAllBodyPartPr] = useState(false);
  const screenScrollRef = useRef(null);

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

  const prData = useMemo(() => {
    const allKeys = [...new Set([...Object.keys(historyBestMap), ...Object.keys(manualBestMap)])];

    const merged = allKeys.map((key) => {
      const historyBest = historyBestMap[key];
      const manualBest = manualBestMap[key];
      if (!historyBest) return manualBest;
      if (!manualBest) return historyBest;
      return manualBest.estimated1RM > historyBest.estimated1RM ? manualBest : historyBest;
    }).filter(Boolean);

    const groupLabels = sortBodyPartLabels(merged.map((item) => item.bodyPart));
    const groupedByBodyPart = groupLabels.map((bodyPart) => ({
      bodyPart,
      items: merged
        .filter((item) => item.bodyPart === bodyPart)
        .sort((a, b) => b.estimated1RM - a.estimated1RM || a.displayName.localeCompare(b.displayName, "ja")),
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
  }, [historyBestMap, manualBestMap]);

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
    return [
      ...(historyRecordMap[selectedExerciseKey] || []),
      ...(manualRecordMap[selectedExerciseKey] || []),
    ].sort(sortByDateDesc);
  }, [selectedExerciseKey, historyRecordMap, manualRecordMap]);

  const selectedChartData = useMemo(
    () => buildChartData(selectedRecords, period),
    [selectedRecords, period]
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
  const selectedPrPreview = selectedPrGroup ? selectedPrGroup.items.slice(0, 3) : [];
  const overviewBodyPartStats = overviewSummary?.bodyPartStats || [];
  const overviewBodyPartChart = overviewBodyPartStats.map((item) => ({
    label: getBodyPartDisplayLabel(item.bodyPart),
    sets: item.sets,
    fill: BODY_PART_CHART_COLORS[item.bodyPart] || "#12C7C2",
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

  useEffect(() => {
    if (!selectedExerciseKey) return;

    const scrollToTop = () => {
      window.scrollTo(0, 0);
      if (document.scrollingElement) {
        document.scrollingElement.scrollTop = 0;
      }
      if (screenScrollRef.current) {
        screenScrollRef.current.scrollTop = 0;
      }
    };

    const firstFrame = requestAnimationFrame(() => {
      scrollToTop();
      requestAnimationFrame(scrollToTop);
    });

    return () => cancelAnimationFrame(firstFrame);
  }, [selectedExerciseKey]);

  const renderPRCard = (item, { compact = false, hideEstimated1RM = false } = {}) => {
    const sharedStyle = {
      width: "100%",
      textAlign: "left",
      background: compact ? "linear-gradient(180deg, var(--info-soft), var(--card))" : "var(--card2)",
      borderRadius: 16,
      padding: compact ? "12px 14px" : "11px 12px",
      border: compact ? "1px solid var(--info-border)" : "1px solid rgba(186, 230, 253, 0.65)",
      boxShadow: compact ? "var(--shadow-card)" : "none",
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
        onClick={() => setSelectedExerciseKey(item.key)}
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
            <span style={{ padding: "2px 8px", borderRadius: 999, background: "var(--info-soft)", border: "1px solid var(--info-border)", color: "var(--accent)", fontSize: 11, fontWeight: 700 }}>
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
    return (
      <div ref={screenScrollRef} style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
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
              <span style={{ padding: "4px 10px", borderRadius: 999, background: "var(--info-soft)", border: "1px solid var(--info-border)", color: "var(--accent)", fontSize: 12, fontWeight: 700 }}>
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

          {selectedChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={selectedChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border2)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text3)" }} />
                <YAxis tick={{ fontSize: 10, fill: "var(--text3)" }} />
                <Tooltip
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--border2)", borderRadius: 12, fontSize: 12, boxShadow: "var(--shadow-card)" }}
                  labelStyle={{ color: "var(--text)" }}
                  formatter={(value) => [`${value}kg`, "1RM"]}
                />
                <Line type="monotone" dataKey="weight" stroke="var(--accent)" strokeWidth={2.5} dot={{ fill: "var(--accent)", r: 3.5 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ textAlign: "center", color: "var(--text3)", fontSize: 13, padding: "28px 0 18px" }}>
              グラフに表示できる日付付き記録がありません
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
    <div ref={screenScrollRef} style={{ padding: "20px 20px calc(120px + var(--safe-bottom, 0px))", display: "flex", flexDirection: "column", gap: 18 }}>
      <div
        style={{
          display: "inline-flex",
          gap: 8,
          padding: 6,
          borderRadius: 999,
          background: "var(--card)",
          border: "1px solid rgba(18, 199, 194, 0.10)",
          boxShadow: "var(--shadow-soft)",
          alignSelf: "flex-start",
        }}
      >
        {[
          { key: "this_week", label: "今週" },
          { key: "last_week", label: "先週" },
          { key: "this_month", label: "今月" },
          { key: "last_month", label: "先月" },
        ].map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setOverviewScope(option.key)}
            style={{
              minWidth: 82,
              padding: "9px 16px",
              borderRadius: 999,
              border: "1px solid rgba(18, 199, 194, 0.10)",
              background:
                overviewScope === option.key
                  ? "linear-gradient(135deg, #0F5E63, #12C7C2)"
                  : "transparent",
              color: overviewScope === option.key ? "#fff" : "var(--text2)",
              fontSize: 13,
              fontWeight: 800,
              boxShadow:
                overviewScope === option.key ? "0 10px 22px rgba(15, 94, 99, 0.12)" : "none",
            }}
          >
            {option.label}
          </button>
        ))}
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
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              {overviewBodyPartStats.slice(0, 4).map((item) => (
                <div
                  key={`overview-sets-${item.bodyPart}`}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    background: "rgba(18, 199, 194, 0.06)",
                    border: "1px solid rgba(18, 199, 194, 0.12)",
                    color: "var(--text2)",
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  {item.bodyPart} {item.sets}セット
                </div>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={Math.max(250, Math.min(360, 160 + overviewBodyPartChart.length * 18))}>
              <BarChart data={overviewBodyPartChart} margin={{ top: 10, right: 10, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(18, 199, 194, 0.10)" vertical={false} />
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
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid rgba(18, 199, 194, 0.12)",
                    borderRadius: 14,
                    fontSize: 12,
                    boxShadow: "var(--shadow-card)",
                  }}
                  labelStyle={{ color: "var(--text)" }}
                  formatter={(value) => [`${Math.round(Number(value) || 0)}セット`, "セット数"]}
                />
                <Bar
                  dataKey="sets"
                  radius={[10, 10, 0, 0]}
                  background={{ fill: "rgba(18, 199, 194, 0.08)", radius: 10 }}
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

      <div style={{ background: "var(--card)", borderRadius: 22, padding: 16, border: "1px solid rgba(18, 199, 194, 0.10)", boxShadow: "var(--shadow-card)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text)" }}>詳細サマリー</div>
            <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 3 }}>
              週・月ごとの記録を確認、シェアできます
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          {[weeklySummary, monthlySummary].map((summary) => (
            <div
              key={summary.key}
              style={{
                background: "linear-gradient(180deg, var(--card2), var(--card))",
                borderRadius: 18,
                padding: "11px 11px 10px",
                border: "1px solid rgba(18, 199, 194, 0.10)",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", marginBottom: 2 }}>
                {summary.title}
              </div>
              <div style={{ fontSize: 10, color: "var(--text3)", lineHeight: 1.45, marginBottom: 8 }}>
                {summary.shortLabel} {summary.workoutCount}回 / Volume {summary.totalVolume.toLocaleString("ja-JP")}kg
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setActiveSummaryKey(summary.group)}
                  style={{
                    flex: 1,
                    padding: "7px 0",
                    borderRadius: 12,
                    border: "1px solid rgba(18, 199, 194, 0.12)",
                    background: "var(--card)",
                    color: "var(--text)",
                    fontSize: 10,
                    fontWeight: 800,
                  }}
                >
                  見る
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSummaryKey(summary.group)}
                  style={{
                    flex: 1,
                    padding: "7px 0",
                    borderRadius: 12,
                    border: "1px solid var(--success-border)",
                    background: "var(--success-soft)",
                    color: "var(--accent)",
                    fontSize: 10,
                    fontWeight: 800,
                  }}
                >
                  シェア
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: "var(--card)", borderRadius: 20, padding: 16, border: "1px solid var(--border2)", boxShadow: "var(--shadow-card)" }}>
        <div style={{ fontSize: 10, letterSpacing: 2.5, color: "var(--text3)", marginBottom: 12 }}>
          BIG3 PR
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ background: "linear-gradient(135deg, var(--success-soft), var(--card))", borderRadius: 18, padding: "14px 16px", border: "1px solid var(--success-border)" }}>
            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>BIG3合計</div>
            <div style={{ fontSize: 30, fontWeight: 900, color: "var(--text)" }}>{prData.big3Total}kg</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            {prData.big3.map((entry) => (
              <div key={entry.key}>
                {renderPRCard(entry.item, { compact: true })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ background: "var(--card)", borderRadius: 22, padding: 18, border: "1px solid rgba(18, 199, 194, 0.10)", boxShadow: "var(--shadow-card)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>
            部位別PR
          </div>
          {selectedPrGroup && selectedPrGroup.items.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAllBodyPartPr(true)}
              style={{
                padding: "7px 12px",
                borderRadius: 999,
                border: "1px solid rgba(18, 199, 194, 0.12)",
                background: "var(--card2)",
                color: "var(--accent)",
                fontSize: 11,
                fontWeight: 800,
              }}
            >
              すべて見る
            </button>
          )}
        </div>
        {prData.groupedByBodyPart.length > 0 ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginBottom: 14 }}>
              {prData.groupedByBodyPart.map((group) => (
                <button
                  key={group.bodyPart}
                  type="button"
                  onClick={() => setSelectedPrBodyPart(group.bodyPart)}
                  style={{
                    padding: "12px 12px 11px",
                    borderRadius: 16,
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
                  <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>
                    {group.bodyPart}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text2)", fontWeight: 700 }}>
                    {group.items.length}件のPR
                  </div>
                </button>
              ))}
            </div>

            {selectedPrGroup && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {selectedPrPreview.map((item) => (
                  <div key={item.key}>
                    {renderPRCard(item)}
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

      {onOpenPhotoCompare && (
        <div style={{ background: "var(--card)", borderRadius: 20, padding: 16, border: "1px solid rgba(18, 199, 194, 0.10)", boxShadow: "var(--shadow-card)" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", marginBottom: 4 }}>
            写真比較
          </div>
          <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 12, lineHeight: 1.5 }}>
            見た目の変化を比較したい時だけ、ここから開けます。
          </div>
          <button
            type="button"
            onClick={onOpenPhotoCompare}
            style={{
              width: "100%",
              padding: "11px 14px",
              borderRadius: 14,
              border: "1px solid rgba(18, 199, 194, 0.12)",
              background: "linear-gradient(180deg, var(--card2), var(--card))",
              color: "var(--text)",
              fontSize: 13,
              fontWeight: 800,
            }}
          >
            写真比較を開く
          </button>
        </div>
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
