import { useRef, useState } from "react";

const HEADER_OFFSET = 72;
const BOTTOM_NAV_OFFSET = 92;
const FOOTER_SAFE_PADDING = `calc(env(safe-area-inset-bottom, 0px) + ${BOTTOM_NAV_OFFSET}px)`;

const AI_SUGGESTIONS = [
    {
        label: "種目組んで",
        mode: "ask_part",
    },
    {
        label: "次回メニュー提案",
        prompt: "最近の記録をもとに、次は何をやればいいか初心者にも分かりやすく教えて",
    },
    {
        label: "今日の記録分析",
        prompt: "今日のトレーニング記録を分析して、良かった点と次回改善する点を教えて",
    },
];

export default function AIScreen({ aiMsgs, aiInput, setAiInput, sendAI, aiLoad, aiEnd }) {
    const inputRef = useRef(null);
    const [waitingForWorkoutPart, setWaitingForWorkoutPart] = useState(false);

    const handleSend = (overrideMsg) => {
        const nextMessage = overrideMsg ?? aiInput;
        if (!nextMessage?.trim()) return;

        if (!overrideMsg && waitingForWorkoutPart) {
            sendAI(`${nextMessage.trim()}のトレーニングメニューを、最近の記録を参考に初心者にも分かりやすく組んでください。`);
            setWaitingForWorkoutPart(false);
            setAiInput("");
            setTimeout(() => inputRef.current?.blur(), 50);
            return;
        }

        sendAI(overrideMsg);
        setTimeout(() => inputRef.current?.blur(), 50);
    };

    const handleSuggestion = ({ prompt, mode }) => {
        if (mode === "ask_part") {
            setWaitingForWorkoutPart(true);
            setAiInput("");
            return;
        }

        setWaitingForWorkoutPart(false);
        handleSend(prompt);
    };

    return (
        <div
            className="fade-in"
            style={{
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                height: `calc(100dvh - ${HEADER_OFFSET}px)`,
                maxHeight: `calc(100dvh - ${HEADER_OFFSET}px)`,
                overflow: "hidden",
                background: "var(--bg)",
            }}
        >
            <div
                style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    padding: "20px 20px 24px",
                }}
            >
                {aiMsgs.map((msg, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start", marginBottom: 12 }}>
                        <div style={{
                            maxWidth: "80%", padding: "12px 16px", fontSize: 14, lineHeight: 1.6,
                            borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                            background: msg.role === "user" ? "var(--text)" : "var(--card2)",
                            color: msg.role === "user" ? "var(--bg)" : "var(--text)",
                            border: msg.role === "assistant" ? "1px solid var(--border2)" : "none",
                        }}>
                            {msg.content}
                        </div>
                    </div>
                ))}
                {waitingForWorkoutPart && (
                    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 12 }}>
                        <div style={{
                            maxWidth: "80%", padding: "12px 16px", fontSize: 14, lineHeight: 1.6,
                            borderRadius: "18px 18px 18px 4px",
                            background: "var(--card2)",
                            color: "var(--text)",
                            border: "1px solid var(--border2)",
                        }}>
                            今日はどの部位をやりますか？<br />
                            例：胸、背中、脚、肩、腕 など
                        </div>
                    </div>
                )}
                {aiLoad && (
                    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 12 }}>
                        <div style={{ padding: "12px 16px", borderRadius: "18px 18px 18px 4px", background: "var(--card2)", border: "1px solid var(--border2)", animation: "pulse 1s infinite", fontSize: 20 }}>💭</div>
                    </div>
                )}
                <div ref={aiEnd} />
            </div>

            <div
                style={{
                    flexShrink: 0,
                    padding: "10px 20px 8px",
                    borderTop: "1px solid var(--border2)",
                    display: "flex",
                    gap: 6,
                    overflowX: "auto",
                    background: "var(--bg)",
                }}
            >
                {AI_SUGGESTIONS.map(({ label, prompt, mode }) => (
                    <button key={label} onClick={() => handleSuggestion({ prompt, mode })}
                        style={{ whiteSpace: "nowrap", padding: "7px 12px", borderRadius: 20, background: "var(--card2)", color: "var(--text3)", fontSize: 12, border: "1px solid var(--border2)" }}>
                        {label}
                    </button>
                ))}
            </div>

            <div
                style={{
                    flexShrink: 0,
                    padding: `8px 20px ${FOOTER_SAFE_PADDING}`,
                    display: "flex",
                    gap: 8,
                    background: "var(--bg)",
                }}
            >
                <input ref={inputRef} value={aiInput} onChange={e => setAiInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleSend()}
                    placeholder="AI Coachに聞く..."
                    style={{ flex: 1, padding: "12px 16px", borderRadius: 24, background: "var(--card2)", border: "1px solid var(--border2)", color: "var(--text)", fontSize: 14 }} />
                <button onClick={() => handleSend()} disabled={aiLoad}
                    style={{ width: 46, height: 46, borderRadius: 23, background: aiLoad ? "var(--border2)" : "var(--text)", color: "var(--bg)", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>↑</button>
            </div>
        </div>
    );
}
