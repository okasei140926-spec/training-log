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

export default function SummaryShareCard({
    template,
    styleSet,
    dateLabel,
    summaryItems,
    renderPhotoUrl,
    photoImgRef,
    onPhotoLoad,
    onPhotoError,
}) {
    return (
        <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", opacity: 0.8 }}>
                        <span
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: 18,
                                height: 18,
                                borderRadius: 999,
                                background: template === "cool" ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.72)",
                                color: styleSet.accent,
                                fontSize: 10,
                                fontWeight: 900,
                                letterSpacing: 0,
                            }}
                        >
                            {styleSet.titleIcon}
                        </span>
                        <span>{styleSet.title}</span>
                    </div>
                    <div style={{ fontSize: renderPhotoUrl ? 26 : 28, fontWeight: 800, lineHeight: 1.15, marginTop: 6 }}>
                        {dateLabel}
                    </div>
                </div>
                <div style={{ ...styleSet.badge, borderRadius: 999, padding: "6px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                    {renderPhotoUrl
                        ? styleSet.summaryBadgeWithPhoto
                        : styleSet.summaryBadgeWithoutPhoto}
                </div>
            </div>

            {renderPhotoUrl && (
                <div style={{ ...styleSet.photoFrame, marginBottom: 14 }}>
                    <img
                        ref={photoImgRef}
                        src={renderPhotoUrl}
                        alt={`${dateLabel} workout share`}
                        crossOrigin="anonymous"
                        onLoad={onPhotoLoad}
                        onError={onPhotoError}
                        style={{
                            width: "100%",
                            display: "block",
                            aspectRatio: "4 / 5",
                            objectFit: "cover",
                            borderRadius: template === "cute" ? 22 : 18,
                        }}
                    />
                </div>
            )}

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 10,
                    marginBottom: renderPhotoUrl ? 14 : 12,
                }}
            >
                {summaryItems.map((item) => (
                    <SummaryItem key={item.label} value={item.value} label={item.label} styleSet={styleSet} />
                ))}
            </div>

            <div style={{ display: "flex", justifyContent: renderPhotoUrl ? "space-between" : "flex-end", alignItems: "center", gap: 12 }}>
                {renderPhotoUrl ? <div /> : null}
                <div style={{ color: styleSet.brand, fontSize: 11, letterSpacing: 1.4 }}>
                    IRON LOG
                </div>
            </div>
        </>
    );
}
