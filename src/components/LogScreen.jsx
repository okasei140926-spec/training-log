import React, { useState, useRef } from "react";
import { calc1RM, dispW } from "../utils/helpers";
import AddExModal from "./modals/AddExModal";

const PRESET_SECS = [30, 60, 90, 120];

export default function LogScreen({
  onBack,
  todayLabels, dayColor,
  exercises, logData, getExSets, setField, addSet, removeSet, removeEx,
  timerLeft, intervalSec, setIntervalSec, startTimer, stopTimer,
  saveLog, onAddEx, onQuickAddEx, onReorderEx, onRenameEx, getPrev, getPR, onCopyDown, onCopyDownReps, unit = "kg",
  getExUnit, onToggleExUnit,
}) {
  const [showAdd, setShowAdd]         = useState(false);
  const [addName, setAddName]         = useState("");
  const [customMode, setCustomMode]   = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [editingId, setEditingId]     = useState(null);
  const [editingName, setEditingName] = useState("");
  const editRef = useRef(null);

  const accentColor = dayColor || "var(--text)";
  const accentText  = dayColor ? "#000" : "var(--bg)";
  const isTimerOff  = intervalSec === 0;
  const isCustom    = !PRESET_SECS.includes(intervalSec) && intervalSec !== 0;

  const confirmCustom = () => {
    const val = parseInt(customInput);
    if (val > 0) setIntervalSec(val);
    setCustomMode(false);
  };

  const startEdit = (ex) => {
    setEditingId(ex.id);
    setEditingName(ex.name);
    setTimeout(() => editRef.current?.focus(), 30);
  };

  const confirmEdit = (ex) => {
    const trimmed = editingName.trim();
    if (trimmed && trimmed !== ex.name) onRenameEx(ex.id, trimmed);
    setEditingId(null);
  };

  const moveEx = (idx, dir) => {
    const target = idx + dir;
    if (target < 0 || target >= exercises.length) return;
    onReorderEx(idx, target);
  };

  const title = todayLabels.length ? todayLabels.join(" + ") : "ワークアウト";

  return (
    <div className="fade-in" style={{ padding: "20px", paddingBottom: 120 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        {onBack && (
          <button onClick={onBack} style={{ background: "none", color: "var(--text2)", fontSize: 22, padding: "0 4px", lineHeight: 1 }}>‹</button>
        )}
        <div style={{ fontSize: 11, color: "var(--text2)", letterSpacing: 3, textTransform: "uppercase" }}>{title}</div>
      </div>

      {/* タイマーエリア */}
      {timerLeft !== null ? (
        <div style={{ background: timerLeft === 0 ? "#4ade8022" : "var(--card2)", border: `1px solid ${timerLeft === 0 ? "#4ade80" : timerLeft <= 10 ? "#FF4D4D" : "var(--border2)"}`, borderRadius: 16, padding: "16px 20px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 2 }}>休憩中</div>
            <div style={{ fontSize: 36, fontWeight: 900, color: timerLeft === 0 ? "#4ade80" : timerLeft <= 10 ? "#FF4D4D" : "var(--text)" }}>
              {timerLeft === 0 ? "GO! 💪" : `${Math.floor(timerLeft / 60)}:${String(timerLeft % 60).padStart(2, "0")}`}
            </div>
          </div>
          <button onClick={stopTimer} style={{ padding: "8px 16px", borderRadius: 20, background: "var(--card2)", color: "var(--text2)", fontSize: 13 }}>スキップ</button>
        </div>
      ) : (
        <div style={{ background: "var(--card)", borderRadius: 12, padding: "12px 14px", marginBottom: 16, border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <div style={{ fontSize: 11, color: "var(--text2)", marginRight: 2, flexShrink: 0 }}>休憩</div>
            {PRESET_SECS.map(s => (
              <button key={s} onClick={() => { setIntervalSec(s); setCustomMode(false); }}
                style={{ padding: "5px 10px", borderRadius: 16, fontSize: 12, fontWeight: 600, flexShrink: 0, border: "none",
                  background: intervalSec === s && !isCustom ? "var(--text)" : "var(--border)",
                  color:      intervalSec === s && !isCustom ? "var(--bg)"   : "var(--text2)" }}>
                {s < 60 ? `${s}s` : `${s / 60}m`}
              </button>
            ))}
            {customMode ? (
              <input type="text" inputMode="numeric" autoFocus
                value={customInput} onChange={e => setCustomInput(e.target.value)}
                onBlur={confirmCustom} onKeyDown={e => e.key === "Enter" && confirmCustom()}
                placeholder="秒"
                style={{ width: 52, padding: "5px 8px", borderRadius: 16, fontSize: 12, background: "var(--text)", color: "var(--bg)", border: "none", textAlign: "center" }} />
            ) : (
              <button onClick={() => { setCustomMode(true); setCustomInput(isCustom ? String(intervalSec) : ""); }}
                style={{ padding: "5px 10px", borderRadius: 16, fontSize: 12, fontWeight: 600, flexShrink: 0, border: "none",
                  background: isCustom ? "var(--text)" : "var(--border)",
                  color:      isCustom ? "var(--bg)"   : "var(--text2)" }}>
                {isCustom ? `${intervalSec}s` : "カスタム"}
              </button>
            )}
            <button onClick={() => { setIntervalSec(0); setCustomMode(false); stopTimer(); }}
              style={{ padding: "5px 10px", borderRadius: 16, fontSize: 12, fontWeight: 600, flexShrink: 0,
                background: isTimerOff ? "#FF4D4D22" : "var(--border)",
                color: isTimerOff ? "#FF4D4D" : "var(--text2)",
                border: isTimerOff ? "1px solid #FF4D4D44" : "none" }}>
              OFF
            </button>
          </div>
          {!isTimerOff && (
            <button onClick={startTimer}
              style={{ width: "100%", marginTop: 10, padding: "9px", borderRadius: 10, background: "var(--card2)", border: "1px solid var(--border2)", color: "var(--text3)", fontSize: 13, fontWeight: 700 }}>
              ⏱ 休憩スタート
            </button>
          )}
        </div>
      )}

      {/* 種目カード */}
      {exercises.map((ex, i) => {
        const sets      = logData[ex.name] || getExSets(ex.name);
        const isEditing = editingId === ex.id;
        const prev      = getPrev ? getPrev(ex.name) : null;
        const pr        = getPR ? getPR(ex.name) : null;
        const exUnit    = getExUnit ? getExUnit(ex.name) : unit;
        const prIsAlsoPrev = pr && prev && pr.date === prev.date;

        const doneSets = sets.filter(s => s.done && s.weight && s.reps);
        const cur1RM   = calc1RM(doneSets);
        const prev1RM  = prev ? calc1RM(prev.sets) : 0;
        const isPRPace = doneSets.length > 0 && prev1RM > 0 && cur1RM > prev1RM * 1.001;

        // PR の実際のトップセット（1RM換算が最大のセット）
        const prTopSet = pr?.sets?.reduce((best, s) => {
          if (s.weight === "BW" || !s.weight || !s.reps) return best;
          if (!best) return s;
          return Number(s.weight) * (1 + Number(s.reps) / 30) >= Number(best.weight) * (1 + Number(best.reps) / 30) ? s : best;
        }, null);

        return (

  <React.Fragment key={ex.id}>
    <div style={{ background: "var(--card)", borderRadius: 16, padding: "16px", marginBottom: 12, border: `1px solid ${isPRPace ? "#4ade8055" : "var(--border)"}` }}>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
                {isEditing ? (
                  <input ref={editRef} value={editingName}
                    onChange={e => setEditingName(e.target.value)}
                    onBlur={() => confirmEdit(ex)}
                    onKeyDown={e => { if (e.key === "Enter") confirmEdit(ex); if (e.key === "Escape") setEditingId(null); }}
                    style={{ width: "100%", background: "transparent", border: "none", borderBottom: "1px solid var(--text2)", color: "var(--text)", fontSize: 16, fontWeight: 700, padding: "2px 0" }} />
                ) : (
                  <div onClick={() => startEdit(ex)} style={{ fontSize: 16, fontWeight: 700, cursor: "text", color: "var(--text)" }}>{ex.name}</div>
                )}
              </div>
              <div style={{ display: "flex", gap: 2, alignItems: "center", flexShrink: 0 }}>
                {onToggleExUnit && (
                  <button onClick={() => onToggleExUnit(ex.name)}
                    style={{ padding: "3px 9px", borderRadius: 10, fontSize: 11, fontWeight: 700, border: "1px solid var(--border2)", background: exUnit !== unit ? "var(--text)" : "var(--card2)", color: exUnit !== unit ? "var(--bg)" : "var(--text2)" }}>
                    {{ kg: "kg", lbs: "lbs", BW: "自重" }[exUnit] || exUnit}
                  </button>
                )}
                <button onClick={() => moveEx(i, -1)} style={{ background: "none", color: i === 0 ? "var(--border2)" : "var(--text3)", fontSize: 12, padding: "4px 5px" }}>▲</button>
                <button onClick={() => moveEx(i, 1)} style={{ background: "none", color: i === exercises.length - 1 ? "var(--border2)" : "var(--text3)", fontSize: 12, padding: "4px 5px" }}>▼</button>
                <button onClick={() => removeEx(ex.name)} style={{ background: "none", color: "var(--text4)", fontSize: 18, padding: "4px 8px" }}>×</button>
              </div>
            </div>

            {/* 前回の記録 + PR */}
            {(prev || pr) && (
              <div style={{ marginBottom: 10, padding: "8px 12px", background: "var(--card2)", borderRadius: 10 }}>
                {prev && (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <div style={{ fontSize: 11, color: "var(--text2)" }}>前回 <span style={{ color: "var(--text3)" }}>{prev.date}</span></div>
                      {isPRPace && <div style={{ fontSize: 11, color: "#4ade80", fontWeight: 700 }}>↑ PR更新ペース！</div>}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 3, lineHeight: 1.6 }}>
                      {prev.sets?.map((s, i) => (
                        <span key={i}>
                          {i > 0 && <span style={{ color: "var(--text5)", margin: "0 4px" }}>/</span>}
                          {s.weight === "BW" ? "BW" : `${dispW(s.weight, exUnit)}${exUnit}`}×{s.reps}
                        </span>
                      )) || `${prev.weight === "BW" ? "BW" : `${dispW(prev.weight, exUnit)}${exUnit}`}×${prev.reps}`}
                    </div>
                  </>
                )}
                {pr && !prIsAlsoPrev && (
                  <div style={{ marginTop: prev ? 6 : 0, paddingTop: prev ? 6 : 0, borderTop: prev ? "1px solid var(--border)" : "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 11, color: "var(--text2)" }}>🏆 PR <span style={{ color: "var(--text3)", fontWeight: 400 }}>{pr.date}</span></div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)" }}>
                      {prTopSet ? `${dispW(prTopSet.weight, exUnit)}${exUnit} × ${prTopSet.reps}rep` : `${pr.rm}${exUnit}`}
                    </div>
                  </div>
                )}
                {pr && prIsAlsoPrev && (
                  <div style={{ marginTop: 4, fontSize: 11, color: "var(--text2)" }}>
                    🏆 前回がPR（{prTopSet ? `${dispW(prTopSet.weight, exUnit)}${exUnit}×${prTopSet.reps}rep` : `${pr.rm}${exUnit}`}）
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 1fr 46px", gap: 6, marginBottom: 6 }}>
              <div />
              <div style={{ fontSize: 10, color: "var(--text2)", textAlign: "center" }}>{exUnit === "BW" ? "自重" : exUnit}</div>
              <div style={{ fontSize: 10, color: "var(--text2)", textAlign: "center" }}>rep</div>
              <div />
            </div>

            {sets.map((set, idx) => {
              const canCopy = idx < sets.length - 1;
              return (
                <div key={idx} style={{ display: "grid", gridTemplateColumns: "24px 1fr 1fr 46px", gap: 6, marginBottom: 8, alignItems: "stretch" }}>
                  <button onClick={() => setField(ex.name, idx, "weight", set.weight === "BW" ? "" : "BW")}
  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 40, borderRadius: 8, background: set.weight === "BW" ? "var(--text)" : "var(--border)", fontSize: 11, color: set.weight === "BW" ? "var(--bg)" : "var(--text2)", fontWeight: 700, alignSelf: "center", border: "none" }}>
  {idx + 1}
</button>

                  
                  {set.weight === "BW" ? (
                    <button onClick={() =>
                  setField(ex.name, idx, "weight", "")}
                      style={{ width: "100%", background: "var(--card2)", border: "2px solid var(--border2)", borderRadius: 10, padding: "10px 8px",
                        color: "var(--text2)", fontSize: 14, fontWeight: 700, textAlign: "center" }}>
                            自重 <span style={{ fontSize: 10, color: "var(--text4)" }}>タップでkg</span>
                        </button>
                  ) : (
                        <input type="text" inputMode="decimal" value={set.weight}
                          onChange={e => setField(ex.name, idx, "weight", e.target.value)}
                          onLongPress={() => setField(ex.name, idx, "weight", "BW")}
                        placeholder="0"
                          style={{ width: "100%", background: "var(--card2)", border: "1px solid var(--border2)", borderRadius: 10, padding: "10px 8px", color: "var(--text)", fontSize: 16, fontWeight: 700,
                            textAlign: "center" }} />
                    )}

                  <input type="text" inputMode="numeric" value={set.reps}
                    onChange={e => setField(ex.name, idx, "reps", e.target.value)} placeholder="0"
                    style={{ width: "100%", background: "var(--card2)", border: "1px solid var(--border2)", borderRadius: 10, padding: "10px 8px", color: "var(--text)", fontSize: 16, fontWeight: 700, textAlign: "center" }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, height: "100%" }}>
                    {canCopy && exUnit !== "BW" && onCopyDown ? (
                      <button onClick={() => onCopyDown(ex.name, idx)}
                        style={{ flex: 1, minHeight: 28, borderRadius: 7, background: "var(--border)", border: "none", color: "var(--text3)", fontSize: 11, fontWeight: 700 }}>
                        ↓{exUnit === "lbs" ? "lbs" : "kg"}
                      </button>
                    ) : <div style={{ flex: 1 }} />}
                    {canCopy && onCopyDownReps ? (
                      <button onClick={() => onCopyDownReps(ex.name, idx)}
                        style={{ flex: 1, minHeight: 18, borderRadius: 7, background: "var(--border)", border: "none", color: "var(--text3)", fontSize: 10, fontWeight: 700 }}>
                        ↓rep
                      </button>
                    ) : <div style={{ flex: 1 }} />}
                  </div>
                </div>
              );
            })}

                        <button onClick={() => addSet(ex.name)}
              style={{ width: "100%", marginTop: 4, padding: "8px", borderRadius: 10, background: "transparent", border: "1px dashed var(--border2)", color: "var(--text3)", fontSize: 13 }}>
              ＋ セット追加
            </button>
          </div>
          {i < exercises.length - 1 && (
            <button onClick={() => setShowAdd(true)}
              style={{ width: "100%", marginBottom: 8, padding: "6px", borderRadius: 10, background: "transparent", border: "1px dashed var(--border2)", color: "var(--text4)", fontSize: 11 }}>
              ＋ 種目を追加
            </button>
          )}
        </React.Fragment>
        );
      })}


      <button onClick={saveLog}
        style={{ width: "100%", padding: 16, borderRadius: 14, background: accentColor, color: accentText, fontWeight: 800, fontSize: 16 }}>
        SAVE WORKOUT ✓
      </button>

      {showAdd && (
        <AddExModal
          name={addName} setName={setAddName}
          onConfirm={() => { onAddEx(addName); setAddName(""); }}
          onClose={() => { setShowAdd(false); setAddName(""); }}
          target={todayLabels.length ? todayLabels : null}
          onQuickAdd={onQuickAddEx}
          existingNames={exercises.map(e => e.name)}
        />
      )}
    </div>
  );
}
