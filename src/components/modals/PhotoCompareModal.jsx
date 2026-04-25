export default function PhotoCompareModal({ photos, onClose }) {
    return (
        <div
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.8)",
                zIndex: 1250,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: "100%",
                    maxWidth: 960,
                    background: "var(--card)",
                    borderRadius: 20,
                    border: "1px solid var(--border2)",
                    overflow: "hidden",
                    boxShadow: "0 16px 48px rgba(0,0,0,0.35)",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>写真比較</div>
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

                <div style={{ display: "grid", gridTemplateColumns: photos.length === 1 ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 12, padding: 16 }}>
                    {photos.map((photo, idx) => (
                        <div key={photo.id || idx} style={{ background: "var(--card2)", borderRadius: 16, padding: 10 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 8 }}>
                                {photo.workout_date || photo.title || `写真 ${idx + 1}`}
                            </div>
                            <img
                                src={photo.url}
                                alt={photo.title || `compare-${idx + 1}`}
                                style={{
                                    width: "100%",
                                    display: "block",
                                    borderRadius: 12,
                                    objectFit: "cover",
                                    aspectRatio: "3 / 4",
                                    background: "#000",
                                }}
                            />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
