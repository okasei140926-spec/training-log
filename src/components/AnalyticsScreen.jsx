import { useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { SUGGESTIONS } from "../constants/suggestions";
import { calc1RM } from "../utils/helpers";
import { getBig3ExerciseKey, normalizeExerciseName } from "../utils/exerciseName";

const PERIODS = [
  { label: "1ヶ月", days: 30 },
  { label: "3ヶ月", days: 90 },
  { label: "6ヶ月", days: 180 },
  { label: "1年", days: 365 },
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
const formatDate = (date) => (date ? date.replace(/-/g, "/") : null);

const resolveLabel = (exName, muscleEx = {}) => {
  const canonicalName = normalizeExerciseName(exName);
  const normalized = normalizeName(canonicalName);

  if (EX_TO_LABEL[canonicalName]) return EX_TO_LABEL[canonicalName];
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

const getBestSet = (validSets = []) => {
  return validSets.reduce((best, set) => {
    const score = calc1RM([set]);
    if (!best || score > best.score) {
      return {
        weight: Number(set.weight),
        reps: Number(set.reps),
        score,
      };
    }
    return best;
  }, null);
};

const formatSetsText = (sets = []) =>
  sets.map((set) => `${Number(set.weight)}kg × ${Number(set.reps)}rep`).join(" / ");

const sortByDateDesc = (a, b) => {
  const aDate = a?.date || "";
  const bDate = b?.date || "";
  if (aDate !== bDate) return bDate.localeCompare(aDate);
  return (b?.estimated1RM || 0) - (a?.estimated1RM || 0);
};

const buildHistoryBestMap = (history = {}) => {
  const bestMap = {};

  Object.entries(history || {}).forEach(([name, records]) => {
    const normalizedName = normalizeExerciseName(name);

    (records || []).forEach((record) => {
      const validSets = buildValidSets(record);
      const rm = calc1RM(validSets);
      const bestSet = getBestSet(validSets);
      if (!bestSet || rm <= 0) return;

      if (!bestMap[normalizedName] || rm > bestMap[normalizedName].estimated1RM) {
        bestMap[normalizedName] = {
          name: normalizedName,
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
    const normalizedName = normalizeExerciseName(entry.exercise_name);
    const validSets = buildValidSets({ weight: entry.weight, reps: entry.reps });
    const rm = calc1RM(validSets);
    if (!validSets.length || rm <= 0) return;

    if (!bestMap[normalizedName] || rm > bestMap[normalizedName].estimated1RM) {
      bestMap[normalizedName] = {
        name: normalizedName,
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

const buildHistoryRecordMap = (history = {}) => {
  const recordMap = {};

  Object.entries(history || {}).forEach(([name, records]) => {
    const normalizedName = normalizeExerciseName(name);

    (records || []).forEach((record, index) => {
      const validSets = buildValidSets(record);
      const rm = calc1RM(validSets);
      const bestSet = getBestSet(validSets);
      if (!bestSet || rm <= 0) return;

      if (!recordMap[normalizedName]) recordMap[normalizedName] = [];
      recordMap[normalizedName].push({
        id: `history-${normalizedName}-${record?.date || "nodate"}-${index}`,
        name: normalizedName,
        date: record?.date || null,
        weight: bestSet.weight,
        reps: bestSet.reps,
        estimated1RM: Math.round(rm),
        setsText: formatSetsText(validSets),
        source: "history",
        sourceLabel: null,
      });
    });
  });

  return recordMap;
};

const buildManualRecordMap = (manualBests = []) => {
  const recordMap = {};

  (manualBests || []).forEach((entry, index) => {
    if (!entry?.exercise_name) return;
    const normalizedName = normalizeExerciseName(entry.exercise_name);
    const validSets = buildValidSets({ weight: entry.weight, reps: entry.reps });
    const rm = calc1RM(validSets);
    if (!validSets.length || rm <= 0) return;

    if (!recordMap[normalizedName]) recordMap[normalizedName] = [];
    recordMap[normalizedName].push({
      id: `manual-${normalizedName}-${entry?.best_date || "nodate"}-${entry?.id || index}`,
      name: normalizedName,
      date: entry.best_date || null,
      weight: Number(entry.weight),
      reps: Number(entry.reps),
      estimated1RM: Math.round(rm),
      setsText: `${Number(entry.weight)}kg × ${Number(entry.reps)}rep`,
      source: "manual",
      sourceLabel: "移行記録",
    });
  });

  return recordMap;
};

const buildChartData = (records = [], period) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - period);

  const grouped = {};
  records.forEach((record) => {
    if (!record?.date) return;
    const recordDate = new Date(`${record.date}T00:00:00`);
    if (recordDate < cutoff) return;

    if (!grouped[record.date] || record.estimated1RM > grouped[record.date].estimated1RM) {
      grouped[record.date] = record;
    }
  });

  return Object.values(grouped)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .map((record) => ({
      date: record.date.slice(5),
      weight: record.estimated1RM,
    }));
};

export default function AnalyticsScreen({ history, manualBests = [], muscleEx = {} }) {
  const [selectedExerciseName, setSelectedExerciseName] = useState(null);
  const [period, setPeriod] = useState(90);

  const manualBodyPartMap = useMemo(() => {
    const map = {};
    (manualBests || []).forEach((best) => {
      const normalizedName = normalizeExerciseName(best?.exercise_name);
      if (normalizedName && best?.body_part && !map[normalizedName]) {
        map[normalizedName] = best.body_part;
      }
    });
    return map;
  }, [manualBests]);

  const historyBestMap = useMemo(() => buildHistoryBestMap(history), [history]);
  const manualBestMap = useMemo(() => buildManualBestMap(manualBests), [manualBests]);
  const historyRecordMap = useMemo(() => buildHistoryRecordMap(history), [history]);
  const manualRecordMap = useMemo(() => buildManualRecordMap(manualBests), [manualBests]);

  const prData = useMemo(() => {
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
        .filter((item) => getBig3ExerciseKey(item.name) === key)
        .sort((a, b) => b.estimated1RM - a.estimated1RM)[0] || null;

      return {
        key,
        label,
        item: match,
        estimated1RM: match?.estimated1RM || 0,
      };
    });

    const itemMap = Object.fromEntries(merged.map((item) => [item.name, item]));

    return {
      groupedByBodyPart,
      big3,
      big3Total: big3.reduce((sum, item) => sum + item.estimated1RM, 0),
      itemMap,
    };
  }, [historyBestMap, manualBestMap, manualBodyPartMap, muscleEx]);

  const selectedExercise = selectedExerciseName ? prData.itemMap[selectedExerciseName] || null : null;

  const selectedRecords = useMemo(() => {
    if (!selectedExerciseName) return [];
    return [
      ...(historyRecordMap[selectedExerciseName] || []),
      ...(manualRecordMap[selectedExerciseName] || []),
    ].sort(sortByDateDesc);
  }, [selectedExerciseName, historyRecordMap, manualRecordMap]);

  const selectedChartData = useMemo(
    () => buildChartData(selectedRecords, period),
    [selectedRecords, period]
  );

  const renderPRCard = (item, { compact = false } = {}) => {
    const sharedStyle = {
      width: "100%",
      textAlign: "left",
      background: compact ? "linear-gradient(180deg, var(--info-soft), var(--card))" : "var(--card2)",
      borderRadius: compact ? 16 : 16,
      padding: compact ? "12px 14px" : "11px 12px",
      border: compact ? "1px solid var(--info-border)" : "1px solid rgba(186, 230, 253, 0.65)",
      boxShadow: compact ? "var(--shadow-card)" : "none",
      cursor: item ? "pointer" : "default",
    };

    if (!item) {
      return (
        <div style={sharedStyle}>
          <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>未記録</div>
          <div style={{ fontSize: compact ? 22 : 15, fontWeight: 800, color: "var(--text4)" }}>0kg</div>
        </div>
      );
    }

    return (
      <button
        onClick={() => setSelectedExerciseName(item.name)}
        style={sharedStyle}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontSize: compact ? 11 : 13, fontWeight: 700, color: "var(--text)" }}>{item.name}</div>
          <div style={{ fontSize: compact ? 22 : 15, fontWeight: 800, color: "var(--text)" }}>{item.estimated1RM}kg</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 12, color: "var(--text2)" }}>
          <span>{item.weight}kg × {item.reps}rep</span>
          {item.date && <span>{formatDate(item.date)}</span>}
          {item.source === "manual" && (
            <span style={{ padding: "2px 8px", borderRadius: 999, background: "var(--success-soft)", border: "1px solid var(--success-border)", color: "var(--accent)", fontSize: 11, fontWeight: 700 }}>
              移行記録
            </span>
          )}
        </div>
      </button>
    );
  };

  if (selectedExercise) {
    return (
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <button
          onClick={() => setSelectedExerciseName(null)}
          style={{ alignSelf: "flex-start", background: "none", border: "none", color: "var(--text2)", fontSize: 14, cursor: "pointer", padding: 0 }}
        >
          ← PR一覧に戻る
        </button>

        <div style={{ background: "var(--card)", borderRadius: 20, padding: 16, border: "1px solid var(--border2)", boxShadow: "var(--shadow-card)" }}>
          <div style={{ fontSize: 10, letterSpacing: 2.5, color: "var(--text3)", marginBottom: 10 }}>
            CURRENT PR
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", marginBottom: 10 }}>
            {selectedExercise.name}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            <div style={{ background: "var(--card2)", borderRadius: 16, padding: 12, border: "1px solid var(--border2)" }}>
              <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>現在PR</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text)" }}>{selectedExercise.estimated1RM}kg</div>
              <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 6 }}>
                {selectedExercise.weight}kg × {selectedExercise.reps}rep
              </div>
            </div>
            <div style={{ background: "var(--card2)", borderRadius: 16, padding: 12, border: "1px solid var(--border2)" }}>
              <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>記録日</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>
                {formatDate(selectedExercise.date) || "日付なし"}
              </div>
              {selectedExercise.source === "manual" && (
                <div style={{ marginTop: 8, display: "inline-flex", padding: "3px 8px", borderRadius: 999, background: "var(--success-soft)", border: "1px solid var(--success-border)", color: "var(--accent)", fontSize: 11, fontWeight: 700 }}>
                  移行記録
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ background: "var(--card)", borderRadius: 20, padding: 16, border: "1px solid var(--border2)", boxShadow: "var(--shadow-card)" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {PERIODS.map((item) => (
              <button
                key={item.days}
                onClick={() => setPeriod(item.days)}
                style={{
                  flex: 1,
                  padding: "9px 0",
                  borderRadius: 12,
                  border: period === item.days ? "1px solid transparent" : "1px solid var(--border2)",
                  background: period === item.days ? "linear-gradient(135deg, var(--accent), #4ADE80)" : "var(--card)",
                  color: period === item.days ? "#fff" : "var(--text2)",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  boxShadow: period === item.days ? "var(--shadow-soft)" : "var(--shadow-card)",
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          {selectedChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={selectedChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border2)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text3)" }} />
                <YAxis tick={{ fontSize: 10, fill: "var(--text3)" }} />
                <Tooltip
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--border2)", borderRadius: 12, fontSize: 12, boxShadow: "var(--shadow-card)" }}
                  labelStyle={{ color: "var(--text)" }}
                  formatter={(value) => [`${value}kg`, "1RM"]}
                />
                <Line type="monotone" dataKey="weight" stroke="var(--accent)" strokeWidth={2.5} dot={{ fill: "var(--accent)", r: 3.5 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ textAlign: "center", color: "var(--text3)", fontSize: 13, padding: "28px 0 18px" }}>
              グラフに表示できる日付付き記録がありません
            </div>
          )}
        </div>

        <div style={{ background: "var(--card)", borderRadius: 20, padding: 16, border: "1px solid var(--border2)", boxShadow: "var(--shadow-card)" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text3)", marginBottom: 12 }}>
            過去記録一覧
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {selectedRecords.map((record) => (
              <div key={record.id} style={{ background: "var(--card2)", borderRadius: 16, padding: 12, border: "1px solid rgba(186, 230, 253, 0.65)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>
                    {formatDate(record.date) || "日付なし"}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>
                    推定1RM {record.estimated1RM}kg
                  </div>
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>
                  {record.weight}kg × {record.reps}rep
                </div>
                <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
                  {record.setsText}
                </div>
                {record.source === "manual" && (
                  <div style={{ marginTop: 8, display: "inline-flex", padding: "3px 8px", borderRadius: 999, background: "var(--success-soft)", border: "1px solid var(--success-border)", color: "var(--accent)", fontSize: 11, fontWeight: 700 }}>
                    移行記録
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ background: "var(--card)", borderRadius: 20, padding: 16, border: "1px solid var(--border2)", boxShadow: "var(--shadow-card)" }}>
        <div style={{ fontSize: 10, letterSpacing: 2.5, color: "var(--text3)", marginBottom: 12 }}>
          BIG3 PR
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          {prData.big3.map((entry) => (
            <div key={entry.key}>
              {renderPRCard(entry.item ? { ...entry.item, name: entry.label } : null, { compact: true })}
            </div>
          ))}
          <div style={{ background: "linear-gradient(135deg, var(--success-soft), var(--card))", borderRadius: 16, padding: "12px 14px", gridColumn: "1 / -1", border: "1px solid var(--success-border)" }}>
            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>BIG3合計</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "var(--text)" }}>{prData.big3Total}kg</div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {prData.groupedByBodyPart.map((group) => (
          <div key={group.bodyPart} style={{ background: "var(--card)", borderRadius: 20, padding: 16, border: "1px solid var(--border2)", boxShadow: "var(--shadow-card)" }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text3)", marginBottom: 10 }}>
              {group.bodyPart}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {group.items.map((item) => (
                <div key={item.name}>
                  {renderPRCard(item)}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
