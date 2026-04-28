export function waitForAnimationFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export function roundedRectPath(ctx, x, y, width, height, radius) {
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

export function fillRoundedRect(ctx, x, y, width, height, radius, fillStyle) {
    ctx.save();
    ctx.fillStyle = fillStyle;
    roundedRectPath(ctx, x, y, width, height, radius);
    ctx.fill();
    ctx.restore();
}

export function strokeRoundedRect(ctx, x, y, width, height, radius, strokeStyle, lineWidth = 1) {
    ctx.save();
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    roundedRectPath(ctx, x, y, width, height, radius);
    ctx.stroke();
    ctx.restore();
}

export function clipRoundedRect(ctx, x, y, width, height, radius) {
    ctx.save();
    roundedRectPath(ctx, x, y, width, height, radius);
    ctx.clip();
}

export function drawImageCover(ctx, img, x, y, width, height) {
    const scale = Math.max(width / img.width, height / img.height);
    const drawWidth = img.width * scale;
    const drawHeight = img.height * scale;
    const drawX = x + (width - drawWidth) / 2;
    const drawY = y + (height - drawHeight) / 2;
    ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
}

export function loadCanvasImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

export function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error("canvas toBlob failed"));
        }, "image/png");
    });
}

export async function buildPhotoShareBlob({
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
        bgGradient.addColorStop(0, "#f3fffd");
        bgGradient.addColorStop(0.42, "#e8fff7");
        bgGradient.addColorStop(1, "#eef8ff");
    }
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const shellX = 56;
    const shellY = 56;
    const shellW = canvas.width - shellX * 2;
    const shellH = canvas.height - shellY * 2;

    fillRoundedRect(ctx, shellX, shellY, shellW, shellH, 54, isCool ? "#16171a" : "rgba(255,255,255,0.82)");
    strokeRoundedRect(ctx, shellX, shellY, shellW, shellH, 54, isCool ? "#3b3b40" : "#cdeee7", 2);

    ctx.save();
    ctx.fillStyle = isCool ? "#f5f5f5cc" : "#18b8b3cc";
    fillRoundedRect(ctx, shellX + 44, shellY + 34, 34, 34, 17, isCool ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.78)");
    ctx.fillStyle = isCool ? "#f5f5f5" : "#18b8b3";
    ctx.font = "900 18px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(isCool ? "◆" : "✦", shellX + 61, shellY + 51);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "500 28px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.letterSpacing = "0px";
    ctx.fillText(isCool ? "TODAY'S WORKOUT" : "GYM GLOW", shellX + 92, shellY + 60);

    ctx.fillStyle = isCool ? "#f5f5f5" : "#1f4b52";
    ctx.font = "800 64px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(dateLabel, shellX + 44, shellY + 138);
    ctx.restore();

    const badgeX = shellX + shellW - 244;
    const badgeY = shellY + 46;
    const badgeW = 170;
    const badgeH = 54;
    fillRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 27, isCool ? "#202127" : "#edfffa");
    strokeRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 27, isCool ? "#363741" : "#bfeee5", 2);
    ctx.save();
    ctx.fillStyle = isCool ? "#d7d7dd" : "#12897a";
    ctx.font = "700 22px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(isCool ? "performance log" : "share ready", badgeX + badgeW / 2, badgeY + badgeH / 2);
    ctx.restore();

    const photoFrameX = shellX + 44;
    const photoFrameY = shellY + 182;
    const photoFrameW = shellW - 88;
    const photoFrameH = 860;
    fillRoundedRect(ctx, photoFrameX, photoFrameY, photoFrameW, photoFrameH, isCool ? 34 : 40, isCool ? "#111214" : "#ffffff");
    strokeRoundedRect(ctx, photoFrameX, photoFrameY, photoFrameW, photoFrameH, isCool ? 34 : 40, isCool ? "#2e2f35" : "#caedf2", 2);

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
    const gridStroke = isCool ? "rgba(255,255,255,0.08)" : "rgba(183,235,226,0.95)";
    const gridFill = isCool ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.88)";
    const valueColor = isCool ? "#f5f5f5" : "#1f4b52";
    const labelColor = isCool ? "#9c9ca8" : "#5f8f93";

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
