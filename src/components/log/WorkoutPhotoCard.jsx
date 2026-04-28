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
        <div style={{ background: "var(--card)", borderRadius: 20, padding: "14px 16px", marginBottom: 14, border: "1px solid var(--border2)", boxShadow: "var(--shadow-card)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>体写真</div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                        {logDate} の記録に紐づく自分専用写真
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
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button
                            onClick={onOpenSharePreview}
                            disabled={!canOpenSharePreview}
                            style={{
                                padding: "8px 12px",
                                borderRadius: 14,
                                background: "linear-gradient(135deg, var(--accent2), #7DD3FC)",
                                border: "1px solid transparent",
                                color: "#fff",
                                fontSize: 12,
                                fontWeight: 700,
                                opacity: canOpenSharePreview ? 1 : 0.6,
                                boxShadow: "var(--shadow-soft)",
                            }}
                        >
                            投稿プレビュー
                        </button>
                        <button
                            onClick={onPickPhoto}
                            disabled={photoUploading || !!photoDeletingId || photoLimitReached || !!pendingPhotoFile}
                            style={{
                                padding: "8px 12px",
                                borderRadius: 14,
                                background: "var(--card)",
                                border: "1px solid var(--border2)",
                                color: "var(--text)",
                                fontSize: 12,
                                fontWeight: 700,
                                opacity: photoUploading || photoDeletingId || photoLimitReached || pendingPhotoFile ? 0.6 : 1,
                                boxShadow: "var(--shadow-card)",
                            }}
                        >
                            {photoUploading ? "保存中..." : "＋ 体写真を追加"}
                        </button>
                    </div>
                ) : (
                    <div style={{ fontSize: 11, color: "var(--text4)", textAlign: "right" }}>
                        ログインすると保存できます
                    </div>
                )}
            </div>

            <div style={{ fontSize: 11, color: photoLimitReached ? "#ef4444" : "var(--text3)", marginBottom: 10 }}>
                {photoCount}/5枚 {photoLimitReached ? "・最大5枚まで" : ""}
            </div>

            {!latestPhotoUrl && !photoLoading && (
                <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 10 }}>
                    写真がなくてもワークアウト要約をプレビューできます
                </div>
            )}

            {photoLoading ? (
                <div style={{ background: "linear-gradient(180deg, var(--card2), var(--card))", borderRadius: 16, padding: "24px 16px", color: "var(--text3)", fontSize: 13, textAlign: "center", border: "1px solid rgba(186, 230, 253, 0.6)" }}>
                    写真を読み込み中...
                </div>
            ) : photoRows.length > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    {photoRows.map((row, idx) => (
                        <div key={row.id} style={{ background: "linear-gradient(180deg, var(--card2), var(--card))", borderRadius: 16, padding: 10, border: "1px solid rgba(186, 230, 253, 0.6)" }}>
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
                                        padding: "6px 10px",
                                        borderRadius: 12,
                                        background: "var(--card)",
                                        border: "1px solid var(--border2)",
                                        color: "var(--text3)",
                                        fontSize: 11,
                                        fontWeight: 700,
                                        opacity: photoDeletingId === row.id || photoUploading ? 0.6 : 1,
                                        boxShadow: "var(--shadow-card)",
                                    }}
                                >
                                    {photoDeletingId === row.id ? "削除中..." : "削除"}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div style={{ background: "linear-gradient(180deg, var(--card2), var(--card))", borderRadius: 16, padding: "24px 16px", color: "var(--text3)", fontSize: 13, textAlign: "center", border: "1px solid rgba(186, 230, 253, 0.6)" }}>
                    {user ? "まだ写真はありません" : "写真はログイン後に追加できます"}
                </div>
            )}
        </div>
    );
}
