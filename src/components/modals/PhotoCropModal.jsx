import { useCallback, useEffect, useRef, useState } from "react";
import Cropper from "react-easy-crop";

const CROP_ASPECT = 4 / 3;

function createImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
    });
}

async function getCroppedBlob(imageSrc, croppedAreaPixels, mimeType) {
    const image = await createImage(imageSrc);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    if (!ctx) {
        throw new Error("Canvas context is not available");
    }

    canvas.width = croppedAreaPixels.width;
    canvas.height = croppedAreaPixels.height;

    ctx.drawImage(
        image,
        croppedAreaPixels.x,
        croppedAreaPixels.y,
        croppedAreaPixels.width,
        croppedAreaPixels.height,
        0,
        0,
        croppedAreaPixels.width,
        croppedAreaPixels.height
    );

    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error("Failed to create cropped blob"));
                return;
            }
            resolve(blob);
        }, mimeType || "image/jpeg", 0.92);
    });
}

function extFromType(mimeType, fileName) {
    const ext = String(fileName || "").split(".").pop()?.toLowerCase();
    if (ext && ext !== fileName) return ext;
    if (mimeType === "image/png") return "png";
    if (mimeType === "image/webp") return "webp";
    return "jpg";
}

export default function PhotoCropModal({ file, onCancel, onConfirm }) {
    const [imageUrl, setImageUrl] = useState("");
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [minZoom, setMinZoom] = useState(1);
    const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const cropWrapperRef = useRef(null);

    useEffect(() => {
        const nextUrl = URL.createObjectURL(file);
        setImageUrl(nextUrl);
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setMinZoom(1);

        return () => {
            URL.revokeObjectURL(nextUrl);
        };
    }, [file]);

    const handleCropComplete = useCallback((_croppedArea, nextPixels) => {
        setCroppedAreaPixels(nextPixels);
    }, []);

    const handleMediaLoaded = useCallback((mediaSize) => {
        const wrapper = cropWrapperRef.current;
        if (!wrapper || !mediaSize?.width || !mediaSize?.height) return;

        const containerWidth = wrapper.clientWidth;
        const containerHeight = wrapper.clientHeight;

        let cropWidth = containerWidth;
        let cropHeight = cropWidth / CROP_ASPECT;

        if (cropHeight > containerHeight) {
            cropHeight = containerHeight;
            cropWidth = cropHeight * CROP_ASPECT;
        }

        const fitZoom = Math.min(
            cropWidth / mediaSize.width,
            cropHeight / mediaSize.height
        );

        const nextMinZoom = Math.max(0.1, Math.min(1, fitZoom));
        setMinZoom(nextMinZoom);
        setZoom(nextMinZoom);
        setCrop({ x: 0, y: 0 });
    }, []);

    const handleConfirm = async () => {
        if (!imageUrl || !croppedAreaPixels || isSaving) return;

        setIsSaving(true);

        try {
            const mimeType = file.type && file.type.startsWith("image/")
                ? file.type
                : "image/jpeg";

            const blob = await getCroppedBlob(imageUrl, croppedAreaPixels, mimeType);

            await onConfirm({
                blob,
                mimeType,
                extension: extFromType(mimeType, file.name),
            });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.78)",
                zIndex: 1300,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
            }}
        >
            <div
                style={{
                    width: "100%",
                    maxWidth: 520,
                    background: "var(--card)",
                    borderRadius: 20,
                    border: "1px solid var(--border2)",
                    overflow: "hidden",
                    boxShadow: "0 16px 48px rgba(0,0,0,0.35)",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
                    <button
                        onClick={onCancel}
                        disabled={isSaving}
                        style={{
                            background: "none",
                            border: "none",
                            color: "var(--text3)",
                            fontSize: 14,
                            fontWeight: 700,
                            opacity: isSaving ? 0.6 : 1,
                        }}
                    >
                        キャンセル
                    </button>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>トリミング</div>
                    <button
                        onClick={handleConfirm}
                        disabled={isSaving || !croppedAreaPixels}
                        style={{
                            background: "none",
                            border: "none",
                            color: "var(--text)",
                            fontSize: 14,
                            fontWeight: 700,
                            opacity: isSaving || !croppedAreaPixels ? 0.6 : 1,
                        }}
                    >
                        {isSaving ? "保存中..." : "完了"}
                    </button>
                </div>

                <div ref={cropWrapperRef} style={{ position: "relative", height: "56vh", minHeight: 360, background: "#111" }}>
                    {imageUrl && (
                        <Cropper
                            image={imageUrl}
                            aspect={CROP_ASPECT}
                            crop={crop}
                            zoom={zoom}
                            minZoom={minZoom}
                            onCropChange={setCrop}
                            onCropComplete={handleCropComplete}
                            onZoomChange={setZoom}
                            onMediaLoaded={handleMediaLoaded}
                            showGrid
                            zoomWithScroll={false}
                            objectFit="contain"
                        />
                    )}
                </div>

                <div style={{ padding: "14px 16px 18px" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 8 }}>ズーム</div>
                    <input
                        type="range"
                        min={String(minZoom)}
                        max="4"
                        step="0.01"
                        value={zoom}
                        onChange={(e) => setZoom(Number(e.target.value))}
                        style={{ width: "100%" }}
                    />
                </div>
            </div>
        </div>
    );
}
