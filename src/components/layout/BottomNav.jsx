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
                        alignSelf: "flex-start",
                        height: 44,
                        minHeight: 44,
                        padding: "2px 0 1px",
                        borderRadius: 10,
                    }}
                >
                    <div
                        style={{
                            fontSize: 17,
                            width: 24,
                            height: 24,
                            borderRadius: 12,
                            display: "grid",
                            placeItems: "center",
                            background: activeTab === tab.id ? "rgba(18, 199, 194, 0.12)" : "transparent",
                        }}
                    >
                        {tab.icon}
                    </div>
                    <div style={{ fontSize: 8, lineHeight: 1, fontWeight: activeTab === tab.id ? 800 : 600 }}>{tab.label}</div>
                </button>
            ))}
        </div>
    );
}
