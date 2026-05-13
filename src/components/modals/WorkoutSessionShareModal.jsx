import { useEffect, useMemo, useRef, useState } from "react";
import { toBlob } from "html-to-image";
import { formatSetCountByBodyPart } from "../../utils/setCountByBodyPart";

const CARD_PRESETS = {
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
    if (!Number.isFinite(sec) || sec <= 0) return "";
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

const formatSetLine = (set) => {
    if (!set) return "";
    const reps = Math.max(0, Number(set.reps || 0));
    const weight = String(set.weight || "").toUpperCase();
    if (weight === "BW") return `自重 × ${reps}`;
    const weightNum = Math.round(Number(set.weight || 0) * 10) / 10;
    return `${weightNum}kg × ${reps}`;
};

export default function WorkoutSessionShareModal({
    isOpen,
    onClose,
    workoutDate,
    sessionPayload,
    photoRows = [],
}) {
    const [sizeKey] = useState("story");
    const [sharing, setSharing] = useState(false);
    const cardRef = useRef(null);
    const scrollLockRef = useRef({ top: 0, body: {}, html: {} });

    const preset = CARD_PRESETS[sizeKey] || CARD_PRESETS.story;
    const dateLabel = formatDate(workoutDate);
    const summary = useMemo(
        () => sessionPayload?.session?.summary_json || {},
        [sessionPayload]
    );
    const items = useMemo(
        () => sessionPayload?.preview_items || sessionPayload?.exercises || [],
        [sessionPayload]
    );
    const setCountByBodyPartLabel = useMemo(() => {
        if (Array.isArray(summary?.setCountByBodyPart) && summary.setCountByBodyPart.length > 0) {
            return formatSetCountByBodyPart(summary.setCountByBodyPart, {
                maxParts: 3,
                suffix: "",
                separator: " / ",
            });
        }
        if (items.length > 0) {
            return formatSetCountByBodyPart(items, {
                maxParts: 3,
                suffix: "",
                separator: " / ",
            });
        }
        return "まだありません";
    }, [items, summary]);

    const visibleItems = useMemo(() => items, [items]);
    const durationLabel = formatDuration(sessionPayload?.session?.duration_sec);
    const totalSetLabel = `${Number(summary?.setCount || 0)}セット`;
    const totalVolumeLabel = `${Math.round(Number(summary?.totalVolume || 0)).toLocaleString("ja-JP")}kg`;

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
                    {photoRows.length > 0 && (
                        <div style={{ marginBottom: 12, fontSize: 11, color: "var(--text3)" }}>
                            写真はこのカードでは表示せず、ワークアウト内容を優先しています
                        </div>
                    )}

                    <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
                        <div
                            ref={cardRef}
                            style={{
                                width: preset.width,
                                minHeight: preset.height,
                                borderRadius: 28,
                                overflow: "hidden",
                                background:
                                    "radial-gradient(circle at top right, rgba(51,225,219,0.18), transparent 28%), radial-gradient(circle at bottom left, rgba(15,94,99,0.18), transparent 26%), linear-gradient(165deg, #05070b 0%, #0b1220 42%, #111827 100%)",
                                border: "1px solid rgba(255,255,255,0.08)",
                                boxShadow: "0 30px 60px rgba(15, 23, 42, 0.24)",
                                display: "flex",
                                flexDirection: "column",
                                flexShrink: 0,
                            }}
                        >
                            <div
                                style={{
                                    width: "100%",
                                    height: 68,
                                    background: "transparent",
                                    display: "flex",
                                    alignItems: "center",
                                    padding: "0 24px",
                                    boxSizing: "border-box",
                                }}
                            >
                                <div style={{ fontSize: 13, letterSpacing: 3.2, color: "rgba(255,255,255,0.68)", fontWeight: 800 }}>
                                    PUMP
                                </div>
                            </div>

                        <div style={{ padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 14, flex: 1 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                                <div>
                                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", marginBottom: 6 }}>{dateLabel}</div>
                                    <div style={{ fontSize: 28, fontWeight: 900, color: "#fff", lineHeight: 1.12 }}>
                                        今日のワークアウト
                                    </div>
                                </div>
                            </div>

                            <div
                                style={{
                                    background: "rgba(17, 24, 39, 0.72)",
                                    borderRadius: 20,
                                    border: "1px solid rgba(56,189,248,0.14)",
                                    padding: "14px 15px",
                                    display: "grid",
                                    gap: 8,
                                }}
                            >
                                <div style={{ fontSize: 16, fontWeight: 800, color: "#E6FFFD", lineHeight: 1.4 }}>
                                    {setCountByBodyPartLabel}
                                </div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                    <div style={{ padding: "6px 10px", borderRadius: 999, background: "rgba(18,199,194,0.12)", border: "1px solid rgba(18,199,194,0.22)", color: "#7DE7E2", fontSize: 12, fontWeight: 800 }}>
                                        {totalSetLabel}
                                    </div>
                                    <div style={{ padding: "6px 10px", borderRadius: 999, background: "rgba(56,189,248,0.10)", border: "1px solid rgba(56,189,248,0.18)", color: "#C9F7FF", fontSize: 12, fontWeight: 800 }}>
                                        {totalVolumeLabel}
                                    </div>
                                    {durationLabel ? (
                                        <div style={{ padding: "6px 10px", borderRadius: 999, background: "rgba(249,115,22,0.10)", border: "1px solid rgba(249,115,22,0.18)", color: "#FDBA74", fontSize: 12, fontWeight: 800 }}>
                                            {durationLabel}
                                        </div>
                                    ) : null}
                                </div>
                            </div>

                            <div style={{ display: "grid", gap: 10, flex: 1 }}>
                                {visibleItems.map((item) => (
                                    <div
                                        key={`${item.body_part || ""}-${item.exercise_name}`}
                                        style={{
                                            background: "rgba(17, 24, 39, 0.72)",
                                            borderRadius: 18,
                                            padding: "12px 14px",
                                            border: "1px solid rgba(56,189,248,0.12)",
                                        }}
                                    >
                                        <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", marginBottom: 8 }}>
                                            {item.exercise_name}
                                        </div>
                                        <div style={{ display: "grid", gap: 4 }}>
                                            {Array.isArray(item.sets) && item.sets.length > 0 ? (
                                                item.sets.map((set, index) => (
                                                    <div key={`${item.exercise_name}-${index}`} style={{ fontSize: 13, color: "rgba(255,255,255,0.84)", lineHeight: 1.45 }}>
                                                        {formatSetLine(set)}
                                                    </div>
                                                ))
                                            ) : (
                                                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.72)", lineHeight: 1.5 }}>
                                                    最大 {getMaxWeightLabel(item.max_weight)}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
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
