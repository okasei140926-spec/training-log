import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../utils/supabase";
import PhotoCompareModal from "./modals/PhotoCompareModal";
import PhotoCropModal from "./modals/PhotoCropModal";
import PhotoViewerModal from "./modals/PhotoViewerModal";

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

const formatDateLabel = (dateString) => String(dateString || "").replace(/-/g, "/");

const getToggledCompareSelection = (selection, row) => {
    if (!row?.id) return selection;

    if (selection.some((selected) => selected.id === row.id)) {
        return selection.filter((selected) => selected.id !== row.id);
    }

    if (selection.length >= 2) return selection;

    return [...selection, row];
};

export default function PhotoScreen({ user }) {
    const today = new Date();
    const [year, setYear] = useState(today.getFullYear());
    const [month, setMonth] = useState(today.getMonth());
    const [photoRows, setPhotoRows] = useState([]);
    const [selectedDate, setSelectedDate] = useState(null);
    const [selectedPhotoUrls, setSelectedPhotoUrls] = useState({});
    const [selectedPhotoLoading, setSelectedPhotoLoading] = useState(false);
    const [photoUploading, setPhotoUploading] = useState(false);
    const [pendingPhotoFile, setPendingPhotoFile] = useState(null);
    const [photoDeletingId, setPhotoDeletingId] = useState(null);
    const [viewerPhoto, setViewerPhoto] = useState(null);
    const [compareSelection, setCompareSelection] = useState([]);
    const [comparePhotos, setComparePhotos] = useState([]);
    const [isCompareOpen, setIsCompareOpen] = useState(false);
    const [compareLoading, setCompareLoading] = useState(false);
    const [comparePreviewUrls, setComparePreviewUrls] = useState({});
    const photoInputRef = useRef(null);
    const selectedDateRequestIdRef = useRef(0);

    useEffect(() => {
        let isActive = true;

        const loadPhotos = async () => {
            if (!user?.id) {
                if (!isActive) return;
                setPhotoRows([]);
                setSelectedDate(null);
                setSelectedPhotoUrls({});
                setViewerPhoto(null);
                return;
            }

            const { data, error } = await supabase
                .from("progress_photos")
                .select("id, workout_date, storage_path")
                .eq("user_id", user.id)
                .order("workout_date", { ascending: false });

            if (!isActive) return;

            if (error || !data) {
                setPhotoRows([]);
                return;
            }

            setPhotoRows(
                [...data].sort((a, b) => {
                    if (a.workout_date !== b.workout_date) {
                        return String(b.workout_date || "").localeCompare(String(a.workout_date || ""));
                    }
                    return String(a.storage_path || "").localeCompare(String(b.storage_path || ""));
                })
            );
        };

        loadPhotos();

        return () => {
            isActive = false;
        };
    }, [user?.id]);

    const photoMap = useMemo(() => {
        return photoRows.reduce((acc, row) => {
            if (row?.workout_date) {
                if (!acc[row.workout_date]) acc[row.workout_date] = [];
                acc[row.workout_date].push(row);
            }
            return acc;
        }, {});
    }, [photoRows]);

    const photoDates = useMemo(() => new Set(Object.keys(photoMap)), [photoMap]);

    const compareDateRows = useMemo(() => {
        return Object.entries(photoMap)
            .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
            .map(([, rows]) => rows[0])
            .filter(Boolean);
    }, [photoMap]);

    const compareBrowseRows = useMemo(() => {
        return [...compareDateRows].sort((a, b) =>
            String(b?.workout_date || "").localeCompare(String(a?.workout_date || ""))
        );
    }, [compareDateRows]);

    const canCompare = photoRows.length >= 2;

    useEffect(() => {
        let isActive = true;

        const loadComparePreviewUrls = async () => {
            if (!user?.id || !compareBrowseRows.length) {
                if (isActive) setComparePreviewUrls({});
                return;
            }

            const signedEntries = await Promise.all(compareBrowseRows.map(async (row) => {
                const { data, error } = await supabase
                    .storage
                    .from("progress-photos-private")
                    .createSignedUrl(row.storage_path, 3600);

                if (error || !data?.signedUrl) return null;
                return [row.id, data.signedUrl];
            }));

            if (!isActive) return;
            setComparePreviewUrls(Object.fromEntries(signedEntries.filter(Boolean)));
        };

        loadComparePreviewUrls();

        return () => {
            isActive = false;
        };
    }, [user?.id, compareBrowseRows]);

    const openPhotoForDate = async (date) => {
        const dateRows = photoMap[date] || [];
        const requestId = selectedDateRequestIdRef.current + 1;
        selectedDateRequestIdRef.current = requestId;
        setSelectedDate(date);
        setSelectedPhotoUrls({});
        setViewerPhoto(null);

        if (!dateRows.length) {
            if (user?.id && !photoUploading && !photoDeletingId) {
                photoInputRef.current?.click();
            }
            return;
        }

        setSelectedPhotoLoading(true);

        const signedEntries = await Promise.all(dateRows.map(async (row) => {
            const { data, error } = await supabase
                .storage
                .from("progress-photos-private")
                .createSignedUrl(row.storage_path, 3600);
            return error ? null : [row.id, data?.signedUrl || null];
        }));

        if (selectedDateRequestIdRef.current !== requestId) return;

        setSelectedPhotoUrls(Object.fromEntries(signedEntries.filter(Boolean)));
        setSelectedPhotoLoading(false);
    };

    const selectedDateRows = selectedDate ? (photoMap[selectedDate] || []) : [];
    const selectedDateLabel = selectedDate ? formatDateLabel(selectedDate) : "";

    const resetCompareState = () => {
        setCompareSelection([]);
        setComparePhotos([]);
        setIsCompareOpen(false);
        setCompareLoading(false);
    };

    const openCompareWithRows = async (rows) => {
        const filteredRows = (rows || []).filter(Boolean).slice(0, 2);
        if (filteredRows.length !== 2 || compareLoading) return;

        setViewerPhoto(null);
        setCompareSelection(filteredRows);
        setCompareLoading(true);

        try {
            const signedEntries = await Promise.all(filteredRows.map(async (photo, idx) => {
                const { data, error } = await supabase
                    .storage
                    .from("progress-photos-private")
                    .createSignedUrl(photo.storage_path, 3600);

                if (error || !data?.signedUrl) return null;

                return {
                    id: photo.id,
                    workout_date: photo.workout_date,
                    url: data.signedUrl,
                    title: `${photo.workout_date} の体写真 ${idx + 1}`,
                };
            }));

            const readyPhotos = signedEntries.filter(Boolean);
            if (readyPhotos.length === 2) {
                setComparePhotos(readyPhotos);
                setIsCompareOpen(true);
            } else {
                setCompareSelection([]);
            }
        } finally {
            setCompareLoading(false);
        }
    };

    const handleCompareCardSelect = (row) => {
        if (!row?.id || compareLoading) return;
        setCompareSelection((prev) => getToggledCompareSelection(prev, row));
    };

    const handlePhotoChange = (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";

        if (!file || !user?.id || !selectedDate) return;
        setPendingPhotoFile(file);
    };

    const handlePhotoUpload = async ({ blob, extension, mimeType }) => {
        if (!user?.id || !selectedDate) return;

        setPhotoUploading(true);

        try {
            const ext = extension || "jpg";
            const storagePath = `${user.id}/${selectedDate}/progress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

            const { error: uploadError } = await supabase
                .storage
                .from("progress-photos-private")
                .upload(storagePath, blob, {
                    contentType: mimeType || "image/jpeg",
                });

            if (uploadError) throw uploadError;

            const { data: insertedRow, error: insertError } = await supabase
                .from("progress_photos")
                .insert({
                    user_id: user.id,
                    workout_date: selectedDate,
                    storage_path: storagePath,
                })
                .select("id, storage_path, workout_date")
                .single();

            if (insertError) throw insertError;

            const { data: signedData, error: signedError } = await supabase
                .storage
                .from("progress-photos-private")
                .createSignedUrl(storagePath, 3600);

            if (signedError) throw signedError;

            setPhotoRows((prev) =>
                [...prev, insertedRow].sort((a, b) => {
                    if (a.workout_date !== b.workout_date) {
                        return String(b.workout_date || "").localeCompare(String(a.workout_date || ""));
                    }
                    return String(a.storage_path || "").localeCompare(String(b.storage_path || ""));
                })
            );
            setSelectedPhotoUrls((prev) => ({
                ...prev,
                [insertedRow.id]: signedData?.signedUrl || null,
            }));
        } catch (error) {
            console.error("photo upload failed", error);
        } finally {
            setPhotoUploading(false);
            setPendingPhotoFile(null);
        }
    };

    const handlePhotoDelete = async (row) => {
        if (!user?.id || !row?.id || !row?.storage_path || photoDeletingId) return;

        const confirmed = window.confirm("この写真を削除しますか？");
        if (!confirmed) return;

        setPhotoDeletingId(row.id);

        try {
            const { error: storageError } = await supabase
                .storage
                .from("progress-photos-private")
                .remove([row.storage_path]);

            if (storageError) throw storageError;

            const { error: dbError } = await supabase
                .from("progress_photos")
                .delete()
                .eq("user_id", user.id)
                .eq("id", row.id);

            if (dbError) throw dbError;

            setPhotoRows((prev) => prev.filter((photo) => photo.id !== row.id));
            setSelectedPhotoUrls((prev) => {
                const next = { ...prev };
                delete next[row.id];
                return next;
            });
            setComparePreviewUrls((prev) => {
                const next = { ...prev };
                delete next[row.id];
                return next;
            });
            setCompareSelection((prev) => prev.filter((photo) => photo.id !== row.id));
            setComparePhotos((prev) => prev.filter((photo) => photo.id !== row.id));
            setViewerPhoto((prev) => (prev?.id === row.id ? null : prev));
        } catch (error) {
            console.error("photo delete failed", error);
        } finally {
            setPhotoDeletingId(null);
        }
    };

    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr =
        `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    const toStr = (d) =>
        `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

    const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
    const monthPhotoCount = [...photoDates].filter((d) => d.startsWith(monthPrefix)).length;
    const compareSelectionReady = compareSelection.length === 2;

    const prevMonth = () => {
        if (month === 0) {
            setYear((y) => y - 1);
            setMonth(11);
        } else {
            setMonth((m) => m - 1);
        }
    };

    const nextMonth = () => {
        if (month === 11) {
            setYear((y) => y + 1);
            setMonth(0);
        } else {
            setMonth((m) => m + 1);
        }
    };

    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);

    return (
        <div className="fade-in" style={{ padding: "20px", paddingBottom: 120 }}>
            <div style={{ fontSize: 10, letterSpacing: 2.5, color: "var(--text3)", marginBottom: 16 }}>
                BEFORE / AFTER で変化を見比べる
            </div>

            {!user ? (
                <div style={{ background: "var(--card)", borderRadius: 18, padding: "24px 18px", border: "1px solid var(--border2)", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
                    ログインすると比較用の体写真を見返せます
                </div>
            ) : (
                <>
                    {!canCompare ? (
                        <div style={{ background: "linear-gradient(180deg, #F8FCFF, var(--card))", borderRadius: 18, padding: "24px 18px", border: "1px solid rgba(56, 189, 248, 0.16)", marginBottom: 16 }}>
                            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>
                                比較には2枚以上の写真が必要です
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.7 }}>
                                今日の写真を追加して、変化を残しましょう
                            </div>
                        </div>
                    ) : (
                        <div style={{ background: "var(--card)", borderRadius: 18, padding: 16, border: "1px solid var(--border2)", marginBottom: 16 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
                                <div>
                                    <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>写真から選んで比較</div>
                                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                                        代表写真を2枚選んで Before / After を見比べる
                                    </div>
                                </div>
                                {compareSelection.length > 0 && (
                                    <button
                                        onClick={() => setCompareSelection([])}
                                        style={{
                                            padding: "7px 10px",
                                            borderRadius: 10,
                                            background: "var(--card2)",
                                            border: "1px solid var(--border2)",
                                            color: "var(--text2)",
                                            fontSize: 11,
                                            fontWeight: 700,
                                        }}
                                    >
                                        選択クリア
                                    </button>
                                )}
                            </div>

                            <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4, marginBottom: 12 }}>
                                {compareBrowseRows.map((row) => {
                                    const isSelected = compareSelection.some((selected) => selected.id === row.id);
                                    const selectedIndex = compareSelection.findIndex((selected) => selected.id === row.id);

                                    return (
                                        <button
                                            key={row.id}
                                            onClick={() => handleCompareCardSelect(row)}
                                            style={{
                                                minWidth: 132,
                                                background: "var(--card2)",
                                                borderRadius: 16,
                                                border: isSelected ? "2px solid var(--accent)" : "1px solid rgba(217, 228, 239, 0.9)",
                                                padding: 8,
                                                textAlign: "left",
                                                boxShadow: isSelected ? "0 10px 24px rgba(34, 197, 94, 0.12)" : "var(--shadow-card)",
                                            }}
                                        >
                                            <div style={{ width: "100%", aspectRatio: "3 / 4", borderRadius: 12, overflow: "hidden", background: "var(--card)" }}>
                                                {comparePreviewUrls[row.id] ? (
                                                    <img
                                                        src={comparePreviewUrls[row.id]}
                                                        alt={row.workout_date}
                                                        style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }}
                                                    />
                                                ) : (
                                                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text3)", fontSize: 11 }}>
                                                        読み込み中...
                                                    </div>
                                                )}
                                            </div>
                                            <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, color: "var(--text)" }}>
                                                {formatDateLabel(row.workout_date)}
                                            </div>
                                            <div style={{ marginTop: 4, fontSize: 10, color: isSelected ? "var(--accent)" : "var(--text3)", fontWeight: isSelected ? 800 : 600 }}>
                                                {isSelected ? `${selectedIndex + 1}枚目に選択中` : "タップして選択"}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                                <div style={{ fontSize: 11, color: "var(--text3)" }}>
                                    {compareSelection.length === 0
                                        ? "2枚選ぶと比較できます"
                                        : `${compareSelection.length}/2 枚選択中`}
                                </div>
                                <button
                                    onClick={() => openCompareWithRows(compareSelection)}
                                    disabled={!compareSelectionReady || compareLoading}
                                    style={{
                                        padding: "9px 14px",
                                        borderRadius: 12,
                                        background: compareSelectionReady ? "linear-gradient(135deg, var(--accent), #4ADE80)" : "var(--card2)",
                                        border: "1px solid transparent",
                                        color: compareSelectionReady ? "#fff" : "var(--text4)",
                                        fontSize: 12,
                                        fontWeight: 800,
                                        opacity: compareSelectionReady ? 1 : 0.65,
                                        boxShadow: compareSelectionReady ? "0 10px 22px rgba(34, 197, 94, 0.16)" : "none",
                                    }}
                                >
                                    選んだ2枚を比較
                                </button>
                            </div>
                        </div>
                    )}

                    <div style={{ background: "var(--card)", borderRadius: 16, padding: 16, border: "1px solid var(--border)", marginBottom: 16 }}>
                        <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>カレンダーで見る</div>
                            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                                日付から写真を見返したい時はこちら
                            </div>
                        </div>

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                            <button onClick={prevMonth} style={{ background: "none", color: "var(--text2)", fontSize: 24, padding: "4px 10px" }}>‹</button>
                            <div style={{ textAlign: "center" }}>
                                <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>{year}年{month + 1}月</div>
                                <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 2 }}>{monthPhotoCount}日写真あり</div>
                            </div>
                            <button onClick={nextMonth} style={{ background: "none", color: "var(--text2)", fontSize: 24, padding: "4px 10px" }}>›</button>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 6 }}>
                            {WEEK.map((d, i) => (
                                <div
                                    key={d}
                                    style={{
                                        textAlign: "center",
                                        fontSize: 10,
                                        fontWeight: 700,
                                        padding: "4px 0",
                                        color: i === 0 ? "#FF4D4D" : i === 6 ? "#4D9FFF" : "var(--text2)",
                                    }}
                                >
                                    {d}
                                </div>
                            ))}
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
                            {cells.map((d, i) => {
                                if (!d) return <div key={`empty-${i}`} />;

                                const ds = toStr(d);
                                const hasPhoto = photoDates.has(ds);
                                const isToday = ds === todayStr;
                                const isSelected = ds === selectedDate;
                                const dow = (firstDow + d - 1) % 7;

                                return (
                                    <div
                                        key={ds}
                                        onClick={() => openPhotoForDate(ds)}
                                        style={{
                                            padding: "8px 2px",
                                            borderRadius: 10,
                                            cursor: "pointer",
                                            background: isToday ? "#111" : isSelected ? "var(--card2)" : "transparent",
                                            border: isSelected ? "1px solid #ef4444" : "1px solid transparent",
                                            display: "flex",
                                            flexDirection: "column",
                                            alignItems: "center",
                                            gap: 3,
                                        }}
                                    >
                                        <div
                                            style={{
                                                fontSize: 13,
                                                fontWeight: isToday || isSelected ? 800 : 400,
                                                color: isToday ? "#fff" : dow === 0 ? "#FF4D4D" : dow === 6 ? "#4D9FFF" : "var(--text)",
                                            }}
                                        >
                                            {d}
                                        </div>

                                        {hasPhoto ? (
                                            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444" }} />
                                        ) : (
                                            <div style={{ width: 6, height: 6 }} />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                </>
            )}

            {selectedDateRows.length > 0 && (
                <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                                {selectedDateLabel} の写真
                            </div>
                            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                                {selectedDateRows.length}枚
                            </div>
                        </div>
                    </div>

                    {selectedPhotoLoading ? (
                        <div style={{ background: "var(--card2)", borderRadius: 14, padding: "18px 14px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
                            写真を読み込み中...
                        </div>
                    ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                            {selectedDateRows.map((row, idx) => (
                                <div key={row.id} style={{ background: "var(--card2)", borderRadius: 14, padding: 10 }}>
                                    {selectedPhotoUrls[row.id] ? (
                                        <img
                                            src={selectedPhotoUrls[row.id]}
                                            alt={`${selectedDate} progress ${idx + 1}`}
                                            onClick={() => setViewerPhoto({ id: row.id, url: selectedPhotoUrls[row.id], title: `${selectedDate} の体写真 ${idx + 1}` })}
                                            style={{
                                                width: "100%",
                                                display: "block",
                                                borderRadius: 12,
                                                objectFit: "cover",
                                                aspectRatio: "1 / 1",
                                                cursor: "zoom-in",
                                            }}
                                        />
                                    ) : (
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 12, aspectRatio: "1 / 1", color: "var(--text3)", fontSize: 12 }}>
                                            写真を表示できません
                                        </div>
                                    )}
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 8 }}>
                                        <div style={{ fontSize: 11, color: "var(--text3)" }}>{idx + 1}枚目</div>
                                        <button
                                            onClick={() => handlePhotoDelete(row)}
                                            disabled={photoDeletingId === row.id}
                                            style={{
                                                padding: "6px 10px",
                                                borderRadius: 10,
                                                background: "transparent",
                                                border: "1px solid var(--border2)",
                                                color: "var(--text3)",
                                                fontSize: 11,
                                                fontWeight: 700,
                                                opacity: photoDeletingId === row.id ? 0.6 : 1,
                                            }}
                                        >
                                            {photoDeletingId === row.id ? "削除中..." : "削除"}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
                style={{ display: "none" }}
            />

            {viewerPhoto?.url && (
                <PhotoViewerModal
                    imageUrl={viewerPhoto.url}
                    title={viewerPhoto.title}
                    onClose={() => setViewerPhoto(null)}
                />
            )}

            {isCompareOpen && comparePhotos.length === 2 && (
                <PhotoCompareModal
                    photos={comparePhotos}
                    onClose={resetCompareState}
                />
            )}

            {pendingPhotoFile && (
                <PhotoCropModal
                    file={pendingPhotoFile}
                    onCancel={() => setPendingPhotoFile(null)}
                    onConfirm={handlePhotoUpload}
                />
            )}
        </div>
    );
}
