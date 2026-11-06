import React from "react";
import { formatWorkoutDuration } from "../utils/workoutTimer";

const pad2 = (value) => String(Math.max(0, Number(value) || 0)).padStart(2, "0");

export default function WorkoutElapsedTimer({
  elapsedSec = 0,
  status = "idle",
  onClick,
}) {
  const totalSec = Math.max(0, Math.floor(Number(elapsedSec) || 0));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  const isFinished = status === "finished";
  const isActive = status === "active";
  const label = isFinished
    ? formatWorkoutDuration(totalSec)
    : `${pad2(minutes)}:${pad2(seconds)}`;
  const isInteractive = typeof onClick === "function" && isActive;

  return (
    <button
      type="button"
      onClick={isInteractive ? onClick : undefined}
      aria-disabled={!isInteractive}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        background: isFinished
          ? "linear-gradient(180deg, rgba(255, 146, 39, 0.14), rgba(255, 146, 39, 0.06))"
          : "linear-gradient(180deg, rgba(18, 199, 194, 0.085), rgba(18, 199, 194, 0.04))",
        border: isFinished
          ? "1px solid rgba(255, 146, 39, 0.2)"
          : "1px solid rgba(18, 199, 194, 0.16)",
        color: isFinished ? "#8A4A12" : "#0F5E63",
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1,
        boxShadow: "0 8px 18px rgba(15, 94, 99, 0.06)",
        whiteSpace: "nowrap",
        cursor: isInteractive ? "pointer" : "default",
      }}
    >
      <span style={{ fontSize: 12 }}>{isFinished ? "✅" : "⏱"}</span>
      <span>{label}</span>
      {isInteractive && <span style={{ fontSize: 12, opacity: 0.7 }}>…</span>}
    </button>
  );
}
