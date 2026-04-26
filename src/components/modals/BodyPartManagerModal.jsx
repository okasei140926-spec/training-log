import { QUICK_LABELS } from "../../constants/suggestions";

export default function BodyPartManagerModal({
    isOpen,
    customBodyParts = [],
    hiddenBodyParts = [],
    onClose,
    onUpdateHiddenBodyParts,
}) {
    if (!isOpen) return null;

    const allBodyParts = [...new Set([...QUICK_LABELS, ...customBodyParts.filter(Boolean)])];
    const visibleCount = allBodyParts.filter((part) => !hiddenBodyParts.includes(part)).length;

    const toggleBodyPart = (bodyPart) => {
        const isHidden = hiddenBodyParts.includes(bodyPart);
        if (isHidden) {
            onUpdateHiddenBodyParts?.(hiddenBodyParts.filter((part) => part !== bodyPart));
            return;
        }

        if (visibleCount <= 1) {
            window.alert("最低1つの部位は表示したままにしてください");
            return;
        }

        onUpdateHiddenBodyParts?.([...hiddenBodyParts, bodyPart]);
    };

    return (
        <div
            onClick={(e) => {
                e.stopPropagation();
                onClose?.();
            }}
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

                <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6, color: "var(--text)" }}>
                    部位管理
                </div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 14 }}>
                    AddEx の部位チップに表示するカテゴリを選べます
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {allBodyParts.map((bodyPart) => {
                        const isHidden = hiddenBodyParts.includes(bodyPart);
                        const isLastVisible = !isHidden && visibleCount <= 1;

                        return (
                            <div
                                key={bodyPart}
                                style={{
                                    background: "var(--card2)",
                                    borderRadius: 12,
                                    padding: "10px 12px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 12,
                                }}
                            >
                                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                                    {bodyPart}
                                </div>
                                <button
                                    onClick={() => toggleBodyPart(bodyPart)}
                                    disabled={isLastVisible}
                                    style={{
                                        padding: "6px 10px",
                                        borderRadius: 10,
                                        border: "1px solid var(--border2)",
                                        background: "transparent",
                                        color: isHidden ? "var(--text3)" : "var(--text2)",
                                        fontSize: 11,
                                        fontWeight: 700,
                                        opacity: isLastVisible ? 0.5 : 1,
                                    }}
                                >
                                    {isHidden ? "表示" : "非表示"}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
