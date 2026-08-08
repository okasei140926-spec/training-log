import { useMemo, useState } from "react";
import {
  FIXED_BODY_PART_LABELS,
  buildWeeklyBodyPartSetCounts,
  buildEightWeekHeatmap,
  getCurrentWeekBoundaries,
} from "./analyticsUtils";

const TRACKED_BODY_PARTS = FIXED_BODY_PART_LABELS.filter((bp) => bp !== "その他");

function getCurrentWeekDayIndex(weekStartDay = "monday") {
  const today = new Date();
  const day = today.getDay(); // 0=Sun
  return weekStartDay === "sunday" ? day : (day === 0 ? 6 : day - 1);
}

function getProgressColor(ratio, isLateWeek) {
  if (ratio >= 1.0) return "#55D89E";
  if (ratio < 0.7 && isLateWeek) return "#F6A623";
  return "var(--text2)";
}

function getHeatmapCellColor(days) {
  if (days === 0) return "rgba(130,150,155,0.18)";
  if (days === 1) return "rgba(18,199,194,0.42)";
  return "rgba(18,199,194,0.88)";
}

function getHeatmapCellBorder(days, isCurrentWeek) {
  if (isCurrentWeek) return "1.5px solid rgba(18,199,194,0.45)";
  if (days === 0) return "1px solid rgba(130,150,155,0.30)";
  return "1px solid transparent";
}

function getHeatmapNumberColor(days) {
  if (days === 1) return "rgba(18,199,194,0.95)";
  return "#fff";
}

