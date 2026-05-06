import React from "react";

const pad2 = (value) => String(Math.max(0, Number(value) || 0)).padStart(2, "0");

export default function WorkoutElapsedTimer({ elapsedSec = 0 }) {
  const totalSec = Math.max(0, Math.floor(Number(elapsedSec) || 0));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        background: "linear-gradient(180deg, rgba(18, 199, 194, 0.085), rgba(18, 199, 194, 0.04))",
        border: "1px solid rgba(18, 199, 194, 0.16)",
        color: "#0F5E63",
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1,
        boxShadow: "0 8px 18px rgba(15, 94, 99, 0.06)",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontSize: 12 }}>⏱</span>
      <span>経過時間 {pad2(minutes)}:{pad2(seconds)}</span>
    </div>
  );
}
