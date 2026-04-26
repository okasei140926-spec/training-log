const BODY_PART_LABELS = ["胸", "背中", "脚", "肩", "二頭", "三頭", "腹", "その他"];

const resolveBodyPart = (value) => {
    return BODY_PART_LABELS.includes(value) ? value : "その他";
};

export default function ManualBestManagerModal({
    isOpen,
    user,
    manualBests = [],
    onClose,
    onOpenRegister,
    onDeleteBest,
}) {
    if (!isOpen) return null;

    const groupedManualBests = BODY_PART_LABELS.map((bodyPart) => ({
        bodyPart,
        items: manualBests.filter((best) => resolveBodyPart(best.body_part) === bodyPart),
    })).filter((group) => group.items.length > 0);

    return (
        <div
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.35)",
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                zIndex: 1000,
                padding: 16,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: "100%",
                    maxWidth: 430,
                    background: "var(--card)",
                    borderRadius: 20,
                    padding: "18px 16px 20px",
                    border: "1px solid var(--border2)",
                    maxHeight: "72vh",
                    overflowY: "auto",
                }}
            >
                <div
                    style={{
                        width: 44,
                        height: 5,
                        borderRadius: 999,
                        background: "var(--border2)",
                        margin: "0 auto 14px",
                    }}
                />

                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        marginBottom: 14,
                    }}
                >
                    <div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)", marginBottom: 4 }}>
                            過去ベスト管理
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text3)" }}>
                            移行用に、過去の自己ベストだけ先に登録できます
                        </div>
                    </div>
                    <button
                        onClick={onOpenRegister}
                        disabled={!user}
                        style={{
                            padding: "8px 12px",
                            borderRadius: 12,
                            background: "var(--card2)",
                            border: "1px solid var(--border2)",
                            color: "var(--text)",
                            fontSize: 12,
                            fontWeight: 700,
                            opacity: user ? 1 : 0.6,
                            flexShrink: 0,
                        }}
                    >
                        過去ベスト登録
                    </button>
                </div>

                {!user ? (
                    <div style={{ fontSize: 12, color: "var(--text3)" }}>
                        ログインすると過去ベストを保存できます
                    </div>
                ) : manualBests.length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--text3)" }}>
                        まだ登録された過去ベストはありません
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {groupedManualBests.map((group) => (
                            <div key={group.bodyPart}>
                                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text3)", marginBottom: 8 }}>
                                    {group.bodyPart}
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    {group.items.map((best) => (
                                        <div
                                            key={best.id}
                                            style={{
                                                background: "var(--card2)",
                                                borderRadius: 12,
                                                padding: "10px 12px",
                                                display: "flex",
                                                justifyContent: "space-between",
                                                alignItems: "center",
                                                gap: 12,
                                            }}
                                        >
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
                                                    {best.exercise_name}
                                                </div>
                                                <div style={{ fontSize: 12, color: "var(--text2)" }}>
                                                    {best.weight}kg × {best.reps}rep
                                                    {best.best_date ? ` ・ ${best.best_date.replace(/-/g, "/")}` : ""}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => onDeleteBest?.(best)}
                                                style={{
                                                    padding: "6px 10px",
                                                    borderRadius: 10,
                                                    background: "transparent",
                                                    border: "1px solid var(--border2)",
                                                    color: "var(--text3)",
                                                    fontSize: 11,
                                                    fontWeight: 700,
                                                    flexShrink: 0,
                                                }}
                                            >
                                                削除
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
