import { useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { SUGGESTIONS } from "../constants/suggestions";
import { calc1RM } from "../utils/helpers";

const PERIODS = [
  { label: "1ヶ月", days: 30 },
  { label: "3ヶ月", days: 90 },
  { label: "6ヶ月", days: 180 },
  { label: "1年", days: 365 },
];

const ANALYTICS_TABS = [
  { id: "exercises", label: "種目" },
  { id: "pr", label: "PR" },
];

const FIXED_BODY_PART_LABELS = ["胸", "背中", "四頭", "ハムストリングス", "尻", "肩", "二頭", "三頭", "腹筋", "その他"];
const BIG3_EXERCISES = [
  { key: "bench", label: "ベンチプレス" },
  { key: "squat", label: "スクワット" },
  { key: "deadlift", label: "デッドリフト" },
];

const EX_TO_LABEL = {};
Object.entries(SUGGESTIONS).forEach(([label, names]) => {
  names.forEach((n) => {
    EX_TO_LABEL[n] = label;
  });
});

const normalizeName = (name) => String(name || "").replace(/\s+/g, "").trim();

const resolveLabel = (exName, muscleEx = {}) => {
  const normalized = normalizeName(exName);

  if (EX_TO_LABEL[exName]) return EX_TO_LABEL[exName];

  const suggestionMatch = Object.entries(EX_TO_LABEL).find(([name]) => {
    const base = normalizeName(name);
    return base === normalized || base.includes(normalized) || normalized.includes(base);
  });
  if (suggestionMatch) return suggestionMatch[1];

  const customMatch = Object.entries(muscleEx || {}).find(([label, list]) =>
    (list || []).some((ex) => {
      const name = typeof ex === "string" ? ex : ex.name;
      const base = normalizeName(name);
      return base === normalized || base.includes(normalized) || normalized.includes(base);
    })
  );

  return customMatch ? customMatch[0] : null;
};

const resolveBodyPart = (value) => (FIXED_BODY_PART_LABELS.includes(value) ? value : "その他");

const buildValidSets = (record) => {
  const sourceSets = Array.isArray(record?.sets) && record.sets.length > 0
    ? record.sets
    : [{ weight: record?.weight, reps: record?.reps }];

  return sourceSets.filter((s) => {
    const w = Number(s.weight);
    const reps = Number(s.reps);
    return Number.isFinite(w) && Number.isFinite(reps) && w > 0 && reps > 0;
  });
};

const buildHistoryBestMap = (history = {}) => {
  const bestMap = {};

  Object.entries(history || {}).forEach(([name, records]) => {
    (records || []).forEach((record) => {
      const validSets = buildValidSets(record);
      const rm = calc1RM(validSets);
      if (!validSets.length || rm <= 0) return;

      const bestSet = validSets.reduce((best, set) => {
        const current = Number(set.weight) * (1 + Number(set.reps) / 30);
        if (!best || current > best.score) {
          return { weight: Number(set.weight), reps: Number(set.reps), score: current };
        }
        return best;
      }, null);

      if (!bestSet) return;

      if (!bestMap[name] || rm > bestMap[name].estimated1RM) {
        bestMap[name] = {
          name,
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

const buildManualBestMap = (manualBests = []) => {
  const bestMap = {};

  (manualBests || []).forEach((entry) => {
    if (!entry?.exercise_name) return;
    const validSets = buildValidSets({ weight: entry.weight, reps: entry.reps });
    const rm = calc1RM(validSets);
    if (!validSets.length || rm <= 0) return;

    if (!bestMap[entry.exercise_name] || rm > bestMap[entry.exercise_name].estimated1RM) {
      bestMap[entry.exercise_name] = {
        name: entry.exercise_name,
        weight: Number(entry.weight),
        reps: Number(entry.reps),
        estimated1RM: Math.round(rm),
        date: entry.best_date || null,
        source: "manual",
        sourceLabel: "移行記録",
        bodyPart: entry.body_part || "その他",
      };
    }
  });

  return bestMap;
};

const matchBig3Key = (name) => {
  if (name.includes("ベンチプレス")) return "bench";
  if (name.includes("スクワット")) return "squat";
  if (name.includes("デッドリフト")) return "deadlift";
  return null;
};

export default function AnalyticsScreen({ history, manualBests = [], muscleEx = {} }) {
  const [activeTab, setActiveTab] = useState("exercises");
  const [selectedEx, setSelectedEx] = useState(null);
  const [period, setPeriod] = useState(90);
  const [search, setSearch] = useState("");

  const exercises = Object.keys(history || {}).sort();
  const filtered = exercises.filter(e => e.includes(search));

  const manualBodyPartMap = useMemo(() => {
    const map = {};
    (manualBests || []).forEach((best) => {
      if (best?.exercise_name && best?.body_part && !map[best.exercise_name]) {
        map[best.exercise_name] = best.body_part;
      }
    });
    return map;
  }, [manualBests]);

  const prData = useMemo(() => {
    const historyBestMap = buildHistoryBestMap(history);
    const manualBestMap = buildManualBestMap(manualBests);
    const allNames = [...new Set([...Object.keys(historyBestMap), ...Object.keys(manualBestMap)])];

    const merged = allNames.map((name) => {
      const historyBest = historyBestMap[name];
      const manualBest = manualBestMap[name];
      const best = !historyBest
        ? manualBest
        : !manualBest
          ? historyBest
          : manualBest.estimated1RM > historyBest.estimated1RM
            ? manualBest
            : historyBest;

      const bodyPart = best?.source === "manual"
        ? resolveBodyPart(best.bodyPart)
        : resolveBodyPart(
          manualBodyPartMap[name] ||
          resolveLabel(name, muscleEx) ||
          "その他"
        );

      return {
        ...best,
        bodyPart,
      };
    }).filter(Boolean);

    const groupedByBodyPart = FIXED_BODY_PART_LABELS.map((bodyPart) => ({
      bodyPart,
      items: merged
        .filter((item) => item.bodyPart === bodyPart)
        .sort((a, b) => b.estimated1RM - a.estimated1RM || a.name.localeCompare(b.name, "ja")),
    })).filter((group) => group.items.length > 0);

    const big3 = BIG3_EXERCISES.map(({ key, label }) => {
      const match = merged
        .filter((item) => matchBig3Key(item.name) === key)
        .sort((a, b) => b.estimated1RM - a.estimated1RM)[0] || null;

      return {
        key,
        label,
        item: match,
        estimated1RM: match?.estimated1RM || 0,
      };
    });

    return {
      groupedByBodyPart,
      big3,
      big3Total: big3.reduce((sum, item) => sum + item.estimated1RM, 0),
    };
  }, [history, manualBests, manualBodyPartMap, muscleEx]);

  const getChartData = (exName) => {
    const recs = history[exName] || [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - period);
    return recs
      .filter(r => new Date(r.date) >= cutoff)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(r => ({
        date: r.date.slice(5),
        weight: Math.round(Number(r.weight) * (1 + Number(r.reps) / 30)),
      }));
  };

  const formatDate = (date) => (date ? date.replace(/-/g, "/") : null);

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {ANALYTICS_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 10,
              border: "none",
              background: activeTab === tab.id ? "var(--text)" : "var(--card)",
              color: activeTab === tab.id ? "var(--bg)" : "var(--text2)",
              fontSize: 13,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "exercises" && (
        <>
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
                      formatter={(value) => [`${value}kg`, "1RM"]}
                    />
                    <Line type="monotone" dataKey="weight" stroke="#4ade80" strokeWidth={2} dot={{ fill: "#4ade80", r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </>
      )}

      {activeTab === "pr" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ background: "var(--card)", borderRadius: 16, padding: 16, border: "1px solid var(--border2)" }}>
            <div style={{ fontSize: 10, letterSpacing: 2.5, color: "var(--text3)", marginBottom: 12 }}>
              BIG3 PR
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
              {prData.big3.map((entry) => (
                <div key={entry.key} style={{ background: "var(--card2)", borderRadius: 12, padding: "12px 14px" }}>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>{entry.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)" }}>{entry.estimated1RM}kg</div>
                  {entry.item && (
                    <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 6 }}>
                      {entry.item.weight}kg × {entry.item.reps}rep
                    </div>
                  )}
                </div>
              ))}
              <div style={{ background: "var(--card2)", borderRadius: 12, padding: "12px 14px", gridColumn: "1 / -1" }}>
                <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>BIG3合計</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "var(--text)" }}>{prData.big3Total}kg</div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {prData.groupedByBodyPart.map((group) => (
              <div key={group.bodyPart} style={{ background: "var(--card)", borderRadius: 16, padding: 16, border: "1px solid var(--border2)" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text3)", marginBottom: 10 }}>
                  {group.bodyPart}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {group.items.map((item) => (
                    <div key={item.name} style={{ background: "var(--card2)", borderRadius: 12, padding: "10px 12px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 4 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{item.name}</div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{item.estimated1RM}kg</div>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 12, color: "var(--text2)" }}>
                        <span>{item.weight}kg × {item.reps}rep</span>
                        {item.date && <span>{formatDate(item.date)}</span>}
                        {item.source === "manual" && (
                          <span style={{ padding: "2px 8px", borderRadius: 999, background: "rgba(74,222,128,0.14)", color: "#4ade80", fontSize: 11, fontWeight: 700 }}>
                            移行記録
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
