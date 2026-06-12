// src/components/friends/Big3DetailModal.jsx
import React from "react";

function Big3DetailModal({ selectedBig3Entry, setSelectedBig3Entry, renderRankAvatar }) {
    if (!selectedBig3Entry) return null;

    return (
        <div
            onClick={() => setSelectedBig3Entry(null)}
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 9999,
                background: "rgba(15, 23, 42, 0.38)",
                backdropFilter: "blur(8px)",
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                padding: "18px 14px calc(18px + var(--safe-bottom, 0px))",
            }}
        >
            <div
                onClick={(event) => event.stopPropagation()}
                style={{
                    width: "100%",
                    maxWidth: 420,
                    borderRadius: 24,
                    background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(238, 252, 251, 0.98))",
                    border: "1px solid rgba(18, 199, 194, 0.18)",
                    boxShadow: "0 24px 54px rgba(15, 94, 99, 0.20)",
                    padding: 18,
                    color: "var(--text)",
                }}
            >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                        {renderRankAvatar(selectedBig3Entry, 48)}
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12, color: "var(--text3)", fontWeight: 900 }}>
                                BIG3 内訳
                            </div>
                            <div style={{ fontSize: 20, color: "var(--text)", fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {selectedBig3Entry.name}
                            </div>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setSelectedBig3Entry(null)}
                        style={{
                            width: 38,
                            height: 38,
                            borderRadius: 999,
                            border: "1px solid rgba(18, 199, 194, 0.14)",
                            background: "rgba(255,255,255,0.72)",
                            color: "var(--text)",
                            fontSize: 22,
                            fontWeight: 900,
                            flexShrink: 0,
                        }}
                        aria-label="閉じる"
                    >
                        ×
                    </button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginBottom: 10 }}>
                    {[
                        ["ベンチプレス", selectedBig3Entry.bench],
                        ["スクワット", selectedBig3Entry.squat],
                        ["デッドリフト", selectedBig3Entry.deadlift],
                    ].map(([label, value]) => (
                        <div
                            key={label}
                            style={{
                                borderRadius: 16,
                                border: "1px solid rgba(18, 199, 194, 0.14)",
                                background: "rgba(255,255,255,0.76)",
                                padding: "12px 8px",
                                textAlign: "center",
                            }}
                        >
                            <div style={{ fontSize: 10.5, color: "var(--text3)", fontWeight: 900, lineHeight: 1.2 }}>
                                {label}
                            </div>
                            <div style={{ fontSize: 18, color: "var(--text)", fontWeight: 950, marginTop: 7, whiteSpace: "nowrap" }}>
                                {Number(value || 0).toLocaleString("ja-JP")}kg
                            </div>
                        </div>
                    ))}
                </div>

                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        borderRadius: 18,
                        background: "linear-gradient(135deg, rgba(15, 94, 99, 0.12), rgba(18, 199, 194, 0.18))",
                        border: "1px solid rgba(18, 199, 194, 0.22)",
                        padding: "13px 14px",
                    }}
                >
                    <div style={{ fontSize: 13, color: "var(--text2)", fontWeight: 900 }}>
                        合計
                    </div>
                    <div style={{ fontSize: 24, color: "var(--accent)", fontWeight: 950 }}>
                        {Number(selectedBig3Entry.value || 0).toLocaleString("ja-JP")}kg
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Big3DetailModal;
