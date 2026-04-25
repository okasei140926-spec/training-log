export default function PhotoViewerModal({ imageUrl, title, onClose }) {
    return (
        <div
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.78)",
                zIndex: 1200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 20,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: "100%",
                    maxWidth: 720,
                    maxHeight: "90vh",
                    background: "var(--card)",
                    borderRadius: 18,
                    border: "1px solid var(--border2)",
                    overflow: "hidden",
                    boxShadow: "0 16px 48px rgba(0,0,0,0.35)",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{title}</div>
                    <button
                        onClick={onClose}
                        style={{
                            background: "none",
                            border: "none",
                            color: "var(--text3)",
                            fontSize: 22,
                            lineHeight: 1,
                            padding: "2px 6px",
                        }}
                    >
                        ×
                    </button>
                </div>

                <div style={{ background: "#000", display: "flex", alignItems: "center", justifyContent: "center", padding: 10 }}>
                    <img
                        src={imageUrl}
                        alt={title}
                        style={{
                            width: "100%",
                            maxHeight: "calc(90vh - 80px)",
                            objectFit: "contain",
                            display: "block",
                            borderRadius: 12,
                        }}
                    />
                </div>
            </div>
        </div>
    );
}
