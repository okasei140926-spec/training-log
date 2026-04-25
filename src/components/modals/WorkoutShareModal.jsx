import React from "react";

const TEMPLATE_OPTIONS = [
    { id: "cute", label: "Cute" },
    { id: "cool", label: "Cool" },
];

function formatDate(dateStr) {
    if (!dateStr) return "";
    const [year, month, day] = dateStr.split("-");
    return `${year}/${month}/${day}`;
}

function buildTemplateStyles(template) {
    if (template === "cool") {
        return {
            shell: {
                background: "linear-gradient(180deg, #0f0f10 0%, #1a1a1d 100%)",
                color: "#f5f5f5",
                border: "1px solid #3b3b40",
                boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
            },
            photoFrame: {
                background: "#111214",
                border: "1px solid #2e2f35",
                borderRadius: 24,
                padding: 10,
            },
            badge: {
                background: "#202127",
                color: "#d7d7dd",
                border: "1px solid #363741",
            },
            summaryCard: {
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#f5f5f5",
            },
            label: { color: "#9c9ca8" },
            accent: "#f5f5f5",
            brand: "#9c9ca8",
            title: "TODAY'S WORKOUT",
        };
    }

    return {
        shell: {
            background: "linear-gradient(180deg, #fff8fb 0%, #fff5ef 100%)",
            color: "#51363c",
            border: "1px solid #f3dfe5",
            boxShadow: "0 24px 60px rgba(196,132,148,0.18)",
        },
        photoFrame: {
            background: "#fffdfd",
            border: "1px solid #f1e6ea",
            borderRadius: 28,
            padding: 12,
        },
        badge: {
            background: "#fff0f5",
            color: "#a25d6c",
            border: "1px solid #f3d7df",
        },
        summaryCard: {
            background: "rgba(255,255,255,0.75)",
            border: "1px solid rgba(232,199,210,0.9)",
            color: "#51363c",
        },
        label: { color: "#9b7d86" },
        accent: "#7f4653",
        brand: "#b48d99",
        title: "Workout Moment",
    };
}

function SummaryItem({ value, label, styleSet }) {
    return (
        <div
            style={{
                ...styleSet.summaryCard,
                borderRadius: 18,
                padding: "14px 12px",
                minWidth: 0,
            }}
        >
            <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.1, marginBottom: 6 }}>
                {value}
            </div>
            <div style={{ ...styleSet.label, fontSize: 11, lineHeight: 1.4 }}>
                {label}
            </div>
        </div>
    );
}

export default function WorkoutShareModal({
    isOpen,
    onClose,
    template,
    onChangeTemplate,
    photoUrl,
    workoutDate,
    summary,
}) {
    if (!isOpen) return null;

    const styleSet = buildTemplateStyles(template);
    const dateLabel = formatDate(workoutDate);
    const totalVolumeLabel = `${Number(summary?.totalVolumeKg || 0).toLocaleString("ja-JP")}kg`;

    return (
        <div
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 140,
                background: "rgba(0,0,0,0.72)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 18,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: "100%",
                    maxWidth: 430,
                    maxHeight: "92vh",
                    overflowY: "auto",
                    borderRadius: 28,
                    padding: 18,
                    background: "var(--card)",
                    border: "1px solid var(--border2)",
                }}
            >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
                    <div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>投稿プレビュー</div>
                        <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
                            今日の写真とワークアウト要約
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            padding: "8px 12px",
                            borderRadius: 12,
                            background: "var(--card2)",
                            border: "1px solid var(--border2)",
                            color: "var(--text2)",
                            fontSize: 12,
                            fontWeight: 700,
                        }}
                    >
                        閉じる
                    </button>
                </div>

                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                    {TEMPLATE_OPTIONS.map((option) => {
                        const isActive = option.id === template;
                        return (
                            <button
                                key={option.id}
                                onClick={() => onChangeTemplate(option.id)}
                                style={{
                                    flex: 1,
                                    padding: "10px 12px",
                                    borderRadius: 14,
                                    border: `1px solid ${isActive ? styleSet.accent : "var(--border2)"}`,
                                    background: isActive ? styleSet.accent : "var(--card2)",
                                    color: isActive ? "#fff" : "var(--text2)",
                                    fontSize: 12,
                                    fontWeight: 800,
                                }}
                            >
                                {option.label}
                            </button>
                        );
                    })}
                </div>

                {photoUrl ? (
                    <div
                        style={{
                            ...styleSet.shell,
                            borderRadius: 30,
                            padding: 18,
                            overflow: "hidden",
                        }}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
                            <div>
                                <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", opacity: 0.8 }}>
                                    {styleSet.title}
                                </div>
                                <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.15, marginTop: 6 }}>
                                    {dateLabel}
                                </div>
                            </div>
                            <div style={{ ...styleSet.badge, borderRadius: 999, padding: "6px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                                {template === "cute" ? "today's glow" : "performance log"}
                            </div>
                        </div>

                        <div style={{ ...styleSet.photoFrame, marginBottom: 14 }}>
                            <img
                                src={photoUrl}
                                alt={`${dateLabel} workout share`}
                                style={{
                                    width: "100%",
                                    display: "block",
                                    aspectRatio: "4 / 5",
                                    objectFit: "cover",
                                    borderRadius: template === "cute" ? 22 : 18,
                                }}
                            />
                        </div>

                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                                gap: 10,
                                marginBottom: 14,
                            }}
                        >
                            <SummaryItem value={`${summary?.exerciseCount || 0}種目`} label="エクササイズ" styleSet={styleSet} />
                            <SummaryItem value={`${summary?.setCount || 0}セット`} label="トータルセット" styleSet={styleSet} />
                            <SummaryItem value={`PR ${summary?.prCount || 0}`} label="更新件数" styleSet={styleSet} />
                            <SummaryItem value={totalVolumeLabel} label="合計ボリューム" styleSet={styleSet} />
                        </div>

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                            <div style={{ ...styleSet.label, fontSize: 11 }}>
                                まずはプレビューのみ
                            </div>
                            <div style={{ color: styleSet.brand, fontSize: 11, letterSpacing: 1.4 }}>
                                IRON LOG
                            </div>
                        </div>
                    </div>
                ) : (
                    <div style={{ background: "var(--card2)", borderRadius: 18, padding: "32px 18px", textAlign: "center" }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
                            写真を追加すると投稿プレビューできます
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text3)" }}>
                            今日の体写真を1枚追加すると Cute / Cool テンプレで確認できます
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
