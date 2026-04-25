import React, { useEffect, useMemo, useRef, useState } from "react";
import { toBlob } from "html-to-image";

const TEMPLATE_OPTIONS = [
    { id: "cute", label: "Cute" },
    { id: "cool", label: "Cool" },
];

function formatDate(dateStr) {
    if (!dateStr) return "";
    const [year, month, day] = dateStr.split("-");
    return `${year}/${month}/${day}`;
}

function buildTemplateStyles(template) {
    if (template === "cool") {
        return {
            shell: {
                background: "linear-gradient(180deg, #0f0f10 0%, #1a1a1d 100%)",
                color: "#f5f5f5",
                border: "1px solid #3b3b40",
                boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
            },
            photoFrame: {
                background: "#111214",
                border: "1px solid #2e2f35",
                borderRadius: 24,
                padding: 10,
            },
            badge: {
                background: "#202127",
                color: "#d7d7dd",
                border: "1px solid #363741",
            },
            summaryCard: {
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#f5f5f5",
            },
            label: { color: "#9c9ca8" },
            accent: "#f5f5f5",
            brand: "#9c9ca8",
            title: "TODAY'S WORKOUT",
        };
    }

    return {
        shell: {
            background: "linear-gradient(180deg, #fff8fb 0%, #fff5ef 100%)",
            color: "#51363c",
            border: "1px solid #f3dfe5",
            boxShadow: "0 24px 60px rgba(196,132,148,0.18)",
        },
        photoFrame: {
            background: "#fffdfd",
            border: "1px solid #f1e6ea",
            borderRadius: 28,
            padding: 12,
        },
        badge: {
            background: "#fff0f5",
            color: "#a25d6c",
            border: "1px solid #f3d7df",
        },
        summaryCard: {
            background: "rgba(255,255,255,0.75)",
            border: "1px solid rgba(232,199,210,0.9)",
            color: "#51363c",
        },
        label: { color: "#9b7d86" },
        accent: "#7f4653",
        brand: "#b48d99",
        title: "Workout Moment",
    };
}

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

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function waitForImageReady(img) {
    return new Promise((resolve, reject) => {
        if (!img) {
            resolve();
            return;
        }

        if (img.complete && img.naturalWidth > 0) {
            if (typeof img.decode === "function") {
                img.decode().then(resolve).catch(resolve);
            } else {
                resolve();
            }
            return;
        }

        const handleLoad = () => {
            img.removeEventListener("load", handleLoad);
            img.removeEventListener("error", handleError);
            if (typeof img.decode === "function") {
                img.decode().then(resolve).catch(resolve);
            } else {
                resolve();
            }
        };

        const handleError = (event) => {
            img.removeEventListener("load", handleLoad);
            img.removeEventListener("error", handleError);
            reject(event);
        };

        img.addEventListener("load", handleLoad);
        img.addEventListener("error", handleError);
    });
}

function waitForAnimationFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export default function WorkoutShareModal({
    isOpen,
    onClose,
    template,
    onChangeTemplate,
    photoUrl,
    workoutDate,
    summary,
}) {
    const cardRef = useRef(null);
    const photoImgRef = useRef(null);
    const [sharing, setSharing] = useState(false);
    const [errorMsg, setErrorMsg] = useState("");
    const [renderPhotoUrl, setRenderPhotoUrl] = useState(photoUrl || null);
    const [photoPreparing, setPhotoPreparing] = useState(Boolean(photoUrl));
    const [photoReady, setPhotoReady] = useState(!photoUrl);
    const styleSet = buildTemplateStyles(template);
    const dateLabel = formatDate(workoutDate);
    const totalVolumeLabel = `${Number(summary?.totalVolumeKg || 0).toLocaleString("ja-JP")}kg`;
    const summaryItems = [
        { value: `${summary?.exerciseCount || 0}種目`, label: "種目" },
        { value: `${summary?.setCount || 0}セット`, label: "セット" },
        { value: `PR ${summary?.prCount || 0}`, label: "PR" },
        { value: totalVolumeLabel, label: "ボリューム" },
    ];
    const shareTitle = useMemo(() => `${dateLabel} のワークアウト`, [dateLabel]);

    useEffect(() => {
        let isActive = true;

        const preparePhotoUrl = async () => {
            if (!photoUrl) {
                if (isActive) {
                    setRenderPhotoUrl(null);
                    setPhotoPreparing(false);
                    setPhotoReady(true);
                }
                return;
            }

            if (isActive) {
                setPhotoPreparing(true);
                setPhotoReady(false);
            }

            try {
                const res = await fetch(photoUrl);
                if (!res.ok) throw new Error("photo fetch failed");
                const blob = await res.blob();

                const dataUrl = await blobToDataUrl(blob);
                const preloadImg = new Image();
                preloadImg.src = dataUrl;
                await waitForImageReady(preloadImg);

                if (isActive) {
                    setRenderPhotoUrl(dataUrl);
                    setPhotoPreparing(false);
                    setPhotoReady(true);
                    setErrorMsg("");
                }
            } catch (error) {
                console.error("share photo prepare failed", error);
                if (isActive) {
                    setRenderPhotoUrl(null);
                    setPhotoPreparing(false);
                    setPhotoReady(false);
                    setErrorMsg("写真の読み込みに失敗しました。時間をおいてもう一度お試しください。");
                }
            }
        };

        preparePhotoUrl();

        return () => {
            isActive = false;
        };
    }, [photoUrl]);

    if (!isOpen) return null;

    const handleDownload = (blob) => {
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = `iron-log-${workoutDate || "workout"}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(objectUrl);
    };

    const handleShare = async () => {
        if (!cardRef.current || sharing || (photoUrl && (!renderPhotoUrl || !photoReady || photoPreparing))) return;

        setSharing(true);
        setErrorMsg("");

        try {
            if (document.fonts?.ready) {
                await document.fonts.ready;
            }

            const cardImage = photoImgRef.current;
            if (cardImage) {
                await waitForImageReady(cardImage);
            }

            await waitForAnimationFrame();
            await waitForAnimationFrame();

            const blob = await toBlob(cardRef.current, {
                cacheBust: true,
                pixelRatio: 2,
                backgroundColor: "transparent",
            });

            if (!blob) {
                throw new Error("画像の生成に失敗しました");
            }

            const file = new File([blob], `iron-log-${workoutDate || "workout"}.png`, {
                type: "image/png",
            });

            const shareData = {
                files: [file],
                title: shareTitle,
                text: "IRON LOG の投稿プレビュー",
            };

            if (navigator.canShare && navigator.canShare(shareData) && navigator.share) {
                await navigator.share(shareData);
                return;
            }

            handleDownload(blob);
        } catch (error) {
            if (error?.name === "AbortError") return;
            console.error("share preview failed", {
                error,
                message: error?.message,
                name: error?.name,
                hasPhoto: Boolean(photoUrl),
                renderPhotoUrl,
                photoReady,
                photoPreparing,
            });
            setErrorMsg("共有画像の作成に失敗しました。もう一度お試しください。");
        } finally {
            setSharing(false);
        }
    };

    return (
        <div
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 140,
                background: "rgba(0,0,0,0.72)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 18,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: "100%",
                    maxWidth: 430,
                    maxHeight: "92vh",
                    overflowY: "auto",
                    borderRadius: 28,
                    padding: 18,
                    background: "var(--card)",
                    border: "1px solid var(--border2)",
                }}
            >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
                    <div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>投稿プレビュー</div>
                        <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
                            今日の写真とワークアウト要約
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            padding: "8px 12px",
                            borderRadius: 12,
                            background: "var(--card2)",
                            border: "1px solid var(--border2)",
                            color: "var(--text2)",
                            fontSize: 12,
                            fontWeight: 700,
                        }}
                    >
                        閉じる
                    </button>
                </div>

                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                    <div style={{ display: "flex", gap: 8, flex: 1 }}>
                        {TEMPLATE_OPTIONS.map((option) => {
                            const isActive = option.id === template;
                            return (
                                <button
                                    key={option.id}
                                    onClick={() => onChangeTemplate(option.id)}
                                    style={{
                                        flex: 1,
                                        padding: "10px 12px",
                                        borderRadius: 14,
                                        border: `1px solid ${isActive ? styleSet.accent : "var(--border2)"}`,
                                        background: isActive ? styleSet.accent : "var(--card2)",
                                        color: isActive ? "#fff" : "var(--text2)",
                                        fontSize: 12,
                                        fontWeight: 800,
                                    }}
                                >
                                    {option.label}
                                </button>
                            );
                        })}
                    </div>
                    <button
                        onClick={handleShare}
                        disabled={sharing || (photoUrl && (!renderPhotoUrl || !photoReady || photoPreparing))}
                        style={{
                            padding: "10px 14px",
                            borderRadius: 14,
                            border: "none",
                            background: styleSet.accent,
                            color: template === "cool" ? "#111214" : "#fff",
                            fontSize: 12,
                            fontWeight: 800,
                            opacity: sharing || (photoUrl && (!renderPhotoUrl || !photoReady || photoPreparing)) ? 0.7 : 1,
                            whiteSpace: "nowrap",
                        }}
                    >
                        {sharing ? "共有中..." : photoUrl && (!renderPhotoUrl || !photoReady || photoPreparing) ? "画像読み込み中..." : "共有"}
                    </button>
                </div>

                {errorMsg && (
                    <div
                        style={{
                            marginBottom: 14,
                            padding: "10px 12px",
                            borderRadius: 12,
                            background: "#ef44441a",
                            border: "1px solid #ef444455",
                            color: "#ef4444",
                            fontSize: 12,
                            fontWeight: 600,
                        }}
                    >
                        {errorMsg}
                    </div>
                )}

                {renderPhotoUrl ? (
                    <div
                        ref={cardRef}
                        style={{
                            ...styleSet.shell,
                            borderRadius: 30,
                            padding: 18,
                            overflow: "hidden",
                        }}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
                            <div>
                                <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", opacity: 0.8 }}>
                                    {styleSet.title}
                                </div>
                                <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.15, marginTop: 6 }}>
                                    {dateLabel}
                                </div>
                            </div>
                            <div style={{ ...styleSet.badge, borderRadius: 999, padding: "6px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                                {template === "cute" ? "today's glow" : "performance log"}
                            </div>
                        </div>

                        <div style={{ ...styleSet.photoFrame, marginBottom: 14 }}>
                            <img
                                ref={photoImgRef}
                                src={renderPhotoUrl}
                                alt={`${dateLabel} workout share`}
                                onLoad={() => {
                                    setPhotoPreparing(false);
                                    setPhotoReady(true);
                                    setErrorMsg("");
                                }}
                                onError={(error) => {
                                    console.error("share preview image load failed", error);
                                    setPhotoPreparing(false);
                                    setPhotoReady(false);
                                    setErrorMsg("写真の読み込みに失敗しました。時間をおいてもう一度お試しください。");
                                }}
                                style={{
                                    width: "100%",
                                    display: "block",
                                    aspectRatio: "4 / 5",
                                    objectFit: "cover",
                                    borderRadius: template === "cute" ? 22 : 18,
                                }}
                            />
                        </div>

                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                                gap: 10,
                                marginBottom: 14,
                            }}
                        >
                            {summaryItems.map((item) => (
                                <SummaryItem key={item.label} value={item.value} label={item.label} styleSet={styleSet} />
                            ))}
                        </div>

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                            <div style={{ ...styleSet.label, fontSize: 11 }}>
                                まずはプレビューのみ
                            </div>
                            <div style={{ color: styleSet.brand, fontSize: 11, letterSpacing: 1.4 }}>
                                IRON LOG
                            </div>
                        </div>
                    </div>
                ) : (
                    <div
                        ref={cardRef}
                        style={{
                            ...styleSet.shell,
                            borderRadius: 30,
                            padding: 20,
                            overflow: "hidden",
                        }}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
                            <div>
                                <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", opacity: 0.8 }}>
                                    {styleSet.title}
                                </div>
                                <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.15, marginTop: 6 }}>
                                    {dateLabel}
                                </div>
                            </div>
                            <div style={{ ...styleSet.badge, borderRadius: 999, padding: "6px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                                {template === "cute" ? "summary only" : "stats focus"}
                            </div>
                        </div>

                        <div style={{ ...styleSet.summaryCard, borderRadius: 24, padding: "18px 16px", marginBottom: 14 }}>
                            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>
                                {template === "cute" ? "今日のワークアウトまとめ" : "TODAY'S STATS"}
                            </div>
                            <div style={{ ...styleSet.label, fontSize: 12, lineHeight: 1.6 }}>
                                写真がない日は、ワークアウト要約を主役にした投稿デザインで表示します
                            </div>
                        </div>

                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                                gap: 10,
                                marginBottom: 14,
                            }}
                        >
                            {summaryItems.map((item) => (
                                <SummaryItem key={item.label} value={item.value} label={item.label} styleSet={styleSet} />
                            ))}
                        </div>

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                            <div style={{ ...styleSet.label, fontSize: 11 }}>
                                写真を追加すると写真入りデザインに切り替わります
                            </div>
                            <div style={{ color: styleSet.brand, fontSize: 11, letterSpacing: 1.4 }}>
                                IRON LOG
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
