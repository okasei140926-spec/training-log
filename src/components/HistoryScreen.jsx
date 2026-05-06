import { useState, useEffect, useMemo } from "react";
import { supabase } from "../utils/supabase";
import CalendarView from "./CalendarView";
import HistoryEditModal from "./modals/HistoryEditModal";
import ManualBestModal from "./modals/ManualBestModal";
import ManualBestManagerModal from "./modals/ManualBestManagerModal";
import CustomBodyPartModal from "./modals/CustomBodyPartModal";
import HistoryExerciseItem from "./history/HistoryExerciseItem";
import { resolveRecordedBodyPartLabel } from "../utils/bodyPartClassification";
import {
  PR_UPDATE_TOLERANCE_KG,
  dispW,
  formatDateKey,
  getBestRmSet,
  hasMeaningfulPRIncrease,
  sanitizeHistoryRecord,
  sanitizeWorkoutSets,
} from "../utils/helpers";
import { normalizeExerciseName } from "../utils/exerciseName";

const formatVolume = (value) => `${Math.round(Number(value || 0)).toLocaleString("ja-JP")}kg`;
const WORKOUT_STARTED_AT_KEY = "pump_workout_started_at";
const WORKOUT_STARTED_FOR_DATE_KEY = "pump_workout_started_for_date";
const WORKOUT_LAST_ACTIVITY_AT_KEY = "pump_workout_last_activity_at";

const formatWeight = (value, unit = "kg") => {
  if (value === "BW") return "自重";
  const displayed = dispW(value, unit);
  if (!displayed) return "-";
  return `${displayed}${unit}`;
};
const formatSetDisplay = (weight, reps, unit = "kg") =>
  `${formatWeight(weight, unit)} × ${Number(reps)}rep`;
