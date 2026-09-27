import { useState } from "react";
import { resolveRecordedBodyPartLabel } from "../utils/bodyPartClassification";
import {
  getValidWorkoutDatesFromHistory,
  sanitizeHistoryRecord,
} from "../utils/helpers";

// 6グループへの集約マッピング
const CALENDAR_LEGEND = ["胸", "背中", "脚", "肩", "二頭", "三頭"];

const CALENDAR_GROUP_COLORS = {
  胸: "#FF5A5A",
  背中: "#4D9FFF",
  脚: "#FBBF24",
  肩: "#4ECDC4",
  二頭: "#A855F7",
  三頭: "#F472B6",
};

// resolveRecordedBodyPartLabel の返却ラベル → カレンダーグループ
const BODY_PART_TO_CALENDAR_GROUP = {
  胸: "胸",
  背中: "背中",
  四頭: "脚",
  ハム: "脚",
  ハムストリングス: "脚",
  尻: "脚",
  臀部: "脚",
  カーフ: "脚",
  下腿: "脚",
  脚: "脚",
  下半身: "脚",
  肩: "肩",
  二頭: "二頭",
  三頭: "三頭",
  // 腹筋・その他 → undefined → 点を表示しない
};

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

export default function CalendarView({
  history,
  onDayOpen,
  muscleEx = {},
  hiddenBodyParts = [],
  exerciseBodyPartOverrides = {},
  // Earliest navigable month as "YYYY-MM". null means no limit (Pro users).
  minYearMonth = null,
  // Called with "YYYY-MM" when the user navigates to a different month.
  onMonthChange = null,
}) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const safeHistory = history || {};

  // date → Set<グループ名>
  const dateLabelGroupSets = {};
  Object.entries(safeHistory).forEach(([exName, recs]) => {
    (recs || []).forEach((r) => {
      const sanitized = sanitizeHistoryRecord(r, { allowBodyweight: true });
      if (!sanitized?.date || !sanitized.sets?.length) return;
      const label = resolveRecordedBodyPartLabel(sanitized, exName, {
        muscleEx,
        hiddenBodyParts,
        exerciseBodyPartOverrides,
      });
      const group = label ? BODY_PART_TO_CALENDAR_GROUP[label] : null;
      if (!group) return;
      if (!dateLabelGroupSets[sanitized.date]) dateLabelGroupSets[sanitized.date] = new Set();
      dateLabelGroupSets[sanitized.date].add(group);
    });
  });
  // CALENDAR_LEGEND の順に並べた色配列に変換
  const dateLabelColors = {};
  Object.entries(dateLabelGroupSets).forEach(([date, groupSet]) => {
    dateLabelColors[date] = CALENDAR_LEGEND
      .filter((g) => groupSet.has(g))
      .map((g) => CALENDAR_GROUP_COLORS[g]);
  });

  const trainedDates = new Set(getValidWorkoutDatesFromHistory(safeHistory));

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr =
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const currentYearMonth = `${year}-${String(month + 1).padStart(2, "0")}`;
  const isAtMinMonth = Boolean(minYearMonth && currentYearMonth <= minYearMonth);

  const prevMonth = () => {
    if (isAtMinMonth) return;
    let nextYear = year;
    let nextMonth_;
    if (month === 0) {
      nextYear = year - 1;
      nextMonth_ = 11;
    } else {
      nextMonth_ = month - 1;
    }
    setYear(nextYear);
    setMonth(nextMonth_);
    const ym = `${nextYear}-${String(nextMonth_ + 1).padStart(2, "0")}`;
    if (onMonthChange) onMonthChange(ym);
  };

  const nextMonth = () => {
    let nextYear = year;
    let nextMonth_;
    if (month === 11) {
      nextYear = year + 1;
      nextMonth_ = 0;
    } else {
      nextMonth_ = month + 1;
    }
    setYear(nextYear);
    setMonth(nextMonth_);
    const ym = `${nextYear}-${String(nextMonth_ + 1).padStart(2, "0")}`;
    if (onMonthChange) onMonthChange(ym);
  };

  const toStr = (d) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthWorkouts = [...trainedDates].filter((d) => d.startsWith(monthPrefix)).length;

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <button
          onClick={prevMonth}
          disabled={isAtMinMonth}
          style={{
            background: "none",
            color: isAtMinMonth ? "var(--text5)" : "var(--text2)",
            fontSize: 24,
            padding: "4px 10px",
            opacity: isAtMinMonth ? 0.35 : 1,
            cursor: isAtMinMonth ? "default" : "pointer",
          }}
        >‹</button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>{year}年{month + 1}月</div>
          <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>{monthWorkouts}日トレーニング</div>
        </div>
        <button onClick={nextMonth} style={{ background: "none", color: "var(--text2)", fontSize: 24, padding: "4px 10px" }}>›</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 6 }}>
        {WEEK.map((d, i) => (
          <div
            key={d}
            style={{
              textAlign: "center",
              fontSize: 10,
              fontWeight: 700,
              padding: "4px 0",
              color: i === 0 ? "#FF4D4D" : i === 6 ? "#4D9FFF" : "var(--text2)",
            }}
          >
            {d}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const ds = toStr(d);
          const worked = trainedDates.has(ds);
          const isToday = ds === todayStr;
          const dow = (firstDow + d - 1) % 7;
          const colors = dateLabelColors[ds] || [];

          return (
            <div
              key={ds}
              onClick={() => onDayOpen?.(ds)}
              style={{
                padding: "8px 2px",
                borderRadius: 10,
                cursor: "pointer",
                background: isToday ? "#111" : "transparent",
                border: "2px solid transparent",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: isToday ? 800 : 400,
                  color: isToday ? "#fff" : dow === 0 ? "#FF4D4D" : dow === 6 ? "#4D9FFF" : "var(--text)",
                }}
              >
                {d}
              </div>

              {worked ? (
                <div style={{ display: "flex", gap: 1.5, justifyContent: "center", minHeight: 5 }}>
                  {colors.map((col, ci) => (
                    <div
                      key={ci}
                      style={{ width: 4, height: 4, borderRadius: "50%", background: isToday ? "rgba(255,255,255,0.85)" : col, flexShrink: 0 }}
                    />
                  ))}
                </div>
              ) : (
                <div style={{ height: 5 }} />
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: "3px 10px", marginTop: 10 }}>
        {CALENDAR_LEGEND.map((group) => (
          <div key={group} style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: CALENDAR_GROUP_COLORS[group], flexShrink: 0 }} />
            <span style={{ fontSize: 9, color: "var(--text3)", fontWeight: 700 }}>{group}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
