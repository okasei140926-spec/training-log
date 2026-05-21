import { useMemo, useRef, useState } from "react";
import { sanitizeHistoryRecord } from "../utils/helpers";

const HEADER_OFFSET = 72;
const BOTTOM_NAV_OFFSET = 104;
const AI_VIEWPORT_HEIGHT = `calc(100dvh - ${HEADER_OFFSET}px - ${BOTTOM_NAV_OFFSET}px - var(--safe-top) - var(--safe-bottom))`;
const FOOTER_SAFE_PADDING = "calc(8px + var(--safe-bottom))";

const AI_SUGGESTIONS = [
    { label: "胸メニュー組んで", prompt: "胸メニュー組んで" },
    { label: "今日の記録分析", prompt: "今日の記録を分析して" },
    { label: "昨日の記録分析", prompt: "昨日の記録を分析して" },
    { label: "BIG3伸ばしたい", prompt: "BIG3を伸ばしたい" },
    { label: "減量中メニュー", prompt: "減量中のメニューを作って" },
    { label: "肩メニュー作成", prompt: "肩メニューを作成して" },
];

const formatDateLabel = (dateKey) => {
    if (!dateKey) return "";
    const [year, month, day] = String(dateKey).split("-");
    if (!year || !month || !day) return dateKey;
    return `${month}/${day}`;
};

