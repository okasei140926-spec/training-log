import React from "react";
import { S } from "../../utils/styles";

function LoginPrompt({ onLogin }) {
    return (
        <div style={{ ...S.page, justifyContent: "center", minHeight: "55vh" }}>
            <div
                style={{
                    ...S.sectionCard,
                    textAlign: "center",
                    padding: 24,
                }}
            >
            <p style={{ marginBottom: 24, color: "var(--text2)", lineHeight: 1.6 }}>Friends機能を使うにはログインが必要です</p>
            <button onClick={onLogin} style={{ padding: "12px 32px", borderRadius: 14, background: "linear-gradient(135deg, var(--accent), var(--accent2))", color: "#fff", border: "1px solid transparent", fontWeight: 700, fontSize: 16, boxShadow: "var(--shadow-soft)" }}>
                ログイン / 新規登録
            </button>
            </div>
        </div>
    );
}

export default LoginPrompt;
