import { useEffect, useRef, useState } from "react";
import ReactCrop from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

async function getCroppedBlob(image, pixelCrop, mimeType) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    if (!ctx) {
        throw new Error("Canvas context is not available");
    }

    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;

    canvas.width = Math.max(1, Math.floor(pixelCrop.width * scaleX));
    canvas.height = Math.max(1, Math.floor(pixelCrop.height * scaleY));

    ctx.drawImage(
        image,
        pixelCrop.x * scaleX,
        pixelCrop.y * scaleY,
        pixelCrop.width * scaleX,
        pixelCrop.height * scaleY,
        0,
        0,
        canvas.width,
        canvas.height
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
    const [crop, setCrop] = useState();
    const [completedCrop, setCompletedCrop] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const imageRef = useRef(null);

    useEffect(() => {
        const nextUrl = URL.createObjectURL(file);
        setImageUrl(nextUrl);
        setCrop(undefined);
        setCompletedCrop(null);

        return () => {
            URL.revokeObjectURL(nextUrl);
        };
    }, [file]);

    const handleImageLoad = (e) => {
        const { width, height } = e.currentTarget;
        imageRef.current = e.currentTarget;
        setCrop({
            unit: "%",
            x: 5,
            y: 5,
            width: 90,
            height: 90,
        });
        setCompletedCrop({
            unit: "px",
            x: width * 0.05,
            y: height * 0.05,
            width: width * 0.9,
            height: height * 0.9,
        });
    };

    const handleConfirm = async () => {
        if (!completedCrop || !imageRef.current || isSaving) return;

        setIsSaving(true);

        try {
            const mimeType = file.type && file.type.startsWith("image/")
                ? file.type
                : "image/jpeg";

            const blob = await getCroppedBlob(imageRef.current, completedCrop, mimeType);

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
                        disabled={isSaving || !completedCrop?.width || !completedCrop?.height}
                        style={{
                            background: "none",
                            border: "none",
                            color: "var(--text)",
                            fontSize: 14,
                            fontWeight: 700,
                            opacity: isSaving || !completedCrop?.width || !completedCrop?.height ? 0.6 : 1,
                        }}
                    >
                        {isSaving ? "保存中..." : "完了"}
                    </button>
                </div>

                <div style={{ position: "relative", height: "56vh", minHeight: 360, background: "#111", overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
                    {imageUrl && (
                        <ReactCrop
                            crop={crop}
                            onChange={(_, percentCrop) => setCrop(percentCrop)}
                            onComplete={(pixelCrop) => setCompletedCrop(pixelCrop)}
                            ruleOfThirds
                        >
                            <img
                                src={imageUrl}
                                alt="crop target"
                                onLoad={handleImageLoad}
                                style={{
                                    maxWidth: "100%",
                                    maxHeight: "calc(56vh - 24px)",
                                    display: "block",
                                }}
                            />
                        </ReactCrop>
                    )}
                </div>
            </div>
        </div>
    );
}
