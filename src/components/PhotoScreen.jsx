import { useEffect, useMemo, useState } from "react";
import { supabase } from "../utils/supabase";
import PhotoCompareModal from "./modals/PhotoCompareModal";
import PhotoViewerModal from "./modals/PhotoViewerModal";

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

export default function PhotoScreen({ user }) {
    const today = new Date();
    const [year, setYear] = useState(today.getFullYear());
    const [month, setMonth] = useState(today.getMonth());
    const [photoRows, setPhotoRows] = useState([]);
    const [photoLoading, setPhotoLoading] = useState(false);
    const [selectedDate, setSelectedDate] = useState(null);
    const [selectedPhotoUrls, setSelectedPhotoUrls] = useState({});
    const [selectedPhotoLoading, setSelectedPhotoLoading] = useState(false);
    const [photoDeletingId, setPhotoDeletingId] = useState(null);
    const [viewerPhoto, setViewerPhoto] = useState(null);
    const [isCompareMode, setIsCompareMode] = useState(false);
    const [compareSelection, setCompareSelection] = useState([]);
    const [comparePhotos, setComparePhotos] = useState([]);
    const [isCompareOpen, setIsCompareOpen] = useState(false);
    const [compareLoading, setCompareLoading] = useState(false);

    useEffect(() => {
        let isActive = true;

        const loadPhotos = async () => {
            if (!user?.id) {
                if (!isActive) return;
                setPhotoRows([]);
                setSelectedDate(null);
                setSelectedPhotoUrls({});
                setViewerPhoto(null);
                setPhotoLoading(false);
                return;
            }

            setPhotoLoading(true);

            const { data, error } = await supabase
                .from("progress_photos")
                .select("id, workout_date, storage_path")
                .eq("user_id", user.id)
                .order("workout_date", { ascending: false });

            if (!isActive) return;

            if (error || !data) {
                setPhotoRows([]);
                setPhotoLoading(false);
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
            setPhotoLoading(false);
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

    useEffect(() => {
        if (selectedDate && !(photoMap[selectedDate] || []).length) {
            setSelectedDate(null);
            setSelectedPhotoUrls({});
            setViewerPhoto(null);
        }
    }, [selectedDate, photoMap]);

    const openPhotoForDate = async (date) => {
        const dateRows = photoMap[date] || [];
        setSelectedDate(date);
        setSelectedPhotoUrls({});
        setViewerPhoto(null);

        if (!dateRows.length) return;

        setSelectedPhotoLoading(true);

        const signedEntries = await Promise.all(dateRows.map(async (row) => {
            const { data, error } = await supabase
                .storage
                .from("progress-photos-private")
                .createSignedUrl(row.storage_path, 3600);
            return error ? null : [row.id, data?.signedUrl || null];
        }));

        setSelectedPhotoUrls(Object.fromEntries(signedEntries.filter(Boolean)));
        setSelectedPhotoLoading(false);
    };

    const selectedDateRows = selectedDate ? (photoMap[selectedDate] || []) : [];

    const resetCompareState = () => {
        setIsCompareMode(false);
        setCompareSelection([]);
        setComparePhotos([]);
        setIsCompareOpen(false);
        setCompareLoading(false);
    };

    const handleCompareToggle = () => {
        if (isCompareMode) {
            resetCompareState();
            return;
        }

        setViewerPhoto(null);
        setIsCompareMode(true);
        setCompareSelection([]);
        setComparePhotos([]);
        setIsCompareOpen(false);
    };

    const handleCompareSelect = async (row) => {
        if (!row?.id || compareLoading) return;

        let nextSelection;

        if (compareSelection.some((selected) => selected.id === row.id)) {
            nextSelection = compareSelection.filter((selected) => selected.id !== row.id);
            setCompareSelection(nextSelection);
            return;
        }

        if (compareSelection.length >= 2) return;

        nextSelection = [...compareSelection, row];
        setCompareSelection(nextSelection);

        if (nextSelection.length !== 2) return;

        setCompareLoading(true);

        try {
            const signedEntries = await Promise.all(nextSelection.map(async (photo, idx) => {
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
            setCompareSelection((prev) => prev.filter((photo) => photo.id !== row.id));
            setComparePhotos((prev) => prev.filter((photo) => photo.id !== row.id));
            if (selectedDate === row.workout_date && selectedDateRows.length === 1) {
                setSelectedDate(null);
            }
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
                写真がある日をカレンダーから確認
            </div>

            <div style={{ background: "var(--card)", borderRadius: 16, padding: 16, border: "1px solid var(--border)", marginBottom: 16 }}>
                {!user ? (
                    <div style={{ background: "var(--card2)", borderRadius: 14, padding: "24px 16px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
                        ログインすると自分の体写真を見返せます
                    </div>
                ) : (
                    <>
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
                    </>
                )}
            </div>

            <div style={{ background: "var(--card)", borderRadius: 16, padding: 16, border: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
                    <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>写真一覧</div>
                        <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                            {isCompareMode
                                ? `比較したい写真を2枚選択してください${compareSelection.length ? ` (${compareSelection.length}/2)` : ""}`
                                : selectedDate ? `${selectedDate} の写真 ${selectedDateRows.length}枚` : "日付をタップして表示"}
                        </div>
                    </div>
                    <button
                        onClick={handleCompareToggle}
                        disabled={!user || !photoRows.length || compareLoading}
                        style={{
                            padding: "8px 12px",
                            borderRadius: 12,
                            background: isCompareMode ? "var(--text)" : "var(--card2)",
                            border: "1px solid var(--border2)",
                            color: isCompareMode ? "var(--bg)" : (!user || !photoRows.length || compareLoading ? "var(--text4)" : "var(--text)"),
                            fontSize: 12,
                            fontWeight: 700,
                            opacity: !user || !photoRows.length || compareLoading ? 0.6 : 1,
                        }}
                    >
                        {compareLoading ? "準備中..." : isCompareMode ? "比較をやめる" : "比較"}
                    </button>
                </div>

                {!user ? (
                    <div style={{ background: "var(--card2)", borderRadius: 14, padding: "24px 16px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
                        写真を見るにはログインが必要です
                    </div>
                ) : photoLoading ? (
                    <div style={{ background: "var(--card2)", borderRadius: 14, padding: "24px 16px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
                        写真一覧を読み込み中...
                    </div>
                ) : selectedPhotoLoading ? (
                    <div style={{ background: "var(--card2)", borderRadius: 14, padding: "24px 16px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
                        写真を読み込み中...
                    </div>
                ) : selectedDateRows.length > 0 ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                        {selectedDateRows.map((row, idx) => (
                            <div key={row.id} style={{ background: "var(--card2)", borderRadius: 14, padding: 10 }}>
                                {selectedPhotoUrls[row.id] ? (
                                    <div style={{ position: "relative" }}>
                                        <img
                                            src={selectedPhotoUrls[row.id]}
                                            alt={`${selectedDate} progress ${idx + 1}`}
                                            onClick={() => {
                                                if (isCompareMode) {
                                                    handleCompareSelect(row);
                                                    return;
                                                }
                                                setViewerPhoto({ id: row.id, url: selectedPhotoUrls[row.id], title: `${selectedDate} の体写真 ${idx + 1}` });
                                            }}
                                            style={{
                                                width: "100%",
                                                display: "block",
                                                borderRadius: 12,
                                                objectFit: "cover",
                                                aspectRatio: "1 / 1",
                                                cursor: isCompareMode ? "pointer" : "zoom-in",
                                                border: compareSelection.some((selected) => selected.id === row.id) ? "2px solid #ef4444" : "2px solid transparent",
                                                boxSizing: "border-box",
                                            }}
                                        />
                                        {compareSelection.some((selected) => selected.id === row.id) && (
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    top: 8,
                                                    right: 8,
                                                    minWidth: 24,
                                                    height: 24,
                                                    borderRadius: 999,
                                                    background: "#ef4444",
                                                    color: "#fff",
                                                    fontSize: 12,
                                                    fontWeight: 800,
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
                                                }}
                                            >
                                                {compareSelection.findIndex((selected) => selected.id === row.id) + 1}
                                            </div>
                                        )}
                                    </div>
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
                ) : (
                    <div style={{ background: "var(--card2)", borderRadius: 14, padding: "24px 16px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
                        {photoRows.length > 0
                            ? selectedDate ? "この日に保存されている写真はありません" : "写真がある日付を選ぶとここに表示されます"
                            : "まだ保存されている写真はありません"}
                    </div>
                )}
            </div>

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
        </div>
    );
}
