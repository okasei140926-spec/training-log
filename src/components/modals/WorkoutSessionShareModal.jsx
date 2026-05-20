import { useEffect, useMemo, useRef, useState } from "react";
import { toBlob } from "html-to-image";
import { formatSetCountByBodyPart } from "../../utils/setCountByBodyPart";

const CARD_PRESETS = {
    square: {
        key: "square",
        label: "1:1",
        width: 360,
        height: 360,
        scale: 0.84,
    },
    story: {
        key: "story",
        label: "9:16",
        width: 360,
        height: 640,
        scale: 0.58,
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
    const [sizeKey, setSizeKey] = useState("story");
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

    const visibleItems = useMemo(() => items.slice(0, sizeKey === "story" ? 7 : 5), [items, sizeKey]);
    const hiddenItemCount = Math.max(0, items.length - visibleItems.length);
    const durationLabel = formatDuration(sessionPayload?.session?.duration_sec);
    const totalSetLabel = `${Number(summary?.setCount || 0)}セット`;
    const totalVolumeLabel = `${Math.round(Number(summary?.totalVolume || 0)).toLocaleString("ja-JP")}kg`;
    const prCount = Number(summary?.prCount || 0);
    const previewScale = preset.scale || 0.58;

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
            if (document.fonts?.ready) {
                await document.fonts.ready;
            }

            const blob = await toBlob(cardRef.current, {
                pixelRatio: 3,
                cacheBust: true,
                backgroundColor: "#05070b",
            });

            if (!blob) {
                throw new Error("session share card blob generation failed");
            }

            const file = new File([blob], `pump-workout-${workoutDate}-${preset.key}.png`, {
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
                        {Object.values(CARD_PRESETS).map((option) => (
                            <button
                                key={option.key}
                                type="button"
                                onClick={() => setSizeKey(option.key)}
                                style={{
                                    padding: "8px 12px",
                                    borderRadius: 999,
                                    border: "1px solid rgba(18, 199, 194, 0.12)",
                                    background: sizeKey === option.key
                                        ? "linear-gradient(135deg, #0F5E63, #12C7C2)"
                                        : "var(--card2)",
                                    color: sizeKey === option.key ? "#fff" : "var(--text2)",
                                    fontSize: 12,
                                    fontWeight: 800,
                                }}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>

                    <div style={{ display: "flex", justifyContent: "center", marginBottom: 14, overflow: "hidden" }}>
                        <div
                            style={{
                                width: preset.width * previewScale,
                                height: preset.height * previewScale,
                                overflow: "hidden",
                                borderRadius: 22,
                                boxShadow: "0 24px 48px rgba(15, 23, 42, 0.18)",
                                flexShrink: 0,
                            }}
                        >
                            <div
                                style={{
                                    width: preset.width,
                                    height: preset.height,
                                    transform: `scale(${previewScale})`,
                                    transformOrigin: "top left",
                                }}
                            >
                                <div
                                    ref={cardRef}
                                    style={{
                                        width: preset.width,
                                        height: preset.height,
                                        borderRadius: 28,
                                        overflow: "hidden",
                                        background:
                                            "radial-gradient(circle at 85% 8%, rgba(251, 146, 60, 0.34), transparent 28%), radial-gradient(circle at 10% 88%, rgba(18,199,194,0.26), transparent 30%), linear-gradient(160deg, #05070b 0%, #111827 48%, #27140b 100%)",
                                        border: "1px solid rgba(255,255,255,0.10)",
                                        boxShadow: "0 30px 60px rgba(15, 23, 42, 0.24)",
                                        display: "flex",
                                        flexDirection: "column",
                                        color: "#fff",
                                        boxSizing: "border-box",
                                        padding: sizeKey === "story" ? "28px 24px 24px" : "20px",
                                    }}
                                >
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: sizeKey === "story" ? 22 : 14 }}>
                                        <div>
                                            <div style={{ fontSize: 11, letterSpacing: 3.2, color: "rgba(255,255,255,0.62)", fontWeight: 900, marginBottom: 8 }}>
                                                PUMP
                                            </div>
                                            <div style={{ fontSize: sizeKey === "story" ? 13 : 11, color: "rgba(255,255,255,0.74)", fontWeight: 700 }}>
                                                {dateLabel}
                                            </div>
                                        </div>
                                        <div style={{ padding: "7px 10px", borderRadius: 999, background: "rgba(18,199,194,0.14)", border: "1px solid rgba(18,199,194,0.28)", color: "#7DE7E2", fontSize: 10, fontWeight: 900 }}>
                                            WORKOUT
                                        </div>
                                    </div>

                                    <div style={{ marginBottom: sizeKey === "story" ? 22 : 14 }}>
                                        <div style={{ fontSize: sizeKey === "story" ? 46 : 32, fontWeight: 950, lineHeight: 0.95, letterSpacing: -0.5 }}>
                                            {totalVolumeLabel}
                                        </div>
                                        <div style={{ marginTop: 10, fontSize: sizeKey === "story" ? 18 : 13, color: "#E6FFFD", fontWeight: 900, lineHeight: 1.35 }}>
                                            {setCountByBodyPartLabel}
                                        </div>
                                    </div>

                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginBottom: sizeKey === "story" ? 18 : 12 }}>
                                        {[
                                            { label: "SETS", value: totalSetLabel },
                                            { label: "PR", value: `${prCount}件` },
                                            { label: "TIME", value: durationLabel || "-" },
                                        ].map((metric) => (
                                            <div key={metric.label} style={{ borderRadius: 16, background: "rgba(17, 24, 39, 0.72)", border: "1px solid rgba(255,255,255,0.10)", padding: "10px 9px" }}>
                                                <div style={{ fontSize: 9, letterSpacing: 1.4, color: "rgba(255,255,255,0.46)", fontWeight: 800 }}>
                                                    {metric.label}
                                                </div>
                                                <div style={{ marginTop: 5, fontSize: sizeKey === "story" ? 16 : 13, color: "#fff", fontWeight: 950, whiteSpace: "nowrap" }}>
                                                    {metric.value}
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    <div style={{ display: "grid", gap: sizeKey === "story" ? 8 : 6, flex: 1, minHeight: 0 }}>
                                        {visibleItems.map((item) => {
                                            const bestSet = item.best_set_json?.weight
                                                ? `${getMaxWeightLabel(item.best_set_json.weight)} × ${Number(item.best_set_json.reps || 0)}`
                                                : Array.isArray(item.sets) && item.sets.length > 0
                                                    ? formatSetLine(item.sets[0])
                                                    : `最大 ${getMaxWeightLabel(item.max_weight)}`;

                                            return (
                                                <div
                                                    key={`${item.body_part || ""}-${item.exercise_name}`}
                                                    style={{
                                                        background: "rgba(17, 24, 39, 0.70)",
                                                        borderRadius: 15,
                                                        padding: sizeKey === "story" ? "10px 12px" : "8px 10px",
                                                        border: "1px solid rgba(255,255,255,0.08)",
                                                        display: "grid",
                                                        gridTemplateColumns: "minmax(0, 1fr) auto",
                                                        alignItems: "center",
                                                        gap: 10,
                                                    }}
                                                >
                                                    <div style={{ minWidth: 0 }}>
                                                        <div style={{ fontSize: sizeKey === "story" ? 14 : 12, fontWeight: 900, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                            {item.exercise_name}
                                                        </div>
                                                        <div style={{ marginTop: 3, fontSize: 10, color: "rgba(255,255,255,0.52)", fontWeight: 800 }}>
                                                            {item.set_count || item.sets?.length || 0} set
                                                        </div>
                                                    </div>
                                                    <div style={{ fontSize: sizeKey === "story" ? 14 : 12, fontWeight: 950, color: "#7DE7E2", whiteSpace: "nowrap" }}>
                                                        {bestSet}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {hiddenItemCount > 0 && (
                                            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.54)", fontWeight: 800, textAlign: "center", paddingTop: 2 }}>
                                                +{hiddenItemCount} exercises
                                            </div>
                                        )}
                                    </div>

                                    <div style={{ marginTop: sizeKey === "story" ? 14 : 8, fontSize: 10, color: "rgba(255,255,255,0.42)", letterSpacing: 2 }}>
                                        SHARE YOUR PUMP
                                    </div>
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
