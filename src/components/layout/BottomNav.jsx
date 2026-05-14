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
                        gap: 2,
                        padding: "5px 0 4px",
                        minHeight: 54,
                        borderRadius: 14,
                    }}
                >
                    <div
                        style={{
                            fontSize: 18,
                            width: 30,
                            height: 30,
                            borderRadius: 15,
                            display: "grid",
                            placeItems: "center",
                            background: activeTab === tab.id ? "rgba(18, 199, 194, 0.12)" : "transparent",
                        }}
                    >
                        {tab.icon}
                    </div>
                    <div style={{ fontSize: 9, lineHeight: 1.1, fontWeight: activeTab === tab.id ? 800 : 600 }}>{tab.label}</div>
                </button>
            ))}
        </div>
    );
}
