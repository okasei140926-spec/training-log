import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const PERIODS = [
  { label: "1ヶ月", days: 30 },
  { label: "3ヶ月", days: 90 },
  { label: "6ヶ月", days: 180 },
  { label: "1年", days: 365 },
];

export default function AnalyticsScreen({ history }) {
  const [selectedEx, setSelectedEx] = useState(null);
  const [period, setPeriod] = useState(90);
  const [search, setSearch] = useState("");

  const exercises = Object.keys(history || {}).sort();
  const filtered = exercises.filter(e => e.includes(search));

  const getChartData = (exName) => {
    const recs = history[exName] || [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - period);
    return recs
      .filter(r => new Date(r.date) >= cutoff)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(r => ({
        date: r.date.slice(5),
        weight: Number(r.weight),
      }));
  };

  return (
    <div style={{ padding: 20 }}>
      {!selectedEx ? (
        <>
          <input
            placeholder="種目を検索..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ display: "block", width: "100%", padding: "12px 16px", borderRadius: 12, border: "1px solid var(--border2)", background: "var(--card)", color: "var(--text)", fontSize: 15, boxSizing: "border-box", marginBottom: 16 }}
          />
          {filtered.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--text3)", fontSize: 14, marginTop: 40 }}>
              記録がありません
            </div>
          )}
          {filtered.map(ex => (
            <button key={ex} onClick={() => setSelectedEx(ex)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", padding: "14px 16px", background: "var(--card)", borderRadius: 12, border: "1px solid var(--border2)", marginBottom: 8, color: "var(--text)", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
              <span>{ex}</span>
              <span style={{ color: "var(--text3)" }}>›</span>
            </button>
          ))}
        </>
      ) : (
        <>
          <button onClick={() => setSelectedEx(null)}
            style={{ background: "none", border: "none", color: "var(--text2)", fontSize: 14, cursor: "pointer", marginBottom: 16, padding: 0 }}>
            ← 戻る
          </button>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>{selectedEx}</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            {PERIODS.map(p => (
              <button key={p.days} onClick={() => setPeriod(p.days)}
                style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "none", background: period === p.days ? "#4ade80" : "var(--card)", color: period === p.days ? "#000" : "var(--text2)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                {p.label}
              </button>
            ))}
          </div>
          <div style={{ background: "var(--card)", borderRadius: 16, padding: 16 }}>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={getChartData(selectedEx)}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text3)" }} />
                <YAxis tick={{ fontSize: 10, fill: "var(--text3)" }} />
                <Tooltip
                  contentStyle={{ background: "var(--card2)", border: "none", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "var(--text)" }}
                />
                <Line type="monotone" dataKey="weight" stroke="#4ade80" strokeWidth={2} dot={{ fill: "#4ade80", r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
