import { useMemo, useRef, useState } from "react";

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
    const [activeIndex, setActiveIndex] = useState(0);
    const touchStartX = useRef(null);
    const safePhotos = useMemo(
        () => (Array.isArray(photos) ? photos.filter(Boolean) : []),
        [photos]
    );
    const activePhoto = safePhotos[activeIndex] || safePhotos[0];

    const periodText = useMemo(() => {
        if (safePhotos.length < 2) return "";

        const dates = safePhotos
            .map((photo) => photo?.workout_date)
            .filter(Boolean)
            .sort();

        if (dates.length < 2) return "";
        return `${dates[0]} → ${dates[dates.length - 1]}`;
    }, [safePhotos]);

    const daysText = useMemo(() => diffDaysLabel(safePhotos), [safePhotos]);

    const goPrev = () => {
        setActiveIndex((prev) => Math.max(0, prev - 1));
    };

    const goNext = () => {
        setActiveIndex((prev) => Math.min(safePhotos.length - 1, prev + 1));
    };

    const handleTouchStart = (e) => {
        touchStartX.current = e.touches[0].clientX;
    };

    const handleTouchEnd = (e) => {
        if (touchStartX.current == null) return;

        const endX = e.changedTouches[0].clientX;
        const dx = endX - touchStartX.current;

        if (dx <= -50) goNext();
        if (dx >= 50) goPrev();

        touchStartX.current = null;
    };

    if (!activePhoto) return null;

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
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                style={{
                    width: "100%",
                    maxWidth: 720,
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
                        {periodText && (
                            <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4 }}>
                                {periodText}
                            </div>
                        )}
                        {daysText && (
                            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
                                {daysText}
                            </div>
                        )}
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

                <div style={{ padding: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 10 }}>
                        <button
                            onClick={goPrev}
                            disabled={activeIndex === 0}
                            style={{
                                padding: "8px 12px",
                                borderRadius: 12,
                                border: "1px solid var(--border2)",
                                background: "var(--card2)",
                                color: "var(--text)",
                                fontSize: 12,
                                fontWeight: 700,
                                opacity: activeIndex === 0 ? 0.45 : 1,
                            }}
                        >
                            前へ
                        </button>

                        <div style={{ textAlign: "center" }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>
                                {activeIndex + 1}/{safePhotos.length}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>
                                {activePhoto.workout_date || activePhoto.title}
                            </div>
                        </div>

                        <button
                            onClick={goNext}
                            disabled={activeIndex === safePhotos.length - 1}
                            style={{
                                padding: "8px 12px",
                                borderRadius: 12,
                                border: "1px solid var(--border2)",
                                background: "var(--card2)",
                                color: "var(--text)",
                                fontSize: 12,
                                fontWeight: 700,
                                opacity: activeIndex === safePhotos.length - 1 ? 0.45 : 1,
                            }}
                        >
                            次へ
                        </button>
                    </div>

                    <div
                        style={{
                            background: "var(--card2)",
                            borderRadius: 16,
                            padding: 10,
                        }}
                    >
                        <img
                            src={activePhoto.url}
                            alt={activePhoto.title || `compare-${activeIndex + 1}`}
                            style={{
                                width: "100%",
                                display: "block",
                                borderRadius: 12,
                                objectFit: "contain",
                                maxHeight: "calc(92vh - 210px)",
                                background: "#000",
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
