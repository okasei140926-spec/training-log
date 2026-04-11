import { QUICK_LABELS, LABEL_COLORS } from "../constants/suggestions";
import { dispW } from "../utils/helpers";

export default function HomeScreen({ muscleEx, history, todayLabels, setTodayLabels, onStartWorkout, onStartFree, onGoToSetup, unit = "kg", logDate, setLogDate }) {
  const toggle = (lbl) =>
    setTodayLabels(p => p.includes(lbl) ? p.filter(x => x !== lbl) : [...p, lbl]);

  const selectedExercises = todayLabels.flatMap(l => muscleEx[l] || []);
  const btnColor = LABEL_COLORS[todayLabels[0]] || "var(--text)";
  const hasAnyExercises = Object.values(muscleEx).some(arr => arr.length > 0);
  const todayStr = new Date().toISOString().split("T")[0];
  const isToday = !logDate || logDate === todayStr;

  return (
    <div className="fade-in">
      <div style={{ padding: "24px 20px 12px" }}>
        <div style={{ fontSize: 26, fontWeight: 900, marginBottom: 4 }}>今日どこ鍛える？</div>
        <div style={{ fontSize: 13, color: "var(--text2)" }}>部位を選んでメニューを確認しよう</div>
      </div>

      {/* 記録日 */}
      {setLogDate && (
        <div style={{ padding: "0 20px 16px", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--text3)" }}>記録日</div>
          <input
            type="date"
            value={logDate || todayStr}
            onChange={e => e.target.value && setLogDate(e.target.value)}
            style={{
              padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: isToday ? 400 : 700,
              background: isToday ? "var(--card)" : "#4D9FFF22",
              border: `1px solid ${isToday ? "var(--border)" : "#4D9FFF66"}`,
              color: isToday ? "var(--text2)" : "#4D9FFF",
            }}
          />
          {!isToday && (
            <button onClick={() => setLogDate(todayStr)}
              style={{ fontSize: 11, color: "var(--text3)", background: "none", border: "1px solid var(--border)", borderRadius: 12, padding: "3px 8px" }}>
              今日に戻す
            </button>
          )}
        </div>
      )}

      {/* 種目未設定ガイダンス */}
      {!hasAnyExercises && (
        <div style={{ margin: "0 20px 20px", background: "var(--card)", borderRadius: 16, padding: "18px", border: "1px solid var(--border2)" }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>まず種目を設定しよう 💡</div>
          <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.7, marginBottom: 14 }}>
            部位ごとに種目を登録しておくと、ここから一発で呼び出せます。<br />
            種目なしでも「フリーで始める」からすぐスタートできます。
          </div>
          <button onClick={onGoToSetup}
            style={{ padding: "10px 18px", borderRadius: 20, background: "var(--text)", color: "var(--bg)", fontWeight: 700, fontSize: 13, border: "none" }}>
            ⚙ 種目を設定する
          </button>
        </div>
      )}

      {/* 部位チップ */}
      <div style={{ padding: "4px 20px 20px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        {QUICK_LABELS.map(lbl => {
          const isSelected = todayLabels.includes(lbl);
          const col = LABEL_COLORS[lbl];
          const exCount = (muscleEx[lbl] || []).length;
          return (
            <button key={lbl} onClick={() => toggle(lbl)}
              style={{
                borderRadius: 14, padding: "14px 4px",
                background: isSelected ? col + "22" : "var(--card)",
                border: `2px solid ${isSelected ? col : "var(--border)"}`,
                display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
              }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: isSelected ? col : "var(--text3)" }}>{lbl}</div>
              <div style={{ fontSize: 10, color: isSelected ? col + "99" : "var(--text5)" }}>
                {exCount > 0 ? `${exCount}種目` : "未設定"}
              </div>
            </button>
          );
        })}
      </div>

      {/* 選択中の種目プレビュー */}
      {selectedExercises.length > 0 && (
        <div style={{ margin: "0 20px 20px", background: "var(--card)", borderRadius: 16, padding: "16px", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11, color: "var(--text2)", letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>
            今日の種目 ({selectedExercises.length})
          </div>
          {selectedExercises.slice(0, 5).map(ex => {
            const recs = history[ex.name];
            const last = recs?.[recs.length - 1];
            return (
              <div key={ex.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{ex.name}</div>
                {last
                  ? <div style={{ fontSize: 12, color: "var(--text2)" }}>
                      {dispW(last.sets?.[0]?.weight ?? last.weight, unit)}{unit} × {last.sets?.[0]?.reps ?? last.reps}
                      <span style={{ color: "var(--text4)", marginLeft: 4 }}>前回</span>
                    </div>
                  : <div style={{ fontSize: 12, color: "var(--text5)" }}>初回</div>
                }
              </div>
            );
          })}
          {selectedExercises.length > 5 && (
            <div style={{ fontSize: 12, color: "var(--text3)", paddingTop: 8 }}>他 {selectedExercises.length - 5} 種目</div>
          )}
        </div>
      )}

      {/* スタートボタン */}
      <div style={{ padding: "0 20px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
        {todayLabels.length > 0 ? (
          <button onClick={onStartWorkout}
            style={{ width: "100%", padding: "18px", borderRadius: 16, background: btnColor, color: LABEL_COLORS[todayLabels[0]] ? "#000" : "var(--bg)", fontWeight: 900, fontSize: 17 }}>
            スタート 💪
          </button>
        ) : (
          <div style={{ textAlign: "center", color: "var(--text4)", padding: "8px 0", fontSize: 14 }}>
            部位を選んでスタートしよう
          </div>
        )}
        <button onClick={onStartFree}
          style={{ width: "100%", padding: "14px", borderRadius: 14, background: "var(--card)", border: "1px dashed var(--border2)", color: "var(--text2)", fontWeight: 700, fontSize: 14 }}>
          フリーで始める（部位選択なし）→
        </button>
      </div>
    </div>
  );
}
