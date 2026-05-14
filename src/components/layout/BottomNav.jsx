import { S } from "../../utils/styles";

export default function BottomNav({ tabs, activeTab, onSelectTab }) {
    return (
        <div style={S.bottomNav}>
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    onClick={() => onSelectTab(tab.id)}
                    style={{
                        flex: 1,
                        background: activeTab === tab.id ? "linear-gradient(135deg, rgba(18,199,194,0.14), rgba(51,225,219,0.04))" : "transparent",
                        color: activeTab === tab.id ? "var(--accent)" : "var(--text3)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 1,
                        padding: "3px 0 2px",
                        minHeight: 44,
                        borderRadius: 12,
                    }}
                >
                    <div
                        style={{
                            fontSize: 18,
                            width: 26,
                            height: 26,
                            borderRadius: 13,
                            display: "grid",
                            placeItems: "center",
                            background: activeTab === tab.id ? "rgba(18, 199, 194, 0.12)" : "transparent",
                        }}
                    >
                        {tab.icon}
                    </div>
                    <div style={{ fontSize: 8.5, lineHeight: 1.05, fontWeight: activeTab === tab.id ? 800 : 600 }}>{tab.label}</div>
                </button>
            ))}
        </div>
    );
}
