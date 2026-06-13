// src/components/home/WeeklyTrainingModal.jsx
import React from "react";
import { formatDate } from "./homeUtils";

const detailPill = {
    padding: "7px 11px",
    borderRadius: 999,
    background: "rgba(18,199,194,0.13)",
    border: "1px solid rgba(18,199,194,0.22)",
    color: "var(--accent)",
    fontSize: 12,
    fontWeight: 900,
};

function WeeklyTrainingModal({ selectedWeeklyPart, onClose }) {
    if (!selectedWeeklyPart) return null;

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
                            今週のトレーニング
                        </div>
                        <h2 style={{ margin: "6px 0 4px", fontSize: 28, fontWeight: 950, color: "var(--home-title)" }}>
                            {selectedWeeklyPart.part}
                        </h2>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                            <span style={detailPill}>{selectedWeeklyPart.totalSets} set</span>
                            <span style={detailPill}>{selectedWeeklyPart.totalVolume.toLocaleString()} kg</span>
                            <span style={detailPill}>
                                {selectedWeeklyPart.lastDate ? `最終 ${formatDate(selectedWeeklyPart.lastDate)}` : "記録なし"}
                            </span>
                        </div>
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

                <div style={{ marginTop: 18 }}>
                    <div style={{ color: "var(--home-title)", fontSize: 16, fontWeight: 950, marginBottom: 10 }}>
                        種目内訳
                    </div>

                    {(selectedWeeklyPart.exercises || []).length > 0 ? (
                        <div style={{ display: "grid", gap: 10 }}>
                            {selectedWeeklyPart.exercises.map((ex, idx) => (
                                <div
                                    key={`${ex.name}-${idx}`}
                                    style={{
                                        borderRadius: 17,
                                        border: "1px solid var(--home-inner-border)",
                                        background: "var(--home-inner-card)",
                                        padding: 14,
                                    }}
                                >
                                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                                        <div style={{
                                            color: "var(--home-title)",
                                            fontSize: 16,
                                            fontWeight: 950,
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                        }}>
                                            {ex.name}
                                        </div>
                                        <div style={{ color: "var(--accent)", fontSize: 14, fontWeight: 950 }}>
                                            {ex.sets} set
                                        </div>
                                    </div>

                                    <div style={{
                                        marginTop: 8,
                                        display: "flex",
                                        justifyContent: "space-between",
                                        gap: 8,
                                        color: "var(--home-muted2)",
                                        fontSize: 12,
                                        fontWeight: 850,
                                    }}>
                                        <span>{ex.volume.toLocaleString()} kg</span>
                                        <span>{ex.dates.join(" / ")}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={{ color: "var(--home-muted)", fontWeight: 800, padding: "10px 0" }}>
                            この部位の今週の記録はありません
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default WeeklyTrainingModal;
