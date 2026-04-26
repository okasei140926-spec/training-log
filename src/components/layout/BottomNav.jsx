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
                        background: "none",
                        color: activeTab === tab.id ? "var(--text)" : "var(--text3)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 4,
                        padding: "4px 0",
                    }}
                >
                    <div style={{ fontSize: 20 }}>{tab.icon}</div>
                    <div style={{ fontSize: 9, fontWeight: activeTab === tab.id ? 700 : 400 }}>{tab.label}</div>
                </button>
            ))}
        </div>
    );
}
