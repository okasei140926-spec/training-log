import { useState, useRef } from "react";
import { LABEL_COLORS } from "../constants/suggestions";
import { dispW } from "../utils/helpers";
import AddExModal from "./modals/AddExModal";

export default function PrepScreen({
  todayLabels, dayColor,
  initialExercises, history, lastWorkoutExercises,
  onStart, onBack, unit = "kg",
}) {
  const [exercises, setExercises] = useState(initialExercises);
  const [showAdd, setShowAdd] = useState(false);
  const [newExName, setNewExName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const editRef = useRef(null);

  const getPrev = (name) => { const r = history[name]; return r ? r[r.length - 1] : null; };

  const removeEx = (name) => setExercises(p => p.filter(e => e.name !== name));
  const addEx = (name) => {
    const trimmed = name.trim();
    if (!trimmed || exercises.find(e => e.name === trimmed)) return;
    setExercises(p => [...p, { id: Date.now() + (Math.random() * 1000 | 0), name: trimmed }]);
  };
  const handleQuickAdd = (name, remove) => {
    if (remove) setExercises(p => p.filter(e => e.name !== name));
    else if (!exercises.find(e => e.name === name))
      setExercises(p => [...p, { id: Date.now() + (Math.random() * 1000 | 0), name }]);
  };

  const startEdit = (ex) => { setEditingId(ex.id); setEditingName(ex.name); setTimeout(() => editRef.current?.focus(), 30); };
  const confirmEdit = (id) => {
    const trimmed = editingName.trim();
    if (trimmed) setExercises(p => p.map(e => e.id === id ? { ...e, name: trimmed } : e));
    setEditingId(null);
  };
  const moveEx = (idx, dir) => {
    const target = idx + dir;
    if (target < 0 || target >= exercises.length) return;
    setExercises(p => { const a = [...p];[a[idx], a[target]] = [a[target], a[idx]]; return a; });
  };

  const canStart = exercises.length > 0;
  const btnColor = dayColor || "var(--text)";
  const btnText = dayColor ? "#000" : "var(--bg)";
  const title = todayLabels.length ? todayLabels.join(" + ") : "フリーワークアウト";

  // 部位ごとにグループ化（todayLabels が複数の場合はセクション表示）
  const useGroups = todayLabels.length > 1;
  const groups = useGroups
    ? todayLabels
      .map(lbl => ({ lbl, col: LABEL_COLORS[lbl], exs: exercises.filter(ex => ex.label === lbl) }))
      .filter(g => g.exs.length > 0)
    : null;
  const ungrouped = useGroups ? exercises.filter(ex => !ex.label) : exercises;

  const prevText = (name) => {
    const prev = getPrev(name);
    if (!prev) return "記録なし";
    const sets = prev.sets?.map(s => `${dispW(s.weight, unit)}${unit}×${s.reps}`).join(" / ");
    return `前回: ${sets || `${dispW(prev.weight, unit)}${unit}×${prev.reps}`}`;
  };

  const ExCard = ({ ex }) => {
    const i = exercises.indexOf(ex);
    const isEditing = editingId === ex.id;
    const pText = prevText(ex.name);
    const hasPrev = !!getPrev(ex.name);
    return (
      <div style={{ background: "var(--card)", borderRadius: 14, padding: "12px 14px", marginBottom: 8, border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {isEditing ? (
              <input ref={editRef} value={editingName}
                onChange={e => setEditingName(e.target.value)}
                onBlur={() => setTimeout(() => confirmEdit(ex.id), 500)}
                onKeyDown={e => { if (e.key === "Enter") confirmEdit(ex.id); if (e.key === "Escape") setEditingId(null); }}
                style={{ width: "100%", background: "transparent", border: "none", borderBottom: "1px solid var(--text2)", color: "var(--text)", fontSize: 14, fontWeight: 700, padding: "2px 0" }} />
            ) : (
              <div onClick={() => startEdit(ex)} style={{ fontSize: 14, fontWeight: 700, cursor: "text", color: "var(--text)" }}>
                {ex.name}
              </div>
            )}
            <div style={{ fontSize: 11, color: hasPrev ? "var(--text2)" : "var(--text5)", marginTop: 3 }}>
              {pText}
            </div>
          </div>
          <div style={{ display: "flex", gap: 2, alignItems: "center", flexShrink: 0 }}>
            <button onClick={() => moveEx(i, -1)} style={{ background: "none", color: i === 0 ? "var(--border2)" : "var(--text2)", fontSize: 13, padding: "4px 6px", lineHeight: 1 }}>▲</button>
            <button onClick={() => moveEx(i, 1)} style={{ background: "none", color: i === exercises.length - 1 ? "var(--border2)" : "var(--text2)", fontSize: 13, padding: "4px 6px", lineHeight: 1 }}>▼</button>
            <button onClick={() => removeEx(ex.name)} style={{ background: "none", color: "var(--text3)", fontSize: 18, padding: "4px 8px", lineHeight: 1 }}>×</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fade-in" style={{ padding: "20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
        <button onClick={onBack} style={{ background: "none", color: "var(--text2)", fontSize: 22, padding: "0 4px" }}>‹</button>
        <div>
          <div style={{ fontSize: 11, color: "var(--text2)", letterSpacing: 2, textTransform: "uppercase" }}>今日のメニュー</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: btnColor }}>{title}</div>
        </div>
      </div>

      {exercises.length === 0 && lastWorkoutExercises.length > 0 && (
        <button onClick={() => setExercises(lastWorkoutExercises)}
          style={{ width: "100%", padding: "14px 16px", borderRadius: 14, background: "var(--card2)", border: "1px solid var(--border2)", color: "var(--text)", fontSize: 14, fontWeight: 700, marginBottom: 12, textAlign: "left" }}>
          前回と同じメニューで始める <span style={{ color: "var(--text2)" }}>→</span>
        </button>
      )}

      {/* 部位ごとセクション表示 */}
      {useGroups && groups ? (
        <>
          {groups.map(({ lbl, col, exs }) => (
            <div key={lbl} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ width: 3, height: 16, borderRadius: 2, background: col, flexShrink: 0 }} />
                <div style={{ fontSize: 12, fontWeight: 800, color: col, letterSpacing: 1 }}>{lbl}</div>
                <div style={{ flex: 1, height: 1, background: col + "33" }} />
              </div>
              {exs.map(ex => <ExCard key={ex.id} ex={ex} />)}
            </div>
          ))}
          {ungrouped.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "var(--text2)", letterSpacing: 2, marginBottom: 8 }}>追加種目</div>
              {ungrouped.map(ex => <ExCard key={ex.id} ex={ex} />)}
            </div>
          )}
        </>
      ) : (
        <>
          {ungrouped.map(ex => <ExCard key={ex.id} ex={ex} />)}
        </>
      )}

      {exercises.length === 0 && (
        <div style={{ textAlign: "center", color: "var(--text5)", padding: "40px 0", fontSize: 14 }}>
          種目を追加してスタートしよう
        </div>
      )}

      <button onClick={() => setShowAdd(true)}
        style={{ width: "100%", padding: "15px", borderRadius: 14, background: "var(--card2)", border: `1px solid ${btnColor}55`, color: btnColor, fontSize: 15, fontWeight: 700, marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <span style={{ fontSize: 20, lineHeight: 1 }}>＋</span> 種目を追加
      </button>

      <button onClick={() => canStart && onStart(exercises)}
        style={{ width: "100%", padding: 18, borderRadius: 16, background: canStart ? btnColor : "var(--card2)", color: canStart ? btnText : "var(--text4)", fontWeight: 900, fontSize: 18 }}>
        {"START 💪"}
      </button>

      {showAdd && (
        <AddExModal
          name={newExName} setName={setNewExName}
          onConfirm={() => { addEx(newExName); setNewExName(""); }}
          onClose={() => { setShowAdd(false); setNewExName(""); }}
          target={todayLabels.length ? todayLabels : null}
          onQuickAdd={handleQuickAdd}
          existingNames={exercises.map(e => e.name)}
        />
      )}
    </div>
  );
}
