import { useMemo, useRef, useState } from "react";
import { toBlob } from "html-to-image";
import TrainingSummaryShareCard from "../share/TrainingSummaryShareCard";

const CARD_PRESETS = {
  square: { key: "square", label: "1:1" },
  story: { key: "story", label: "9:16" },
};

const formatVolume = (value) =>
  `${Math.round(Number(value || 0)).toLocaleString("ja-JP")}kg`;

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

  const detailItems = useMemo(
    () => [
      { label: "トレーニング回数", value: `${summary?.workoutCount || 0}回` },
      { label: "総ボリューム", value: formatVolume(summary?.totalVolume || 0) },
      { label: "実施種目数", value: `${summary?.exerciseCount || 0}種目` },
      { label: "最多部位", value: summary?.topBodyPart || "なし" },
      { label: "PR更新", value: `${summary?.prUpdateCount || 0}件` },
      { label: "ストリーク", value: `${summary?.streak || 0}日` },
    ],
    [summary]
  );

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
        `pump-${summary.key}-${summary.startKey}-${sizeKey}.png`,
        { type: "image/png" }
      );

      const shareData = {
        title: "PUMP",
        text: `${summary.shareLabel} ${summary.rangeLabel}`,
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
        background: "rgba(15, 23, 42, 0.72)",
        zIndex: 360,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          maxHeight: "min(88vh, 840px)",
          overflowY: "auto",
          background: "var(--card-modal)",
          borderRadius: 24,
          padding: 20,
          boxSizing: "border-box",
        }}
        onClick={(event) => event.stopPropagation()}
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
              {summary.title}
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>
              {summary.rangeLabel}
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
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 8,
            marginBottom: 16,
          }}
        >
          {detailItems.map((item) => (
            <div
              key={item.label}
              style={{
                background: "var(--card2)",
                borderRadius: 16,
                border: "1px solid var(--border2)",
                padding: "12px 14px",
              }}
            >
              <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>
                {item.label}
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            background: "var(--card2)",
            borderRadius: 18,
            border: "1px solid var(--border2)",
            padding: "14px 14px 12px",
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 10 }}>
            種目ハイライト
          </div>
          {summary.highlights?.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {summary.highlights.map((item) => (
                <div
                  key={item.key}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 14,
                    background: "var(--card)",
                    border: "1px solid rgba(255,255,255,0.04)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        color: "var(--text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.exerciseName}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>
                      {item.bodyPart} ・ {item.setCount}セット
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "var(--accent)" }}>
                      {formatVolume(item.volume)}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>
                      最大 {Math.round(Number(item.maxWeight || 0) * 10) / 10 || 0}kg
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--text3)" }}>
              この期間のハイライト種目はまだありません
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {Object.values(CARD_PRESETS).map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => setSizeKey(preset.key)}
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: "1px solid var(--border2)",
                background: sizeKey === preset.key ? "var(--text)" : "var(--card2)",
                color: sizeKey === preset.key ? "var(--bg)" : "var(--text2)",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <TrainingSummaryShareCard ref={cardRef} summary={summary} sizeKey={sizeKey} />
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
  );
}