const buildAiOverview = (history) => {
    const flattened = [];

    Object.entries(history || {}).forEach(([exerciseName, records]) => {
        (records || []).forEach((record) => {
            const sanitized = sanitizeHistoryRecord(record, { allowBodyweight: true });
            if (!sanitized?.date || !sanitized.sets?.length) return;
            flattened.push({
                exerciseName,
                date: sanitized.date,
                bodyPart: sanitized.bodyPart || "その他",
                setCount: sanitized.sets.length,
            });
        });
    });

    const uniqueDates = Array.from(new Set(flattened.map((entry) => entry.date))).sort();
    const latestDate = uniqueDates[uniqueDates.length - 1] || "";
    const latestEntries = flattened.filter((entry) => entry.date === latestDate);

    const partMap = latestEntries.reduce((acc, entry) => {
        acc[entry.bodyPart] = (acc[entry.bodyPart] || 0) + entry.setCount;
        return acc;
    }, {});

    const partSummary = Object.entries(partMap)
        .map(([bodyPart, count]) => ({ bodyPart, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 2);

    const latestSummary = partSummary.length
        ? partSummary.map((item) => `${item.bodyPart}${item.count}セット`).join(" / ")
        : "最近の記録";

    const recommendation = latestDate
        ? `${formatDateLabel(latestDate)}は${latestSummary}でした。${
            partSummary[0]
                ? `${partSummary[0].bodyPart}を続けるならメイン1種目と補助2種目、別部位なら回復している部位を優先するのがおすすめです。`
                : "メニュー提案やフォーム相談、重量相談ができます。"
        }`
        : "最近の記録をもとに、メニュー提案・フォーム相談・重量相談ができます。";

    return {
        trainingDays: uniqueDates.length,
        latestDate,
        latestSummary,
        recommendation,
    };
};

const CompactBubble = ({ children, role }) => (
    <div style={{ display: "flex", justifyContent: role === "user" ? "flex-end" : "flex-start" }}>
        <div
            style={{
                maxWidth: "84%",
                padding: role === "user" ? "11px 14px" : "12px 14px",
                fontSize: 13,
                lineHeight: 1.5,
                borderRadius: role === "user" ? "18px 18px 6px 18px" : "18px 18px 18px 6px",
                background:
                    role === "user"
                        ? "linear-gradient(135deg, var(--accent), var(--accent2))"
                        : "linear-gradient(180deg, rgba(18, 199, 194, 0.12), rgba(18, 199, 194, 0.06))",
                color: role === "user" ? "#fff" : "var(--text)",
                border: role === "assistant" ? "1px solid rgba(18, 199, 194, 0.12)" : "none",
                boxShadow: role === "user" ? "var(--shadow-soft)" : "0 10px 18px rgba(15,94,99,0.06)",
            }}
        >
            {children}
        </div>
    </div>
);

const ProPaywallCard = ({ onStartPro, aiUsageCount, dailyFreeAiLimit }) => (
    <div
        style={{
            position: "relative",
            overflow: "hidden",
            padding: 16,
            borderRadius: 22,
            background:
                "radial-gradient(circle at 82% 10%, rgba(51, 225, 219, 0.30), transparent 34%), linear-gradient(145deg, rgba(8, 28, 32, 0.96), rgba(13, 63, 68, 0.92) 52%, rgba(18, 199, 194, 0.20))",
            border: "1px solid rgba(51, 225, 219, 0.28)",
            color: "var(--text)",
            boxShadow: "0 18px 38px rgba(15, 94, 99, 0.20)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
        }}
    >
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(255,255,255,0.08), transparent 42%)", pointerEvents: "none" }} />
        <div style={{ position: "relative", zIndex: 1 }}>
            <div
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 9px",
                    borderRadius: 999,
                    background: "rgba(51, 225, 219, 0.16)",
                    border: "1px solid rgba(51, 225, 219, 0.28)",
                    color: "#A7FFFB",
                    fontSize: 10,
                    fontWeight: 900,
                    letterSpacing: 1.2,
                    marginBottom: 10,
                }}
            >
                AI COACH PRO
            </div>
            <div style={{ fontSize: 22, fontWeight: 950, color: "#FFFFFF", lineHeight: 1.12, marginBottom: 8 }}>
                AI Coachをもっと使う
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.78)", lineHeight: 1.65 }}>
                無料相談は本日分を使い切りました。Pump Proなら、あなたの記録をもとにメニュー・重量・成長分析まで相談できます。
            </div>
        </div>
        <div style={{ position: "relative", zIndex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
            {[
                "今日のメニュー提案",
                "重量設定の相談",
                "記録分析",
                "弱点部位の改善提案",
                "Proシェアカード",
            ].map((feature) => (
                <div
                    key={feature}
                    style={{
                        padding: "9px 10px",
                        borderRadius: 12,
                        background: "rgba(255,255,255,0.09)",
                        border: "1px solid rgba(255,255,255,0.10)",
                        color: "rgba(255,255,255,0.84)",
                        fontSize: 11,
                        fontWeight: 800,
                        lineHeight: 1.35,
                    }}
                >
                    {feature}
                </div>
            ))}
            <div
                style={{
                    padding: "9px 10px",
                    borderRadius: 12,
                    background: "rgba(51, 225, 219, 0.18)",
                    border: "1px solid rgba(51, 225, 219, 0.26)",
                    color: "#FFFFFF",
                    fontSize: 11,
                    fontWeight: 900,
                    lineHeight: 1.35,
                }}
            >
                月額 ¥480
            </div>
        </div>
        <button
            type="button"
            onClick={onStartPro}
            className="pressable"
            style={{
                position: "relative",
                zIndex: 1,
                width: "100%",
                padding: "13px 14px",
                borderRadius: 18,
                border: "none",
                background: "linear-gradient(135deg, var(--accent), var(--accent2))",
                color: "#fff",
                fontSize: 15,
                fontWeight: 900,
                boxShadow: "0 14px 26px rgba(18, 199, 194, 0.26)",
            }}
        >
            Pump Proを始める
        </button>
        <div
            style={{
                position: "relative",
                zIndex: 1,
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                color: "rgba(255,255,255,0.58)",
                fontSize: 10,
                fontWeight: 800,
            }}
        >
            <span>今日の使用回数</span>
            <span>{aiUsageCount}/{dailyFreeAiLimit}</span>
        </div>
    </div>
);

export default function AIScreen({
    aiMsgs,
    aiInput,
    setAiInput,
    sendAI,
    aiLoad,
    aiEnd,
    history,
    isPro = false,
    onStartPro,
    dailyFreeAiLimit = 5,
    aiUsageCount = 0,
    aiRemaining,
}) {
    const inputRef = useRef(null);
    const [activeQuickAction, setActiveQuickAction] = useState("");

    const overview = useMemo(() => buildAiOverview(history), [history]);
    const isInitialState =
        aiMsgs.length === 1 &&
        aiMsgs[0]?.role === "assistant" &&
        !aiLoad;

    const visibleMessages = isInitialState ? [] : aiMsgs;
    const isAiLimitReached = !isPro && Number(aiRemaining) <= 0;
    const canSendMessage = !aiLoad && !isAiLimitReached;
    const showProPaywall = () => isAiLimitReached;

    const handleSend = (overrideMsg) => {
        if (!canSendMessage) return;
        const nextMessage = overrideMsg ?? aiInput;
        if (!nextMessage?.trim()) return;
        sendAI(overrideMsg);
        setTimeout(() => inputRef.current?.blur(), 50);
    };

    const handleSuggestion = ({ label, prompt }) => {
        if (isAiLimitReached) return;
        setActiveQuickAction(label);
        setAiInput(prompt);
        inputRef.current?.focus();
        setTimeout(() => setActiveQuickAction(""), 180);
    };

    return (
        <div
            className="fade-in"
            style={{
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                height: AI_VIEWPORT_HEIGHT,
                maxHeight: AI_VIEWPORT_HEIGHT,
                overflow: "hidden",
                background: "var(--bg)",
                padding: "0 16px 8px",
                gap: 8,
            }}
        >
            <div
                style={{
                    flexShrink: 0,
                    alignSelf: "flex-start",
                    padding: "6px 10px",
                    borderRadius: 999,
                    background: "rgba(18, 199, 194, 0.08)",
                    border: "1px solid rgba(18, 199, 194, 0.12)",
                    color: "var(--text2)",
                    fontSize: 11,
                    fontWeight: 700,
                }}
            >
                {isPro
                    ? "今日のAI相談 Pro 無制限"
                    : `今日のAI相談 残り${aiRemaining}回 / ${dailyFreeAiLimit}回`}
            </div>

            <div
                style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    padding: "8px 0 10px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                }}
            >
                {isInitialState && (
                    <>
                        <div
                            style={{
                                ...({
                                    background: "var(--card)",
                                    borderRadius: 20,
                                    border: "1px solid rgba(18, 199, 194, 0.1)",
                                    boxShadow: "var(--shadow-card)",
                                    padding: 16,
                                }),
                                display: "flex",
                                flexDirection: "column",
                                gap: 8,
                            }}
                        >
                            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.8, color: "var(--text3)" }}>
                                AI COACH
                            </div>
                            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.12, color: "var(--text)" }}>
                                今日の判断を、すぐに。
                            </div>
                            <div style={{ fontSize: 13, lineHeight: 1.65, color: "var(--text2)" }}>
                                メニュー提案・フォーム相談・重量相談ができます。
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                                {["胸メニュー組んで", "昨日の記録分析", "ベンチ伸ばしたい"].map((example) => (
                                    <div
                                        key={example}
                                        style={{
                                            padding: "6px 10px",
                                            borderRadius: 999,
                                            background: "rgba(18, 199, 194, 0.07)",
                                            border: "1px solid rgba(18, 199, 194, 0.12)",
                                            fontSize: 11,
                                            fontWeight: 700,
                                            color: "var(--text2)",
                                        }}
                                    >
                                        {example}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div
                            style={{
                                background: "linear-gradient(180deg, rgba(18, 199, 194, 0.12), rgba(18, 199, 194, 0.04))",
                                borderRadius: 18,
                                border: "1px solid rgba(18, 199, 194, 0.12)",
                                padding: 14,
                                display: "flex",
                                flexDirection: "column",
                                gap: 6,
                            }}
                        >
                            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.6, color: "var(--text3)" }}>
                                最近のおすすめ
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                                最近の記録 {overview.latestSummary}
                            </div>
                            <div style={{ fontSize: 12, lineHeight: 1.65, color: "var(--text2)" }}>
                                {overview.recommendation}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--text3)" }}>
                                継続日数 {overview.trainingDays}日
                            </div>
                        </div>
                    </>
                )}

                {visibleMessages.map((msg, i) => (
                    <CompactBubble key={i} role={msg.role}>
                        {msg.content}
                    </CompactBubble>
                ))}

                {aiLoad && (
                    <CompactBubble role="assistant">
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ display: "flex", gap: 4 }}>
                                {[0, 1, 2].map((item) => (
                                    <span
                                        key={item}
                                        style={{
                                            width: 6,
                                            height: 6,
                                            borderRadius: 999,
                                            background: "var(--accent)",
                                            opacity: 0.75,
                                            animation: `pulse 1s ${item * 0.12}s infinite`,
                                            display: "inline-block",
                                        }}
                                    />
                                ))}
                            </div>
                            <span style={{ fontSize: 12, color: "var(--text2)" }}>考えています…</span>
                        </div>
                    </CompactBubble>
                )}

                <div ref={aiEnd} />
            </div>

            <div
                style={{
                    flexShrink: 0,
                    display: "flex",
                    gap: 6,
                    overflowX: "auto",
                    padding: "2px 0 4px",
                    WebkitOverflowScrolling: "touch",
                }}
            >
                {AI_SUGGESTIONS.map(({ label, prompt }) => (
                    <button
                        key={label}
                        onClick={() => handleSuggestion({ label, prompt })}
                        disabled={isAiLimitReached}
                        className="pressable"
                        style={{
                            whiteSpace: "nowrap",
                            padding: "7px 11px",
                            borderRadius: 999,
                            background:
                                isAiLimitReached
                                    ? "linear-gradient(180deg, rgba(255,255,255,0.46), rgba(255,255,255,0.30))"
                                    : activeQuickAction === label
                                    ? "linear-gradient(135deg, rgba(18, 199, 194, 0.18), rgba(51, 225, 219, 0.12))"
                                    : "linear-gradient(180deg, var(--card2), var(--card))",
                            color: isAiLimitReached ? "var(--text4)" : activeQuickAction === label ? "var(--text)" : "var(--text2)",
                            fontSize: 11,
                            fontWeight: 800,
                            border: isAiLimitReached ? "1px solid rgba(18, 199, 194, 0.06)" : "1px solid rgba(18, 199, 194, 0.12)",
                            boxShadow: isAiLimitReached ? "none" : "var(--shadow-card)",
                            transform: activeQuickAction === label ? "scale(0.98)" : "scale(1)",
                            opacity: isAiLimitReached ? 0.50 : 1,
                            cursor: isAiLimitReached ? "not-allowed" : "pointer",
                        }}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <div
                style={{
                    flexShrink: 0,
                    padding: `9px 10px ${FOOTER_SAFE_PADDING}`,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    background: "var(--card)",
                    borderRadius: 20,
                    boxShadow: "var(--shadow-card)",
                    border: "1px solid rgba(18, 199, 194, 0.08)",
                }}
            >
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                        ref={inputRef}
                        value={aiInput}
                        onChange={(e) => setAiInput(e.target.value)}
                        disabled={isAiLimitReached}
                        onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            e.preventDefault();
                            handleSend();
                        }}
                        placeholder={isAiLimitReached ? "今日は無料相談を使い切りました" : "今日は背中の日なんだけど…"}
                        style={{
                            flex: 1,
                            padding: "11px 14px",
                            borderRadius: 20,
                            background: isAiLimitReached ? "rgba(139, 164, 168, 0.10)" : "var(--card2)",
                            border: isAiLimitReached ? "1px solid rgba(139, 164, 168, 0.18)" : "1px solid var(--border2)",
                            color: isAiLimitReached ? "var(--text3)" : "var(--text)",
                            fontSize: 13,
                            minHeight: 42,
                            boxShadow: "none",
                            opacity: isAiLimitReached ? 0.78 : 1,
                            cursor: isAiLimitReached ? "not-allowed" : "text",
                        }}
                    />
                    <button
                        onClick={() => handleSend()}
                        disabled={!canSendMessage}
                        className="pressable"
                        style={{
                            width: 44,
                            height: 44,
                            borderRadius: 22,
                            background: !canSendMessage ? "rgba(139, 164, 168, 0.22)" : "linear-gradient(135deg, var(--accent), var(--accent2))",
                            color: "#fff",
                            fontSize: 18,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            boxShadow: !canSendMessage ? "none" : "var(--shadow-soft)",
                            flexShrink: 0,
                            opacity: !canSendMessage ? 0.50 : 1,
                            cursor: !canSendMessage ? "not-allowed" : "pointer",
                        }}
                    >
                        ↑
                    </button>
                </div>
                {showProPaywall() && (
                    <ProPaywallCard
                        onStartPro={onStartPro}
                        aiUsageCount={aiUsageCount}
                        dailyFreeAiLimit={dailyFreeAiLimit}
                    />
                )}
                <div style={{ fontSize: 11, color: "var(--text3)", padding: "0 2px" }}>
                    今日は何をやるべきか、昨日の記録分析、フォーム相談などをそのまま聞けます。
                </div>
            </div>
        </div>
    );
}
