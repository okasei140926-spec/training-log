import { useState } from "react";
import { LABEL_COLORS, SUGGESTIONS } from "../constants/suggestions";

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

// reverse map: exercise name → muscle label
const EX_TO_LABEL = {};
Object.entries(SUGGESTIONS).forEach(([label, names]) => {
  names.forEach(n => { EX_TO_LABEL[n] = label; });
});

export default function CalendarView({ history, onDayOpen }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

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

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = today.toISOString().split("T")[0];

  const prevMonth = () => {
    if (month === 0) {
      setYear(y => y - 1);
      setMonth(11);
    } else {
      setMonth(m => m - 1);
    }
  };

  const nextMonth = () => {
    if (month === 11) {
      setYear(y => y + 1);
      setMonth(0);
    } else {
      setMonth(m => m + 1);
    }
  };

  const toStr = (d) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const monthWorkouts = [...trainedDates].filter(d =>
    d.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)
  ).length;

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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
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
              onClick={() => onDayOpen(ds)}
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
                <div style={{ display: "flex", gap: 2, justifyContent: "center", flexWrap: "wrap", minHeight: 6 }}>
                  {colors.slice(0, 3).map((col, ci) => (
                    <div
                      key={ci}
                      style={{ width: 5, height: 5, borderRadius: "50%", background: isToday ? "#fff" : col }}
                    />
                  ))}
                </div>
              ) : (
                <div style={{ width: 6, height: 6 }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}