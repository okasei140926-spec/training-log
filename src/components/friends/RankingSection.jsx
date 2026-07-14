// src/components/friends/RankingSection.jsx
import React, { useState } from "react";
import RankAvatar from "./RankAvatar";

const getRankAccentColor = (rankIndex) => {
    if (rankIndex === 0) return "#C88A1A";
    if (rankIndex === 1) return "#7E99A5";
    if (rankIndex === 2) return "#B66B36";
    return "var(--text3)";
};

const RANKING_TABS = [
    { key: "big3", label: "BIG3" },
    { key: "consistency", label: "継続" },
    { key: "monthly", label: "Volume" },
];

const VOLUME_PERIOD_TABS = [
    { key: "thisMonth", label: "今月" },
    { key: "lastMonth", label: "先月" },
];

function RankingSection({
    rankingTab,
    setRankingTab,
    myRankingSummary,
    activeRanking,
    friendsRefreshing,
    volumePeriod,
    setVolumePeriod,
    volumePeriodRange,
    shouldShowRankingLoading,
    topThreeRanking,
    podiumOrder,
    setSelectedBig3Entry,
    compactRankingRows,
    removeFriend,
}) {
    const [removingId, setRemovingId] = useState(null);

    const handleRemoveFriend = async (entry) => {
        const confirmed = window.confirm(`${entry.name} をフレンドから削除しますか？`);
        if (!confirmed) return;
        setRemovingId(entry.id);
        await removeFriend(entry.id);
        setRemovingId(null);
    };

    return (
        <>
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: 8,
                    padding: 3,
                    marginBottom: 10,
                    borderRadius: 16,
                    background: "linear-gradient(180deg, rgba(15, 94, 99, 0.06), rgba(18, 199, 194, 0.02))",
                    border: "1px solid rgba(18, 199, 194, 0.12)",
                }}
            >
                {RANKING_TABS.map((tab) => {
                    const selected = rankingTab === tab.key;
                    return (
                        <button
                            key={tab.key}
                            type="button"
                            onClick={() => setRankingTab(tab.key)}
                            style={{
                                minWidth: 0,
                                padding: "10px 8px",
                                borderRadius: 13,
                                border: selected ? "1px solid rgba(255,255,255,0.8)" : "1px solid transparent",
                                background: selected
                                    ? "linear-gradient(135deg, #0F5E63, #12C7C2)"
                                    : "rgba(255,255,255,0.58)",
                                color: selected ? "#fff" : "var(--text2)",
                                fontSize: 12,
                                fontWeight: 900,
                                boxShadow: selected
                                    ? "0 12px 24px rgba(18, 199, 194, 0.22), inset 0 1px 0 rgba(255,255,255,0.35)"
                                    : "inset 0 1px 0 rgba(255,255,255,0.75)",
                            }}
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {myRankingSummary && (
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        alignItems: "center",
                        gap: 10,
                        background: "linear-gradient(135deg, rgba(255,255,255,0.96), rgba(18, 199, 194, 0.08))",
                        borderRadius: 18,
                        padding: "11px 13px",
                        marginBottom: 10,
                        border: "1px solid rgba(18, 199, 194, 0.14)",
                        boxShadow: "0 12px 26px rgba(15, 94, 99, 0.08)",
                    }}
                >
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 900, color: "var(--text3)", marginBottom: 2 }}>
                            あなたの順位
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 950, color: "var(--text)", lineHeight: 1.15 }}>
                            {myRankingSummary.headline}
                        </div>
                    </div>
                    <div style={{ textAlign: "right", minWidth: 104 }}>
                        <div style={{ fontSize: 18, fontWeight: 950, color: "var(--accent)", lineHeight: 1.1 }}>
                            {myRankingSummary.metric}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 4, whiteSpace: "nowrap" }}>
                            {myRankingSummary.note}
                        </div>
                    </div>
                </div>
            )}

            <div
                style={{
                    background: "var(--card)",
                    borderRadius: 20,
                    padding: 12,
                    border: "1px solid var(--border2)",
                    boxShadow: "var(--shadow-card)",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                    <div>
                        <div style={{ fontSize: 15, fontWeight: 950, color: "var(--text)", lineHeight: 1.2 }}>
                            {activeRanking.description}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>
                            {rankingTab === "big3"
                                ? "通算PRの合計"
                                : rankingTab === "monthly"
                                    ? `集計期間 ${volumePeriodRange.display}`
                                    : "順位・ユーザー・数値"}
                        </div>
                    </div>
                    {friendsRefreshing && (
                        <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 800, flexShrink: 0 }}>
                            更新中...
                        </div>
                    )}
                </div>

                {rankingTab === "monthly" && (
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                            gap: 6,
                            padding: 3,
                            marginBottom: 10,
                            borderRadius: 14,
                            background: "rgba(15, 94, 99, 0.04)",
                            border: "1px solid rgba(18, 199, 194, 0.10)",
                        }}
                    >
                        {VOLUME_PERIOD_TABS.map((period) => {
                            const selected = volumePeriod === period.key;
                            return (
                                <button
                                    key={period.key}
                                    type="button"
                                    onClick={() => setVolumePeriod(period.key)}
                                    style={{
                                        minWidth: 0,
                                        padding: "8px 10px",
                                        borderRadius: 11,
                                        border: selected ? "1px solid rgba(255,255,255,0.8)" : "1px solid transparent",
                                        background: selected
                                            ? "linear-gradient(135deg, #0F5E63, #12C7C2)"
                                            : "rgba(255,255,255,0.66)",
                                        color: selected ? "#fff" : "var(--text2)",
                                        fontSize: 12,
                                        fontWeight: 900,
                                        boxShadow: selected ? "0 10px 18px rgba(18, 199, 194, 0.16)" : "none",
                                    }}
                                >
                                    {period.label}
                                </button>
                            );
                        })}
                    </div>
                )}

                {shouldShowRankingLoading ? (
                    <div style={{ textAlign: "center", padding: 26, color: "var(--text2)", fontSize: 14 }}>読み込み中...</div>
                ) : (
                    <>
                        {rankingTab === "big3" && topThreeRanking.length > 0 && (
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "1fr 1.18fr 1fr",
                                    alignItems: "end",
                                    gap: 7,
                                    minHeight: 168,
                                    marginBottom: 10,
                                    padding: "8px 4px 0",
                                }}
                            >
                                {podiumOrder.map((entry) => {
                                    const rankIndex = activeRanking.data.findIndex((item) => item.id === entry.id);
                                    const isChampion = rankIndex === 0;
                                    return (
                                        <button
                                            type="button"
                                            onClick={() => setSelectedBig3Entry(entry)}
                                            key={`podium-${entry.id}`}
                                            style={{
                                                appearance: "none",
                                                border: "none",
                                                background: "transparent",
                                                padding: 0,
                                                minWidth: 0,
                                                width: "100%",
                                                textAlign: "center",
                                                transform: isChampion ? "translateY(-8px)" : "none",
                                                cursor: "pointer",
                                            }}
                                            aria-label={`${entry.name}のBIG3内訳を見る`}
                                        >
                                            <div style={{ fontSize: isChampion ? 24 : 18, lineHeight: 1, marginBottom: 4 }}>
                                                {rankIndex === 0 ? "♛" : rankIndex === 1 ? "2" : "3"}
                                            </div>
                                            <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
                                                <RankAvatar entry={entry} size={isChampion ? 58 : 46} />
                                            </div>
                                            <div style={{ fontSize: isChampion ? 13 : 12, fontWeight: 950, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                {entry.name}
                                            </div>
                                            <div style={{ fontSize: isChampion ? 18 : 15, fontWeight: 950, color: isChampion ? "var(--accent)" : "var(--text)", marginTop: 2 }}>
                                                {activeRanking.metricLabel(entry)}
                                            </div>
                                            <div
                                                style={{
                                                    height: isChampion ? 54 : rankIndex === 1 ? 40 : 34,
                                                    marginTop: 7,
                                                    borderRadius: "13px 13px 6px 6px",
                                                    background: isChampion
                                                        ? "linear-gradient(180deg, rgba(18, 199, 194, 0.28), rgba(15, 94, 99, 0.18))"
                                                        : "linear-gradient(180deg, rgba(15, 94, 99, 0.10), rgba(18, 199, 194, 0.06))",
                                                    border: `1px solid ${isChampion ? "rgba(18, 199, 194, 0.32)" : "rgba(15, 94, 99, 0.12)"}`,
                                                    display: "grid",
                                                    placeItems: "center",
                                                    color: getRankAccentColor(rankIndex),
                                                    fontSize: 14,
                                                    fontWeight: 950,
                                                    boxShadow: isChampion ? "0 14px 28px rgba(18, 199, 194, 0.16)" : "none",
                                                }}
                                            >
                                                {rankIndex + 1}位
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        <div style={{ display: "grid", gap: 6 }}>
                            {compactRankingRows.map((entry) => {
                                const index = activeRanking.data.findIndex((item) => item.id === entry.id);
                                return (
                                    <div
                                        key={`${rankingTab}-${entry.id}`}
                                        style={{
                                            minHeight: 52,
                                            display: "grid",
                                            gridTemplateColumns: entry.isMe ? "38px minmax(0, 1fr) auto" : "38px minmax(0, 1fr) auto 28px",
                                            alignItems: "center",
                                            gap: 8,
                                            padding: "7px 10px",
                                            borderRadius: 14,
                                            background: entry.isMe
                                                ? "linear-gradient(90deg, rgba(18, 199, 194, 0.12), rgba(255,255,255,0.9))"
                                                : "rgba(255,255,255,0.72)",
                                            border: entry.isMe
                                                ? "1px solid rgba(18, 199, 194, 0.24)"
                                                : "1px solid rgba(217, 228, 239, 0.78)",
                                            boxShadow: index === 0 && rankingTab !== "big3" ? "0 10px 20px rgba(18, 199, 194, 0.12)" : "none",
                                            opacity: entry.value > 0 ? 1 : 0.72,
                                        }}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                            <span style={{ fontSize: index < 3 ? 15 : 12, lineHeight: 1 }}>
                                                {index === 0 ? "♛" : ""}
                                            </span>
                                            <span style={{ fontSize: 13, fontWeight: 950, color: getRankAccentColor(index), fontVariantNumeric: "tabular-nums" }}>
                                                {index + 1}
                                            </span>
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                            <RankAvatar entry={entry} size={30} />
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ fontSize: 13, fontWeight: 950, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.2 }}>
                                                    {entry.name}
                                                </div>
                                                <div style={{ fontSize: 10.5, color: "var(--text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                                                    {activeRanking.detailLabel(entry)}
                                                </div>
                                            </div>
                                        </div>
                                        <div style={{ fontSize: 16, fontWeight: 950, color: "var(--text)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                                            {activeRanking.metricLabel(entry)}
                                        </div>
                                        {!entry.isMe && (
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveFriend(entry)}
                                                disabled={removingId === entry.id}
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    width: 28,
                                                    height: 28,
                                                    borderRadius: 8,
                                                    border: "none",
                                                    background: "transparent",
                                                    color: "var(--text3)",
                                                    fontSize: 16,
                                                    cursor: "pointer",
                                                    padding: 0,
                                                    opacity: removingId === entry.id ? 0.4 : 1,
                                                }}
                                            >
                                                ···
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>

        </>
    );
}

export default RankingSection;
