import React, { useEffect, useMemo, useRef, useState } from "react";
import { toBlob } from "html-to-image";
import SummaryShareCard from "../share/SummaryShareCard";
import FullRecordShareCard from "../share/FullRecordShareCard";
import { formatDate, buildTemplateStyles } from "../../utils/shareTemplateStyles";
import {
    waitForAnimationFrame,
    buildPhotoShareBlob,
} from "../../utils/shareCanvas";

const TEMPLATE_OPTIONS = [
    { id: "cute", label: "Cute" },
    { id: "cool", label: "Cool" },
];

const POST_TYPE_OPTIONS = [
    { id: "summary", label: "サマリー" },
    { id: "fullRecord", label: "全記録" },
];

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
                        <SummaryShareCard
                            template={template}
                            styleSet={styleSet}
                            dateLabel={dateLabel}
                            summaryItems={summaryItems}
                            renderPhotoUrl={renderPhotoUrl}
                            photoImgRef={photoImgRef}
                            onPhotoLoad={() => {
                                setPhotoPreparing(false);
                                setPhotoReady(true);
                                setErrorMsg("");
                            }}
                            onPhotoError={(error) => {
                                console.error("share preview image load failed", error);
                                setPhotoPreparing(false);
                                setPhotoReady(false);
                                setErrorMsg("写真の読み込みに失敗しました。時間をおいてもう一度お試しください。");
                            }}
                        />
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
                        <SummaryShareCard
                            template={template}
                            styleSet={styleSet}
                            dateLabel={dateLabel}
                            summaryItems={summaryItems}
                            renderPhotoUrl={null}
                            photoImgRef={photoImgRef}
                            onPhotoLoad={() => { }}
                            onPhotoError={() => { }}
                        />
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
                        <FullRecordShareCard
                            template={template}
                            styleSet={styleSet}
                            dateLabel={dateLabel}
                            fullRecord={fullRecord}
                            renderPhotoUrl={renderPhotoUrl}
                            photoImgRef={photoImgRef}
                            onPhotoLoad={() => {
                                setPhotoPreparing(false);
                                setPhotoReady(true);
                                setErrorMsg("");
                            }}
                            onPhotoError={(error) => {
                                console.error("share preview image load failed", error);
                                setPhotoPreparing(false);
                                setPhotoReady(false);
                                setErrorMsg("写真の読み込みに失敗しました。時間をおいてもう一度お試しください。");
                            }}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