export default function WeeklyTab({
  history,
  muscleEx = {},
  exerciseBodyPartOverrides = {},
  weekStartDay = "monday",
  weeklySetTargets = {},
  setWeeklySetTargets,
}) {
  const [editingBp, setEditingBp] = useState(null);
  const [showHint, setShowHint] = useState(() => {
    try { return !localStorage.getItem("weeklyTargetHintDone"); } catch { return false; }
  });

  const isLateWeek = getCurrentWeekDayIndex(weekStartDay) >= 3;

  const dismissHint = () => {
    try { localStorage.setItem("weeklyTargetHintDone", "1"); } catch {}
    setShowHint(false);
  };

  const handleTargetChange = (bp, delta) => {
    if (!setWeeklySetTargets) return;
    setWeeklySetTargets((prev) => {
      const current = prev[bp] ?? 10;
      const next = Math.max(0, Math.min(50, current + delta));
      return { ...prev, [bp]: next };
    });
  };

  const weeklySetCounts = useMemo(
    () => buildWeeklyBodyPartSetCounts(history, weekStartDay, muscleEx, exerciseBodyPartOverrides),
    [history, weekStartDay, muscleEx, exerciseBodyPartOverrides]
  );

  const heatmapData = useMemo(
    () => buildEightWeekHeatmap(history, weekStartDay, muscleEx, exerciseBodyPartOverrides),
    [history, weekStartDay, muscleEx, exerciseBodyPartOverrides]
  );

  const { start: currentWeekStart } = useMemo(
    () => getCurrentWeekBoundaries(weekStartDay),
    [weekStartDay]
  );

  // target=0 の部位は done≥1 のときだけ表示（グレー表示）
  const partsToShow = TRACKED_BODY_PARTS.filter((bp) => {
    const target = weeklySetTargets[bp] ?? 10;
    const done = weeklySetCounts[bp] || 0;
    return target > 0 || done >= 1;
  });
  const displayParts = partsToShow.length ? partsToShow : TRACKED_BODY_PARTS;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Progress bars */}
      <div style={{
        background: "var(--card)",
        borderRadius: 20,
        padding: "16px 18px",
        border: "1px solid rgba(18, 199, 194, 0.10)",
        boxShadow: "var(--shadow-soft)",
      }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: "var(--text2)", marginBottom: showHint ? 8 : 14 }}>今週のセット数</div>
        {showHint && (
          <div
            onClick={dismissHint}
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: "var(--accent)",
              background: "rgba(18,199,194,0.08)",
              borderRadius: 8,
              padding: "6px 10px",
              marginBottom: 12,
              cursor: "pointer",
            }}
          >
            目標はタップで変更できます　✕
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {displayParts.map((bp) => {
            const done = weeklySetCounts[bp] || 0;
            const target = weeklySetTargets[bp] ?? 10;
            const isZeroTarget = target === 0;
            const ratio = target > 0 ? done / target : (done > 0 ? 1 : 0);
            const color = isZeroTarget ? "var(--text3)" : getProgressColor(ratio, isLateWeek);
            const remaining = Math.max(0, target - done);
            const isEditing = editingBp === bp;
            return (
              <div key={bp}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: isZeroTarget ? 0 : 5 }}>
                  <span style={{ fontSize: 13, fontWeight: 900, color: isZeroTarget ? "var(--text3)" : "var(--text)", minWidth: 40 }}>{bp}</span>
                  {isEditing ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        onClick={() => handleTargetChange(bp, -1)}
                        style={{
                          width: 28, height: 28, borderRadius: 8,
                          background: "rgba(130,150,155,0.15)",
                          border: "none", color: "var(--text)", fontSize: 16, fontWeight: 900,
                          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                        }}
                      >−</button>
                      <span style={{ fontSize: 14, fontWeight: 900, color: "var(--accent)", minWidth: 32, textAlign: "center" }}>
                        {target}set
                      </span>
                      <button
                        onClick={() => handleTargetChange(bp, 1)}
                        style={{
                          width: 28, height: 28, borderRadius: 8,
                          background: "rgba(130,150,155,0.15)",
                          border: "none", color: "var(--text)", fontSize: 16, fontWeight: 900,
                          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                        }}
                      >+</button>
                      <button
                        onClick={() => setEditingBp(null)}
                        style={{
                          padding: "4px 10px", borderRadius: 8,
                          background: "var(--accent)", border: "none",
                          color: "#fff", fontSize: 11, fontWeight: 900, cursor: "pointer",
                        }}
                      >完了</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span
                        style={{ fontSize: 13, fontWeight: 900, color, cursor: "pointer" }}
                        onClick={() => { setEditingBp(bp); if (showHint) dismissHint(); }}
                      >
                        {done}
                        <span style={{ color: "var(--text3)", fontSize: 11, fontWeight: 800 }}>/{target}set</span>
                      </span>
                      {!isZeroTarget && remaining > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 800, color: (ratio < 0.7 && isLateWeek) ? "#F6A623" : "var(--text3)" }}>
                          あと{remaining}
                        </span>
                      )}
                      {!isZeroTarget && ratio >= 1 && (
                        <span style={{ fontSize: 12, fontWeight: 900, color: "#55D89E" }}>✓</span>
                      )}
                    </div>
                  )}
                </div>
                {!isZeroTarget && (
                  <div style={{ height: 5, borderRadius: 999, background: "rgba(130,150,155,0.18)", overflow: "hidden" }}>
                    <div style={{
                      height: "100%",
                      width: `${Math.min(ratio * 100, 100)}%`,
                      borderRadius: 999,
                      background: color,
                      transition: "width 0.3s ease",
                    }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 8-week heatmap */}
      <div style={{
        background: "var(--card)",
        borderRadius: 20,
        padding: "16px 18px",
        border: "1px solid rgba(18, 199, 194, 0.10)",
        boxShadow: "var(--shadow-soft)",
      }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: "var(--text2)", marginBottom: 14 }}>直近8週間の頻度</div>
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <div style={{ minWidth: "max-content" }}>
            {/* Week labels header */}
            <div style={{ display: "flex", alignItems: "center", marginBottom: 4, paddingLeft: 44 }}>
              {heatmapData.map((week, i) => {
                const isCurrentWeek = week.start === currentWeekStart;
                const d = new Date(`${week.start}T00:00:00`);
                const label = `${d.getMonth() + 1}/${d.getDate()}`;
                const showLabel = i === 0 || i === 4 || i === 7;
                return (
                  <div key={week.start} style={{
                    width: 28,
                    textAlign: "center",
                    fontSize: 10,
                    fontWeight: isCurrentWeek ? 900 : 700,
                    color: isCurrentWeek ? "var(--accent)" : "var(--text3)",
                    marginRight: 3,
                  }}>
                    {showLabel ? label : ""}
                  </div>
                );
              })}
            </div>

            {/* Body part rows */}
            {TRACKED_BODY_PARTS.map((bp) => (
              <div key={bp} style={{ display: "flex", alignItems: "center", marginBottom: 3 }}>
                <div style={{
                  width: 40,
                  fontSize: 11,
                  fontWeight: 800,
                  color: "var(--text2)",
                  flexShrink: 0,
                }}>
                  {bp}
                </div>
                {heatmapData.map((week) => {
                  const days = week.daysByBodyPart[bp] || 0;
                  const isCurrentWeek = week.start === currentWeekStart;
                  return (
                    <div key={week.start} style={{
                      width: 24,
                      height: 24,
                      borderRadius: 5,
                      background: getHeatmapCellColor(days),
                      border: getHeatmapCellBorder(days, isCurrentWeek),
                      marginRight: 3,
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}>
                      {days >= 1 && (
                        <span style={{
                          fontSize: 9,
                          fontWeight: 900,
                          color: getHeatmapNumberColor(days),
                          lineHeight: 1,
                        }}>
                          {days}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "var(--text3)", fontWeight: 800 }}>トレーニング日数</span>
          {[
            { n: 0, label: "0日" },
            { n: 1, label: "1日" },
            { n: 2, label: "2日以上" },
          ].map(({ n, label }) => (
            <div key={n} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{
                width: 11,
                height: 11,
                borderRadius: 3,
                background: getHeatmapCellColor(n),
                border: n === 0 ? "1px solid rgba(130,150,155,0.30)" : "none",
              }} />
              <span style={{ fontSize: 10, color: "var(--text3)", fontWeight: 800 }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
