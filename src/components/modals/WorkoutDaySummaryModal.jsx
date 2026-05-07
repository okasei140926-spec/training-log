import { useEffect, useMemo, useRef } from "react";
import { formatWorkoutDaySummaryDuration } from "../../utils/workoutDaySummary";

const formatDateLabel = (date) => {
  const value = String(date || "").trim();
  if (!value) return "";
  return value.replaceAll("-", "/");
};

const formatVolume = (value) => `${Math.round(Number(value || 0)).toLocaleString("ja-JP")}kg`;

export default function WorkoutDaySummaryModal({
  isOpen,
  onClose,
  summary,
  onOpenWorkout,
  onShare,
}) {
  const scrollLockRef = useRef({ top: 0, body: {}, html: {} });

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

  const statItems = useMemo(() => {
    if (!summary) return [];

    const base = [
      summary.durationSec > 0
        ? { key: "duration", label: "時間", value: formatWorkoutDaySummaryDuration(summary.durationSec) }
        : null,
      { key: "volume", label: "Volume", value: formatVolume(summary.totalVolume) },
      { key: "setCount", label: "セット数", value: `${summary.setCount}` },
      { key: "exerciseCount", label: "種目数", value: `${summary.exerciseCount}` },
      { key: "prCount", label: "PR", value: `${summary.prCount}件` },
    ];
    return base.filter(Boolean);
  }, [summary]);

  if (!isOpen || !summary) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.52)",
        zIndex: 300,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding:
          "calc(16px + var(--safe-top, 0px)) 12px calc(12px + var(--safe-bottom, 0px))",
        boxSizing: "border-box",
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 440,
          background: "var(--card-modal)",
          borderRadius: 28,
          border: "1px solid rgba(18, 199, 194, 0.12)",
          boxShadow: "0 22px 44px rgba(15, 23, 42, 0.16)",
          maxHeight:
            "calc(100dvh - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 28px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            overscrollBehavior: "contain",
            padding: "18px 16px calc(22px + var(--safe-bottom, 0px))",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              width: 44,
              height: 5,
              borderRadius: 999,
              background: "var(--border2)",
              margin: "0 auto 14px",
            }}
          />

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
              <div style={{ fontSize: 24, fontWeight: 900, color: "var(--text)", lineHeight: 1.2 }}>
                {summary.title}
              </div>
              <div style={{ fontSize: 13, color: "var(--text3)", marginTop: 6 }}>
                {formatDateLabel(summary.date)}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                color: "var(--text3)",
                fontSize: 28,
                lineHeight: 1,
                padding: 0,
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 10,
              marginBottom: 16,
            }}
          >
            {statItems.map((item) => (
              <div
                key={item.key}
                style={{
                  background: "linear-gradient(180deg, rgba(18, 199, 194, 0.05), rgba(18, 199, 194, 0.015))",
                  borderRadius: 18,
                  border: "1px solid rgba(18, 199, 194, 0.12)",
                  padding: "12px 12px 11px",
                }}
              >
                <div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 700 }}>{item.label}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: "var(--text)", marginTop: 6 }}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          {summary.bodyParts?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "var(--text3)", fontWeight: 700, marginBottom: 8 }}>
                実施部位
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                {summary.bodyParts.map((bodyPart) => (
                  <span
                    key={bodyPart}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "5px 10px",
                      borderRadius: 999,
                      background: "rgba(18, 199, 194, 0.08)",
                      border: "1px solid rgba(18, 199, 194, 0.16)",
                      color: "var(--accent-strong, var(--accent))",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {bodyPart}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {summary.items?.map((item) => (
              <div
                key={item.key}
                style={{
                  background: "linear-gradient(180deg, var(--card2), var(--card))",
                  borderRadius: 18,
                  border: "1px solid rgba(18, 199, 194, 0.1)",
                  padding: "12px 12px 11px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 7 }}>
                  {item.bodyPart ? (
                    <span
                      style={{
                        padding: "4px 8px",
                        borderRadius: 999,
                        background: "rgba(18, 199, 194, 0.08)",
                        border: "1px solid rgba(18, 199, 194, 0.16)",
                        color: "var(--accent-strong, var(--accent))",
                        fontSize: 10,
                        fontWeight: 800,
                      }}
                    >
                      {item.bodyPart}
                    </span>
                  ) : null}
                  {item.isPr ? (
                    <span
                      style={{
                        padding: "4px 8px",
                        borderRadius: 999,
                        background: "rgba(255, 146, 39, 0.12)",
                        border: "1px solid rgba(255, 146, 39, 0.18)",
                        color: "#8A4A12",
                        fontSize: 10,
                        fontWeight: 800,
                      }}
                    >
                      PR
                    </span>
                  ) : null}
                </div>
                <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)", lineHeight: 1.25 }}>
                  {item.name}
                </div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>
                  {item.setCount}セット
                </div>
                <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, marginTop: 6 }}>
                  {item.setDetails}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: onOpenWorkout ? "1fr 1fr" : "1fr 1fr", gap: 10, marginTop: 18 }}>
            {onOpenWorkout ? (
              <button
                type="button"
                onClick={onOpenWorkout}
                style={{
                  padding: "13px 14px",
                  borderRadius: 16,
                  border: "1px solid rgba(18, 199, 194, 0.12)",
                  background: "rgba(18, 199, 194, 0.03)",
                  color: "var(--text2)",
                  fontSize: 14,
                  fontWeight: 800,
                }}
              >
                記録を開く
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: "13px 14px",
                  borderRadius: 16,
                  border: "1px solid rgba(18, 199, 194, 0.12)",
                  background: "rgba(18, 199, 194, 0.03)",
                  color: "var(--text2)",
                  fontSize: 14,
                  fontWeight: 800,
                }}
              >
                閉じる
              </button>
            )}
            <button
              type="button"
              onClick={summary.isShared ? undefined : onShare}
              disabled={summary.isShared || !onShare}
              style={{
                padding: "13px 14px",
                borderRadius: 16,
                border: summary.isShared
                  ? "1px solid rgba(18, 199, 194, 0.12)"
                  : "1px solid rgba(18, 199, 194, 0.18)",
                background: summary.isShared
                  ? "rgba(18, 199, 194, 0.07)"
                  : "linear-gradient(135deg, #12C7C2, #33E1DB)",
                color: summary.isShared ? "var(--text2)" : "#fff",
                fontSize: 14,
                fontWeight: 800,
                boxShadow: summary.isShared ? "none" : "0 14px 26px rgba(18, 199, 194, 0.18)",
                opacity: summary.isShared || !onShare ? 1 : 1,
              }}
            >
              {summary.isShared ? "投稿済み" : "フィードにシェア"}
            </button>
          </div>

          {onOpenWorkout && (
            <button
              type="button"
              onClick={onClose}
              style={{
                width: "100%",
                marginTop: 10,
                padding: "12px 14px",
                borderRadius: 16,
                border: "1px solid rgba(18, 199, 194, 0.12)",
                background: "rgba(18, 199, 194, 0.03)",
                color: "var(--text3)",
                fontSize: 13,
                fontWeight: 800,
              }}
            >
              閉じる
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
