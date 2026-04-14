import { useState } from "react";
import { dispW } from "../utils/helpers";
import { LABEL_COLORS, SUGGESTIONS } from "../constants/suggestions";

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

// reverse map: exercise name → muscle label
const EX_TO_LABEL = {};
Object.entries(SUGGESTIONS).forEach(([label, names]) => {
  names.forEach(n => { EX_TO_LABEL[n] = label; });
});

export default function CalendarView({ history, logData, unit = "kg", onEditRecord, onLogForDate }) {
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(today.toISOString().split("T")[0]);

  // Build date → Set<label> map for colored dots
  const dateLabelColors = {};
  Object.entries(history).forEach(([exName, recs]) => {
    const label = EX_TO_LABEL[exName];
    recs.forEach(r => {
      if (!dateLabelColors[r.date]) dateLabelColors[r.date] = [];
      const color = label ? LABEL_COLORS[label] : "#4ade80";
      if (!dateLabelColors[r.date].includes(color)) dateLabelColors[r.date].push(color);
    });
  });

  const trainedDates = new Set(
    Object.values(history).flatMap(recs => recs.map(r => r.date))
  );

  const firstDow    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr    = today.toISOString().split("T")[0];

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); };

  const toStr = (d) => `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const monthWorkouts = [...trainedDates].filter(d => d.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)).length;

  const getDateExercises = (dateStr) => {
  // 保存済み
  const saved = Object.entries(history)
    .filter(([, recs]) => recs.some(r => r.date === dateStr))
    .map(([name, recs]) => ({
      name,
      record: recs.find(r => r.date === dateStr)
    }));

  // 今日の編集中（logData）
  const todayStr = new Date().toISOString().split("T")[0];

  if (dateStr !== todayStr) return saved;

  const draft = Object.entries(logData || {})
    .map(([name, sets]) => {
      const valid = sets.filter(s => s.weight && s.reps);
      if (!valid.length) return null;
      return {
        name,
        record: { sets: valid, date: todayStr }
      };
    })
    .filter(Boolean);

  // 重複防止（draft優先）
  const merged = [...saved];

  draft.forEach(s => {
    if (!merged.find(d => d.name === s.name)) {
      merged.push(s);
    }
  });

  return merged;
};

  const handleDayClick = (ds) => {
    setSelectedDate(prev => prev === ds ? null : ds);
  };

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <button onClick={prevMonth} style={{ background: "none", color: "var(--text2)", fontSize: 24, padding: "4px 10px" }}>‹</button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>{year}年{month + 1}月</div>
          <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>{monthWorkouts}日トレーニング</div>
        </div>
        <button onClick={nextMonth} style={{ background: "none", color: "var(--text2)", fontSize: 24, padding: "4px 10px" }}>›</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 6 }}>
        {WEEK.map((d, i) => (
          <div key={d} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, padding: "4px 0",
            color: i === 0 ? "#FF4D4D" : i === 6 ? "#4D9FFF" : "var(--text2)" }}>
            {d}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const ds       = toStr(d);
          const worked   = trainedDates.has(ds);
          const isToday  = ds === todayStr;
          const isSelected = ds === selectedDate;
          const dow      = (firstDow + d - 1) % 7;
          const colors   = dateLabelColors[ds] || [];
          return (
            <div key={ds}
              onClick={() => handleDayClick(ds)}
              style={{
                padding: "8px 2px", borderRadius: 10, cursor: "pointer",
                background: isSelected ? "#4ade8022" : isToday ? "var(--border2)" : "transparent",
                border: `1px solid ${isSelected ? "#4ade80" : isToday ? "var(--text2)" : "transparent"}`,
                display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              }}>
              <div style={{ fontSize: 13, fontWeight: isToday ? 800 : 400,
                color: dow === 0 ? "#FF4D4D" : dow === 6 ? "#4D9FFF" : "var(--text)" }}>
                {d}
              </div>
              {worked ? (
                <div style={{ display: "flex", gap: 2, justifyContent: "center", flexWrap: "wrap", minHeight: 6 }}>
                  {colors.slice(0, 3).map((col, ci) => (
                    <div key={ci} style={{ width: 5, height: 5, borderRadius: "50%", background: col }} />
                  ))}
                </div>
              ) : (
                <div style={{ width: 6, height: 6 }} />
              )}
            </div>
          );
        })}
      </div>

      {selectedDate === todayStr && onLogForDate && (
  <button
    onClick={() => onLogForDate(todayStr)}
    style={{
      width: "100%",
      marginTop: 12,
      padding: "11px",
      borderRadius: 10,
      background: "var(--text)",
      color: "var(--bg)",
      fontSize: 13,
      fontWeight: 800,
      border: "none"
    }}
  >
    今日のワークアウトを追加
  </button>
)}

      {selectedDate && (
        <div style={{ marginTop: 14, background: "var(--card2)", borderRadius: 12, padding: "14px 16px", border: "1px solid var(--border2)" }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text)", marginBottom: 10 }}>
            {selectedDate}{selectedDate === todayStr ? " (今日)" : ""}
          </div>
          {getDateExercises(selectedDate).length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text4)", textAlign: "center", padding: "8px 0 4px" }}>記録なし</div>
          ) : getDateExercises(selectedDate).map(({ name, record }) => {
            const sets = record.sets || [{ weight: record.weight, reps: record.reps }];
            const labelColor = LABEL_COLORS[EX_TO_LABEL[name]];
            const recs = history[name] || [];
            const historyIdx = recs.findIndex(r => r === record || r.date === record.date);
            return (
              <div key={name}
                onClick={() => onEditRecord?.(name, record, historyIdx >= 0 ? historyIdx : undefined)}
                style={{ marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid var(--border)", cursor: onEditRecord ? "pointer" : "default", borderRadius: 6, padding: "6px 8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                  {labelColor && <div style={{ width: 6, height: 6, borderRadius: "50%", background: labelColor, flexShrink: 0 }} />}
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{name}</div>
                  {onEditRecord && <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--text3)" }}>編集 →</div>}
                </div>
                <div style={{ fontSize: 12, color: "var(--text3)" }}>
                  {sets.map((s, i) => {
                    const w = s.weight === "BW" ? "自重" : `${dispW(s.weight, unit)}${unit}`;
                    return (i > 0 ? " / " : "") + `${w}×${s.reps}`;
                  })}
                </div>
              </div>
            );
          })}
          {onLogForDate && selectedDate !== todayStr && (
  <button
    onClick={() => onLogForDate(selectedDate)}
    style={{
      width: "100%",
      marginTop: 8,
      padding: "11px",
      borderRadius: 10,
      background: "var(--text)",
      color: "var(--bg)",
      fontSize: 13,
      fontWeight: 800,
      border: "none"
    }}
  >
    この日に記録する
  </button>
)}
        </div>
      )}
    </div>
  );
}
