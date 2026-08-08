import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getBig3ExerciseKey } from "../utils/exerciseName";
import PrDetailView from "./analytics/PrDetailView";
import AnalyticsPrTab from "./analytics/AnalyticsPrTab";
import BodyPartPrModal from "./analytics/BodyPartPrModal";
import WeeklyTab from "./analytics/WeeklyTab";
import {
  debugLog,
  BIG3_EXERCISES,
  sortByDateDesc,
  sortBodyPartLabels,
  buildHistoryBestMap,
  buildManualBestMap,
  buildHistoryRecordMap,
  buildManualRecordMap,
  buildChartData,
  buildChartDomain,
  buildChartTicks,
} from "./analytics/analyticsUtils";

export default function AnalyticsScreen({
  history,
  manualBests = [],
  muscleEx = {},
  hiddenBodyParts = [],
  exerciseBodyPartOverrides = {},
  onOpenPhotoCompare,
  weekStartDay = "monday",
  weeklySetTargets = {},
  setWeeklySetTargets,
  initialTab = "weekly",
}) {
  const [selectedExerciseKey, setSelectedExerciseKey] = useState(null);
  const [period, setPeriod] = useState(90);
  const [activeAnalysisTab, setActiveAnalysisTab] = useState(initialTab);
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
      historySource: "canonicalDisplayHistory/buildTrustedHistory",
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
      allKeys.map((key) => {
        const historyRecords = historyRecordMap[key] || [];
        const manualRecords = historyRecords.length > 0 ? [] : (manualRecordMap[key] || []);
        if (historyRecords.length > 0 && (manualRecordMap[key] || []).length > 0) {
          console.log("[analytics pr]", {
            action: "analytics_pr_calculation",
            source: "manual_bests",
            exerciseKey: key,
            usedTrustedHistory: true,
            usedSummaryJson: false,
            usedLegacyHistory: false,
            usedManualBest: true,
            rejectedStalePR: true,
            ignoredStalePRSource: true,
            reason: "workouts.data history exists; manual_bests used only as fallback",
          });
        }
        return [
          key,
          [
            ...historyRecords,
            ...manualRecords,
          ].sort(sortByDateDesc),
        ];
      })
    );
  }, [historyRecordMap, manualRecordMap]);

  const prData = useMemo(() => {
    const allKeys = [...new Set([...Object.keys(historyBestMap), ...Object.keys(manualBestMap)])];

    const merged = allKeys.map((key) => {
      const historyBest = historyBestMap[key];
      const manualBest = manualBestMap[key];
      if (!historyBest) return manualBest;
      if (!manualBest) return historyBest;
      console.log("[analytics pr]", {
        action: "analytics_pr_calculation",
        source: "manual_bests",
        exerciseName: historyBest.displayName || historyBest.name,
        date: manualBest.date || null,
        originalWeight: manualBest.displayWeight,
        originalUnit: manualBest.displayUnit,
        normalizedKgValue: manualBest.weight,
        normalizedKg: manualBest.weight,
        displayWeight: manualBest.displayWeight,
        displayUnit: manualBest.displayUnit,
        reps: manualBest.reps,
        estimated1RM: manualBest.estimated1RM,
        chosenPRDate: historyBest.date || null,
        chosenPROriginalSet: {
          weight: historyBest.displayWeight,
          unit: historyBest.displayUnit,
          reps: historyBest.reps,
        },
        exactHistoryUsed: true,
        legacyHistoryUsed: false,
        usedTrustedHistory: true,
        usedSummaryJson: false,
        usedLegacyHistory: false,
        usedManualBest: true,
        rejectedStalePR: true,
        ignoredStalePRSource: true,
        reason: "workouts.data history takes precedence over manual_bests",
      });
      return historyBest;
    }).filter(Boolean).map((item) => {
      const records = combinedRecordMap[item.key] || [];
      const currentPrDate = item.date || "";
      const recordsBeforePrDate = records.filter((r) => r.date && r.date < currentPrDate);
      const prevBest1RM = recordsBeforePrDate.reduce((max, r) => Math.max(max, r.estimated1RM || 0), 0);
      const prDiff = prevBest1RM > 0 ? item.estimated1RM - prevBest1RM : null;

      const now = new Date();
      const d21ago = new Date(now); d21ago.setDate(d21ago.getDate() - 21);
      const d14ago = new Date(now); d14ago.setDate(d14ago.getDate() - 14);
      const pad = (n) => String(n).padStart(2, "0");
      const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const d21agoStr = toKey(d21ago);
      const d14agoStr = toKey(d14ago);
      const recentRecordCount = records.filter((r) => r.date >= d21agoStr).length;
      const daysSincePr = currentPrDate ? Math.floor((now - new Date(`${currentPrDate}T00:00:00`)) / 86400000) : null;
      const isNew = Boolean(currentPrDate && currentPrDate >= d14agoStr);
      const stagnationWeeks = (daysSincePr !== null && daysSincePr >= 21 && recentRecordCount >= 3)
        ? Math.floor(daysSincePr / 7)
        : null;

      return {
        ...item,
        recordCount: records.length,
        latestRecordDate: records[0]?.date || item.date || null,
        prDiff,
        isNew,
        stagnationWeeks,
      };
    });

    const groupLabels = sortBodyPartLabels(merged.map((item) => item.bodyPart));
    const groupedByBodyPart = groupLabels.map((bodyPart) => ({
      bodyPart,
      items: merged
        .filter((item) => item.bodyPart === bodyPart)
        .sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    }));
    const allItemsSortedByDate = [...merged].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

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
      allItemsSortedByDate,
      big3,
      big3Total: big3.reduce((sum, item) => sum + item.estimated1RM, 0),
      itemMap,
    };
  }, [historyBestMap, manualBestMap, combinedRecordMap]);

  const selectedExercise = selectedExerciseKey ? prData.itemMap[selectedExerciseKey] || null : null;

  useEffect(() => {
    const labels = prData.groupedByBodyPart.map((group) => group.bodyPart);
    // null means "すべて" — keep it as a valid default
    setSelectedPrBodyPart((prev) => (prev === null || labels.includes(prev)) ? prev : null);
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

  const selectedPrGroup = prData.groupedByBodyPart.find((group) => group.bodyPart === selectedPrBodyPart) || null;

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


  if (selectedExercise) {
    return (
      <PrDetailView
        selectedExercise={selectedExercise}
        screenScrollRef={screenScrollRef}
        handlePrDetailTouchStart={handlePrDetailTouchStart}
        handlePrDetailTouchEnd={handlePrDetailTouchEnd}
        setSelectedExerciseKey={setSelectedExerciseKey}
        period={period}
        setPeriod={setPeriod}
        selectedChartData={selectedChartData}
        selectedChartTicks={selectedChartTicks}
        selectedChartDomain={selectedChartDomain}
        selectedRecords={selectedRecords}
      />
    );
  }

  return (
    <div ref={screenScrollRef} style={{ padding: "20px 20px var(--bottom-nav-scroll-padding)", display: "flex", flexDirection: "column", gap: 18 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 4,
          padding: 5,
          borderRadius: 16,
          background: "var(--card)",
          border: "1px solid rgba(18, 199, 194, 0.10)",
          boxShadow: "var(--shadow-soft)",
        }}
      >
        {[
          { key: "weekly", label: "今週" },
          { key: "pr", label: "PR履歴" },
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
              fontSize: 13,
              fontWeight: 900,
              cursor: "pointer",
              boxShadow: activeAnalysisTab === tab.key
                ? "0 10px 22px rgba(15, 94, 99, 0.13)"
                : "none",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeAnalysisTab === "weekly" && (
        <WeeklyTab
          history={history}
          muscleEx={muscleEx}
          exerciseBodyPartOverrides={exerciseBodyPartOverrides}
          weekStartDay={weekStartDay}
          weeklySetTargets={weeklySetTargets}
          setWeeklySetTargets={setWeeklySetTargets}
        />
      )}

      {activeAnalysisTab === "pr" && (
        <AnalyticsPrTab
          prData={prData}
          selectedPrBodyPart={selectedPrBodyPart}
          setSelectedPrBodyPart={setSelectedPrBodyPart}
          selectedPrGroup={selectedPrGroup}
          selectedExerciseKey={selectedExerciseKey}
          onSelectExercise={handleSelectExercise}
        />
      )}

      {showAllBodyPartPr && (
        <BodyPartPrModal
          selectedPrGroup={selectedPrGroup}
          selectedExerciseKey={selectedExerciseKey}
          onSelectExercise={handleSelectExercise}
          onClose={() => setShowAllBodyPartPr(false)}
        />
      )}

    </div>
  );
}
