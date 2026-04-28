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
    { id: "cute", label: "映え" },
    { id: "cool", label: "黒" },
];

const POST_TYPE_OPTIONS = [
    { id: "summary", label: "サマリー" },
    { id: "fullRecord", label: "全記録" },
];

const MAX_FULL_RECORD_SHARE_EXERCISES = 8;

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
    photoRows = [],
    photoUrls = {},
    initialPhotoId = null,
    workoutDate,
    summary,
    fullRecord = [],
}) {
    const cardRef = useRef(null);
    const photoImgRef = useRef(null);
    const [sharing, setSharing] = useState(false);
    const [errorMsg, setErrorMsg] = useState("");
    const [postType, setPostType] = useState("summary");
    const [selectedPhotoId, setSelectedPhotoId] = useState(initialPhotoId);
    const availablePhotos = useMemo(
        () => photoRows.filter((row) => Boolean(photoUrls[row.id])),
        [photoRows, photoUrls]
    );
    const selectedPhotoUrl = selectedPhotoId ? (photoUrls[selectedPhotoId] || null) : null;
    const [renderPhotoUrl, setRenderPhotoUrl] = useState(selectedPhotoUrl || null);
    const [photoPreparing, setPhotoPreparing] = useState(Boolean(selectedPhotoUrl));
    const [photoReady, setPhotoReady] = useState(!selectedPhotoUrl);
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
    const shareFullRecord = useMemo(() => {
        const normalized = (fullRecord || [])
            .filter((exercise) => exercise?.name && Array.isArray(exercise.sets) && exercise.sets.length > 0)
            .map((exercise) => ({
                name: exercise.name,
                sets: exercise.sets
                    .filter((set) => set?.setNumber && set?.weightLabel && set?.repsLabel)
                    .map((set) => ({
                        setNumber: set.setNumber,
                        weightLabel: set.weightLabel,
                        repsLabel: set.repsLabel,
                        isPR: Boolean(set.isPR),
                    })),
            }))
            .filter((exercise) => exercise.sets.length > 0);

        const hiddenCount = Math.max(0, normalized.length - MAX_FULL_RECORD_SHARE_EXERCISES);

        return {
            items: normalized.slice(0, MAX_FULL_RECORD_SHARE_EXERCISES),
            hiddenCount,
        };
    }, [fullRecord]);

    useEffect(() => {
        if (isOpen) {
            setPostType("summary");
            setSelectedPhotoId(initialPhotoId);
        }
    }, [isOpen, initialPhotoId]);

    useEffect(() => {
        let isActive = true;

        const preparePhotoUrl = async () => {
            if (!selectedPhotoUrl) {
                if (isActive) {
                    setRenderPhotoUrl(null);
                    setPhotoPreparing(false);
                    setPhotoReady(true);
                    setErrorMsg("");
                }
                return;
            }

            if (isActive) {
                setPhotoPreparing(true);
                setPhotoReady(false);
                setErrorMsg("");
            }

            try {
                const preloadImg = new Image();
                preloadImg.crossOrigin = "anonymous";
                preloadImg.src = selectedPhotoUrl;
                await waitForImageReady(preloadImg);

                if (isActive) {
                    setRenderPhotoUrl(selectedPhotoUrl);
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
    }, [selectedPhotoUrl]);

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
        if (!cardRef.current || sharing || (selectedPhotoUrl && (!renderPhotoUrl || !photoReady || photoPreparing))) return;

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
                    pixelRatio: postType === "fullRecord" ? 1.2 : 2,
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
                hasPhoto: Boolean(selectedPhotoUrl),
                renderPhotoUrl,
                photoReady,
                photoPreparing,
                imgComplete: photoImgRef.current?.complete,
                imgNaturalWidth: photoImgRef.current?.naturalWidth,
                postType,
                shareFullRecordCount: shareFullRecord.items.length,
                hiddenFullRecordCount: shareFullRecord.hiddenCount,
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
                                        color: isActive ? styleSet.accentText : "var(--text2)",
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
                        disabled={sharing || (postType === "summary" && selectedPhotoUrl && (!renderPhotoUrl || !photoReady || photoPreparing))}
                        style={{
                            padding: "10px 14px",
                            borderRadius: 14,
                            border: "none",
                            background: styleSet.accent,
                            color: styleSet.accentText,
                            fontSize: 12,
                            fontWeight: 800,
                            opacity: sharing || (postType === "summary" && selectedPhotoUrl && (!renderPhotoUrl || !photoReady || photoPreparing)) ? 0.7 : 1,
                            whiteSpace: "nowrap",
                        }}
                    >
                        {sharing ? "共有中..." : postType === "summary" && selectedPhotoUrl && (!renderPhotoUrl || !photoReady || photoPreparing) ? "画像準備中..." : "共有"}
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
                                    color: isActive ? styleSet.accentText : "var(--text2)",
                                    fontSize: 12,
                                    fontWeight: 800,
                                }}
                            >
                                {option.label}
                            </button>
                        );
                    })}
                </div>

                {availablePhotos.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                        <div
                            style={{
                                color: "var(--text2)",
                                fontSize: 12,
                                fontWeight: 700,
                                marginBottom: 8,
                            }}
                        >
                            投稿に使う写真
                        </div>
                        <div
                            style={{
                                display: "flex",
                                gap: 10,
                                overflowX: "auto",
                                paddingBottom: 4,
                            }}
                        >
                            <button
                                onClick={() => setSelectedPhotoId(null)}
                                style={{
                                    flex: "0 0 auto",
                                    minWidth: 84,
                                    padding: "10px 12px",
                                    borderRadius: 16,
                                    border: `1px solid ${selectedPhotoId === null ? styleSet.accent : "var(--border2)"}`,
                                    background: selectedPhotoId === null ? `${styleSet.accent}12` : "var(--card2)",
                                    color: selectedPhotoId === null ? styleSet.accent : "var(--text2)",
                                    fontSize: 12,
                                    fontWeight: 800,
                                }}
                            >
                                写真なし
                            </button>
                            {availablePhotos.map((row, idx) => {
                                const isSelected = selectedPhotoId === row.id;
                                return (
                                    <button
                                        key={row.id}
                                        onClick={() => setSelectedPhotoId(row.id)}
                                        style={{
                                            flex: "0 0 auto",
                                            width: 92,
                                            borderRadius: 18,
                                            border: `1px solid ${isSelected ? styleSet.accent : "var(--border2)"}`,
                                            background: isSelected ? `${styleSet.accent}12` : "var(--card2)",
                                            padding: 6,
                                            color: "inherit",
                                        }}
                                    >
                                        <div
                                            style={{
                                                width: "100%",
                                                aspectRatio: "1 / 1",
                                                borderRadius: 12,
                                                overflow: "hidden",
                                                background: "var(--card)",
                                                marginBottom: 6,
                                            }}
                                        >
                                            <img
                                                src={photoUrls[row.id]}
                                                alt={`${idx + 1}枚目の体写真`}
                                                style={{
                                                    width: "100%",
                                                    height: "100%",
                                                    objectFit: "cover",
                                                    display: "block",
                                                }}
                                            />
                                        </div>
                                        <div
                                            style={{
                                                fontSize: 11,
                                                fontWeight: 800,
                                                color: isSelected ? styleSet.accent : "var(--text2)",
                                            }}
                                        >
                                            {idx + 1}枚目
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

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
                            fullRecord={shareFullRecord.items}
                            hiddenExerciseCount={shareFullRecord.hiddenCount}
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
