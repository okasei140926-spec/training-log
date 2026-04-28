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
                    <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", opacity: 0.8 }}>
                        {styleSet.title}
                    </div>
                    <div style={{ fontSize: renderPhotoUrl ? 26 : 28, fontWeight: 800, lineHeight: 1.15, marginTop: 6 }}>
                        {dateLabel}
                    </div>
                </div>
                <div style={{ ...styleSet.badge, borderRadius: 999, padding: "6px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                    {renderPhotoUrl
                        ? template === "cute" ? "glow highlight" : "performance log"
                        : template === "cute" ? "soft summary" : "stats focus"}
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
