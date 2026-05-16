import { S } from "../../utils/styles";

export default function BottomNav({ tabs, activeTab, onSelectTab }) {
    return (
        <div style={S.bottomNav}>
            {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                const isPrimary = Boolean(tab.primary);
                const isRecording = Boolean(tab.recording);

                return (
                    <button
                        key={tab.id}
                        onClick={() => onSelectTab(tab.id)}
                        style={{
                            flex: 1,
                            background: isActive && !isPrimary ? "linear-gradient(135deg, rgba(18,199,194,0.14), rgba(51,225,219,0.04))" : "transparent",
                            color: isRecording ? "#ef4444" : isActive ? "var(--accent)" : "var(--text3)",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: isPrimary ? 3 : 1,
                            alignSelf: "flex-start",
                            height: isPrimary ? 52 : 44,
                            minHeight: isPrimary ? 52 : 44,
                            padding: isPrimary ? "0" : "2px 0 1px",
                            borderRadius: isPrimary ? 999 : 10,
                            transform: isPrimary ? "translateY(-8px)" : "none",
                        }}
                    >
                        <div
                            style={{
                                fontSize: isPrimary ? 21 : 17,
                                width: isPrimary ? 46 : 24,
                                height: isPrimary ? 46 : 24,
                                borderRadius: isPrimary ? 999 : 12,
                                display: "grid",
                                placeItems: "center",
                                background: isPrimary
                                    ? isRecording
                                        ? "linear-gradient(135deg, rgba(239,68,68,0.95), rgba(251,113,133,0.85))"
                                        : "linear-gradient(135deg, var(--accent), var(--accent2))"
                                    : isActive
                                        ? "rgba(18, 199, 194, 0.12)"
                                        : "transparent",
                                color: isPrimary ? "#fff" : "inherit",
                                boxShadow: isPrimary ? "0 14px 24px rgba(18,199,194,0.24)" : "none",
                                border: isPrimary ? "1px solid rgba(255,255,255,0.18)" : "none",
                            }}
                        >
                            {tab.icon}
                        </div>
                        <div
                            style={{
                                fontSize: isPrimary ? 8 : 8,
                                lineHeight: 1,
                                fontWeight: isActive || isPrimary ? 800 : 600,
                                letterSpacing: isPrimary ? 0.4 : 0,
                            }}
                        >
                            {tab.label}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}
