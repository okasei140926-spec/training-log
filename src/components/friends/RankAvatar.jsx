import React from "react";

function RankAvatar({ entry, size = 34 }) {
    return (
        <div
            style={{
                width: size,
                height: size,
                borderRadius: "50%",
                overflow: "hidden",
                flexShrink: 0,
                display: "grid",
                placeItems: "center",
                background: entry?.isMe
                    ? "linear-gradient(135deg, #0F5E63, #12C7C2)"
                    : "linear-gradient(135deg, rgba(15, 94, 99, 0.12), rgba(18, 199, 194, 0.24))",
                border: "2px solid rgba(255, 255, 255, 0.9)",
                boxShadow: "0 8px 18px rgba(15, 94, 99, 0.14)",
                color: entry?.isMe ? "#fff" : "var(--text)",
                fontSize: Math.max(11, Math.round(size * 0.36)),
                fontWeight: 900,
            }}
        >
            {entry?.avatarUrl
                ? <img src={entry.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : String(entry?.name || "U").slice(0, 1)}
        </div>
    );
}

export default RankAvatar;
