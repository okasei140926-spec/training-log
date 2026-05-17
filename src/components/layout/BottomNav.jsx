import { S } from "../../utils/styles";

function NavIcon({ id, active }) {
    const stroke = active ? "var(--accent)" : "var(--text3)";
    const common = {
        width: 24,
        height: 24,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke,
        strokeWidth: 2.2,
        strokeLinecap: "round",
        strokeLinejoin: "round",
    };

    if (id === "history") return (
        <svg {...common}><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9 21v-6h6v6"/></svg>
    );
    if (id === "analytics") return (
        <svg {...common}><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-8"/><path d="M22 20V7"/></svg>
    );
    if (id === "feed") return (
        <svg {...common}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 9h8"/><path d="M8 13h5"/></svg>
    );
    if (id === "ai") return (
        <svg {...common}><path d="M12 3a8 8 0 0 0-8 8v3a4 4 0 0 0 4 4h1v3h6v-3h1a4 4 0 0 0 4-4v-3a8 8 0 0 0-8-8z"/><path d="M9 11h.01"/><path d="M15 11h.01"/><path d="M9 15h6"/></svg>
    );

    return null;
}

function DumbbellIcon() {
    return (
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 8v8"/>
            <path d="M18 8v8"/>
            <path d="M3 9v6"/>
            <path d="M21 9v6"/>
            <path d="M6 12h12"/>
        </svg>
    );
}

export default function BottomNav({ tabs, activeTab, onSelectTab, isRecording }) {
    return (
        <div style={S.bottomNav}>
            <div style={S.bottomNavInner}>
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
                                    justifyContent: "center",
                                    background: "transparent",
                                    border: "none",
                                    padding: 0,
                                }}
                            >
                                <div style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: "50%",
                                    background: "linear-gradient(135deg, var(--accent), var(--accent2))",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    boxShadow: "0 8px 26px rgba(18,199,194,0.32)",
                                    position: "relative",
                                    top: -2,
                                    border: "1px solid rgba(255,255,255,0.26)",
                                }}>
                                    {isRecording ? (
                                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                            <div style={{
                                                width: 8,
                                                height: 8,
                                                borderRadius: "50%",
                                                background: "#ff4444",
                                                animation: "pulse 1.2s infinite",
                                            }} />
                                            <span style={{ fontSize: 10, fontWeight: 900, color: "#fff", letterSpacing: 0.5 }}>REC</span>
                                        </div>
                                    ) : (
                                        <DumbbellIcon />
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
                                justifyContent: "flex-end",
                                gap: 2,
                                height: 34,
                                padding: 0,
                                borderRadius: 14,
                                border: "none",
                            }}
                        >
                            <div style={{
                                width: 28,
                                height: 20,
                                borderRadius: 14,
                                display: "grid",
                                placeItems: "center",
                                background: isActive ? "rgba(18,199,194,0.16)" : "transparent",
                                border: isActive ? "1px solid rgba(18,199,194,0.22)" : "1px solid transparent",
                                boxShadow: isActive ? "0 6px 14px rgba(18,199,194,0.10)" : "none",
                            }}>
                                <NavIcon id={tab.id} active={isActive} />
                            </div>
                            <div style={{
                                fontSize: 7,
                                lineHeight: 1,
                                fontWeight: isActive ? 900 : 650,
                                color: isActive ? "var(--accent)" : "var(--text3)",
                                paddingBottom: 1,
                            }}>
                                {tab.label}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
