import { useRef } from "react";

export default function AIScreen({ aiMsgs, aiInput, setAiInput, sendAI, aiLoad, aiEnd }) {
    const inputRef = useRef(null);

    const handleSend = (overrideMsg) => {
        sendAI(overrideMsg);
        setTimeout(() => inputRef.current?.blur(), 50);
    };

    return (
        <div className="fade-in" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 80px)" }}>
            <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
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
                {aiLoad && (
                    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 12 }}>
                        <div style={{ padding: "12px 16px", borderRadius: "18px 18px 18px 4px", background: "var(--card2)", border: "1px solid var(--border2)", animation: "pulse 1s infinite", fontSize: 20 }}>💭</div>
                    </div>
                )}
                <div ref={aiEnd} />
            </div>

            <div style={{ padding: "10px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: 6, overflowX: "auto", background: "var(--bg)" }}>
                {["今日のメニュー", "モチベ上げて", "次の目標は？"].map(q => (
                    <button key={q} onClick={() => handleSend(q)}
                        style={{ whiteSpace: "nowrap", padding: "7px 12px", borderRadius: 20, background: "var(--card2)", color: "var(--text3)", fontSize: 12, border: "1px solid var(--border2)" }}>
                        {q}
                    </button>
                ))}
            </div>

            <div style={{ padding: "8px 20px 16px", display: "flex", gap: 8, background: "var(--bg)" }}>
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
