import { useRef, useState } from "react";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const formatConvDate = (isoStr) => {
    if (!isoStr) return "";
    const d = new Date(isoStr);
    return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS[d.getDay()]})`;
};

const HEADER_OFFSET = 72;
const AI_VIEWPORT_HEIGHT = `calc(100svh - ${HEADER_OFFSET}px - var(--safe-top, 0px) - var(--bottom-nav-height, 56px))`;

const AI_SUGGESTIONS = [
    { label: "胸メニュー組んで", prompt: "胸メニュー組んで" },
    { label: "今日の記録分析", prompt: "今日の記録を分析して" },
    { label: "昨日の記録分析", prompt: "昨日の記録を分析して" },
    { label: "BIG3伸ばしたい", prompt: "BIG3を伸ばしたい" },
    { label: "減量中メニュー", prompt: "減量中のメニューを作って" },
    { label: "肩メニュー作成", prompt: "肩メニューを作成して" },
];


const CompactBubble = ({ children, role }) => (
    <div style={{ display: "flex", justifyContent: role === "user" ? "flex-end" : "flex-start" }}>
        <div
            style={{
                maxWidth: role === "user" ? "80%" : "92%",
                padding: role === "user" ? "11px 14px" : "12px 14px",
                fontSize: 13,
                lineHeight: 1.6,
                borderRadius: role === "user" ? "18px 18px 6px 18px" : "18px 18px 18px 6px",
                background:
                    role === "user"
                        ? "linear-gradient(135deg, var(--accent), var(--accent2))"
                        : "var(--card)",
                color: role === "user" ? "#fff" : "var(--text)",
                border: role === "assistant" ? "1px solid rgba(18, 199, 194, 0.10)" : "none",
                boxShadow: role === "user" ? "var(--shadow-soft)" : "0 4px 12px rgba(15,94,99,0.06)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
            }}
        >
            {children}
        </div>
    </div>
);


const formatWorkoutPlanItem = (item) => {
    const setCount = Array.isArray(item?.sets) ? item.sets.length : 0;
    return `${item?.exerciseName || "種目"} ${setCount || 0}セット`;
};

const WorkoutPlanConfirmModal = ({ plan, selectedMap, setSelectedMap, onClose, onConfirm }) => {
    const selectedCount = plan.filter((_, index) => selectedMap[index]).length;

    return (
        <div
            onClick={onClose}
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 80,
                background: "rgba(11, 24, 28, 0.36)",
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                padding: "18px 16px calc(18px + var(--safe-bottom))",
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: "min(560px, 100%)",
                    maxHeight: "78dvh",
                    overflowY: "auto",
                    borderRadius: 24,
                    background: "var(--card)",
                    border: "1px solid rgba(18, 199, 194, 0.14)",
                    boxShadow: "0 24px 60px rgba(15, 94, 99, 0.22)",
                    padding: 18,
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                }}
            >
                <div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: "var(--text)", marginBottom: 5 }}>
                        記録に追加するメニュー
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
                        今日の記録に追加する種目を選んでください。
                    </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {plan.map((item, index) => (
                        <button
                            type="button"
                            key={`${item.exerciseName}-${index}`}
                            onClick={() => setSelectedMap((prev) => ({ ...prev, [index]: !prev[index] }))}
                            style={{
                                width: "100%",
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                padding: "12px 12px",
                                borderRadius: 16,
                                border: selectedMap[index]
                                    ? "1px solid rgba(18, 199, 194, 0.32)"
                                    : "1px solid rgba(139, 164, 168, 0.16)",
                                background: selectedMap[index]
                                    ? "linear-gradient(135deg, rgba(18, 199, 194, 0.14), rgba(51, 225, 219, 0.08))"
                                    : "var(--card2)",
                                color: "var(--text)",
                                textAlign: "left",
                            }}
                        >
                            <span
                                style={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: 999,
                                    display: "grid",
                                    placeItems: "center",
                                    flexShrink: 0,
                                    background: selectedMap[index]
                                        ? "linear-gradient(135deg, var(--accent), var(--accent2))"
                                        : "rgba(139, 164, 168, 0.14)",
                                    color: selectedMap[index] ? "#fff" : "var(--text3)",
                                    fontSize: 13,
                                    fontWeight: 900,
                                }}
                            >
                                {selectedMap[index] ? "✓" : ""}
                            </span>
                            <span style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ display: "block", fontSize: 14, fontWeight: 900 }}>
                                    {formatWorkoutPlanItem(item)}
                                </span>
                                <span style={{ display: "block", fontSize: 11, color: "var(--text2)", marginTop: 3 }}>
                                    {item.bodyPart || "その他"} / {item.unit === "BW" ? "自重" : item.unit === "lbs" ? "lb" : "kg"}
                                </span>
                            </span>
                        </button>
                    ))}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1.35fr", gap: 10 }}>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            padding: "13px 12px",
                            borderRadius: 16,
                            border: "1px solid var(--border2)",
                            background: "var(--card2)",
                            color: "var(--text2)",
                            fontWeight: 900,
                            fontSize: 13,
                        }}
                    >
                        キャンセル
                    </button>
                    <button
                        type="button"
                        disabled={selectedCount <= 0}
                        onClick={onConfirm}
                        style={{
                            padding: "13px 12px",
                            borderRadius: 16,
                            border: "none",
                            background: selectedCount > 0
                                ? "linear-gradient(135deg, var(--accent), var(--accent2))"
                                : "rgba(139, 164, 168, 0.22)",
                            color: "#fff",
                            fontWeight: 900,
                            fontSize: 13,
                            opacity: selectedCount > 0 ? 1 : 0.55,
                        }}
                    >
                        選択した種目を追加
                    </button>
                </div>
            </div>
        </div>
    );
};

const LimitReachedCard = ({ aiUsageCount, dailyFreeAiLimit, onOpenPro }) => (
    <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 14,
        background: "rgba(130,150,155,0.08)",
        border: "1px solid rgba(130,150,155,0.18)",
    }}>
        <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: "var(--text)", fontWeight: 900, lineHeight: 1.35 }}>
                本日のAI相談 {aiUsageCount}/{dailyFreeAiLimit} を使い切りました
            </div>
            <div style={{ fontSize: 10, color: "var(--text3)", lineHeight: 1.35 }}>
                {onOpenPro ? "ProでAI Coachを無制限に使えます" : "明日 0:00 (JST) にリセットされます"}
            </div>
        </div>
        {onOpenPro && (
            <button
                type="button"
                onClick={onOpenPro}
                className="pressable"
                style={{
                    flexShrink: 0,
                    padding: "7px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(18, 199, 194, 0.18)",
                    background: "linear-gradient(135deg, rgba(18, 199, 194, 0.18), rgba(51, 225, 219, 0.12))",
                    color: "var(--text)",
                    fontSize: 11,
                    fontWeight: 900,
                }}
            >
                Proを見る
            </button>
        )}
    </div>
);

const TRACKED_BODY_PARTS = ["胸", "背中", "四頭", "ハム", "尻", "肩", "二頭", "三頭", "腹筋"];
const DEFAULT_TARGET = 10;

function buildTodaySuggestion(weeklyBodyPartCounts, weeklySetTargets) {
    if (!weeklyBodyPartCounts || !weeklySetTargets) return null;
    const parts = TRACKED_BODY_PARTS.map((bp) => ({
        bp,
        done: weeklyBodyPartCounts[bp] || 0,
        target: weeklySetTargets[bp] ?? DEFAULT_TARGET,
    })).filter((p) => p.target > 0);

    if (!parts.length) return null;

    const allAchieved = parts.every((p) => p.done >= p.target);
    const behind = parts.filter((p) => p.done < p.target);

    if (allAchieved) {
        return { allAchieved: true, parts, behind: [] };
    }
    return { allAchieved: false, parts, behind };
}

function buildSuggestionPrompt(parts) {
    const lines = parts.map((p) => `${p.bp}：${p.done}/${p.target}set`).join("、");
    return `今週のセット数状況です。${lines}。目標に対して不足している部位を中心に、今日のトレーニングメニューを提案してください。`;
}

export default function AIScreen({
    aiMsgs,
    aiInput,
    setAiInput,
    sendAI,
    aiLoad,
    aiEnd,
    isPro = false,
    onDeactivateProDev,
    billingEnabled = false,
    dailyFreeAiLimit = 5,
    aiUsageCount = 0,
    aiRemaining,
    onAddWorkoutPlan,
    onInputFocusChange,
    aiConversations = [],
    aiConversationLoading = false,
    aiConversationError = "",
    activeConversationId = null,
    onOpenConversation,
    onStartNewConversation,
    onDeleteConversation,
    onLoadConversations,
    onOpenStripePortal,
    weeklyBodyPartCounts,
    weeklySetTargets,
    onOpenPaywall,
}) {
    const inputRef = useRef(null);
    const [activeQuickAction, setActiveQuickAction] = useState("");
    const [pendingWorkoutPlan, setPendingWorkoutPlan] = useState(null);
    const [selectedWorkoutPlanMap, setSelectedWorkoutPlanMap] = useState({});
    const [showHistory, setShowHistory] = useState(false);

    const todaySuggestion = buildTodaySuggestion(weeklyBodyPartCounts, weeklySetTargets);

    const showDevProControls = process.env.NODE_ENV !== "production" && isPro && typeof onDeactivateProDev === "function";
    const isInitialState =
        aiMsgs.length === 1 &&
        aiMsgs[0]?.role === "assistant" &&
        !aiLoad;

    const visibleMessages = isInitialState ? [] : aiMsgs;
    const isHardLimitReached = !isPro && Number(aiRemaining) <= 0;
    const isAiLimitReached = isHardLimitReached;
    const canSendMessage = !aiLoad && !isAiLimitReached;
    const shouldShowLimitCard = isAiLimitReached;

    const handleSend = (overrideMsg) => {
        if (isAiLimitReached) {
            if (billingEnabled) onOpenPaywall?.("ai_limit");
            return;
        }
        if (!canSendMessage) return;
        const nextMessage = overrideMsg ?? aiInput;
        if (!nextMessage?.trim()) return;
        sendAI(overrideMsg);
        setTimeout(() => inputRef.current?.blur(), 50);
    };

    const handleSuggestion = ({ label, prompt }) => {
        if (!canSendMessage) return;
        setActiveQuickAction(label);
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
        sendAI(prompt);
        setTimeout(() => setActiveQuickAction(""), 180);
    };

    const handleInputFocus = () => {
        onInputFocusChange?.(true);
    };

    const handleInputBlur = () => {
        window.setTimeout(() => {
            const activeElement = document.activeElement;
            if (activeElement?.getAttribute?.("data-ai-chat-input") === "true") return;
            onInputFocusChange?.(false);
        }, 80);
    };

    const openWorkoutPlanConfirm = (plan) => {
        const safePlan = Array.isArray(plan) ? plan : [];
        if (!safePlan.length) return;
        setPendingWorkoutPlan(safePlan);
        setSelectedWorkoutPlanMap(
            safePlan.reduce((acc, _item, index) => {
                acc[index] = true;
                return acc;
            }, {})
        );
    };

    const closeWorkoutPlanConfirm = () => {
        setPendingWorkoutPlan(null);
        setSelectedWorkoutPlanMap({});
    };

    const confirmWorkoutPlan = () => {
        const selected = (pendingWorkoutPlan || []).filter((_, index) => selectedWorkoutPlanMap[index]);
        if (!selected.length) return;
        onAddWorkoutPlan?.(selected);
        closeWorkoutPlanConfirm();
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
                padding: "0 16px 0",
                gap: 8,
            }}
        >
            <div
                style={{
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 7, flex: "0 1 auto", maxWidth: "100%" }}>
                    <div
                        style={{
                            padding: "6px 10px",
                            borderRadius: 999,
                            background: isAiLimitReached
                                ? "rgba(130,150,155,0.12)"
                                : "rgba(18, 199, 194, 0.08)",
                            border: isAiLimitReached
                                ? "1px solid rgba(130,150,155,0.22)"
                                : "1px solid rgba(18, 199, 194, 0.12)",
                            color: isAiLimitReached ? "var(--text3)" : "var(--text2)",
                            fontSize: 11,
                            fontWeight: 700,
                        }}
                    >
                        {isPro
                            ? "今日のAI相談 Pro 無制限"
                            : `今日 ${aiUsageCount}/${dailyFreeAiLimit}`}
                    </div>
                    {/* Entry ①: Pro unlimited pill button — hidden when Entry② banner is visible */}
                    {billingEnabled && !isPro && !isHardLimitReached && !(Number(aiRemaining) <= 2 && Number(aiRemaining) > 0) && (
                        <button
                            type="button"
                            onClick={() => onOpenPaywall?.("general")}
                            style={{
                                background: "linear-gradient(135deg, var(--accent), var(--accent2, var(--accent)))",
                                border: "none",
                                padding: "4px 10px",
                                borderRadius: 999,
                                color: "#fff",
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: "pointer",
                                whiteSpace: "nowrap",
                                letterSpacing: 0.2,
                            }}
                        >
                            ✦ Proで無制限
                        </button>
                    )}
                </div>
                <div
                    style={{
                        marginLeft: "auto",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        gap: 7,
                        flexWrap: "wrap",
                    }}
                >
                    {showDevProControls && (
                        <button
                            type="button"
                            onClick={onDeactivateProDev}
                            style={{
                                padding: "6px 10px",
                                borderRadius: 999,
                                background: "rgba(239, 68, 68, 0.08)",
                                border: "1px solid rgba(239, 68, 68, 0.18)",
                                color: "#B94A48",
                                fontSize: 11,
                                fontWeight: 800,
                            }}
                        >
                            開発用：Pro解除
                        </button>
                    )}
                    {billingEnabled && isPro && typeof onOpenStripePortal === "function" && (
                        <button
                            type="button"
                            onClick={onOpenStripePortal}
                            style={{
                                padding: "6px 10px",
                                borderRadius: 999,
                                background: "rgba(18,199,194,0.07)",
                                border: "1px solid rgba(18,199,194,0.18)",
                                color: "var(--accent)",
                                fontSize: 11,
                                fontWeight: 800,
                            }}
                        >
                            サブスク管理
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => {
                            onLoadConversations?.();
                            setShowHistory(true);
                        }}
                        className="pressable"
                        style={{
                            padding: "7px 11px",
                            borderRadius: 999,
                            border: "1px solid rgba(18, 199, 194, 0.14)",
                            background: "linear-gradient(180deg, var(--card2), var(--card))",
                            color: "var(--text2)",
                            fontSize: 11,
                            fontWeight: 900,
                            boxShadow: "var(--shadow-soft)",
                            whiteSpace: "nowrap",
                        }}
                    >
                        AI会話履歴
                    </button>
                </div>
            </div>

            <div
                style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    padding: "8px 0 16px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: isInitialState ? "center" : "flex-start",
                    gap: 8,
                    WebkitOverflowScrolling: "touch",
                }}
            >
                {activeConversationId && !isInitialState && (
                    <div style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                        flexShrink: 0,
                    }}>
                        <span style={{ fontSize: 10, color: "var(--text3)", fontWeight: 700 }}>
                            過去の会話
                        </span>
                        <button
                            type="button"
                            onClick={() => onStartNewConversation?.()}
                            style={{
                                padding: "3px 8px",
                                borderRadius: 999,
                                border: "1px solid rgba(18,199,194,0.18)",
                                background: "transparent",
                                color: "var(--accent)",
                                fontSize: 10,
                                fontWeight: 900,
                            }}
                        >
                            + 新しい会話
                        </button>
                    </div>
                )}

                {isInitialState && todaySuggestion && (
                    todaySuggestion.allAchieved ? (
                        <div style={{
                            background: "linear-gradient(135deg, rgba(85,216,158,0.12), rgba(18,199,194,0.08))",
                            borderRadius: 18,
                            border: "1px solid rgba(85,216,158,0.28)",
                            padding: "14px 16px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                        }}>
                            <div style={{ fontSize: 18, fontWeight: 900, color: "#55D89E" }}>今週の目標、全達成！</div>
                            <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
                                すべての部位でセット目標を達成しています。素晴らしいトレーニングウィークでした！
                            </div>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => {
                                if (!canSendMessage) return;
                                const prompt = buildSuggestionPrompt(todaySuggestion.behind);
                                sendAI(prompt);
                            }}
                            style={{
                                background: "var(--card)",
                                borderRadius: 18,
                                border: "1px solid rgba(18, 199, 194, 0.14)",
                                padding: "14px 16px",
                                display: "flex",
                                flexDirection: "column",
                                gap: 8,
                                textAlign: "left",
                                cursor: canSendMessage ? "pointer" : "not-allowed",
                                boxShadow: "var(--shadow-card)",
                                opacity: canSendMessage ? 1 : 0.6,
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1.2, color: "var(--text3)" }}>今日の提案</div>
                                <div style={{ fontSize: 10, color: "var(--accent)", background: "rgba(18,199,194,0.10)", padding: "2px 7px", borderRadius: 999, fontWeight: 800 }}>タップで相談</div>
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {todaySuggestion.behind.slice(0, 5).map((p) => (
                                    <div key={p.bp} style={{
                                        padding: "4px 9px",
                                        borderRadius: 999,
                                        background: "var(--card2)",
                                        border: "1px solid rgba(130,150,155,0.20)",
                                        fontSize: 11,
                                        fontWeight: 800,
                                        color: "var(--text2)",
                                    }}>
                                        {p.bp} {p.done}/{p.target}
                                    </div>
                                ))}
                                {todaySuggestion.behind.length > 5 && (
                                    <div style={{ fontSize: 11, color: "var(--text3)", padding: "4px 0", fontWeight: 700 }}>
                                        +{todaySuggestion.behind.length - 5}
                                    </div>
                                )}
                            </div>
                        </button>
                    )
                )}

                {isInitialState && (
                    <div
                        style={{
                            background: "var(--card)",
                            borderRadius: 20,
                            border: "1px solid rgba(18, 199, 194, 0.1)",
                            boxShadow: "var(--shadow-card)",
                            padding: 16,
                            display: "flex",
                            flexDirection: "column",
                            gap: 7,
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
                    </div>
                )}

                {visibleMessages.map((msg, i) => {
                    const hasWorkoutPlan = msg.role === "assistant" && Array.isArray(msg.workoutPlan) && msg.workoutPlan.length > 0;

                    return (
                        <div key={i} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                            <CompactBubble role={msg.role}>
                                {msg.content}
                            </CompactBubble>
                            {hasWorkoutPlan && (
                                <div style={{ display: "flex", justifyContent: "flex-start" }}>
                                    <button
                                        type="button"
                                        onClick={() => openWorkoutPlanConfirm(msg.workoutPlan)}
                                        className="pressable"
                                        style={{
                                            padding: "9px 12px",
                                            borderRadius: 14,
                                            border: "1px solid rgba(18, 199, 194, 0.18)",
                                            background: "linear-gradient(135deg, rgba(18, 199, 194, 0.16), rgba(51, 225, 219, 0.10))",
                                            color: "var(--text)",
                                            fontSize: 12,
                                            fontWeight: 900,
                                            boxShadow: "0 10px 20px rgba(15,94,99,0.08)",
                                        }}
                                    >
                                        このメニューを記録に追加
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}

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
                    padding: "1px 0 3px",
                    WebkitOverflowScrolling: "touch",
                }}
            >
                {AI_SUGGESTIONS.map(({ label, prompt }) => (
                    <button
                        key={label}
                        onClick={() => handleSuggestion({ label, prompt })}
                        disabled={!canSendMessage}
                        className="pressable"
                        style={{
                            whiteSpace: "nowrap",
                            padding: "7px 11px",
                            borderRadius: 999,
                            background:
                                !canSendMessage
                                    ? "linear-gradient(180deg, rgba(255,255,255,0.46), rgba(255,255,255,0.30))"
                                    : activeQuickAction === label
                                    ? "linear-gradient(135deg, rgba(18, 199, 194, 0.18), rgba(51, 225, 219, 0.12))"
                                    : "linear-gradient(180deg, var(--card2), var(--card))",
                            color: !canSendMessage ? "var(--text4)" : activeQuickAction === label ? "var(--text)" : "var(--text2)",
                            fontSize: 11,
                            fontWeight: 800,
                            border: !canSendMessage ? "1px solid rgba(18, 199, 194, 0.06)" : "1px solid rgba(18, 199, 194, 0.12)",
                            boxShadow: !canSendMessage ? "none" : "var(--shadow-card)",
                            transform: activeQuickAction === label ? "scale(0.98)" : "scale(1)",
                            opacity: !canSendMessage ? 0.50 : 1,
                            cursor: !canSendMessage ? "not-allowed" : "pointer",
                        }}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <div
                style={{
                    flexShrink: 0,
                    padding: "8px 10px 9px",
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
                        data-ai-chat-input="true"
                        value={aiInput}
                        onChange={(e) => setAiInput(e.target.value)}
                        onFocus={handleInputFocus}
                        onBlur={handleInputBlur}
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
                        disabled={aiLoad}
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
                {/* Entry ②: banner when 2 or fewer uses remain */}
                {billingEnabled && !isPro && Number(aiRemaining) <= 2 && Number(aiRemaining) > 0 && !isAiLimitReached && (
                    <button
                        type="button"
                        onClick={() => onOpenPaywall?.("general")}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 6,
                            width: "100%",
                            padding: "8px 12px",
                            borderRadius: 10,
                            background: "rgba(var(--accent-rgb, 99, 102, 241), 0.08)",
                            border: "1px solid rgba(var(--accent-rgb, 99, 102, 241), 0.2)",
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: 700,
                            color: "var(--accent)",
                            whiteSpace: "nowrap",
                        }}
                    >
                        <span style={{ color: "var(--text2)", fontWeight: 600 }}>あと{aiRemaining}回</span>
                        <span style={{ color: "var(--text3)", fontWeight: 400 }}>·</span>
                        <span>Proなら無制限 →</span>
                    </button>
                )}
                {shouldShowLimitCard && (
                    <LimitReachedCard
                        aiUsageCount={aiUsageCount}
                        dailyFreeAiLimit={dailyFreeAiLimit}
                        onOpenPro={billingEnabled ? () => onOpenPaywall?.("ai_limit") : null}
                    />
                )}
                {!shouldShowLimitCard && !(billingEnabled && !isPro && Number(aiRemaining) <= 2 && Number(aiRemaining) > 0) && (
                    <div style={{ fontSize: 11, color: "var(--text3)", padding: "0 2px" }}>
                        メニュー相談、記録分析、フォーム相談をそのまま聞けます。
                    </div>
                )}
            </div>

            {pendingWorkoutPlan && (
                <WorkoutPlanConfirmModal
                    plan={pendingWorkoutPlan}
                    selectedMap={selectedWorkoutPlanMap}
                    setSelectedMap={setSelectedWorkoutPlanMap}
                    onClose={closeWorkoutPlanConfirm}
                    onConfirm={confirmWorkoutPlan}
                />
            )}

            {showHistory && (
                <div
                    onClick={() => setShowHistory(false)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 500,
                        background: "rgba(0,0,0,0.45)",
                        display: "flex",
                        alignItems: "flex-end",
                        justifyContent: "center",
                        padding: "16px",
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: "100%",
                            maxWidth: 440,
                            maxHeight: "78dvh",
                            display: "flex",
                            flexDirection: "column",
                            borderRadius: 24,
                            background: "var(--card-modal)",
                            border: "1px solid var(--border2)",
                            boxShadow: "0 24px 60px rgba(0,0,0,0.32)",
                            overflow: "hidden",
                        }}
                    >
                        {/* ヘッダー */}
                        <div style={{
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "16px 16px 12px",
                            borderBottom: "1px solid var(--border2)",
                            gap: 12,
                        }}>
                            <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text)" }}>
                                AI会話履歴
                            </div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        onStartNewConversation?.();
                                        setShowHistory(false);
                                    }}
                                    style={{
                                        padding: "7px 12px",
                                        borderRadius: 999,
                                        border: "1px solid rgba(18,199,194,0.22)",
                                        background: "rgba(18,199,194,0.10)",
                                        color: "var(--accent)",
                                        fontSize: 12,
                                        fontWeight: 900,
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    + 新しい会話
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowHistory(false)}
                                    style={{
                                        width: 32,
                                        height: 32,
                                        borderRadius: 999,
                                        border: "1px solid var(--border2)",
                                        background: "var(--card2)",
                                        color: "var(--text2)",
                                        fontSize: 18,
                                        fontWeight: 800,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        flexShrink: 0,
                                    }}
                                >
                                    ×
                                </button>
                            </div>
                        </div>

                        {/* リスト */}
                        <div style={{
                            flex: 1,
                            overflowY: "auto",
                            WebkitOverflowScrolling: "touch",
                            padding: "8px 10px calc(8px + var(--safe-bottom, 0px))",
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                        }}>
                            {aiConversationLoading && (
                                <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
                                    読み込み中…
                                </div>
                            )}
                            {!aiConversationLoading && aiConversationError && (
                                <div style={{ padding: "16px 8px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
                                    {aiConversationError}
                                </div>
                            )}
                            {!aiConversationLoading && !aiConversationError && aiConversations.length === 0 && (
                                <div style={{ padding: "32px 8px", textAlign: "center", color: "var(--text3)", fontSize: 13, lineHeight: 1.7 }}>
                                    まだ会話履歴がありません。<br />AIに話しかけると自動で保存されます。
                                </div>
                            )}
                            {!aiConversationLoading && aiConversations.map((conv) => {
                                const isActive = conv.id === activeConversationId;
                                return (
                                    <div
                                        key={conv.id}
                                        style={{
                                            display: "flex",
                                            alignItems: "stretch",
                                            gap: 6,
                                            borderRadius: 16,
                                            background: isActive
                                                ? "linear-gradient(135deg, rgba(18,199,194,0.14), rgba(51,225,219,0.08))"
                                                : "var(--card2)",
                                            border: isActive
                                                ? "1px solid rgba(18,199,194,0.28)"
                                                : "1px solid var(--border2)",
                                        }}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onOpenConversation?.(conv.id);
                                                setShowHistory(false);
                                            }}
                                            style={{
                                                flex: 1,
                                                minWidth: 0,
                                                padding: "12px 14px",
                                                background: "none",
                                                border: "none",
                                                textAlign: "left",
                                                cursor: "pointer",
                                            }}
                                        >
                                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                                <span style={{ fontSize: 10, color: "var(--text3)", fontWeight: 700 }}>
                                                    {formatConvDate(conv.updated_at || conv.created_at)}
                                                </span>
                                                {isActive && (
                                                    <span style={{
                                                        fontSize: 9,
                                                        fontWeight: 900,
                                                        color: "var(--accent)",
                                                        background: "rgba(18,199,194,0.13)",
                                                        border: "1px solid rgba(18,199,194,0.28)",
                                                        borderRadius: 999,
                                                        padding: "1px 6px",
                                                    }}>
                                                        表示中
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{
                                                fontSize: 13,
                                                fontWeight: 800,
                                                color: "var(--text)",
                                                lineHeight: 1.35,
                                                marginBottom: 3,
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                                whiteSpace: "nowrap",
                                            }}>
                                                {conv.title || "AI相談"}
                                            </div>
                                            {conv.preview && (
                                                <div style={{
                                                    fontSize: 11,
                                                    color: "var(--text3)",
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                    whiteSpace: "nowrap",
                                                }}>
                                                    {conv.preview}
                                                </div>
                                            )}
                                        </button>
                                        <button
                                            type="button"
                                            aria-label="削除"
                                            onClick={async (e) => {
                                                e.stopPropagation();
                                                if (!window.confirm("この会話を削除しますか？")) return;
                                                await onDeleteConversation?.(conv.id);
                                            }}
                                            style={{
                                                flexShrink: 0,
                                                width: 36,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                background: "none",
                                                border: "none",
                                                color: "var(--text4)",
                                                fontSize: 15,
                                                cursor: "pointer",
                                                borderLeft: "1px solid var(--border2)",
                                                borderRadius: "0 16px 16px 0",
                                            }}
                                        >
                                            ×
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
