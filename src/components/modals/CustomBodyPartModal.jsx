import { useEffect, useState } from "react";

const FIXED_BODY_PARTS = [
    "胸",
    "背中",
    "四頭",
    "ハムストリングス",
    "尻",
    "肩",
    "二頭",
    "三頭",
    "腹筋",
    "脚",
    "腹",
    "その他",
];

export default function CustomBodyPartModal({
    isOpen,
    customBodyParts = [],
    onClose,
    onSave,
}) {
    const [name, setName] = useState("");
    const [error, setError] = useState("");

    useEffect(() => {
        if (!isOpen) return;
        setName("");
        setError("");
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSave = () => {
        const trimmed = name.trim();

        if (!trimmed) {
            setError("部位名を入力してください");
            return;
        }

        if (FIXED_BODY_PARTS.includes(trimmed)) {
            setError("その部位名はすでに使われています");
            return;
        }

        if (customBodyParts.some((part) => part === trimmed)) {
            setError("同じ部位がすでに登録されています");
            return;
        }

        setError("");
        onSave?.(trimmed);
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

                <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 14, color: "var(--text)" }}>
                    部位を追加
                </div>

                <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="部位名"
                    style={{
                        width: "100%",
                        padding: "12px 14px",
                        borderRadius: 12,
                        border: "1px solid var(--border2)",
                        background: "var(--card2)",
                        color: "var(--text)",
                        fontSize: 14,
                        boxSizing: "border-box",
                    }}
                />

                {error && (
                    <div style={{ fontSize: 12, color: "#f87171", marginTop: 12 }}>
                        {error}
                    </div>
                )}

                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                    <button
                        onClick={onClose}
                        style={{
                            flex: 1,
                            padding: "13px 14px",
                            borderRadius: 14,
                            border: "1px solid var(--border2)",
                            background: "transparent",
                            color: "var(--text2)",
                            fontSize: 14,
                            fontWeight: 700,
                        }}
                    >
                        キャンセル
                    </button>
                    <button
                        onClick={handleSave}
                        style={{
                            flex: 1,
                            padding: "13px 14px",
                            borderRadius: 14,
                            border: "none",
                            background: "var(--text)",
                            color: "var(--bg)",
                            fontSize: 14,
                            fontWeight: 800,
                        }}
                    >
                        追加
                    </button>
                </div>
            </div>
        </div>
    );
}
