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
                        gap: 3,
                        padding: "8px 0 6px",
                        borderRadius: 18,
                    }}
                >
                    <div
                        style={{
                            fontSize: 19,
                            width: 34,
                            height: 34,
                            borderRadius: 17,
                            display: "grid",
                            placeItems: "center",
                            background: activeTab === tab.id ? "rgba(18, 199, 194, 0.12)" : "transparent",
                        }}
                    >
                        {tab.icon}
                    </div>
                    <div style={{ fontSize: 10, fontWeight: activeTab === tab.id ? 800 : 600 }}>{tab.label}</div>
                </button>
            ))}
        </div>
    );
}