const formatDurationValue = (seconds) => {
  const totalSec = Math.max(0, Math.floor(Number(seconds) || 0));
  const totalMin = Math.floor(totalSec / 60);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;

  if (hours <= 0) return `${totalMin}分`;
  return `${hours}時間${minutes}分`;
};
const formatTimeStamp = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function HistoryScreen({
  history,
  muscleEx,
  exerciseBodyPartOverrides = {},
  onEditHistory,
  onDeleteHistory,
  onDeleteDate,
  unit = "kg",
  getExUnit,
  onLogForDate,
  user,
  manualBests = [],
  customBodyParts = [],
  hiddenBodyParts = [],
  onAddManualBest,
  onUpdateManualBest,
  onDeleteManualBest,
  onAddCustomBodyPart,
}) {
  const [editTarget, setEditTarget] = useState(null);
  const [showManualBestModal, setShowManualBestModal] = useState(false);
  const [showManualBestManager, setShowManualBestManager] = useState(false);
  const [showCustomBodyPartModal, setShowCustomBodyPartModal] = useState(false);
  const [editingManualBest, setEditingManualBest] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedSummaryKey, setSelectedSummaryKey] = useState(null);
  const [showAllTodayWorkouts, setShowAllTodayWorkouts] = useState(false);
  const [openExercises, setOpenExercises] = useState({});
  const [todayWorkoutStartedAt, setTodayWorkoutStartedAt] = useState(null);
  const [todayWorkoutLastActivityAt, setTodayWorkoutLastActivityAt] = useState(null);
  const [todayWorkoutDurationSec, setTodayWorkoutDurationSec] = useState(0);

  const todayKey = formatDateKey(new Date());

  const openManualBestModalForCreate = () => {
    setShowManualBestManager(false);
    setEditingManualBest(null);
    setShowManualBestModal(true);
  };

  const openManualBestModalForEdit = (best) => {
    setShowManualBestManager(false);
    setEditingManualBest(best);
    setShowManualBestModal(true);
  };

  const openCustomBodyPartModal = () => {
    setShowManualBestManager(false);
    setShowCustomBodyPartModal(true);
  };

  useEffect(() => {
    if (selectedDate || selectedSummaryKey) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [selectedDate, selectedSummaryKey]);

  useEffect(() => {
    let cancelled = false;

    const applyTodayWorkoutTiming = (payload = {}) => {
      if (cancelled) return;
      setTodayWorkoutStartedAt(payload.startedAt || null);
      setTodayWorkoutLastActivityAt(payload.lastActivityAt || null);
      setTodayWorkoutDurationSec(Math.max(0, Math.floor(Number(payload.durationSec) || 0)));
    };

    const syncFromSources = async () => {
      const savedDate = localStorage.getItem(WORKOUT_STARTED_FOR_DATE_KEY);
      const savedStartedAtRaw = Number(localStorage.getItem(WORKOUT_STARTED_AT_KEY));
      const savedLastActivityAtRaw = Number(localStorage.getItem(WORKOUT_LAST_ACTIVITY_AT_KEY));

      if (
        savedDate === todayKey &&
        Number.isFinite(savedStartedAtRaw) &&
        savedStartedAtRaw > 0 &&
        Number.isFinite(savedLastActivityAtRaw) &&
        savedLastActivityAtRaw >= savedStartedAtRaw
      ) {
        applyTodayWorkoutTiming({
          startedAt: new Date(savedStartedAtRaw).toISOString(),
          lastActivityAt: new Date(savedLastActivityAtRaw).toISOString(),
          durationSec: Math.floor((savedLastActivityAtRaw - savedStartedAtRaw) / 1000),
        });
        return;
      }

      if (!user?.id) {
        applyTodayWorkoutTiming();
        return;
      }

      const { data, error } = await supabase
        .from("workouts")
        .select("started_at, ended_at, duration_sec")
        .eq("user_id", user.id)
        .eq("date", todayKey)
        .maybeSingle();

      if (error) {
        console.error(error);
        applyTodayWorkoutTiming();
        return;
      }

      applyTodayWorkoutTiming({
        startedAt: data?.started_at || null,
        lastActivityAt: data?.ended_at || null,
        durationSec: data?.duration_sec || 0,
      });
    };

    syncFromSources();

    const intervalId = window.setInterval(() => {
      const savedDate = localStorage.getItem(WORKOUT_STARTED_FOR_DATE_KEY);
      const savedStartedAtRaw = Number(localStorage.getItem(WORKOUT_STARTED_AT_KEY));
      const savedLastActivityAtRaw = Number(localStorage.getItem(WORKOUT_LAST_ACTIVITY_AT_KEY));

      if (
        savedDate === todayKey &&
        Number.isFinite(savedStartedAtRaw) &&
        savedStartedAtRaw > 0 &&
        Number.isFinite(savedLastActivityAtRaw) &&
        savedLastActivityAtRaw >= savedStartedAtRaw
      ) {
        applyTodayWorkoutTiming({
          startedAt: new Date(savedStartedAtRaw).toISOString(),
          lastActivityAt: new Date(savedLastActivityAtRaw).toISOString(),
          durationSec: Math.floor((savedLastActivityAtRaw - savedStartedAtRaw) / 1000),
        });
      }
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [todayKey, user?.id]);

  const resolvedEntries = useMemo(() => {
    return Object.entries(history || {})
      .flatMap(([exerciseName, records]) =>
        (records || []).map((record, index) => {
          const sanitized = sanitizeHistoryRecord(record, { allowBodyweight: true });
          if (!sanitized?.date || !sanitized.sets?.length) return null;

          const bodyPart = resolveRecordedBodyPartLabel(sanitized, exerciseName, {
            muscleEx,
            hiddenBodyParts,
            exerciseBodyPartOverrides,
          });
          if (!bodyPart) return null;

          const volume = sanitized.sets.reduce((sum, set) => {
            const weight = Number(set?.weight);
            const reps = Number(set?.reps);
            if (!Number.isFinite(weight) || weight <= 0) return sum;
            if (!Number.isFinite(reps) || reps <= 0) return sum;
            return sum + weight * reps;
          }, 0);

          const maxWeight = sanitized.sets.reduce((max, set) => {
            const weight = Number(set?.weight);
            if (!Number.isFinite(weight) || weight <= 0) return max;
            return Math.max(max, weight);
          }, 0);

          return {
            id: `${exerciseName}-${sanitized.date}-${index}`,
            name: exerciseName,
            date: sanitized.date,
            bodyPart,
            sets: sanitized.sets,
            setCount: sanitized.sets.length,
            volume,
            maxWeight,
            order: typeof sanitized.order === "number" ? sanitized.order : 999,
          };
        })
      )
      .filter(Boolean)
      .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  }, [exerciseBodyPartOverrides, hiddenBodyParts, history, muscleEx]);

  const todayEntries = useMemo(
    () =>
      resolvedEntries
        .filter((entry) => entry.date === todayKey)
        .sort((a, b) => a.order - b.order),
    [resolvedEntries, todayKey]
  );

  const previousSetsMap = useMemo(() => {
    const map = {};

    Object.entries(history || {}).forEach(([exerciseName, records]) => {
      (records || []).forEach((record) => {
        const sanitized = sanitizeHistoryRecord(record, { allowBodyweight: false });
        if (!sanitized?.date || sanitized.date >= todayKey) return;

        const bodyPart = resolveRecordedBodyPartLabel(sanitized, exerciseName, {
          muscleEx,
          hiddenBodyParts,
          exerciseBodyPartOverrides,
        });
        if (!bodyPart) return;

        const key = `${bodyPart}::${normalizeExerciseName(exerciseName)}`;
        if (!map[key]) map[key] = [];
        map[key].push(...sanitizeWorkoutSets(sanitized.sets, { allowBodyweight: false }));
      });
    });

    (manualBests || []).forEach((entry) => {
      const bodyPart = String(entry?.body_part || "").trim();
      if (!bodyPart || hiddenBodyParts.includes(bodyPart)) return;

      const key = `${bodyPart}::${normalizeExerciseName(entry?.exercise_name)}`;
      if (!map[key]) map[key] = [];
      map[key].push(
        ...sanitizeWorkoutSets([{ weight: entry.weight, reps: entry.reps }], {
          allowBodyweight: false,
        })
      );
    });

    return map;
  }, [
    exerciseBodyPartOverrides,
    hiddenBodyParts,
    history,
    manualBests,
    muscleEx,
    todayKey,
  ]);

  const todayPrEntries = useMemo(
    () =>
      todayEntries
        .map((entry) => {
          const previousSets =
            previousSetsMap[`${entry.bodyPart}::${normalizeExerciseName(entry.name)}`] || [];
          const bestSet = getBestRmSet(entry.sets, { allowBodyweight: false });
          if (
            !bestSet ||
            !hasMeaningfulPRIncrease(entry.sets, previousSets, null, PR_UPDATE_TOLERANCE_KG)
          ) {
            return null;
          }

          return {
            ...entry,
            bestSet,
          };
        })
        .filter(Boolean),
    [todayEntries, previousSetsMap]
  );

  const todaySummary = useMemo(() => {
    return {
      exerciseCount: todayEntries.length,
      setCount: todayEntries.reduce((sum, entry) => sum + entry.setCount, 0),
      totalVolume: Math.round(todayEntries.reduce((sum, entry) => sum + entry.volume, 0)),
      durationSec: todayWorkoutDurationSec,
      prCount: todayPrEntries.length,
    };
  }, [
    todayEntries,
    todayWorkoutDurationSec,
    todayPrEntries,
  ]);

  const todayWorkedBodyParts = useMemo(
    () => [...new Set(todayEntries.map((entry) => entry.bodyPart).filter(Boolean))],
    [todayEntries]
  );

  const heroWorkoutCards = todayEntries.slice(0, 3);
  const visibleTodayWorkouts = showAllTodayWorkouts ? todayEntries : heroWorkoutCards;
  const hasTodayWorkout = todayEntries.length > 0;

  const summaryCards = [
    { key: "totalVolume", label: "ボリューム", value: formatVolume(todaySummary.totalVolume) },
    { key: "setCount", label: "セット数", value: `${todaySummary.setCount}` },
    { key: "duration", label: "時間", value: formatDurationValue(todaySummary.durationSec) },
  ];

  const selectedSummary = useMemo(() => {
    if (!selectedSummaryKey) return null;

    if (selectedSummaryKey === "duration") {
      const hasDuration = todaySummary.durationSec > 0;
      return {
        title: "今日のトレーニング時間",
        subtitle: formatDurationValue(todaySummary.durationSec),
        emptyText: "今日はまだ時間データがありません",
        items: hasDuration
          ? [
              {
                key: "workout-duration",
                title: "合計時間",
                meta: formatDurationValue(todaySummary.durationSec),
              },
              {
                key: "workout-started-at",
                title: "開始",
                meta: formatTimeStamp(todayWorkoutStartedAt),
              },
              {
                key: "workout-last-activity-at",
                title: "最終入力",
                meta: formatTimeStamp(todayWorkoutLastActivityAt),
              },
            ]
          : [],
      };
    }

    if (selectedSummaryKey === "exerciseCount") {
      return {
        title: "今日やった種目",
        subtitle: `${todaySummary.exerciseCount}種目`,
        emptyText: "今日はまだ種目を記録していません",
        items: todayEntries.map((entry) => ({
          key: entry.id,
          title: entry.name,
          badge: entry.bodyPart,
          meta: `${entry.setCount}セット ・ ${formatVolume(entry.volume)}`,
        })),
      };
    }

    if (selectedSummaryKey === "setCount") {
      return {
        title: "今日のセット詳細",
        subtitle: `合計 ${todaySummary.setCount}セット`,
        emptyText: "今日はまだセットを記録していません",
        items: todayEntries.map((entry) => ({
          key: entry.id,
          title: entry.name,
          badge: entry.bodyPart,
          meta: entry.sets
            .map(
              (set, index) =>
                `${index + 1}. ${formatSetDisplay(
                  set.weight,
                  set.reps,
                  (getExUnit ? getExUnit(entry.name) : unit) || "kg"
                )}`
            )
            .join(" / "),
        })),
      };
    }

    if (selectedSummaryKey === "prCount") {
      return {
        title: "今日更新したPR",
        subtitle: `${todaySummary.prCount}件`,
        emptyText: "今日はまだPR更新がありません",
        items: todayPrEntries.map((entry) => ({
          key: `${entry.id}-pr`,
          title: entry.name,
          badge: entry.bodyPart,
          meta: formatSetDisplay(
            entry.bestSet.weight,
            entry.bestSet.reps,
            (getExUnit ? getExUnit(entry.name) : unit) || "kg"
          ),
        })),
      };
    }

    return {
      title: "今日のボリューム",
      subtitle: formatVolume(todaySummary.totalVolume),
      emptyText: "今日はまだボリュームがありません",
      items: todayEntries.map((entry) => ({
        key: `${entry.id}-volume`,
        title: entry.name,
        badge: entry.bodyPart,
        meta: `${formatVolume(entry.volume)} ・ ${entry.setCount}セット`,
      })),
    };
  }, [
    selectedSummaryKey,
    todayEntries,
    todayPrEntries,
    todaySummary,
    todayWorkoutLastActivityAt,
    todayWorkoutStartedAt,
    getExUnit,
    unit,
  ]);

  const dayDetails = useMemo(
    () =>
      resolvedEntries
        .filter((entry) => entry.date === selectedDate)
        .map((entry) => ({
          name: entry.name,
          count: entry.setCount,
          sets: entry.sets,
          order: entry.order,
        }))
        .sort((a, b) => a.order - b.order),
    [resolvedEntries, selectedDate]
  );

  const workedLabels = useMemo(
    () => [
      ...new Set(
        resolvedEntries
          .filter((entry) => entry.date === selectedDate)
          .map((entry) => entry.bodyPart)
          .filter(Boolean)
      ),
    ],
    [resolvedEntries, selectedDate]
  );

  const daySummary = useMemo(
    () =>
      dayDetails.reduce((acc, item) => {
        acc[item.name] = (acc[item.name] || 0) + item.count;
        return acc;
      }, {}),
    [dayDetails]
  );

  const totalSets = Object.values(daySummary).reduce((a, b) => a + b, 0);

  return (
    <div
      className="fade-in"
      style={{
        padding: "18px",
        paddingTop: hasTodayWorkout ? "18px" : "30px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {hasTodayWorkout && (
        <>
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                marginBottom: 8,
              }}
            >
              <div style={{ fontSize: 19, fontWeight: 800, color: "var(--text)", flexShrink: 0 }}>
                今日のサマリー
              </div>
              {todayWorkedBodyParts.length > 0 && (
                <div
                  style={{
                    minWidth: 0,
                    flex: 1,
                    display: "flex",
                    justifyContent: "flex-end",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      overflowX: "auto",
                      whiteSpace: "nowrap",
                      paddingBottom: 2,
                      scrollbarWidth: "none",
                      msOverflowStyle: "none",
                    }}
                  >
                    {todayWorkedBodyParts.map((bodyPart) => (
                      <span
                        key={bodyPart}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "4px 9px",
                          borderRadius: 999,
                          background: "rgba(18, 199, 194, 0.08)",
                          border: "1px solid rgba(18, 199, 194, 0.16)",
                          color: "var(--accent-strong, var(--accent))",
                          fontSize: 11,
                          fontWeight: 700,
                          lineHeight: 1,
                          flexShrink: 0,
                        }}
                      >
                        {bodyPart}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
              {summaryCards.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  onClick={() => setSelectedSummaryKey(item.key)}
                  style={{
                    background: "var(--card)",
                    borderRadius: 18,
                    padding: "12px 11px 10px",
                    minHeight: 92,
                    border: "1px solid rgba(18, 199, 194, 0.10)",
                    boxShadow: "0 8px 18px rgba(15, 94, 99, 0.05)",
                    textAlign: "left",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.2 }}>
                    {item.label}
                  </div>
                  <div
                    style={{
                      fontSize: item.key === "totalVolume" ? 16 : 21,
                      fontWeight: 800,
                      color: "var(--text)",
                      lineHeight: 1.05,
                      letterSpacing: item.key === "totalVolume" ? -0.2 : 0,
                    }}
                  >
                    {item.value}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              background: "var(--card)",
              borderRadius: 22,
              padding: "14px 14px 12px",
              border: "1px solid rgba(18, 199, 194, 0.12)",
              boxShadow: "0 12px 30px rgba(15, 94, 99, 0.06)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                marginBottom: 10,
              }}
            >
              <div style={{ fontSize: 19, fontWeight: 800, color: "var(--text)" }}>
                今日のワークアウト
              </div>
              <button
                type="button"
                onClick={() => onLogForDate(todayKey)}
                style={{
                  background: "none",
                  color: "var(--accent)",
                  fontSize: 12,
                  fontWeight: 800,
                  padding: 0,
                }}
              >
                編集
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {visibleTodayWorkouts.map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    background: "linear-gradient(180deg, var(--card2), var(--card))",
                    borderRadius: 17,
                    padding: "9px 10px",
                    border: "1px solid rgba(18, 199, 194, 0.1)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, minWidth: 0 }}>
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
                      {entry.bodyPart}
                    </span>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 800,
                        color: "var(--text)",
                        lineHeight: 1.2,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {entry.name}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text2)", lineHeight: 1.4 }}>
                    {entry.setCount}セット ・ 最大{" "}
                    {entry.maxWeight > 0
                      ? formatWeight(
                          entry.maxWeight,
                          (getExUnit ? getExUnit(entry.name) : unit) || "kg"
                        )
                      : "-"} ・{" "}
                    {formatVolume(entry.volume)}
                  </div>
                </div>
              ))}
              {todayEntries.length > heroWorkoutCards.length && (
                <button
                  type="button"
                  onClick={() => setShowAllTodayWorkouts((prev) => !prev)}
                  style={{
                    fontSize: 11,
                    color: "var(--accent)",
                    textAlign: "center",
                    marginTop: 1,
                    fontWeight: 800,
                    background: "none",
                  }}
                >
                  {showAllTodayWorkouts
                    ? "閉じる"
                    : `さらに ${todayEntries.length - heroWorkoutCards.length} 種目を見る`}
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {!hasTodayWorkout && (
        <div
          style={{
            background: "var(--card)",
            borderRadius: 22,
            padding: "16px 16px 14px",
            border: "1px solid rgba(18, 199, 194, 0.12)",
            boxShadow: "0 12px 30px rgba(15, 94, 99, 0.06)",
            marginTop: 2,
          }}
        >
          <div
            style={{
              background: "linear-gradient(180deg, var(--card2), var(--card))",
              borderRadius: 18,
              padding: "22px 16px",
              border: "1px dashed rgba(18, 199, 194, 0.24)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>
              今日のワークアウトはまだありません
            </div>
            <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5 }}>
              まずは今日のトレーニングを記録しましょう。
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => onLogForDate(todayKey)}
        style={{
          width: "100%",
          padding: "15px 18px",
          borderRadius: 999,
          background: "linear-gradient(135deg, #12C7C2 0%, #33E1DB 100%)",
          color: "#fff",
          fontSize: 16,
          fontWeight: 800,
          boxShadow: "0 16px 30px rgba(18, 199, 194, 0.24)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
        }}
      >
        <span style={{ fontSize: 20, lineHeight: 1 }}>＋</span>
        <span>{hasTodayWorkout ? "追加で記録" : "ワークアウトを記録"}</span>
      </button>

      <details
        style={{
          background: "var(--card)",
          borderRadius: 24,
          border: "1px solid rgba(18, 199, 194, 0.1)",
          boxShadow: "0 10px 26px rgba(15, 94, 99, 0.06)",
          overflow: "hidden",
        }}
      >
        <summary
          style={{
            listStyle: "none",
            cursor: "pointer",
            padding: "14px 16px",
            fontSize: 14,
            fontWeight: 800,
            color: "var(--text)",
          }}
        >
          カレンダーを見る
        </summary>
        <div style={{ padding: "0 16px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 10 }}>
            過去日の記録確認や編集もここからできます
          </div>
          <div
            style={{
              background: "linear-gradient(180deg, var(--card2), var(--card))",
              borderRadius: 18,
              padding: 14,
              border: "1px solid rgba(18, 199, 194, 0.08)",
            }}
          >
            <CalendarView
              history={history}
              muscleEx={muscleEx}
              hiddenBodyParts={hiddenBodyParts}
              exerciseBodyPartOverrides={exerciseBodyPartOverrides}
              onDayOpen={(date) => {
                const hasData = Object.values(history || {}).some((records) =>
                  (records || []).some((record) => record.date === date)
                );

                if (hasData) {
                  setSelectedDate(date);
                } else {
                  onLogForDate(date);
                }
              }}
            />
          </div>
        </div>
      </details>

      {editTarget && (
        <HistoryEditModal
          exName={editTarget.exName}
          record={editTarget.record}
          onSave={(exName, updatedRecord) => {
            onEditHistory(exName, updatedRecord, editTarget.historyIdx);
            setEditTarget(null);
          }}
          onDelete={() => {
            onDeleteHistory(editTarget.exName, editTarget.historyIdx, editTarget.record?.date);
            setEditTarget(null);
          }}
          onClose={() => setEditTarget(null)}
        />
      )}

      <ManualBestModal
        isOpen={showManualBestModal}
        mode={editingManualBest ? "edit" : "create"}
        initialValue={editingManualBest}
        customBodyParts={customBodyParts}
        onClose={() => {
          setShowManualBestModal(false);
          setEditingManualBest(null);
        }}
        onSave={async (payload) => {
          if (!user?.id) return;

          if (editingManualBest) {
            const { data, error } = await supabase
              .from("manual_bests")
              .update({
                exercise_name: payload.exercise_name,
                weight: payload.weight,
                reps: payload.reps,
                best_date: payload.best_date,
                body_part: payload.body_part,
              })
              .eq("id", editingManualBest.id)
              .eq("user_id", user.id)
              .select("id, exercise_name, weight, reps, best_date, body_part, created_at")
              .single();

            if (error) throw error;

            onUpdateManualBest?.(data);
            return;
          }

          const { data, error } = await supabase
            .from("manual_bests")
            .insert({
              user_id: user.id,
              exercise_name: payload.exercise_name,
              weight: payload.weight,
              reps: payload.reps,
              best_date: payload.best_date,
              body_part: payload.body_part,
            })
            .select("id, exercise_name, weight, reps, best_date, body_part, created_at")
            .single();

          if (error) throw error;

          onAddManualBest?.(data);
        }}
      />

      <ManualBestManagerModal
        isOpen={showManualBestManager}
        user={user}
        manualBests={manualBests}
        customBodyParts={customBodyParts}
        onClose={() => setShowManualBestManager(false)}
        onOpenRegister={openManualBestModalForCreate}
        onOpenAddBodyPart={openCustomBodyPartModal}
        onEditBest={openManualBestModalForEdit}
        onDeleteBest={async (best) => {
          const confirmed = window.confirm(`${best.exercise_name} の過去ベストを削除しますか？`);
          if (!confirmed) return;

          const { error } = await supabase
            .from("manual_bests")
            .delete()
            .eq("id", best.id)
            .eq("user_id", user.id);

          if (error) {
            console.error(error);
            return;
          }

          onDeleteManualBest?.(best.id);
        }}
      />

      <CustomBodyPartModal
        isOpen={showCustomBodyPartModal}
        customBodyParts={customBodyParts}
        onClose={() => setShowCustomBodyPartModal(false)}
        onSave={(bodyPart) => {
          onAddCustomBodyPart?.(bodyPart);
          setShowCustomBodyPartModal(false);
        }}
      />

      {selectedDate && Object.keys(daySummary).length > 0 && (
        <div
          onClick={() => setSelectedDate(null)}
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
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 430,
              background: "var(--card)",
              borderRadius: 20,
              padding: "18px 16px 20px",
              border: "1px solid var(--border2)",
              maxHeight: "60vh",
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

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{selectedDate}</div>
            </div>

            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 10,
                background: "var(--card)",
                paddingBottom: 12,
                marginBottom: 4,
              }}
            >
              <button
                onClick={() => onLogForDate(selectedDate)}
                style={{
                  width: "100%",
                  borderRadius: 18,
                  padding: "16px",
                  fontSize: 15,
                  fontWeight: 700,
                  background: "var(--card2)",
                  color: "var(--text)",
                }}
              >
                記録を開く
              </button>
            </div>

            <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 12 }}>
              合計 {totalSets} セット
            </div>

            <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 12 }}>
              {workedLabels.join(" / ")}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {dayDetails.map(({ name, count, sets }) => {
                const isOpen = !!openExercises[name];

                return (
                  <HistoryExerciseItem
                    key={name}
                    name={name}
                    count={count}
                    sets={sets}
                    isOpen={isOpen}
                    onToggle={() =>
                      setOpenExercises((prev) => ({
                        ...prev,
                        [name]: !prev[name],
                      }))
                    }
                    onDeleteSet={(setIdx) =>
                      onDeleteHistory?.(name, undefined, selectedDate, setIdx)
                    }
                  />
                );
              })}
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
                marginTop: 20,
                paddingTop: 6,
              }}
            >
              <button
                onClick={() => {
                  if (!selectedDate) return;
                  const confirmed = window.confirm(`${selectedDate} の記録を削除しますか？`);
                  if (!confirmed) return;
                  onDeleteDate?.(selectedDate);
                  setSelectedDate(null);
                }}
                style={{
                  width: "100%",
                  border: "1px solid var(--border2)",
                  borderRadius: 18,
                  padding: "14px",
                  fontSize: 13,
                  fontWeight: 600,
                  background: "transparent",
                  color: "var(--text3)",
                  marginTop: 8,
                }}
              >
                この日の記録を削除
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedSummary && (
        <div
          onClick={() => setSelectedSummaryKey(null)}
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
            onClick={(e) => e.stopPropagation()}
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
                {selectedSummary.title}
              </div>
              <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4 }}>
                {selectedSummary.subtitle}
              </div>
            </div>

            {selectedSummary.items.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {selectedSummary.items.map((item) => (
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
                {selectedSummary.emptyText}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
