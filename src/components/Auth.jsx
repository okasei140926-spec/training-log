import { useState } from "react";
import { supabase } from "../utils/supabase";

export default function Auth({ onClose, isDark }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const bg = isDark ? "#1a1a1a" : "#fff";
  const text = isDark ? "#fff" : "#000";
  const sub = isDark ? "#aaa" : "#666";
  const border = isDark ? "#333" : "#ddd";
  const inputBg = isDark ? "#2a2a2a" : "#fff";

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.user) {
          await supabase.from("profiles").insert({ id: data.user.id, username });
        }
        setSent(true);
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
        setSent(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onClose();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    display: "block", width: "100%", marginBottom: 12,
    padding: "14px 16px", borderRadius: 12, fontSize: 16,
    border: `1px solid ${border}`, boxSizing: "border-box",
    outline: "none", color: text, background: inputBg,
  };

  const btnStyle = {
    width: "100%", padding: 16, borderRadius: 12,
    background: "#4ade80", border: "none",
    fontWeight: 700, fontSize: 16, cursor: "pointer", color: "#000",
  };

  if (sent) {
    return (
      <div style={{ padding: 32, maxWidth: 400, margin: "0 auto", textAlign: "center", background: bg, minHeight: "100vh" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
        <h2 style={{ marginBottom: 12, color: text }}>メールを送信しました</h2>
        <p style={{ color: sub, marginBottom: 32, lineHeight: 1.6 }}>
          {email} にメールを送りました。<br />
          {mode === "reset"
            ? "メール内のリンクからパスワードを再設定してください。"
            : "メール内のリンクをタップして登録を完了し、ログインしてください。"}
        </p>
        <button onClick={() => { setSent(false); setMode("login"); }} style={btnStyle}>
          ログインへ
        </button>
      </div>
    );
  }

  if (mode === "reset") {
    return (
      <div style={{ padding: 32, maxWidth: 400, margin: "0 auto", background: bg, minHeight: "100vh" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <button onClick={() => setMode("login")} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: sub }}>←</button>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: sub }}>✕</button>
        </div>
        <h2 style={{ marginBottom: 8, fontSize: 24, color: text }}>パスワードをリセット</h2>
        <p style={{ color: sub, marginBottom: 24, fontSize: 14 }}>登録したメールアドレスを入力してください。パスワード再設定用のリンクを送ります。</p>
        <input placeholder="メールアドレス" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} />
        {error && <p style={{ color: "red", marginBottom: 12, fontSize: 14 }}>{error}</p>}
        <button onClick={handleSubmit} disabled={loading} style={{ ...btnStyle, opacity: loading ? 0.7 : 1 }}>
          {loading ? "送信中..." : "リセットメールを送る"}
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 32, maxWidth: 400, margin: "0 auto", background: bg, minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: sub }}>✕</button>
      </div>
      <h2 style={{ marginBottom: 24, fontSize: 24, color: text }}>
        {mode === "login" ? "ログイン" : "新規登録"}
      </h2>
      {mode === "signup" && (
        <input placeholder="ユーザー名" value={username} onChange={e => setUsername(e.target.value)} style={inputStyle} />
      )}
      <input placeholder="メールアドレス" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} />
      <input type="password" placeholder="パスワード（6文字以上）" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} />
      {error && <p style={{ color: "red", marginBottom: 12, fontSize: 14 }}>{error}</p>}
      <button onClick={handleSubmit} disabled={loading} style={{ ...btnStyle, marginBottom: 12, opacity: loading ? 0.7 : 1 }}>
        {loading ? "処理中..." : mode === "login" ? "ログイン" : "登録する"}
      </button>
      {mode === "login" && (
        <button onClick={() => { setMode("reset"); setError(""); }} style={{ width: "100%", padding: 14, borderRadius: 12, background: "none", border: `1px solid ${border}`, fontSize: 15, cursor: "pointer", color: sub, marginBottom: 8 }}>
          パスワードをお忘れの方はこちら
        </button>
      )}
      <button
        onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}
        style={{ width: "100%", padding: 14, borderRadius: 12, background: "none", border: `1px solid ${border}`, fontSize: 15, cursor: "pointer", color: sub }}
      >
        {mode === "login" ? "アカウントをお持ちでない方はこちら" : "すでにアカウントをお持ちの方はこちら"}
      </button>
    </div>
  );
}
