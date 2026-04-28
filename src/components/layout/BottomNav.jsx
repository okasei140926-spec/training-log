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
                        background: activeTab === tab.id ? "linear-gradient(180deg, var(--success-soft), transparent)" : "none",
                        color: activeTab === tab.id ? "var(--accent)" : "var(--text3)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 4,
                        padding: "6px 0 4px",
                        borderRadius: 16,
                    }}
                >
                    <div style={{ fontSize: 20 }}>{tab.icon}</div>
                    <div style={{ fontSize: 9, fontWeight: activeTab === tab.id ? 800 : 500 }}>{tab.label}</div>
                </button>
            ))}
        </div>
    );
}
