export default function EditUsernameModal({
    isOpen,
    value,
    error,
    onChange,
    onSave,
    onCancel,
}) {
    if (!isOpen) return null;

    return (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "#00000066", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
            <div style={{ background: "var(--card)", borderRadius: 16, padding: 24, width: "100%" }}>
                <h3 style={{ marginBottom: 16, color: "var(--text)" }}>ユーザー名を変更</h3>
                <input
                    placeholder="新しいユーザー名"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    style={{ display: "block", width: "100%", padding: "12px 16px", borderRadius: 10, border: "1px solid var(--border2)", background: "var(--card2)", color: "var(--text)", fontSize: 15, boxSizing: "border-box", marginBottom: 12 }}
                />
                {error && (
                    <div style={{ fontSize: 12, color: "#f87171", marginBottom: 12 }}>
                        {error}
                    </div>
                )}
                <button
                    onClick={onSave}
                    style={{ width: "100%", padding: 14, borderRadius: 10, background: "#4ade80", border: "none", fontWeight: 700, fontSize: 15, cursor: "pointer", marginBottom: 8 }}
                >
                    保存
                </button>
                <button
                    onClick={onCancel}
                    style={{ width: "100%", padding: 14, borderRadius: 10, background: "none", border: "1px solid var(--border2)", fontSize: 15, cursor: "pointer", color: "var(--text2)" }}
                >
                    キャンセル
                </button>
            </div>
        </div>
    );
}
