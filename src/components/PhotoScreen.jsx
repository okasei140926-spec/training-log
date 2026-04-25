import { useEffect, useMemo, useState } from "react";
import { supabase } from "../utils/supabase";

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

export default function PhotoScreen({ user }) {
    const today = new Date();
    const [year, setYear] = useState(today.getFullYear());
    const [month, setMonth] = useState(today.getMonth());
    const [photoRows, setPhotoRows] = useState([]);
    const [photoLoading, setPhotoLoading] = useState(false);
    const [selectedDate, setSelectedDate] = useState(null);
    const [selectedPhotoUrl, setSelectedPhotoUrl] = useState(null);
    const [selectedPhotoLoading, setSelectedPhotoLoading] = useState(false);

    useEffect(() => {
        let isActive = true;

        const loadPhotos = async () => {
            if (!user?.id) {
                if (!isActive) return;
                setPhotoRows([]);
                setSelectedDate(null);
                setSelectedPhotoUrl(null);
                setPhotoLoading(false);
                return;
            }

            setPhotoLoading(true);

            const { data, error } = await supabase
                .from("progress_photos")
                .select("workout_date, storage_path")
                .eq("user_id", user.id)
                .order("workout_date", { ascending: false });

            if (!isActive) return;

            if (error || !data) {
                setPhotoRows([]);
                setPhotoLoading(false);
                return;
            }

            setPhotoRows(data);
            setPhotoLoading(false);
        };

        loadPhotos();

        return () => {
            isActive = false;
        };
    }, [user?.id]);

    const photoMap = useMemo(() => {
        return photoRows.reduce((acc, row) => {
            if (row?.workout_date && row?.storage_path) {
                acc[row.workout_date] = row.storage_path;
            }
            return acc;
        }, {});
    }, [photoRows]);

    const photoDates = useMemo(() => new Set(Object.keys(photoMap)), [photoMap]);

    useEffect(() => {
        if (selectedDate && !photoMap[selectedDate]) {
            setSelectedDate(null);
            setSelectedPhotoUrl(null);
        }
    }, [selectedDate, photoMap]);

    const openPhotoForDate = async (date) => {
        const storagePath = photoMap[date];
        setSelectedDate(date);
        setSelectedPhotoUrl(null);

        if (!storagePath) return;

        setSelectedPhotoLoading(true);

        const { data, error } = await supabase
            .storage
            .from("progress-photos-private")
            .createSignedUrl(storagePath, 3600);

        if (!error) {
            setSelectedPhotoUrl(data?.signedUrl || null);
        }

        setSelectedPhotoLoading(false);
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
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>写真プレビュー</div>
                        <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                            {selectedDate ? `${selectedDate} の写真` : "日付をタップして表示"}
                        </div>
                    </div>
                    <button
                        disabled
                        style={{
                            padding: "8px 12px",
                            borderRadius: 12,
                            background: "var(--card2)",
                            border: "1px solid var(--border2)",
                            color: "var(--text4)",
                            fontSize: 12,
                            fontWeight: 700,
                            opacity: 0.6,
                        }}
                    >
                        比較（準備中）
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
                ) : selectedPhotoUrl ? (
                    <div style={{ background: "var(--card2)", borderRadius: 14, padding: 10 }}>
                        <img
                            src={selectedPhotoUrl}
                            alt={`${selectedDate} progress`}
                            style={{ width: "100%", display: "block", borderRadius: 12, objectFit: "cover", maxHeight: 520 }}
                        />
                    </div>
                ) : (
                    <div style={{ background: "var(--card2)", borderRadius: 14, padding: "24px 16px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
                        {photoRows.length > 0
                            ? "写真がある日付を選ぶとここに表示されます"
                            : "まだ保存されている写真はありません"}
                    </div>
                )}
            </div>
        </div>
    );
}
