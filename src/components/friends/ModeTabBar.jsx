import React from "react";

function ModeTabBar({ localMode, setLocalMode }) {
    return (
        <div style={{
            display: "flex",
            background: "var(--card)",
            borderRadius: 16,
            padding: 4,
            gap: 4,
            border: "1px solid var(--border2)",
            marginBottom: 4,
        }}>
            <button
                onClick={() => setLocalMode("feed")}
                style={{
                    flex: 1,
                    padding: "10px 0",
                    borderRadius: 12,
                    fontSize: 13,
                    fontWeight: 800,
                    border: "none",
                    background: localMode === "feed" ? "var(--accent)" : "transparent",
                    color: localMode === "feed" ? "#fff" : "var(--text3)",
                    cursor: "pointer",
                }}
            >アクティビティ</button>
            <button
                onClick={() => setLocalMode("ranking")}
                style={{
                    flex: 1,
                    padding: "10px 0",
                    borderRadius: 12,
                    fontSize: 13,
                    fontWeight: 800,
                    border: "none",
                    background: localMode === "ranking" ? "var(--accent)" : "transparent",
                    color: localMode === "ranking" ? "#fff" : "var(--text3)",
                    cursor: "pointer",
                }}
            >ランキング</button>
        </div>
    );
}

export default ModeTabBar;
