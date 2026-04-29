import { useMemo } from "react";

function formatDateLabel(date) {
    if (!date) return "";
    const [year, month, day] = String(date).split("-");
    if (!year || !month || !day) return date;
    return `${year}/${month}/${day}`;
}

function diffDaysLabel(photos) {
    const dates = photos
        .map((photo) => photo?.workout_date)
        .filter(Boolean)
        .sort();

    if (dates.length < 2) return "";

    const start = new Date(`${dates[0]}T00:00:00`);
    const end = new Date(`${dates[dates.length - 1]}T00:00:00`);
    const diffMs = end - start;
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    return `${diffDays}日間の変化`;
}

export default function PhotoCompareModal({ photos, onClose }) {
    const safePhotos = useMemo(
        () => (Array.isArray(photos) ? photos.filter(Boolean) : []),
        [photos]
    );

    const orderedPhotos = useMemo(() => {
        return [...safePhotos].sort((a, b) =>
            String(a?.workout_date || "").localeCompare(String(b?.workout_date || ""))
        );
    }, [safePhotos]);

    const beforePhoto = orderedPhotos[0] || null;
    const afterPhoto = orderedPhotos[1] || null;
    const daysText = useMemo(() => diffDaysLabel(orderedPhotos), [orderedPhotos]);

    if (!beforePhoto || !afterPhoto) return null;

    return (
        <div
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.82)",
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
                    maxWidth: 760,
                    maxHeight: "92vh",
                    background: "var(--card)",
                    borderRadius: 20,
                    border: "1px solid var(--border2)",
                    overflow: "hidden",
                    boxShadow: "0 16px 48px rgba(0,0,0,0.35)",
                }}
            >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
                    <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>写真比較</div>
                        {daysText && (
                            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--accent)", marginTop: 4 }}>
                                {daysText}
                            </div>
                        )}
                        <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
                            Before / After を見比べて変化を確認
                        </div>
                    </div>
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

                <div style={{ padding: 16, overflowY: "auto", maxHeight: "calc(92vh - 72px)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
                        {[
                            { label: "Before", photo: beforePhoto, accent: "rgba(56, 189, 248, 0.18)", border: "rgba(56, 189, 248, 0.36)" },
                            { label: "After", photo: afterPhoto, accent: "rgba(34, 197, 94, 0.14)", border: "rgba(34, 197, 94, 0.34)" },
                        ].map(({ label, photo, accent, border }) => (
                            <div
                                key={label}
                                style={{
                                    background: "var(--card2)",
                                    borderRadius: 18,
                                    padding: 12,
                                    border: `1px solid ${border}`,
                                }}
                            >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <div
                                            style={{
                                                padding: "5px 10px",
                                                borderRadius: 999,
                                                background: accent,
                                                color: "var(--text)",
                                                fontSize: 11,
                                                fontWeight: 800,
                                            }}
                                        >
                                            {label}
                                        </div>
                                    </div>
                                    <div style={{ fontSize: 12, color: "var(--text2)", fontWeight: 700 }}>
                                        {formatDateLabel(photo.workout_date)}
                                    </div>
                                </div>

                                <div
                                    style={{
                                        width: "100%",
                                        aspectRatio: "3 / 4",
                                        borderRadius: 14,
                                        overflow: "hidden",
                                        background: "#000",
                                        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.05)",
                                    }}
                                >
                                    <img
                                        src={photo.url}
                                        alt={photo.title || label}
                                        style={{
                                            width: "100%",
                                            height: "100%",
                                            display: "block",
                                            objectFit: "cover",
                                            background: "#000",
                                        }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
