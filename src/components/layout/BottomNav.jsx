import { S } from "../../utils/styles";

export default function BottomNav({ tabs, activeTab, onSelectTab, isRecording }) {
    return (
        <div style={S.bottomNav}>
            <div style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                width: "100%",
                maxWidth: 430,
                margin: "0 auto",
                padding: "0 4px",
            }}>
                {tabs.map((tab) => {
                    const isCenter = tab.id === "log";
                    const isActive = activeTab === tab.id;

                    if (isCenter) {
                        return (
                            <button
                                key={tab.id}
                                onClick={() => onSelectTab(tab.id)}
                                style={{
                                    flex: 1,
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    justifyContent: "flex-end",
                                    background: "transparent",
                                    border: "none",
                                    paddingBottom: 6,
                                }}
                            >
                                <div style={{
                                    width: 54,
                                    height: 54,
                                    borderRadius: "50%",
                                    background: "linear-gradient(135deg, var(--accent), var(--accent2))",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    boxShadow: "0 4px 18px rgba(18,199,194,0.45)",
                                    position: "relative",
                                    top: -8,
                                }}>
                                    {isRecording ? (
                                        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                                            <div style={{
                                                width: 8,
                                                height: 8,
                                                borderRadius: "50%",
                                                background: "#ff4444",
                                                animation: "pulse 1.2s infinite",
                                            }} />
                                            <span style={{ fontSize: 9, fontWeight: 900, color: "#fff", letterSpacing: 0.5 }}>REC</span>
                                        </div>
                                    ) : (
                                        <span style={{ fontSize: 22 }}>🏋️</span>
                                    )}
                                </div>
                            </button>
                        );
                    }

                    return (
                        <button
                            key={tab.id}
                            onClick={() => onSelectTab(tab.id)}
                            style={{
                                flex: 1,
                                background: "transparent",
                                color: isActive ? "var(--accent)" : "var(--text3)",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 1,
                                height: 48,
                                padding: "2px 0 1px",
                                borderRadius: 10,
                                border: "none",
                            }}
                        >
                            <div style={{
                                fontSize: 18,
                                width: 26,
                                height: 26,
                                borderRadius: 13,
                                display: "grid",
                                placeItems: "center",
                                background: isActive ? "rgba(18,199,194,0.12)" : "transparent",
                            }}>
                                {tab.icon}
                            </div>
                            <div style={{ fontSize: 9, lineHeight: 1, fontWeight: isActive ? 800 : 600 }}>
                                {tab.label}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
