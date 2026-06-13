// src/components/home/RecoveryCard.jsx
import React from "react";
import { RECOVERY_META } from "./homeUtils";

function RecoveryCard({ part, pct, status, onClick }) {
    const meta = RECOVERY_META[status];
    const activeBars = Math.max(1, Math.round(pct / 20));
    const pctFont = pct >= 100 ? 25 : 29;

    return (
        <button onClick={onClick} style={{
            minWidth: 0,
            overflow: "hidden",
            border: "1px solid var(--home-inner-border)",
            borderRadius: 15,
            padding: "12px 4px 11px",
            background: "var(--home-inner-card)",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.025)",
        }}>
            <div style={{ color: "var(--home-text)", fontSize: 14, fontWeight: 900, marginBottom: 10 }}>{part}</div>
            <div style={{
                color: meta.color,
                fontSize: pctFont,
                fontWeight: 950,
                lineHeight: 1,
                letterSpacing: "-1.6px",
                whiteSpace: "nowrap",
                textShadow: `0 0 14px ${meta.color}44`,
            }}>{pct}%</div>
            <div style={{ color: meta.color, fontSize: 12, fontWeight: 900, marginTop: 7 }}>{meta.label}</div>
            <div style={{ display: "flex", justifyContent: "center", gap: 3, marginTop: 12 }}>
                {[1,2,3,4,5].map(i => (
                    <span key={i} style={{
                        width: 12,
                        height: 5,
                        borderRadius: 99,
                        background: i <= activeBars ? meta.color : "rgba(130,150,155,0.22)",
                        boxShadow: i <= activeBars ? `0 0 10px ${meta.color}55` : "none",
                    }} />
                ))}
            </div>
        </button>
    );
}

export default RecoveryCard;
