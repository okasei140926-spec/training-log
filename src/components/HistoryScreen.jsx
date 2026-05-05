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
  formatDateKey,
  hasMeaningfulPRIncrease,
  sanitizeHistoryRecord,
  sanitizeWorkoutSets,
} from "../utils/helpers";
import { normalizeExerciseName } from "../utils/exerciseName";

const formatVolume = (value) => `${Math.round(Number(value || 0)).toLocaleString("ja-JP")}kg`;

const buildGreetingPrefix = (date) => {
  const hour = date.getHours();
  if (hour < 11) return "おはよう";
  if (hour < 18) return "こんにちは";
  return "おつかれさま";
};

export default function HistoryScreen({
  history,
  muscleEx,
  exerciseBodyPartOverrides = {},
  onEditHistory,
  onDeleteHistory,
  onDeleteDate,
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
  const [openExercises, setOpenExercises] = useState({});

  const today = new Date();
  const todayKey = formatDateKey(today);

  const userName = useMemo(() => {
    const metadata = user?.user_metadata || {};
    const emailPrefix = String(user?.email || "").split("@")[0] || "";
    return String(
      metadata.user_name ||
        metadata.preferred_username ||
        metadata.username ||
        metadata.full_name ||
        metadata.name ||
        emailPrefix ||
        ""
    ).trim();
  }, [user]);

  const userAvatarUrl = useMemo(() => {
    const metadata = user?.user_metadata || {};
    return metadata.avatar_url || metadata.picture || metadata.photo_url || "";
  }, [user]);

  const greetingPrefix = buildGreetingPrefix(today);

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
    if (selectedDate) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [selectedDate]);

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

  const todaySummary = useMemo(() => {
    const previousSetsMap = {};

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
        if (!previousSetsMap[key]) previousSetsMap[key] = [];
        previousSetsMap[key].push(...sanitizeWorkoutSets(sanitized.sets, { allowBodyweight: false }));
      });
    });

    (manualBests || []).forEach((entry) => {
      const bodyPart = String(entry?.body_part || "").trim();
      if (!bodyPart || hiddenBodyParts.includes(bodyPart)) return;

      const key = `${bodyPart}::${normalizeExerciseName(entry?.exercise_name)}`;
      if (!previousSetsMap[key]) previousSetsMap[key] = [];
      previousSetsMap[key].push(
        ...sanitizeWorkoutSets([{ weight: entry.weight, reps: entry.reps }], {
          allowBodyweight: false,
        })
      );
    });

    const prCount = todayEntries.reduce((count, entry) => {
      const previousSets =
        previousSetsMap[`${entry.bodyPart}::${normalizeExerciseName(entry.name)}`] || [];
      return (
        count +
        (hasMeaningfulPRIncrease(entry.sets, previousSets, null, PR_UPDATE_TOLERANCE_KG)
          ? 1
          : 0)
      );
    }, 0);

    return {
      exerciseCount: todayEntries.length,
      setCount: todayEntries.reduce((sum, entry) => sum + entry.setCount, 0),
      totalVolume: Math.round(todayEntries.reduce((sum, entry) => sum + entry.volume, 0)),
      prCount,
    };
  }, [
    exerciseBodyPartOverrides,
    hiddenBodyParts,
    history,
    manualBests,
    muscleEx,
    todayEntries,
    todayKey,
  ]);

  const heroWorkoutCards = todayEntries.slice(0, 3);

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
      style={{ padding: "18px", display: "flex", flexDirection: "column", gap: 14 }}
    >
      <div
        style={{
          background: "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(255,255,255,0.88))",
          borderRadius: 22,
          padding: "12px 14px",
          border: "1px solid rgba(18, 199, 194, 0.12)",
          boxShadow: "0 12px 30px rgba(15, 94, 99, 0.08)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        {userAvatarUrl ? (
          <img
            src={userAvatarUrl}
            alt="profile"
            style={{
              width: 42,
              height: 42,
              borderRadius: "50%",
              objectFit: "cover",
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: "50%",
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              background: "linear-gradient(135deg, #33E1DB, #12C7C2)",
              color: "#fff",
              fontSize: 16,
              fontWeight: 800,
              boxShadow: "0 10px 22px rgba(18, 199, 194, 0.18)",
            }}
          >
            {userName ? userName.slice(0, 1).toUpperCase() : "P"}
          </div>
        )}
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text)", lineHeight: 1.25 }}>
            {userName ? `${greetingPrefix}、${userName}さん！` : `${greetingPrefix}！`}
          </div>
          <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2, lineHeight: 1.35 }}>
            今日も最高のトレーニングを。
          </div>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 19, fontWeight: 800, color: "var(--text)", marginBottom: 10 }}>
          今日のサマリー
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          {[
            { icon: "🏋️", label: "種目数", value: `${todaySummary.exerciseCount}` },
            { icon: "✅", label: "セット数", value: `${todaySummary.setCount}` },
            { icon: "📈", label: "Volume", value: formatVolume(todaySummary.totalVolume) },
            { icon: "🏆", label: "PR更新", value: `${todaySummary.prCount}件` },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                background: "var(--card)",
                borderRadius: 20,
                padding: "12px 12px 11px",
                border: "1px solid rgba(18, 199, 194, 0.12)",
                boxShadow: "0 12px 28px rgba(15, 94, 99, 0.06)",
              }}
            >
              <div style={{ fontSize: 20, marginBottom: 6 }}>{item.icon}</div>
              <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 2 }}>
                {item.label}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text)", lineHeight: 1.15 }}>
                {item.value}
              </div>
            </div>
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

        {heroWorkoutCards.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {heroWorkoutCards.map((entry) => (
              <div
                key={entry.id}
                style={{
                  background: "linear-gradient(180deg, var(--card2), var(--card))",
                  borderRadius: 17,
                  padding: "10px 11px",
                  border: "1px solid rgba(18, 199, 194, 0.1)",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
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
                      }}
                    >
                      {entry.bodyPart}
                    </span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", lineHeight: 1.25 }}>
                    {entry.name}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2, lineHeight: 1.35 }}>
                    {entry.setCount}セット ・ 最大{" "}
                    {entry.maxWeight > 0
                      ? `${Math.round(entry.maxWeight * 10) / 10}kg`
                      : "-"}
                  </div>
                </div>
                <div style={{ flexShrink: 0, textAlign: "right" }}>
                  <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 2 }}>
                    Volume
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", lineHeight: 1.2 }}>
                    {formatVolume(entry.volume)}
                  </div>
                </div>
              </div>
            ))}
            {todayEntries.length > heroWorkoutCards.length && (
              <div style={{ fontSize: 11, color: "var(--text3)", textAlign: "center", marginTop: 1 }}>
                さらに {todayEntries.length - heroWorkoutCards.length} 種目あります
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              background: "linear-gradient(180deg, var(--card2), var(--card))",
              borderRadius: 18,
              padding: "18px 14px",
              border: "1px dashed rgba(18, 199, 194, 0.24)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", marginBottom: 4 }}>
              今日のワークアウトはまだありません
            </div>
            <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.45 }}>
              下のボタンから、今日のトレーニングを記録しましょう。
            </div>
          </div>
        )}
      </div>

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
        <span>ワークアウトを記録</span>
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

      <div
        style={{
          background: "var(--card)",
          borderRadius: 18,
          padding: "12px 14px",
          border: "1px solid rgba(18, 199, 194, 0.08)",
          boxShadow: "0 10px 22px rgba(15, 94, 99, 0.05)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 11, color: "var(--text2)", lineHeight: 1.45 }}>
          移行用に、過去の自己ベストだけ先に登録できます
        </div>
        <button
          onClick={() => setShowManualBestManager(true)}
          disabled={!user}
          style={{
            padding: "8px 11px",
            borderRadius: 12,
            background: "var(--card2)",
            border: "1px solid var(--border2)",
            color: "var(--text)",
            fontSize: 11,
            fontWeight: 800,
            opacity: user ? 1 : 0.6,
          }}
        >
          過去ベスト
        </button>
      </div>

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
    </div>
  );
}
