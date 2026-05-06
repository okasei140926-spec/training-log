import React from "react";

const pad2 = (value) => String(Math.max(0, Number(value) || 0)).padStart(2, "0");
const formatFinishedDuration = (totalSec) => {
  const totalMin = Math.floor(totalSec / 60);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;

  if (hours <= 0) return `${totalMin}分`;
  return `${hours}時間${minutes}分`;
};

export default function WorkoutElapsedTimer({
  elapsedSec = 0,
  status = "idle",
  onClick,
}) {
  const totalSec = Math.max(0, Math.floor(Number(elapsedSec) || 0));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  const isPaused = status === "paused";
  const isFinished = status === "finished";
  const label = isFinished
    ? `完了 ${formatFinishedDuration(totalSec)}`
    : `${isPaused ? "一時停止" : "時間"} ${pad2(minutes)}:${pad2(seconds)}`;

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        background: isFinished
          ? "linear-gradient(180deg, rgba(255, 146, 39, 0.14), rgba(255, 146, 39, 0.06))"
          : isPaused
            ? "linear-gradient(180deg, rgba(15, 94, 99, 0.12), rgba(15, 94, 99, 0.05))"
            : "linear-gradient(180deg, rgba(18, 199, 194, 0.085), rgba(18, 199, 194, 0.04))",
        border: isFinished
          ? "1px solid rgba(255, 146, 39, 0.2)"
          : isPaused
            ? "1px solid rgba(15, 94, 99, 0.2)"
            : "1px solid rgba(18, 199, 194, 0.16)",
        color: isFinished ? "#8A4A12" : isPaused ? "#0A3F44" : "#0F5E63",
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1,
        boxShadow: "0 8px 18px rgba(15, 94, 99, 0.06)",
        whiteSpace: "nowrap",
        cursor: "pointer",
        borderWidth: 0,
      }}
    >
      <span style={{ fontSize: 12 }}>{isFinished ? "✓" : "⏱"}</span>
      <span>{label}</span>
    </button>
  );
}
