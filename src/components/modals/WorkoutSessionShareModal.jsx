import { useEffect, useMemo, useRef, useState } from "react";
import { toBlob } from "html-to-image";

const CARD_PRESETS = {
    square: {
        key: "square",
        label: "1:1",
        width: 360,
        height: 360,
    },
    story: {
        key: "story",
        label: "9:16",
        width: 360,
        height: 640,
    },
};

const formatDate = (date) => {
    const value = String(date || "");
    if (!value) return "";
    const [year, month, day] = value.split("-");
    return `${year}/${month}/${day}`;
};

const formatDuration = (durationSec) => {
    const sec = Number(durationSec || 0);
    if (!Number.isFinite(sec) || sec <= 0) return "0分";
    const hours = Math.floor(sec / 3600);
    const minutes = Math.max(1, Math.round((sec % 3600) / 60));
    if (hours <= 0) return `${minutes}分`;
    return `${hours}時間${minutes}分`;
};

const getMaxWeightLabel = (weight) => {
    const value = Number(weight || 0);
    if (!Number.isFinite(value) || value <= 0) return "-";
    return `${Math.round(value * 10) / 10}kg`;
};

export default function WorkoutSessionShareModal({
    isOpen,
    onClose,
    workoutDate,
    sessionPayload,
    photoRows = [],
    photoUrls = {},
}) {
    const [sizeKey, setSizeKey] = useState("square");
    const [selectedPhotoId, setSelectedPhotoId] = useState(() => photoRows[0]?.id ?? null);
    const [sharing, setSharing] = useState(false);
    const cardRef = useRef(null);
    const scrollLockRef = useRef({ top: 0, body: {}, html: {} });

    const preset = CARD_PRESETS[sizeKey] || CARD_PRESETS.square;
    const dateLabel = formatDate(workoutDate);
    const selectedPhotoUrl = selectedPhotoId ? photoUrls[selectedPhotoId] || null : null;
    const items = useMemo(() => sessionPayload?.exercises || [], [sessionPayload]);
    const summary = sessionPayload?.session?.summary_json || {};

    const visibleItems = useMemo(() => {
        if (sizeKey === "story") return items.slice(0, 7);
        return items.slice(0, 5);
    }, [items, sizeKey]);

    useEffect(() => {
        if (!isOpen) return;
        setSelectedPhotoId(photoRows[0]?.id ?? null);
    }, [isOpen, photoRows]);

    useEffect(() => {
        if (!isOpen) return undefined;

        const body = document.body;
        const html = document.documentElement;
        const scrollTop = window.scrollY || window.pageYOffset || 0;
        const scrollLock = scrollLockRef.current;

        scrollLock.top = scrollTop;
        scrollLock.body = {
            overflow: body.style.overflow,
            position: body.style.position,
            top: body.style.top,
            width: body.style.width,
            touchAction: body.style.touchAction,
        };
        scrollLock.html = {
            overflow: html.style.overflow,
            overscrollBehavior: html.style.overscrollBehavior,
        };

        body.style.overflow = "hidden";
        body.style.position = "fixed";
        body.style.top = `-${scrollTop}px`;
        body.style.width = "100%";
        body.style.touchAction = "none";
        html.style.overflow = "hidden";
        html.style.overscrollBehavior = "none";

        return () => {
            body.style.overflow = scrollLock.body.overflow || "";
            body.style.position = scrollLock.body.position || "";
            body.style.top = scrollLock.body.top || "";
            body.style.width = scrollLock.body.width || "";
            body.style.touchAction = scrollLock.body.touchAction || "";
            html.style.overflow = scrollLock.html.overflow || "";
            html.style.overscrollBehavior = scrollLock.html.overscrollBehavior || "";
            window.scrollTo(0, scrollLock.top || 0);
        };
    }, [isOpen]);

    if (!isOpen || !sessionPayload) return null;

    const handleShare = async () => {
        if (!cardRef.current || sharing) return;

        setSharing(true);

        try {
            const blob = await toBlob(cardRef.current, {
                pixelRatio: 3,
                cacheBust: true,
            });

            if (!blob) {
                throw new Error("session share card blob generation failed");
            }

            const file = new File([blob], `iron-log-${workoutDate}-${preset.key}.png`, {
                type: "image/png",
            });

            const shareData = {
                title: "PUMP",
                text: `${dateLabel} のワークアウト`,
                files: [file],
            };

            if (navigator.canShare && navigator.canShare(shareData) && navigator.share) {
                await navigator.share(shareData);
                return;
            }

            const objectUrl = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = objectUrl;
            anchor.download = file.name;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            URL.revokeObjectURL(objectUrl);
        } catch (error) {
            console.error("session share failed", error);
            alert("シェアカードの作成に失敗しました。");
        } finally {
            setSharing(false);
        }
    };

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(15, 23, 42, 0.72)",
                zIndex: 320,
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                padding:
                    "calc(16px + var(--safe-top, 0px)) 12px calc(12px + var(--safe-bottom, 0px))",
            }}
            onClick={onClose}
        >
            <div
                style={{
                    width: "100%",
                    maxWidth: 420,
                    background: "var(--card-modal)",
                    borderRadius: 24,
                    border: "1px solid var(--border2)",
                    boxShadow: "0 22px 44px rgba(15, 23, 42, 0.18)",
                    boxSizing: "border-box",
                    maxHeight:
                        "calc(100dvh - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 24px)",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                }}
                onClick={(event) => event.stopPropagation()}
            >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 18px 12px" }}>
                    <div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>シェアカードを作成</div>
                        <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
                            ワークアウト要約を画像で共有できます
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{ background: "none", border: "none", color: "var(--text3)", fontSize: 20 }}
                    >
                        ×
                    </button>
                </div>

                <div
                    style={{
                        flex: 1,
                        minHeight: 0,
                        overflowY: "auto",
                        WebkitOverflowScrolling: "touch",
                        overscrollBehavior: "contain",
                        padding: "0 18px calc(18px + var(--safe-bottom, 0px))",
                    }}
                >
                    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                        {Object.values(CARD_PRESETS).map((item) => (
                            <button
                                key={item.key}
                                type="button"
                                onClick={() => setSizeKey(item.key)}
                                style={{
                                    padding: "8px 12px",
                                    borderRadius: 999,
                                    border: "1px solid var(--border2)",
                                    background: sizeKey === item.key ? "var(--text)" : "var(--card2)",
                                    color: sizeKey === item.key ? "var(--bg)" : "var(--text2)",
                                    fontSize: 12,
                                    fontWeight: 700,
                                }}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>

                    {photoRows.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>
                                写真を選択
                            </div>
                            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
                                <button
                                    type="button"
                                    onClick={() => setSelectedPhotoId(null)}
                                    style={{
                                        minWidth: 76,
                                        padding: "8px 10px",
                                        borderRadius: 12,
                                        border: "1px solid var(--border2)",
                                        background: selectedPhotoId === null ? "var(--text)" : "var(--card2)",
                                        color: selectedPhotoId === null ? "var(--bg)" : "var(--text2)",
                                        fontSize: 11,
                                        fontWeight: 700,
                                    }}
                                >
                                    写真なし
                                </button>
                                {photoRows.map((row, index) => (
                                    <button
                                        key={row.id}
                                        type="button"
                                        onClick={() => setSelectedPhotoId(row.id)}
                                        style={{
                                            minWidth: 76,
                                            padding: "6px",
                                            borderRadius: 12,
                                            border: selectedPhotoId === row.id ? "2px solid var(--accent)" : "1px solid var(--border2)",
                                            background: "var(--card2)",
                                            color: "var(--text2)",
                                            fontSize: 11,
                                            fontWeight: 700,
                                        }}
                                    >
                                        {photoUrls[row.id] ? (
                                            <img
                                                src={photoUrls[row.id]}
                                                alt={`${workoutDate} session ${index + 1}`}
                                                style={{ width: "100%", height: 56, borderRadius: 8, objectFit: "cover", display: "block", marginBottom: 4 }}
                                            />
                                        ) : (
                                            <div style={{ width: "100%", height: 56, borderRadius: 8, background: "var(--card)", marginBottom: 4 }} />
                                        )}
                                        {index + 1}枚目
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
                        <div
                            ref={cardRef}
                            style={{
                                width: preset.width,
                                height: preset.height,
                                borderRadius: 28,
                                overflow: "hidden",
                                background: selectedPhotoUrl
                                    ? "linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)"
                                    : "linear-gradient(160deg, #eff6ff 0%, #dcfce7 52%, #ffffff 100%)",
                                border: "1px solid rgba(255,255,255,0.85)",
                                boxShadow: "0 30px 60px rgba(15, 23, 42, 0.14)",
                                display: "flex",
                                flexDirection: "column",
                                flexShrink: 0,
                            }}
                        >
                        {selectedPhotoUrl ? (
                            <img
                                src={selectedPhotoUrl}
                                alt={`${dateLabel} workout`}
                                style={{
                                    width: "100%",
                                    height: sizeKey === "story" ? 250 : 152,
                                    objectFit: "cover",
                                    display: "block",
                                }}
                            />
                        ) : (
                            <div
                                style={{
                                    width: "100%",
                                    height: sizeKey === "story" ? 184 : 132,
                                    background: "linear-gradient(135deg, #22c55e, #38bdf8)",
                                    display: "flex",
                                    alignItems: "flex-end",
                                    padding: "20px 24px",
                                    boxSizing: "border-box",
                                    color: "#fff",
                                    fontWeight: 900,
                                    fontSize: sizeKey === "story" ? 38 : 30,
                                    letterSpacing: 1,
                                }}
                            >
                                PUMP
                            </div>
                        )}

                        <div style={{ padding: sizeKey === "story" ? "22px 24px 24px" : "18px 20px 20px", display: "flex", flexDirection: "column", gap: 14, flex: 1 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                                <div>
                                    <div style={{ fontSize: 11, letterSpacing: 2.4, color: "#64748b", marginBottom: 6 }}>PUMP</div>
                                    <div style={{ fontSize: sizeKey === "story" ? 26 : 22, fontWeight: 900, color: "#0f172a" }}>
                                        {dateLabel}
                                    </div>
                                </div>
                                <div style={{ display: "grid", gap: 6 }}>
                                    <div style={{ padding: "6px 10px", borderRadius: 999, background: "#dcfce7", color: "#15803d", fontSize: 11, fontWeight: 800 }}>
                                        トレ時間 {formatDuration(sessionPayload.session.duration_sec)}
                                    </div>
                                    <div style={{ padding: "6px 10px", borderRadius: 999, background: "#e0f2fe", color: "#0369a1", fontSize: 11, fontWeight: 800 }}>
                                        総ボリューム {Math.round(Number(summary.totalVolume || 0)).toLocaleString("ja-JP")}kg
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: "grid", gap: 10, flex: 1 }}>
                                {visibleItems.map((item) => (
                                    <div
                                        key={`${item.body_part || ""}-${item.exercise_name}`}
                                        style={{
                                            background: "rgba(248, 250, 252, 0.92)",
                                            borderRadius: 18,
                                            padding: "12px 14px",
                                            border: "1px solid rgba(186, 230, 253, 0.8)",
                                        }}
                                    >
                                        <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", marginBottom: 4 }}>
                                            {item.exercise_name}
                                            {item.body_part ? ` · ${item.body_part}` : ""}
                                        </div>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 11, color: "#475569" }}>
                                            <span>{item.set_count}セット</span>
                                            <span>最大 {getMaxWeightLabel(item.max_weight)}</span>
                                            <span>Volume {Math.round(Number(item.volume || 0)).toLocaleString("ja-JP")}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {items.length > visibleItems.length && (
                                <div style={{ fontSize: 11, color: "#64748b" }}>
                                    他 {items.length - visibleItems.length} 種目
                                </div>
                            )}
                        </div>
                        </div>
                    </div>

                    <div style={{ display: "flex", gap: 10 }}>
                        <button
                            type="button"
                            onClick={onClose}
                            style={{
                                flex: 1,
                                padding: "14px",
                                borderRadius: 14,
                                background: "var(--card2)",
                                border: "1px solid var(--border2)",
                                color: "var(--text2)",
                                fontSize: 14,
                                fontWeight: 700,
                            }}
                        >
                            閉じる
                        </button>
                        <button
                            type="button"
                            onClick={handleShare}
                            disabled={sharing}
                            style={{
                                flex: 2,
                                padding: "14px",
                                borderRadius: 14,
                                background: "linear-gradient(135deg, var(--accent), var(--accent2))",
                                border: "none",
                                color: "#fff",
                                fontSize: 15,
                                fontWeight: 800,
                                opacity: sharing ? 0.7 : 1,
                            }}
                        >
                            {sharing ? "作成中..." : "共有する"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
