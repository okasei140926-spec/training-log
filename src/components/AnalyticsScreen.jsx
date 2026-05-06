import { useEffect, useMemo, useState } from "react";
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { calc1RM, formatDateKey, getRecordSourceSets, sanitizeHistoryRecord, sanitizeWorkoutSets } from "../utils/helpers";
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

const formatDate = (date) => (date ? date.replace(/-/g, "/") : null);

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

const getWeekBounds = (today = new Date()) => {
  const base = new Date(today);
  base.setHours(0, 0, 0, 0);
  const diffToMonday = base.getDay() === 0 ? -6 : 1 - base.getDay();
  const start = new Date(base);
  start.setDate(base.getDate() + diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { startKey: formatDateKey(start), endKey: formatDateKey(end) };
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
  const [selectedWeeklyBodyPart, setSelectedWeeklyBodyPart] = useState(null);
  const [overviewScope, setOverviewScope] = useState("weekly");
  const [selectedPrBodyPart, setSelectedPrBodyPart] = useState(null);

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
  const activeSummary =
    activeSummaryKey === "weekly"
      ? weeklySummary
      : activeSummaryKey === "monthly"
        ? monthlySummary
        : null;
  const progressInsights = useMemo(() => {
    const validDates = new Set();
    const { startKey, endKey } = getWeekBounds(new Date());
    const weeklyBodyPartMap = {};
    const weeklyBodyPartDetails = {};

    Object.entries(history || {}).forEach(([exerciseName, records]) => {
      (records || []).forEach((record) => {
        const sanitized = sanitizeHistoryRecord(record, { allowBodyweight: true });
        if (!sanitized?.date || !sanitized.sets?.length) return;

        const bodyPart = resolveAnalyticsBodyPart(sanitized, exerciseName, resolutionContext);
        if (!bodyPart) return;

        validDates.add(sanitized.date);

        if (sanitized.date < startKey || sanitized.date > endKey) return;
        weeklyBodyPartMap[bodyPart] = (weeklyBodyPartMap[bodyPart] || 0) + sanitized.sets.length;

        if (!weeklyBodyPartDetails[bodyPart]) {
          weeklyBodyPartDetails[bodyPart] = {};
        }

        const detailKey = normalizeExerciseName(exerciseName);
        if (!weeklyBodyPartDetails[bodyPart][detailKey]) {
          weeklyBodyPartDetails[bodyPart][detailKey] = {
            key: `${bodyPart}::${detailKey}`,
            name: exerciseName,
            setCount: 0,
            volume: 0,
          };
        }

        weeklyBodyPartDetails[bodyPart][detailKey].setCount += sanitized.sets.length;
        weeklyBodyPartDetails[bodyPart][detailKey].volume += sanitized.sets.reduce((sum, set) => {
          const weight = Number(set?.weight);
          const reps = Number(set?.reps);
          if (!Number.isFinite(weight) || weight <= 0) return sum;
          if (!Number.isFinite(reps) || reps <= 0) return sum;
          return sum + weight * reps;
        }, 0);
      });
    });

    const weeklyBodyPartItems = Object.fromEntries(
      Object.entries(weeklyBodyPartDetails).map(([label, exerciseMap]) => [
        label,
        Object.values(exerciseMap).sort(
          (a, b) =>
            b.setCount - a.setCount ||
            b.volume - a.volume ||
            a.name.localeCompare(b.name, "ja")
        ),
      ])
    );

    return {
      totalTrainingDays: validDates.size,
      weeklyBodyParts: Object.entries(weeklyBodyPartMap)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
        .slice(0, 6),
      weeklyBodyPartItems,
    };
  }, [history, resolutionContext]);

  const selectedWeeklyBodyPartSummary = useMemo(() => {
    if (!selectedWeeklyBodyPart) return null;
    const items = progressInsights.weeklyBodyPartItems?.[selectedWeeklyBodyPart] || [];

    return {
      title: `${selectedWeeklyBodyPart}の種目`,
      subtitle: `今週 ${progressInsights.weeklyBodyParts.find(([label]) => label === selectedWeeklyBodyPart)?.[1] || 0}セット`,
      emptyText: "今週はまだこの部位の記録がありません",
      items: items.map((item) => ({
        key: item.key,
        title: item.name,
        badge: selectedWeeklyBodyPart,
        meta: `${item.setCount}セット ・ ${Math.round(item.volume).toLocaleString("ja-JP")}kg`,
      })),
    };
  }, [selectedWeeklyBodyPart, progressInsights]);

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

  const overviewSummary = overviewScope === "monthly" ? monthlySummary : weeklySummary;
  const overviewTrend = overviewSummary?.trend || [];
  const hasOverviewTrendData = overviewTrend.some((item) => Number(item.volume) > 0);
  const prUpdatePreview = (overviewSummary?.prUpdates || []).slice(0, 3);
  const selectedPrGroup = prData.groupedByBodyPart.find((group) => group.bodyPart === selectedPrBodyPart) || null;

  const getTrendTickIndexes = (length, group) => {
    if (length <= 0) return new Set();
    if (group === "weekly") {
      return new Set(Array.from({ length }, (_, index) => index));
    }

    if (length <= 4) return new Set(Array.from({ length }, (_, index) => index));
    return new Set([
      0,
      Math.floor((length - 1) / 3),
      Math.floor(((length - 1) * 2) / 3),
      length - 1,
    ]);
  };

  const trendTickIndexes = useMemo(
    () => getTrendTickIndexes(overviewTrend.length, overviewSummary?.group),
    [overviewTrend.length, overviewSummary?.group]
  );

  const renderOverviewMetric = (label, value, accent = null) => (
    <div
      key={label}
      style={{
        background: "var(--card)",
        borderRadius: 18,
        padding: "14px 14px 12px",
        border: "1px solid rgba(18, 199, 194, 0.10)",
        boxShadow: "var(--shadow-soft)",
      }}
    >
      <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text)" }}>{value}</div>
      {accent && (
        <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700, marginTop: 6 }}>
          {accent}
        </div>
      )}
    </div>
  );

  const renderPRCard = (item, { compact = false } = {}) => {
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
          <div style={{ fontSize: compact ? 22 : 15, fontWeight: 800, color: "var(--text)" }}>
            {item.estimated1RM}kg
          </div>
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
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
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
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
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
          { key: "weekly", label: "今週" },
          { key: "monthly", label: "今月" },
        ].map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setOverviewScope(option.key)}
            style={{
              minWidth: 92,
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
        {[
          {
            label: "Volume",
            value: `${overviewSummary.totalVolume.toLocaleString("ja-JP")}kg`,
            accent: overviewSummary.prUpdateCount > 0 ? `PR ${overviewSummary.prUpdateCount}件` : null,
          },
          {
            label: "トレーニング",
            value: `${overviewSummary.workoutCount}回`,
            accent: overviewSummary.shortLabel,
          },
          {
            label: "種目数",
            value: `${overviewSummary.exerciseCount}種目`,
            accent: overviewSummary.topBodyPart !== "なし" ? `最多 ${overviewSummary.topBodyPart}` : null,
          },
        ].map((item) => renderOverviewMetric(item.label, item.value, item.accent))}
      </div>

      <div style={{ background: "var(--card)", borderRadius: 22, padding: 18, border: "1px solid rgba(18, 199, 194, 0.10)", boxShadow: "var(--shadow-card)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>Volume推移</div>
            <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4 }}>
              {overviewSummary.rangeLabel}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--text3)", fontWeight: 700 }}>
            {overviewSummary.totalVolume.toLocaleString("ja-JP")}kg
          </div>
        </div>

        {hasOverviewTrendData ? (
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={overviewTrend}>
              <defs>
                <linearGradient id="pumpVolumeFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#12C7C2" stopOpacity={0.26} />
                  <stop offset="100%" stopColor="#12C7C2" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(18, 199, 194, 0.10)" vertical={false} />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                interval={0}
                tick={{ fontSize: 11, fill: "var(--text3)" }}
                tickFormatter={(value, index) => (trendTickIndexes.has(index) ? value : "")}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: "var(--text3)" }}
                width={38}
                tickFormatter={(value) =>
                  Number(value) >= 1000
                    ? `${Math.round(Number(value) / 1000)}k`
                    : String(Math.round(Number(value)))
                }
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
                formatter={(value) => [`${Math.round(Number(value) || 0).toLocaleString("ja-JP")}kg`, "Volume"]}
              />
              <Area type="monotone" dataKey="volume" stroke="#12C7C2" strokeWidth={3} fill="url(#pumpVolumeFill)" />
            </AreaChart>
          </ResponsiveContainer>
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

      <div style={{ background: "var(--card)", borderRadius: 22, padding: 18, border: "1px solid rgba(18, 199, 194, 0.10)", boxShadow: "var(--shadow-card)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>PR更新</div>
          {overviewSummary.prUpdateCount > 0 && (
            <div style={{ fontSize: 12, color: "var(--text3)", fontWeight: 700 }}>
              {overviewSummary.prUpdateCount}件
            </div>
          )}
        </div>

        {prUpdatePreview.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {prUpdatePreview.map((item) => (
              <button
                key={`${item.key}-${item.date}`}
                type="button"
                onClick={() => setSelectedExerciseKey(item.key)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "linear-gradient(180deg, var(--card2), var(--card))",
                  borderRadius: 18,
                  padding: "12px 14px",
                  border: "1px solid rgba(18, 199, 194, 0.10)",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{item.exerciseName}</div>
                    <span style={{ padding: "3px 8px", borderRadius: 999, background: "var(--info-soft)", border: "1px solid var(--info-border)", color: "var(--accent)", fontSize: 10, fontWeight: 800 }}>
                      {item.bodyPart}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text2)" }}>
                    1RM {item.estimated1RM}kg
                    {item.weight > 0 && item.reps > 0 ? ` ・ ${item.weight}kg × ${item.reps}rep` : ""}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "var(--accent)" }}>
                    +{item.diffKg}kg
                  </div>
                  <div style={{ marginTop: 5, display: "inline-flex", padding: "4px 9px", borderRadius: 999, background: "var(--success-soft)", border: "1px solid var(--success-border)", color: "var(--accent)", fontSize: 10, fontWeight: 800 }}>
                    NEW PR
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6 }}>
            この期間のPR更新はありません
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 148px) minmax(0, 1fr)", gap: 12 }}>
        <div
          style={{
            background: "var(--card)",
            borderRadius: 18,
            padding: "14px 14px 12px",
            border: "1px solid rgba(18, 199, 194, 0.10)",
            boxShadow: "var(--shadow-soft)",
          }}
        >
          <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>
            累計トレーニング日数
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, color: "var(--text)" }}>
            {progressInsights.totalTrainingDays}日
          </div>
        </div>

        <div
          style={{
            background: "var(--card)",
            borderRadius: 18,
            padding: "14px 14px 12px",
            border: "1px solid rgba(18, 199, 194, 0.10)",
            boxShadow: "var(--shadow-soft)",
          }}
        >
          <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 10 }}>
            今週の部位別セット数
          </div>
          {progressInsights.weeklyBodyParts.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {progressInsights.weeklyBodyParts.map(([label, count]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setSelectedWeeklyBodyPart(label)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    borderRadius: 999,
                    background: "var(--card2)",
                    border: "1px solid rgba(18, 199, 194, 0.10)",
                    fontSize: 12,
                    color: "var(--text2)",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{label}</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{count}</span>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--text3)" }}>
              今週のセット記録はまだありません
            </div>
          )}
        </div>
      </div>

      <div style={{ background: "var(--card)", borderRadius: 22, padding: 18, border: "1px solid rgba(18, 199, 194, 0.10)", boxShadow: "var(--shadow-card)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>詳細サマリー</div>
            <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4 }}>
              シェア画像の生成や、今週 / 先週、今月 / 先月の切替はこちら
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
                padding: "12px 12px 11px",
                border: "1px solid rgba(18, 199, 194, 0.10)",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", marginBottom: 3 }}>
                {summary.title}
              </div>
              <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.5, marginBottom: 10 }}>
                {summary.shortLabel} {summary.workoutCount}回 / Volume {summary.totalVolume.toLocaleString("ja-JP")}kg
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setActiveSummaryKey(summary.group)}
                  style={{
                    flex: 1,
                    padding: "8px 0",
                    borderRadius: 12,
                    border: "1px solid rgba(18, 199, 194, 0.12)",
                    background: "var(--card)",
                    color: "var(--text)",
                    fontSize: 11,
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
                    padding: "8px 0",
                    borderRadius: 12,
                    border: "1px solid var(--success-border)",
                    background: "var(--success-soft)",
                    color: "var(--accent)",
                    fontSize: 11,
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          {prData.big3.map((entry) => (
            <div key={entry.key}>
              {renderPRCard(entry.item, { compact: true })}
            </div>
          ))}
          <div style={{ background: "linear-gradient(135deg, var(--success-soft), var(--card))", borderRadius: 16, padding: "12px 14px", gridColumn: "1 / -1", border: "1px solid var(--success-border)" }}>
            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>BIG3合計</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "var(--text)" }}>{prData.big3Total}kg</div>
          </div>
        </div>
      </div>

      <div style={{ background: "var(--card)", borderRadius: 22, padding: 18, border: "1px solid rgba(18, 199, 194, 0.10)", boxShadow: "var(--shadow-card)" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)", marginBottom: 12 }}>
          部位別PR
        </div>
        {prData.groupedByBodyPart.length > 0 ? (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              {prData.groupedByBodyPart.map((group) => (
                <button
                  key={group.bodyPart}
                  type="button"
                  onClick={() => setSelectedPrBodyPart(group.bodyPart)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 999,
                    border: "1px solid rgba(18, 199, 194, 0.12)",
                    background:
                      selectedPrBodyPart === group.bodyPart
                        ? "linear-gradient(135deg, #0F5E63, #12C7C2)"
                        : "var(--card2)",
                    color: selectedPrBodyPart === group.bodyPart ? "#fff" : "var(--text2)",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {group.bodyPart}
                </button>
              ))}
            </div>

            {selectedPrGroup && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {selectedPrGroup.items.map((item) => (
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

      {selectedWeeklyBodyPartSummary && (
        <div
          onClick={() => setSelectedWeeklyBodyPart(null)}
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
              maxHeight: "58vh",
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
                {selectedWeeklyBodyPartSummary.title}
              </div>
              <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4 }}>
                {selectedWeeklyBodyPartSummary.subtitle}
              </div>
            </div>

            {selectedWeeklyBodyPartSummary.items.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {selectedWeeklyBodyPartSummary.items.map((item) => (
                  <div
                    key={item.key}
                    style={{
                      background: "linear-gradient(180deg, var(--card2), var(--card))",
                      borderRadius: 16,
                      padding: "11px 12px",
                      border: "1px solid rgba(18, 199, 194, 0.1)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      {item.badge && (
                        <span
                          style={{
                            display: "inline-flex",
                            padding: "3px 7px",
                            borderRadius: 999,
                            background: "var(--info-soft)",
                            border: "1px solid var(--info-border)",
                            color: "var(--accent)",
                            fontSize: 10,
                            fontWeight: 800,
                            flexShrink: 0,
                          }}
                        >
                          {item.badge}
                        </span>
                      )}
                      <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>
                        {item.title}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.45 }}>
                      {item.meta}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
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
                {selectedWeeklyBodyPartSummary.emptyText}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
