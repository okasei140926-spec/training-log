import { useState } from "react";
import { save, load } from "../utils/helpers";

const STEPS = [
  {
    title: "IRON LOGへようこそ 💪",
    body: "筋トレを記録して、成長を可視化しよう。まず基本的な使い方を案内します。",
    hint: null,
  },
  {
    title: "① 部位を選ぼう",
    body: "ホーム画面でトレーニングしたい部位をタップして選択。複数選択もできます。",
    hint: "例：胸・背中・肩 など",
  },
  {
    title: "② メニューを確認",
    body: "「メニューを確認して始める」をタップ。種目の追加・並び替えも自由にできます。",
    hint: "種目が未設定なら「フリーで始める」でも OK",
  },
  {
    title: "③ トレーニングを記録",
    body: "重量と回数を入力してセット完了。終わったら「SAVE WORKOUT」で保存！",
    hint: "自重トレには「自重」ボタン、ポンド派には種目ごとに lbs 切替も可能",
  },
];

export default function OnboardingOverlay({ onDone }) {
  const [step, setStep] = useState(0);

  const next = () => {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      save("onboardingDone", true);
      onDone();
    }
  };

  const skip = () => {
    save("onboardingDone", true);
    onDone();
  };

  const s = STEPS[step];

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#000000ee", zIndex: 1000,
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div style={{
        width: "100%", maxWidth: 430, background: "var(--card-modal)",
        borderRadius: "24px 24px 0 0", padding: "32px 24px 48px",
      }}>
        {/* Progress dots */}
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 28 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 20 : 6, height: 6, borderRadius: 3,
              background: i === step ? "var(--text)" : "var(--border2)",
              transition: "width 0.3s ease",
            }} />
          ))}
        </div>

        <div style={{ fontSize: 20, fontWeight: 900, color: "var(--text)", marginBottom: 12 }}>{s.title}</div>
        <div style={{ fontSize: 15, color: "var(--text2)", lineHeight: 1.7, marginBottom: s.hint ? 10 : 32 }}>{s.body}</div>
        {s.hint && (
          <div style={{ fontSize: 12, color: "var(--text3)", background: "var(--card2)", borderRadius: 10, padding: "8px 12px", marginBottom: 28 }}>
            💡 {s.hint}
          </div>
        )}

        <button onClick={next} style={{
          width: "100%", padding: "16px", borderRadius: 16,
          background: "var(--text)", color: "var(--bg)", fontWeight: 900, fontSize: 16, border: "none",
        }}>
          {step < STEPS.length - 1 ? "次へ →" : "はじめる 🚀"}
        </button>

        {step < STEPS.length - 1 && (
          <button onClick={skip} style={{
            width: "100%", marginTop: 12, padding: "12px", borderRadius: 16,
            background: "transparent", color: "var(--text4)", fontSize: 14, border: "none",
          }}>
            スキップ
          </button>
        )}
      </div>
    </div>
  );
}
