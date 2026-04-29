export default function WorkoutPhotoCard({
    user,
    logDate,
    photoRows,
    photoUrls,
    photoLoading,
    photoUploading,
    photoDeletingId,
    photoLimitReached,
    photoCount,
    latestPhotoUrl,
    canOpenSharePreview,
    accentColor,
    accentText,
    pendingPhotoFile,
    fileInputRef,
    onFileChange,
    onPickPhoto,
    onDeletePhoto,
    onOpenViewer,
    onOpenSharePreview,
}) {
    return (
        <div style={{ background: "var(--card)", borderRadius: 20, padding: "12px 14px", marginBottom: 14, border: "1px solid rgba(217, 228, 239, 0.9)", boxShadow: "0 8px 18px rgba(15, 23, 42, 0.04)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>今日の写真</div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                        変化を残したい時だけ追加
                    </div>
                </div>

                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={onFileChange}
                    disabled={!user || photoUploading || photoLimitReached || !!pendingPhotoFile}
                />

                {user ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <button
                            onClick={onOpenSharePreview}
                            disabled={!canOpenSharePreview}
                            style={{
                                padding: "7px 10px",
                                borderRadius: 12,
                                background: "var(--card2)",
                                border: "1px solid rgba(125, 211, 252, 0.7)",
                                color: "var(--text2)",
                                fontSize: 11,
                                fontWeight: 700,
                                opacity: canOpenSharePreview ? 1 : 0.6,
                                boxShadow: "0 6px 14px rgba(56, 189, 248, 0.08)",
                            }}
                        >
                            投稿用に使う
                        </button>
                        <button
                            onClick={onPickPhoto}
                            disabled={photoUploading || !!photoDeletingId || photoLimitReached || !!pendingPhotoFile}
                            style={{
                                padding: "7px 10px",
                                borderRadius: 12,
                                background: "var(--card)",
                                border: "1px solid rgba(217, 228, 239, 0.95)",
                                color: "var(--text)",
                                fontSize: 11,
                                fontWeight: 700,
                                opacity: photoUploading || photoDeletingId || photoLimitReached || pendingPhotoFile ? 0.6 : 1,
                                boxShadow: "0 6px 14px rgba(15, 23, 42, 0.05)",
                            }}
                        >
                            {photoUploading ? "保存中..." : "写真を追加"}
                        </button>
                    </div>
                ) : (
                    <div style={{ fontSize: 11, color: "var(--text4)", textAlign: "right" }}>
                        ログインすると保存できます
                    </div>
                )}
            </div>

            <div style={{ fontSize: 11, color: photoLimitReached ? "#ef4444" : "var(--text3)", marginBottom: 8 }}>
                {photoCount}/5枚 {photoLimitReached ? "・最大5枚まで" : ""}
            </div>

            {!latestPhotoUrl && !photoLoading && (
                <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>
                    写真がなくてもワークアウト要約をプレビューできます
                </div>
            )}

            {photoLoading ? (
                <div style={{ background: "linear-gradient(180deg, var(--card2), var(--card))", borderRadius: 14, padding: "18px 14px", color: "var(--text3)", fontSize: 12, textAlign: "center", border: "1px solid rgba(217, 228, 239, 0.9)" }}>
                    写真を読み込み中...
                </div>
            ) : photoRows.length > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                    {photoRows.map((row, idx) => (
                        <div key={row.id} style={{ background: "linear-gradient(180deg, var(--card2), var(--card))", borderRadius: 14, padding: 8, border: "1px solid rgba(217, 228, 239, 0.85)" }}>
                            {photoUrls[row.id] ? (
                                <img
                                    src={photoUrls[row.id]}
                                    alt={`${logDate} progress ${idx + 1}`}
                                    onClick={() => onOpenViewer(row, idx)}
                                    style={{ width: "100%", display: "block", borderRadius: 12, objectFit: "cover", aspectRatio: "1 / 1", cursor: "zoom-in" }}
                                />
                            ) : (
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 12, aspectRatio: "1 / 1", color: "var(--text3)", fontSize: 12 }}>
                                    読み込み中...
                                </div>
                            )}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 8 }}>
                                <div style={{ fontSize: 11, color: "var(--text3)" }}>{idx + 1}枚目</div>
                                <button
                                    onClick={() => onDeletePhoto(row)}
                                    disabled={photoDeletingId === row.id || photoUploading}
                                    style={{
                                        padding: "5px 9px",
                                        borderRadius: 10,
                                        background: "var(--card)",
                                        border: "1px solid rgba(217, 228, 239, 0.95)",
                                        color: "var(--text3)",
                                        fontSize: 11,
                                        fontWeight: 700,
                                        opacity: photoDeletingId === row.id || photoUploading ? 0.6 : 1,
                                        boxShadow: "0 4px 10px rgba(15, 23, 42, 0.04)",
                                    }}
                                >
                                    {photoDeletingId === row.id ? "削除中..." : "削除"}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div style={{ background: "linear-gradient(180deg, var(--card2), var(--card))", borderRadius: 14, padding: "18px 14px", color: "var(--text3)", fontSize: 12, textAlign: "center", border: "1px solid rgba(217, 228, 239, 0.9)" }}>
                    {user ? "まだ写真はありません" : "ログイン後に追加できます"}
                </div>
            )}
        </div>
    );
}
