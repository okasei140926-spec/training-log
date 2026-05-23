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

const formatConversationTime = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const time = date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

    if (startOfDate === startOfToday) return `今日 ${time}`;
    if (startOfDate === startOfToday - 24 * 60 * 60 * 1000) return `昨日 ${time}`;
    return `${date.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })} ${time}`;
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
        ? `${formatDateLabel(latestDate)}は${latestSummary}でした。次のメニューや重量調整を相談できます。`
        : "最近の記録をもとに、メニューや重量調整を相談できます。";

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

const ConversationHistorySection = ({
    conversations,
    loading,
    error,
    activeConversationId,
    showAll,
    setShowAll,
    onOpenConversation,
    onStartNewConversation,
    onDeleteConversation,
}) => {
    const visibleConversations = showAll ? conversations : conversations.slice(0, 5);
    const hasMore = conversations.length > 5;

    const handleDelete = async (event, conversation) => {
        event.stopPropagation();
        if (!window.confirm(`「${conversation.title || "AI相談"}」を削除しますか？`)) return;
        await onDeleteConversation?.(conversation.id);
    };

    return (
        <div
            style={{
                background: "var(--card)",
                borderRadius: 20,
                border: "1px solid rgba(18, 199, 194, 0.10)",
                boxShadow: "var(--shadow-card)",
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 10,
            }}
        >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div>
                    <div style={{ fontSize: 15, fontWeight: 900, color: "var(--text)" }}>
                        AIとの会話履歴
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                        過去の相談の続きから質問できます
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onStartNewConversation}
                    className="pressable"
                    style={{
                        flexShrink: 0,
                        padding: "7px 10px",
                        borderRadius: 999,
                        border: "1px solid rgba(18, 199, 194, 0.14)",
                        background: "linear-gradient(180deg, var(--card2), var(--card))",
                        color: "var(--text2)",
                        fontSize: 11,
                        fontWeight: 900,
                    }}
                >
                    新規相談
                </button>
            </div>

            {loading && (
                <div style={{ fontSize: 12, color: "var(--text3)", padding: "6px 0" }}>
                    会話履歴を読み込んでいます…
                </div>
            )}
            {!loading && error && (
                <div style={{ fontSize: 12, color: "var(--text3)", padding: "6px 0" }}>
                    {error}
                </div>
            )}
            {!loading && !error && !conversations.length && (
                <div
                    style={{
                        padding: "12px 12px",
                        borderRadius: 14,
                        background: "rgba(18, 199, 194, 0.06)",
                        border: "1px solid rgba(18, 199, 194, 0.10)",
                        color: "var(--text2)",
                        fontSize: 12,
                    }}
                >
                    まだ会話履歴はありません。
                </div>
            )}

            {!!visibleConversations.length && (
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {visibleConversations.map((conversation) => {
                        const isActive = conversation.id === activeConversationId;
                        return (
                            <div
                                key={conversation.id}
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "1fr auto",
                                    gap: 8,
                                    alignItems: "stretch",
                                }}
                            >
                                <button
                                    type="button"
                                    onClick={() => onOpenConversation?.(conversation.id)}
                                    className="pressable"
                                    style={{
                                        minWidth: 0,
                                        textAlign: "left",
                                        padding: "10px 11px",
                                        borderRadius: 15,
                                        border: isActive
                                            ? "1px solid rgba(18, 199, 194, 0.32)"
                                            : "1px solid rgba(18, 199, 194, 0.10)",
                                        background: isActive
                                            ? "linear-gradient(135deg, rgba(18, 199, 194, 0.16), rgba(51, 225, 219, 0.08))"
                                            : "var(--card2)",
                                        color: "var(--text)",
                                    }}
                                >
                                    <div style={{ fontSize: 13, fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {conversation.title || "AI相談"}
                                    </div>
                                    <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 3 }}>
                                        {formatConversationTime(conversation.updated_at || conversation.created_at)}
                                    </div>
                                    {conversation.preview && (
                                        <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {conversation.preview}
                                        </div>
                                    )}
                                </button>
                                <button
                                    type="button"
                                    onClick={(event) => handleDelete(event, conversation)}
                                    aria-label="会話履歴を削除"
                                    style={{
                                        width: 38,
                                        borderRadius: 14,
                                        border: "1px solid rgba(139, 164, 168, 0.14)",
                                        background: "var(--card2)",
                                        color: "var(--text3)",
                                        fontSize: 16,
                                        fontWeight: 900,
                                    }}
                                >
                                    ×
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {hasMore && (
                <button
                    type="button"
                    onClick={() => setShowAll((prev) => !prev)}
                    style={{
                        width: "100%",
                        padding: "9px 10px",
                        borderRadius: 14,
                        border: "1px solid rgba(18, 199, 194, 0.12)",
                        background: "rgba(18, 199, 194, 0.06)",
                        color: "var(--text2)",
                        fontSize: 12,
                        fontWeight: 900,
                    }}
                >
                    {showAll ? "閉じる" : "すべて見る"}
                </button>
            )}
        </div>
    );
};

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
    onDeactivateProDev,
    dailyFreeAiLimit = 5,
    aiUsageCount = 0,
    aiRemaining,
    onAddWorkoutPlan,
    aiConversations = [],
    aiConversationLoading = false,
    aiConversationError = "",
    activeConversationId = null,
    onOpenConversation,
    onStartNewConversation,
    onDeleteConversation,
}) {
    const inputRef = useRef(null);
    const [activeQuickAction, setActiveQuickAction] = useState("");
    const [pendingWorkoutPlan, setPendingWorkoutPlan] = useState(null);
    const [selectedWorkoutPlanMap, setSelectedWorkoutPlanMap] = useState({});
    const [showAllConversations, setShowAllConversations] = useState(false);

    const overview = useMemo(() => buildAiOverview(history), [history]);
    const showDevProControls = process.env.NODE_ENV !== "production" && isPro && typeof onDeactivateProDev === "function";
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
                padding: "0 16px 8px",
                gap: 8,
            }}
        >
            <div
                style={{
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                }}
            >
                <div
                    style={{
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

                <ConversationHistorySection
                    conversations={aiConversations}
                    loading={aiConversationLoading}
                    error={aiConversationError}
                    activeConversationId={activeConversationId}
                    showAll={showAllConversations}
                    setShowAll={setShowAllConversations}
                    onOpenConversation={onOpenConversation}
                    onStartNewConversation={onStartNewConversation}
                    onDeleteConversation={onDeleteConversation}
                />

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
                    メニュー相談、記録分析、フォーム相談をそのまま聞けます。
                </div>
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
        </div>
    );
}
