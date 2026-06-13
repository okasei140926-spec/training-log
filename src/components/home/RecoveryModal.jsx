// src/components/home/RecoveryModal.jsx
import React from "react";
import { RECOVERY_META, formatDate, getRecoveryAdvice } from "./homeUtils";

const recoveryStatCard = {
    borderRadius: 16,
    border: "1px solid var(--home-inner-border)",
    background: "var(--home-inner-card)",
    padding: "12px 8px",
    textAlign: "center",
};

const recoveryStatLabel = {
    color: "var(--home-muted2)",
    fontSize: 11,
    fontWeight: 850,
};

const recoveryStatValue = {
    color: "var(--home-title)",
    fontSize: 22,
    lineHeight: 1.15,
    fontWeight: 950,
    marginTop: 6,
};

const recoveryStatUnit = {
    color: "var(--home-muted)",
    fontSize: 11,
    fontWeight: 850,
    marginTop: 2,
};

function RecoveryModal({ selectedRecovery, onClose }) {
    if (!selectedRecovery) return null;

    return (
        <div
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 9998,
                background: "rgba(0,0,0,0.58)",
                backdropFilter: "blur(10px)",
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                padding: "18px 14px",
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: "calc(100% - 28px)",
                    maxWidth: 430,
                    maxHeight: "82vh",
                    overflowY: "auto",
                    borderRadius: 24,
                    background: "var(--home-card)",
                    border: "1px solid var(--home-card-border)",
                    boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
                    padding: 20,
                    color: "var(--home-text)",
                }}
            >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <div>
                        <div style={{ color: "var(--home-muted2)", fontSize: 13, fontWeight: 850 }}>
                            回復状況
                        </div>
                        <h2 style={{ margin: "6px 0 4px", fontSize: 28, fontWeight: 950, color: "var(--home-title)" }}>
                            {selectedRecovery.part}
                        </h2>
                    </div>

                    <button
                        onClick={onClose}
                        style={{
                            width: 36,
                            height: 36,
                            borderRadius: 999,
                            border: "1px solid var(--home-card-border)",
                            background: "rgba(130,150,155,0.12)",
                            color: "var(--home-text)",
                            fontSize: 22,
                            fontWeight: 800,
                        }}
                    >
                        ×
                    </button>
                </div>

                <div style={{
                    marginTop: 14,
                    borderRadius: 20,
                    border: "1px solid var(--home-inner-border)",
                    background: "var(--home-inner-card)",
                    padding: 16,
                }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10 }}>
                        <div>
                            <div style={{
                                fontSize: 46,
                                lineHeight: 1,
                                fontWeight: 950,
                                letterSpacing: "-2px",
                                color: RECOVERY_META[selectedRecovery.status].color,
                                textShadow: `0 0 16px ${RECOVERY_META[selectedRecovery.status].color}44`,
                            }}>
                                {selectedRecovery.pct}%
                            </div>
                            <div style={{
                                marginTop: 7,
                                color: RECOVERY_META[selectedRecovery.status].color,
                                fontSize: 15,
                                fontWeight: 950,
                            }}>
                                {RECOVERY_META[selectedRecovery.status].label}
                            </div>
                        </div>

                        <div style={{ textAlign: "right", color: "var(--home-muted2)", fontSize: 12, fontWeight: 850 }}>
                            {selectedRecovery.detail.lastDate
                                ? `前回 ${formatDate(selectedRecovery.detail.lastDate)}`
                                : "記録なし"}
                        </div>
                    </div>

                    <div style={{
                        marginTop: 16,
                        height: 10,
                        borderRadius: 999,
                        background: "rgba(130,150,155,0.18)",
                        overflow: "hidden",
                    }}>
                        <div style={{
                            height: "100%",
                            width: `${selectedRecovery.pct}%`,
                            borderRadius: 999,
                            background: RECOVERY_META[selectedRecovery.status].color,
                            boxShadow: `0 0 14px ${RECOVERY_META[selectedRecovery.status].color}66`,
                        }} />
                    </div>
                </div>

                <div style={{
                    marginTop: 14,
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 8,
                }}>
                    <div style={recoveryStatCard}>
                        <div style={recoveryStatLabel}>直近7日</div>
                        <div style={recoveryStatValue}>{selectedRecovery.detail.totalSets7d}</div>
                        <div style={recoveryStatUnit}>set</div>
                    </div>
                    <div style={recoveryStatCard}>
                        <div style={recoveryStatLabel}>Volume</div>
                        <div style={recoveryStatValue}>{selectedRecovery.detail.totalVolume7d.toLocaleString()}</div>
                        <div style={recoveryStatUnit}>kg</div>
                    </div>
                    <div style={recoveryStatCard}>
                        <div style={recoveryStatLabel}>前回から</div>
                        {(() => {
                            const h = selectedRecovery.detail.lastHours;
                            if (h == null) return (
                                <>
                                    <div style={recoveryStatValue}>-</div>
                                    <div style={recoveryStatUnit}></div>
                                </>
                            );
                            if (h >= 48) {
                                const days = Math.floor(h / 24);
                                const hrs = h % 24;
                                return (
                                    <>
                                        <div style={{ ...recoveryStatValue, fontSize: 17 }}>
                                            {hrs > 0 ? `${days}日${hrs}時間` : `${days}日`}
                                        </div>
                                        <div style={recoveryStatUnit}></div>
                                    </>
                                );
                            }
                            return (
                                <>
                                    <div style={recoveryStatValue}>{h}</div>
                                    <div style={recoveryStatUnit}>時間</div>
                                </>
                            );
                        })()}
                    </div>
                </div>

                <div style={{
                    marginTop: 14,
                    borderRadius: 18,
                    border: "1px solid var(--home-inner-border)",
                    background: "var(--home-inner-card)",
                    padding: 14,
                }}>
                    <div style={{ color: "var(--accent)", fontSize: 13, fontWeight: 950, marginBottom: 7 }}>
                        AIコメント
                    </div>
                    <div style={{ color: "var(--home-text)", fontSize: 14, lineHeight: 1.65, fontWeight: 750 }}>
                        {getRecoveryAdvice(selectedRecovery.part, selectedRecovery.pct, selectedRecovery.detail)}
                    </div>
                </div>

                <div style={{ marginTop: 16 }}>
                    <div style={{ color: "var(--home-title)", fontSize: 16, fontWeight: 950, marginBottom: 10 }}>
                        最近の{selectedRecovery.part}トレ
                    </div>

                    {(selectedRecovery.detail.recent || []).length > 0 ? (
                        <div style={{ display: "grid", gap: 8 }}>
                            {selectedRecovery.detail.recent.map((r, idx) => (
                                <div
                                    key={`${r.date}-${r.name}-${idx}`}
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: "74px 1fr 52px 72px",
                                        gap: 7,
                                        alignItems: "center",
                                        padding: "10px 0",
                                        borderBottom: idx !== selectedRecovery.detail.recent.length - 1 ? "1px solid var(--home-row-border)" : "none",
                                    }}
                                >
                                    <div style={{ color: "var(--home-muted2)", fontSize: 12, fontWeight: 850 }}>
                                        {formatDate(r.date)}
                                    </div>
                                    <div style={{
                                        color: "var(--home-text)",
                                        fontSize: 13,
                                        fontWeight: 900,
                                        wordBreak: "break-word",
                                    }}>
                                        {r.name}
                                    </div>
                                    <div style={{ color: "var(--home-text)", fontSize: 12, fontWeight: 850, textAlign: "right" }}>
                                        {r.sets} set
                                    </div>
                                    <div style={{ color: "var(--home-text)", fontSize: 12, fontWeight: 850, textAlign: "right" }}>
                                        {r.volume.toLocaleString()} kg
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={{ color: "var(--home-muted)", fontWeight: 800, padding: "10px 0" }}>
                            この部位の記録はまだありません
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default RecoveryModal;
