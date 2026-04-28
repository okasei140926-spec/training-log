export default function FullRecordShareCard({
    template,
    styleSet,
    dateLabel,
    fullRecord,
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
                                background: template === "cool" ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.78)",
                                color: styleSet.accent,
                                fontSize: 10,
                                fontWeight: 900,
                                letterSpacing: 0,
                            }}
                        >
                            {styleSet.titleIcon}
                        </span>
                        <span>{styleSet.fullRecordTitle}</span>
                    </div>
                    <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.15, marginTop: 6 }}>
                        {dateLabel}
                    </div>
                </div>
                <div style={{ ...styleSet.badge, borderRadius: 999, padding: "6px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                    {styleSet.fullRecordBadge}
                </div>
            </div>

            {renderPhotoUrl && (
                <div style={{ ...styleSet.photoFrame, marginBottom: 12, padding: template === "cool" ? 8 : 10 }}>
                    <img
                        ref={photoImgRef}
                        src={renderPhotoUrl}
                        alt={`${dateLabel} workout full record`}
                        crossOrigin="anonymous"
                        onLoad={onPhotoLoad}
                        onError={onPhotoError}
                        style={{
                            width: "100%",
                            display: "block",
                            aspectRatio: "16 / 9",
                            objectFit: "cover",
                            borderRadius: template === "cute" ? 18 : 16,
                        }}
                    />
                </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                {fullRecord.length > 0 ? fullRecord.map((exercise) => (
                    <div
                        key={exercise.name}
                        style={{
                            ...styleSet.summaryCard,
                            borderRadius: 16,
                            padding: "10px 12px",
                        }}
                    >
                        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>
                            {exercise.name}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {exercise.sets.map((set) => (
                                <div
                                    key={`${exercise.name}-${set.setNumber}`}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                        flexWrap: "wrap",
                                        padding: "4px 0",
                                        borderBottom: `1px solid ${template === "cool" ? "rgba(255,255,255,0.08)" : "rgba(232,199,210,0.75)"}`,
                                    }}
                                >
                                    <div style={{ fontSize: 12, fontWeight: 700, color: styleSet.label.color }}>
                                        #{set.setNumber}
                                    </div>
                                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                                        {set.weightLabel}
                                    </div>
                                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                                        ×
                                    </div>
                                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                                        {set.repsLabel}
                                    </div>
                                    {set.isPR ? (
                                        <div
                                            style={{
                                                marginLeft: "auto",
                                                padding: "2px 7px",
                                                borderRadius: 999,
                                                fontSize: 10,
                                                fontWeight: 800,
                                                background: template === "cool" ? "#f5f5f5" : styleSet.accent,
                                                color: template === "cool" ? "#111214" : styleSet.accentText,
                                            }}
                                        >
                                            {template === "cool" ? "PR" : "✦ PR"}
                                        </div>
                                    ) : (
                                        <div style={{ marginLeft: "auto" }} />
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )) : (
                    <div style={{ ...styleSet.summaryCard, borderRadius: 22, padding: "18px 16px", fontSize: 13 }}>
                        まだ記録されたセットがありません
                    </div>
                )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
                <div style={{ color: styleSet.brand, fontSize: 11, letterSpacing: 1.4 }}>
                    IRON LOG
                </div>
            </div>
        </>
    );
}
