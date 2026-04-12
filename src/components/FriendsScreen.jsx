import { useState } from "react";
import { DEMO_FRIENDS } from "../constants/demoData";
import { S } from "../utils/styles";
import { calc1RM } from "../utils/helpers";
import FriendDetailModal from "./modals/FriendDetailModal";

const KEY_EXERCISES = ["ベンチプレス", "デッドリフト", "スクワット"];

export default function FriendsScreen({ history, onCopyMenu }) {
  const [cheers, setCheers]               = useState({});
  const [selectedFriend, setSelectedFriend] = useState(null);
  const [copied, setCopied]               = useState(false);

  const handleCopyInvite = async () => {
    const url = window.location.href;
    const text = "一緒にトレーニングを記録しよう！ IRON LOG";
    if (navigator.share) {
      try {
        await navigator.share({ title: "IRON LOG", text, url });
        return;
      } catch {}
    }
    // Fallback: clipboard
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const el = document.createElement("textarea");
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const today = new Date().toISOString().split("T")[0];
  const thresholdDate = new Date();
  thresholdDate.setDate(thresholdDate.getDate() - 2);
  const thresholdStr = thresholdDate.toISOString().split("T")[0];

  const myRecentExercises = Object.entries(history)
    .filter(([, recs]) => recs[recs.length - 1]?.date >= thresholdStr)
    .map(([name, recs]) => {
      const last   = recs[recs.length - 1];
      const topSet = last.sets?.reduce((best, s) => Number(s.weight) > Number(best.weight) ? s : best, last.sets[0]);
      return { name, weight: topSet?.weight || last.weight, reps: topSet?.reps || last.reps, date: last.date };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const myTodayExercises = myRecentExercises.filter(e => e.date === today);

  const activeRecently = myRecentExercises.length > 0;

  const myBests = KEY_EXERCISES.reduce((acc, ex) => {
    const recs = history[ex];
    if (recs?.length) acc[ex] = Math.round(calc1RM(recs[recs.length - 1].sets));
    return acc;
  }, {});

  const cheer      = (id) => setCheers(p => ({ ...p, [id]: (p[id] || 0) + 1 }));
  const activeToday = myTodayExercises.length > 0;

  return (
    <div className="fade-in" style={{ padding: "20px" }}>

      <div style={S.sLabel}>最近のアクティビティ（3日間）</div>

      {/* 自分のカード */}
      <div style={{ background: "var(--card)", borderRadius: 16, padding: "16px", marginBottom: 12, border: "1px solid var(--border2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: activeRecently ? 14 : 0 }}>
          <div style={{ width: 44, height: 44, borderRadius: 22, background: "var(--text)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 900, color: "var(--bg)", flexShrink: 0 }}>
            YOU
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>自分</div>
              {activeToday && (
                <div style={{ padding: "2px 8px", borderRadius: 10, background: "#4ade8022", border: "1px solid #4ade8044", fontSize: 10, color: "#4ade80", fontWeight: 700 }}>
                  完了 ✓
                </div>
              )}
            </div>
            <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>
              {activeRecently ? `直近3日 ${myRecentExercises.length}種目` : "直近3日の記録なし"}
            </div>
          </div>
        </div>
        {activeRecently && (() => {
  const byDate = {};
  myRecentExercises.forEach(ex => {
    if (!byDate[ex.date]) byDate[ex.date] = [];
    byDate[ex.date].push(ex);
  });
  return Object.entries(byDate)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, exs]) => {
      const isOpen = openDates[date] !== false;
      return (
        <div key={date} style={{ marginBottom: 6 }}>
          <button onClick={() => setOpenDates(p => ({ ...p, [date]: !isOpen }))}
            style={{ width: "100%", display: "flex", justifyContent: "space-between", padding: "6px 8px", background: "var(--border)", borderRadius: 8, border: "none", marginBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text2)" }}>{date === today ? "今日" : date}</div>
            <div style={{ fontSize: 11, color: "var(--text3)" }}>{isOpen ? "▲" : "▼"}</div>
          </button>
          {isOpen && exs.map((ex, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "var(--card2)", borderRadius: 10, marginBottom: 4 }}>
              <div style={{ fontSize: 13, color: "var(--text3)" }}>{ex.name}</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>
                {ex.weight}kg × {ex.reps}rep
              </div>
            </div>
          ))}
        </div>
      );
    });
})()}
      </div>

      {DEMO_FRIENDS.filter(f => f.today).map(f => (
        <div key={f.id} style={{ background: "var(--card)", borderRadius: 16, padding: "16px", marginBottom: 12, border: `1px solid ${f.color}33` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <button onClick={() => setSelectedFriend(f)} style={{ background: "none", border: "none", padding: 0, display: "flex", alignItems: "center", gap: 12, flex: 1, textAlign: "left" }}>
              <div style={{ width: 44, height: 44, borderRadius: 22, background: f.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 900, color: "#000", flexShrink: 0 }}>
                {f.name[0]}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{f.name}</div>
                  <div style={{ padding: "2px 8px", borderRadius: 10, background: "#4ade8022", border: "1px solid #4ade8044", fontSize: 10, color: "#4ade80", fontWeight: 700 }}>LIVE</div>
                </div>
                <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>{f.today.label} · {f.today.time} · 詳細を見る →</div>
              </div>
            </button>
            <CheerButton id={f.id} color={f.color} count={cheers[f.id] || 0} onCheer={cheer} />
          </div>
          {f.today.exercises.map((ex, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--card2)", borderRadius: 10, marginBottom: 6 }}>
              <div style={{ fontSize: 13, color: "var(--text3)" }}>{ex.name}</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: f.color }}>
                {ex.weight > 0 ? `${ex.weight}kg` : "BW"} <span style={{ color: "var(--text2)", fontWeight: 400 }}>×</span> {ex.reps}rep
              </div>
            </div>
          ))}
        </div>
      ))}

      {DEMO_FRIENDS.filter(f => !f.today).map(f => (
        <div key={f.id} style={{ background: "var(--card)", borderRadius: 16, padding: "14px 16px", marginBottom: 12, border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setSelectedFriend(f)} style={{ background: "none", border: "none", padding: 0, display: "flex", alignItems: "center", gap: 12, flex: 1, textAlign: "left" }}>
            <div style={{ width: 40, height: 40, borderRadius: 20, background: "var(--card2)", border: `2px solid ${f.color}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 900, color: f.color }}>
              {f.name[0]}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{f.name}</div>
              <div style={{ fontSize: 11, color: "var(--text3)" }}>今日はお休み · 詳細を見る →</div>
            </div>
          </button>
          <CheerButton id={f.id} color={f.color} count={cheers[f.id] || 0} onCheer={cheer} />
        </div>
      ))}

      <div style={{ ...S.sLabel, marginTop: 20 }}>強さ比較（推定1RM）</div>
      {KEY_EXERCISES.map(ex => {
        const entries = [
          { name: "自分", color: "var(--text)", value: myBests[ex] || 0 },
          ...DEMO_FRIENDS.map(f => ({ name: f.name, color: f.color, value: f.bests[ex] || 0 })),
        ].filter(e => e.value > 0);
        if (!entries.length) return null;
        const maxVal = Math.max(...entries.map(e => e.value));
        return (
          <div key={ex} style={{ background: "var(--card)", borderRadius: 16, padding: "16px", marginBottom: 10, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, color: "var(--text)" }}>{ex}</div>
            {entries.sort((a, b) => b.value - a.value).map((e, i) => (
              <CompareBar key={e.name} rank={i + 1} name={e.name} value={e.value} max={maxVal} color={e.color} />
            ))}
            {!myBests[ex] && (
              <div style={{ fontSize: 11, color: "var(--text4)", marginTop: 8 }}>この種目を記録すると比較できます</div>
            )}
          </div>
        );
      })}

      <div style={{ background: "var(--card)", borderRadius: 16, padding: "20px", border: "1px dashed var(--border2)", textAlign: "center", marginTop: 8 }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>👥</div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: "var(--text)" }}>友達を招待</div>
        <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 14 }}>一緒にトレーニングを記録しよう</div>
        <button onClick={handleCopyInvite}
          style={{ padding: "10px 28px", borderRadius: 20, background: copied ? "#4ade80" : "var(--text)", color: copied ? "#000" : "var(--bg)", fontWeight: 700, fontSize: 13, border: "none", transition: "background 0.2s" }}>
          {copied ? "コピーしました ✓" : "招待リンクをコピー 🔗"}
        </button>
      </div>

      {selectedFriend && (
        <FriendDetailModal
          friend={selectedFriend}
          onClose={() => setSelectedFriend(null)}
          onCopyMenu={(exercises) => { onCopyMenu(exercises); setSelectedFriend(null); }}
        />
      )}
    </div>
  );
}

function CheerButton({ id, color, count, onCheer }) {
  return (
    <button onClick={() => onCheer(id)}
      style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, flexShrink: 0,
        background: count ? color + "22" : "var(--card2)",
        border: `1px solid ${count ? color + "66" : "var(--border2)"}`,
        color: count ? color : "var(--text2)" }}>
      🔥 {count || "応援"}
    </button>
  );
}

function CompareBar({ rank, name, value, max, color }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ fontSize: 10, color: rank === 1 ? "#FFD700" : "var(--text3)", fontWeight: 800, width: 14 }}>
            {rank === 1 ? "👑" : `${rank}`}
          </div>
          <div style={{ fontSize: 13, color: "var(--text3)" }}>{name}</div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 800, color }}>{value}kg</div>
      </div>
      <div style={{ height: 6, borderRadius: 4, background: "var(--border)" }}>
        <div style={{ height: "100%", borderRadius: 4, background: color, width: `${pct}%`, transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
}
