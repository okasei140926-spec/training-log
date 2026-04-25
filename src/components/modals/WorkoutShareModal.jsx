import React, { useEffect, useMemo, useRef, useState } from "react";
import { toBlob } from "html-to-image";

const TEMPLATE_OPTIONS = [
    { id: "cute", label: "Cute" },
    { id: "cool", label: "Cool" },
];

const POST_TYPE_OPTIONS = [
    { id: "summary", label: "サマリー" },
    { id: "fullRecord", label: "全記録" },
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
            if (img.naturalWidth === 0) {
                reject(new Error("image naturalWidth is 0"));
                return;
            }
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

function roundedRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function fillRoundedRect(ctx, x, y, width, height, radius, fillStyle) {
    ctx.save();
    ctx.fillStyle = fillStyle;
    roundedRectPath(ctx, x, y, width, height, radius);
    ctx.fill();
    ctx.restore();
}

function strokeRoundedRect(ctx, x, y, width, height, radius, strokeStyle, lineWidth = 1) {
    ctx.save();
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    roundedRectPath(ctx, x, y, width, height, radius);
    ctx.stroke();
    ctx.restore();
}

function clipRoundedRect(ctx, x, y, width, height, radius) {
    ctx.save();
    roundedRectPath(ctx, x, y, width, height, radius);
    ctx.clip();
}

function drawImageCover(ctx, img, x, y, width, height) {
    const scale = Math.max(width / img.width, height / img.height);
    const drawWidth = img.width * scale;
    const drawHeight = img.height * scale;
    const drawX = x + (width - drawWidth) / 2;
    const drawY = y + (height - drawHeight) / 2;
    ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
}

function loadCanvasImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error("canvas toBlob failed"));
        }, "image/png");
    });
}

async function buildPhotoShareBlob({
    template,
    photoSrc,
    dateLabel,
    summaryItems,
}) {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1620;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas context not available");

    const isCool = template === "cool";
    const bgGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    if (isCool) {
        bgGradient.addColorStop(0, "#0f0f10");
        bgGradient.addColorStop(1, "#1a1a1d");
    } else {
        bgGradient.addColorStop(0, "#fff8fb");
        bgGradient.addColorStop(1, "#fff5ef");
    }
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const shellX = 56;
    const shellY = 56;
    const shellW = canvas.width - shellX * 2;
    const shellH = canvas.height - shellY * 2;

    fillRoundedRect(ctx, shellX, shellY, shellW, shellH, 54, isCool ? "#16171a" : "rgba(255,255,255,0.72)");
    strokeRoundedRect(ctx, shellX, shellY, shellW, shellH, 54, isCool ? "#3b3b40" : "#f3dfe5", 2);

    ctx.save();
    ctx.fillStyle = isCool ? "#f5f5f5cc" : "#7f4653cc";
    ctx.font = "500 28px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.letterSpacing = "0px";
    ctx.fillText(isCool ? "TODAY'S WORKOUT" : "Workout Moment", shellX + 44, shellY + 60);

    ctx.fillStyle = isCool ? "#f5f5f5" : "#51363c";
    ctx.font = "800 64px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(dateLabel, shellX + 44, shellY + 138);
    ctx.restore();

    const badgeX = shellX + shellW - 244;
    const badgeY = shellY + 46;
    const badgeW = 170;
    const badgeH = 54;
    fillRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 27, isCool ? "#202127" : "#fff0f5");
    strokeRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 27, isCool ? "#363741" : "#f3d7df", 2);
    ctx.save();
    ctx.fillStyle = isCool ? "#d7d7dd" : "#a25d6c";
    ctx.font = "700 22px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(isCool ? "performance log" : "today's glow", badgeX + badgeW / 2, badgeY + badgeH / 2);
    ctx.restore();

    const photoFrameX = shellX + 44;
    const photoFrameY = shellY + 182;
    const photoFrameW = shellW - 88;
    const photoFrameH = 860;
    fillRoundedRect(ctx, photoFrameX, photoFrameY, photoFrameW, photoFrameH, isCool ? 34 : 40, isCool ? "#111214" : "#fffdfd");
    strokeRoundedRect(ctx, photoFrameX, photoFrameY, photoFrameW, photoFrameH, isCool ? 34 : 40, isCool ? "#2e2f35" : "#f1e6ea", 2);

    const photoPadding = isCool ? 18 : 22;
    const photoX = photoFrameX + photoPadding;
    const photoY = photoFrameY + photoPadding;
    const photoW = photoFrameW - photoPadding * 2;
    const photoH = photoFrameH - photoPadding * 2;
    const photoImg = await loadCanvasImage(photoSrc);
    clipRoundedRect(ctx, photoX, photoY, photoW, photoH, isCool ? 28 : 34);
    drawImageCover(ctx, photoImg, photoX, photoY, photoW, photoH);
    ctx.restore();

    const gridX = shellX + 44;
    const gridY = photoFrameY + photoFrameH + 34;
    const gridGap = 22;
    const cardW = (shellW - 88 - gridGap) / 2;
    const cardH = 170;
    const gridStroke = isCool ? "rgba(255,255,255,0.08)" : "rgba(232,199,210,0.9)";
    const gridFill = isCool ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.78)";
    const valueColor = isCool ? "#f5f5f5" : "#51363c";
    const labelColor = isCool ? "#9c9ca8" : "#9b7d86";

    summaryItems.forEach((item, index) => {
        const col = index % 2;
        const row = Math.floor(index / 2);
        const x = gridX + col * (cardW + gridGap);
        const y = gridY + row * (cardH + gridGap);
        fillRoundedRect(ctx, x, y, cardW, cardH, 32, gridFill);
        strokeRoundedRect(ctx, x, y, cardW, cardH, 32, gridStroke, 2);

        ctx.save();
        ctx.fillStyle = valueColor;
        ctx.font = "800 44px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        ctx.textBaseline = "top";
        ctx.fillText(item.value, x + 28, y + 28);
        ctx.fillStyle = labelColor;
        ctx.font = "500 24px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        ctx.fillText(item.label, x + 28, y + 104);
        ctx.restore();
    });

    ctx.save();
    ctx.fillStyle = labelColor;
    ctx.font = "500 22px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("IRON LOG", shellX + shellW - 44, shellY + shellH - 42);
    ctx.restore();

    return canvasToBlob(canvas);
}

