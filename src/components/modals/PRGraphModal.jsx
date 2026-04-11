import { calc1RM, dispW, KG_TO_LBS } from "../../utils/helpers";

export default function PRGraphModal({ exName, history, unit = "kg", onClose }) {
  const recs = history[exName] || [];
  if (!recs.length) return null;

  const toU = (kg) => unit === "lbs" ? kg * KG_TO_LBS : kg;
  const vals = recs.map(r => ({
    date: r.date,
    rm: Math.round(toU(calc1RM(r.sets) || Number(r.weight) * (1 + Number(r.reps) / 30))),
    topSet: r.sets?.reduce((best, s) =>
      Number(s.weight) > Number(best?.weight || 0) ? s : best, r.sets[0]),
  }));

  const maxRM  = Math.max(...vals.map(v => v.rm)) || 1;
  const W = 320, H = 100, PAD = 8;

  const pts = vals.map((v, i) => ({
    x: vals.length > 1 ? PAD + (i / (vals.length - 1)) * (W - PAD * 2) : W / 2,
    y: H - PAD - ((v.rm / maxRM) * (H - PAD * 2)),
    ...v,
  }));

  const polyline = pts.map(p => `${p.x},${p.y}`).join(" ");

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000cc", zIndex: 300, display: "flex", alignItems: "flex-end" }}
      onClick={onClose}>
      <div style={{ width: "100%", maxWidth: 430, margin: "0 auto", background: "var(--card-modal)", borderRadius: "20px 20px 0 0", padding: "24px 20px 36px" }}
        onClick={e => e.stopPropagation()}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>{exName}</div>
            <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>推定1RM 推移（{unit}）</div>
          </div>
          <button onClick={onClose} style={{ background: "none", color: "var(--text2)", fontSize: 22 }}>×</button>
        </div>

        {/* Graph */}
        <div style={{ background: "var(--card2)", borderRadius: 12, padding: "16px", marginBottom: 16 }}>
          <svg width="100%" viewBox={`0 0 ${W} ${H + 20}`} style={{ overflow: "visible" }}>
            {/* Grid lines */}
            {[0.25, 0.5, 0.75, 1].map(f => (
              <line key={f}
                x1={PAD} y1={H - PAD - f * (H - PAD * 2)}
                x2={W - PAD} y2={H - PAD - f * (H - PAD * 2)}
                stroke="var(--border2)" strokeWidth="1" />
            ))}
            {/* Line */}
            {pts.length > 1 && (
              <polyline points={polyline} fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            )}
            {/* Points */}
            {pts.map((p, i) => (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r="4" fill={i === pts.length - 1 ? "#4ade80" : "var(--card2)"} stroke="#4ade80" strokeWidth="2" />
                {/* Value label on last/max point */}
                {(i === pts.length - 1 || p.rm === maxRM) && (
                  <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize="10" fill="#4ade80" fontWeight="700">
                    {p.rm}
                  </text>
                )}
                {/* Date label */}
                <text x={p.x} y={H + 14} textAnchor="middle" fontSize="9" fill="var(--text3)">
                  {p.date.slice(5)}
                </text>
              </g>
            ))}
          </svg>
        </div>

        {/* Stats */}
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1, background: "var(--card2)", borderRadius: 12, padding: "12px", textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#FFD700" }}>{maxRM}</div>
            <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>自己ベスト（{unit}）</div>
          </div>
          <div style={{ flex: 1, background: "var(--card2)", borderRadius: 12, padding: "12px", textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "var(--text)" }}>{vals[vals.length - 1]?.rm}</div>
            <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>直近（{unit}）</div>
          </div>
          <div style={{ flex: 1, background: "var(--card2)", borderRadius: 12, padding: "12px", textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "var(--text)" }}>{recs.length}</div>
            <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>記録回数</div>
          </div>
        </div>
      </div>
    </div>
  );
}
