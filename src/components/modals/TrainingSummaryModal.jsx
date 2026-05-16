import { useEffect, useMemo, useRef, useState } from "react";
import { toBlob } from "html-to-image";
import TrainingSummaryShareCard from "../share/TrainingSummaryShareCard";

const CARD_PRESETS = {
  square: { key: "square", label: "1:1" },
  story: { key: "story", label: "9:16" },
};

const downloadBlob = (blob, fileName) => {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
};

export default function TrainingSummaryModal({ isOpen, onClose, summary }) {
  const [sizeKey, setSizeKey] = useState("square");
  const [sharing, setSharing] = useState(false);
  const cardRef = useRef(null);
  const scrollLockRef = useRef({ top: 0, body: {}, html: {} });
  const [selectedSummaryKey, setSelectedSummaryKey] = useState(null);

  const summaryOptions = useMemo(() => {
    if (!summary?.group) return [];
    if (summary.group === "weekly") {
      return [
        { key: "this_week", label: "今週" },
        { key: "last_week", label: "先週" },
      ];
    }
    if (summary.group === "monthly") {
      return [
        { key: "this_month", label: "今月" },
        { key: "last_month", label: "先月" },
      ];
    }
    return [];
  }, [summary?.group]);

  const summaryMap = useMemo(() => {
    if (!summary) return {};
    return {
      [summary.key]: summary,
      ...(summary.relatedSummaries || {}),
    };
  }, [summary]);

  const activeSummary = summaryMap[selectedSummaryKey] || summary;

  useEffect(() => {
    if (!isOpen || !summary) return;
    setSelectedSummaryKey(summary.key);
  }, [isOpen, summary]);

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
    body.style.touchAction = "";
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

  if (!isOpen || !summary) return null;

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
      });

      if (!blob) throw new Error("summary share blob generation failed");

      const file = new File(
        [blob],
        `pump-${activeSummary.key}-${activeSummary.startKey}-${sizeKey}.png`,
        { type: "image/png" }
      );

      const shareData = {
        title: "PUMP",
        text: `${activeSummary.shareLabel} ${activeSummary.rangeLabel}`,
        files: [file],
      };

      if (navigator.canShare && navigator.canShare(shareData) && navigator.share) {
        await navigator.share(shareData);
        return;
      }

      downloadBlob(blob, file.name);
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.error("training summary share failed", error);
        alert("サマリー画像の作成に失敗しました。");
      }
    } finally {
      setSharing(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 360,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding:
          "calc(16px + var(--safe-top, 0px)) 12px calc(12px + var(--safe-bottom, 0px))",
        boxSizing: "border-box",
      }}
    >
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(15, 23, 42, 0.72)",
        }}
      />
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 440,
          height:
            "calc(100dvh - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 28px)",
          background: "var(--card-modal)",
          borderRadius: 24,
          boxShadow: "0 24px 56px rgba(15, 23, 42, 0.22)",
          overflow: "hidden",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          style={{
            height: "100%",
            overflowY: "auto",
            padding: "18px 16px calc(24px + var(--safe-bottom, 0px))",
            boxSizing: "border-box",
            overscrollBehavior: "contain",
            
            touchAction: "pan-y",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 14,
            }}
          >
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>
                {activeSummary.title}
              </div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>
                {activeSummary.rangeLabel}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                color: "var(--text3)",
                fontSize: 20,
                lineHeight: 1,
                padding: 2,
              }}
            >
              ×
            </button>
          </div>

          {summaryOptions.length > 0 && (
            <div
              style={{
                display: "flex",
                gap: 8,
                marginBottom: 14,
                padding: 4,
                borderRadius: 999,
                background: "rgba(18, 199, 194, 0.05)",
                border: "1px solid rgba(18, 199, 194, 0.10)",
                width: "fit-content",
              }}
            >
              {summaryOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setSelectedSummaryKey(option.key)}
                  style={{
                    minWidth: 76,
                    padding: "9px 14px",
                    borderRadius: 999,
                    border:
                      selectedSummaryKey === option.key
                        ? "1px solid rgba(15, 94, 99, 0.18)"
                        : "1px solid rgba(18, 199, 194, 0.10)",
                    background:
                      selectedSummaryKey === option.key
                        ? "linear-gradient(135deg, #0F5E63, #12C7C2)"
                        : "var(--card)",
                    color:
                      selectedSummaryKey === option.key ? "#fff" : "var(--text2)",
                    fontSize: 12,
                    fontWeight: 800,
                    boxShadow:
                      selectedSummaryKey === option.key
                        ? "0 10px 22px rgba(15, 94, 99, 0.14)"
                        : "none",
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {Object.values(CARD_PRESETS).map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => setSizeKey(preset.key)}
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid rgba(18, 199, 194, 0.12)",
                background: sizeKey === preset.key ? "linear-gradient(135deg, #0F5E63, #12C7C2)" : "var(--card2)",
                color: sizeKey === preset.key ? "#fff" : "var(--text2)",
                fontSize: 12,
                fontWeight: 700,
                boxShadow: sizeKey === preset.key ? "0 10px 22px rgba(15, 94, 99, 0.12)" : "none",
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: 14,
            overflow: "hidden",
            width: "100%",
          }}
        >
          <div
            style={{
              width: sizeKey === "story" ? 360 * 0.54 : 360 * 0.86,
              height: sizeKey === "story" ? 640 * 0.54 : 360 * 0.86,
              display: "flex",
              justifyContent: "center",
              alignItems: "flex-start",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                transform: sizeKey === "story" ? "scale(0.54)" : "scale(0.86)",
                transformOrigin: "top center",
              }}
            >
              <TrainingSummaryShareCard ref={cardRef} summary={activeSummary} sizeKey={sizeKey} />
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleShare}
          disabled={sharing}
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: 14,
            border: "none",
            background: "linear-gradient(135deg, var(--accent), #F97316)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 800,
            boxShadow: "var(--shadow-soft)",
          }}
        >
          {sharing ? "画像を作成中..." : "シェア画像を作成"}
        </button>
        </div>
      </div>
    </div>
  );
}
