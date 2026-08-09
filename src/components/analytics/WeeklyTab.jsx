import { useMemo, useState } from "react";
import {
  FIXED_BODY_PART_LABELS,
  buildWeeklyBodyPartSetCounts,
  buildLastWeekComparison,
  getCurrentWeekBoundaries,
} from "./analyticsUtils";

const TRACKED_BODY_PARTS = FIXED_BODY_PART_LABELS.filter((bp) => bp !== "その他");

function getCurrentWeekDayIndex(weekStartDay = 1) {
  const today = new Date();
  const day = today.getDay(); // 0=Sun
  const startDow = Number(weekStartDay);
  return (day - startDow + 7) % 7;
}

function getProgressColor(ratio, isLateWeek) {
  if (ratio >= 1.0) return "#55D89E";
  if (ratio < 0.7 && isLateWeek) return "#F6A623";
  return "var(--text2)";
}

export default function WeeklyTab({
  history,
  muscleEx = {},
  exerciseBodyPartOverrides = {},
  weekStartDay = 1,
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

  const comparison = useMemo(
    () => buildLastWeekComparison(history, weekStartDay, muscleEx, exerciseBodyPartOverrides),
    [history, weekStartDay, muscleEx, exerciseBodyPartOverrides]
  );

  const { start: currentWeekStart } = useMemo(
    () => getCurrentWeekBoundaries(weekStartDay),
    [weekStartDay]
  );
  void currentWeekStart;

  // target=0 の部位は done≥1 のときだけ表示
  const partsToShow = TRACKED_BODY_PARTS.filter((bp) => {
    const target = weeklySetTargets[bp] ?? 10;
    const done = weeklySetCounts[bp] || 0;
    return target > 0 || done >= 1;
  });
  const displayParts = partsToShow.length ? partsToShow : TRACKED_BODY_PARTS;

  // 先週比較：目標0部位除外 & 両週とも0は除外
  const comparisonParts = displayParts.filter((bp) => {
    const thisW = comparison.thisWeek[bp] || 0;
    const lastW = comparison.lastWeek[bp] || 0;
    return thisW > 0 || lastW > 0;
  });

  const daysElapsed = comparison.daysElapsed;
  const isFullWeek = daysElapsed >= 7;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* 今週のセット数 */}
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

      {/* 先週との比較 */}
      {comparisonParts.length > 0 && (
        <div style={{
          background: "var(--card)",
          borderRadius: 20,
          padding: "16px 18px",
          border: "1px solid rgba(18, 199, 194, 0.10)",
          boxShadow: "var(--shadow-soft)",
        }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: "var(--text2)", marginBottom: 4 }}>先週との比較</div>
          {!isFullWeek && (
            <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text3)", marginBottom: 12 }}>
              今週は{daysElapsed}日経過（先週は7日間の合計）
            </div>
          )}
          {isFullWeek && (
            <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text3)", marginBottom: 12 }}>
              今週も7日経過
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {comparisonParts.map((bp) => {
              const thisW = comparison.thisWeek[bp] || 0;
              const lastW = comparison.lastWeek[bp] || 0;
              const diff = thisW - lastW;
              const isUp = diff > 0;
              const isDown = diff < 0;
              const diffColor = isUp ? "#55D89E" : isDown ? "#F6A623" : "var(--text3)";
              const arrow = isUp ? "↑" : isDown ? "↓" : "→";

              return (
                <div key={bp} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 900, color: "var(--text)", minWidth: 40 }}>{bp}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text3)" }}>{lastW}</span>
                  <span style={{ fontSize: 11, color: "var(--text3)" }}>→</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>{thisW}set</span>
                  <span style={{ fontSize: 12, fontWeight: 900, color: diffColor, marginLeft: 2 }}>
                    {diff === 0 ? "→" : `${arrow}${Math.abs(diff)}`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
