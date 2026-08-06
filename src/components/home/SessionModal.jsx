// src/components/home/SessionModal.jsx
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

function SessionModal({ selectedSession, onClose, onCopyExercises }) {
    if (!selectedSession) return null;

    return (
        <div
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 9999,
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
                            {formatDate(selectedSession.date)}
                        </div>
                        <h2 style={{ margin: "6px 0 4px", fontSize: 23, fontWeight: 950, color: "var(--home-title)" }}>
                            {selectedSession.parts?.length ? selectedSession.parts.join("・") : "ワークアウト"}
                        </h2>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                            <span style={detailPill}>{selectedSession.sets} set</span>
                            <span style={detailPill}>{selectedSession.volume.toLocaleString()} kg</span>
                            <span style={detailPill}>{selectedSession.minutes ? `${selectedSession.minutes}分` : "-"}</span>
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

                {onCopyExercises && (selectedSession.exercises || []).length > 0 && (
                    <button
                        onClick={() => onCopyExercises(
                            (selectedSession.exercises || []).map((ex) => ({ name: ex.name, bodyPart: ex.bodyPart }))
                        )}
                        style={{
                            marginTop: 16,
                            width: "100%",
                            borderRadius: 18,
                            padding: "14px 12px",
                            fontSize: 14,
                            fontWeight: 800,
                            background: "linear-gradient(135deg, var(--accent), #4ADE80)",
                            color: "#fff",
                            border: "none",
                            boxShadow: "0 8px 18px rgba(15,94,99,0.14)",
                        }}
                    >
                        この日の種目をコピー
                    </button>
                )}

                <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
                    {(selectedSession.exercises || []).map((ex, idx) => (
                        <div
                            key={`${ex.name}-${idx}`}
                            style={{
                                borderRadius: 18,
                                border: "1px solid var(--home-inner-border)",
                                background: "var(--home-inner-card)",
                                padding: 14,
                            }}
                        >
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                <div>
                                    <div style={{ fontSize: 16, fontWeight: 950, color: "var(--home-title)" }}>
                                        {ex.name}
                                    </div>
                                    <div style={{ marginTop: 5, color: "var(--home-muted2)", fontSize: 12, fontWeight: 800 }}>
                                        {ex.bodyPart} ・ {ex.setCount} set ・ {ex.volume.toLocaleString()} kg
                                    </div>
                                </div>
                            </div>

                            <div style={{ marginTop: 12, display: "grid", gap: 7 }}>
                                {(ex.sets || []).length > 0 ? (
                                    ex.sets.map((set, setIdx) => (
                                        <div
                                            key={setIdx}
                                            style={{
                                                display: "flex",
                                                justifyContent: "space-between",
                                                alignItems: "center",
                                                padding: "8px 10px",
                                                borderRadius: 12,
                                                background: "rgba(130,150,155,0.10)",
                                                color: "var(--home-text)",
                                                fontWeight: 850,
                                            }}
                                        >
                                            <span style={{ color: "var(--home-muted2)" }}>{setIdx + 1} set</span>
                                            <span>{set.weight} × {set.reps}</span>
                                        </div>
                                    ))
                                ) : (
                                    <div style={{ color: "var(--home-muted)", fontWeight: 800 }}>
                                        セット詳細なし
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export default SessionModal;