export default function WorkoutShareModal({
    isOpen,
    onClose,
    template,
    onChangeTemplate,
    photoUrl,
    workoutDate,
    summary,
    fullRecord = [],
}) {
    const cardRef = useRef(null);
    const photoImgRef = useRef(null);
    const [sharing, setSharing] = useState(false);
    const [errorMsg, setErrorMsg] = useState("");
    const [postType, setPostType] = useState("summary");
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
        if (isOpen) {
            setPostType("summary");
        }
    }, [isOpen]);

    useEffect(() => {
        let isActive = true;
        let nextObjectUrl = null;

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
                nextObjectUrl = URL.createObjectURL(blob);

                const preloadImg = new Image();
                preloadImg.crossOrigin = "anonymous";
                preloadImg.src = nextObjectUrl;
                await waitForImageReady(preloadImg);

                if (isActive) {
                    setRenderPhotoUrl(nextObjectUrl);
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
            if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
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

            let blob;
            if (postType === "summary" && renderPhotoUrl) {
                blob = await buildPhotoShareBlob({
                    template,
                    photoSrc: renderPhotoUrl,
                    dateLabel,
                    summaryItems,
                });
            } else {
                const cardImages = Array.from(cardRef.current.querySelectorAll("img"));
                for (const img of cardImages) {
                    await waitForImageReady(img);
                    if (!img.complete || img.naturalWidth === 0) {
                        throw new Error("share card image is not ready");
                    }
                }

                await waitForAnimationFrame();
                await waitForAnimationFrame();

                blob = await toBlob(cardRef.current, {
                    cacheBust: true,
                    pixelRatio: 2,
                    backgroundColor: "transparent",
                });
            }

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
                imgComplete: photoImgRef.current?.complete,
                imgNaturalWidth: photoImgRef.current?.naturalWidth,
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
                        disabled={sharing || (postType === "summary" && photoUrl && (!renderPhotoUrl || !photoReady || photoPreparing))}
                        style={{
                            padding: "10px 14px",
                            borderRadius: 14,
                            border: "none",
                            background: styleSet.accent,
                            color: template === "cool" ? "#111214" : "#fff",
                            fontSize: 12,
                            fontWeight: 800,
                            opacity: sharing || (postType === "summary" && photoUrl && (!renderPhotoUrl || !photoReady || photoPreparing)) ? 0.7 : 1,
                            whiteSpace: "nowrap",
                        }}
                    >
                        {sharing ? "共有中..." : postType === "summary" && photoUrl && (!renderPhotoUrl || !photoReady || photoPreparing) ? "画像準備中..." : "共有"}
                    </button>
                </div>

                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                    {POST_TYPE_OPTIONS.map((option) => {
                        const isActive = option.id === postType;
                        return (
                            <button
                                key={option.id}
                                onClick={() => setPostType(option.id)}
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

                {postType === "summary" && renderPhotoUrl ? (
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
                                crossOrigin="anonymous"
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
                            <div />
                            <div style={{ color: styleSet.brand, fontSize: 11, letterSpacing: 1.4 }}>
                                IRON LOG
                            </div>
                        </div>
                    </div>
                ) : postType === "summary" ? (
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

                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                                gap: 10,
                                marginBottom: 12,
                            }}
                        >
                            {summaryItems.map((item) => (
                                <SummaryItem key={item.label} value={item.value} label={item.label} styleSet={styleSet} />
                            ))}
                        </div>

                        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
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
                            padding: 18,
                            overflow: "hidden",
                        }}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
                            <div>
                                <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", opacity: 0.8 }}>
                                    {template === "cool" ? "FULL WORKOUT LOG" : "Workout Record"}
                                </div>
                                <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.15, marginTop: 6 }}>
                                    {dateLabel}
                                </div>
                            </div>
                            <div style={{ ...styleSet.badge, borderRadius: 999, padding: "6px 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                                {template === "cool" ? "all sets" : "全セット"}
                            </div>
                        </div>

                        {renderPhotoUrl && (
                            <div style={{ ...styleSet.photoFrame, marginBottom: 12, padding: template === "cool" ? 8 : 10 }}>
                                <img
                                    ref={photoImgRef}
                                    src={renderPhotoUrl}
                                    alt={`${dateLabel} workout full record`}
                                    crossOrigin="anonymous"
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
                                                            background: template === "cool" ? "#f5f5f5" : "#7f4653",
                                                            color: template === "cool" ? "#111214" : "#fff",
                                                        }}
                                                    >
                                                        PR
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
                    </div>
                )}
            </div>
        </div>
    );
}
