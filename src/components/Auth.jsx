import { useEffect, useState } from "react";
import { Browser } from "@capacitor/browser";
import { supabase } from "../utils/supabase";
import {
  getOAuthErrorMessage,
  getOAuthProviderLabel,
  getOAuthRedirectUrl,
  isNativeApp,
} from "../utils/oauth";

export default function Auth({ onClose, isDark }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [oauthLoadingProvider, setOauthLoadingProvider] = useState("");

  const bg = isDark ? "#1a1a1a" : "#fff";
  const text = isDark ? "#fff" : "#000";
  const sub = isDark ? "#aaa" : "#666";
  const border = isDark ? "#333" : "#ddd";
  const inputBg = isDark ? "#2a2a2a" : "#fff";

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        onClose();
      }
    });

    const handleOAuthError = (event) => {
      const message = event?.detail?.message;
      if (message) setError(message);
      setOauthLoadingProvider("");
      setLoading(false);
    };

    window.addEventListener("pump-oauth-error", handleOAuthError);
    return () => {
      subscription?.unsubscribe?.();
      window.removeEventListener("pump-oauth-error", handleOAuthError);
    };
  }, [onClose]);

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.user) {
          await supabase.from("profiles").insert({ id: data.user.id, username });
          const pending = localStorage.getItem("pendingFriendId");
          if (pending && pending !== data.user.id) {
            await supabase.from("friendships").upsert({
              requester_id: data.user.id,
              receiver_id: pending,
              status: "accepted",
            });
            localStorage.removeItem("pendingFriendId");
          }
        }
        setSent(true);
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
        setSent(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const { data: { user } } = await supabase.auth.getUser();
        const pending = localStorage.getItem("pendingFriendId");
        if (pending && user && pending !== user.id) {
          await supabase.from("friendships").upsert({
            requester_id: user.id,
            receiver_id: pending,
            status: "accepted",
          });
          localStorage.removeItem("pendingFriendId");
        }
        onClose();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider) => {
    const providerLabel = getOAuthProviderLabel(provider);
    setError("");
    setLoading(false);
    setOauthLoadingProvider(provider);

    try {
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: getOAuthRedirectUrl(),
          ...(isNativeApp() ? { skipBrowserRedirect: true } : {}),
        },
      });

      if (oauthError) throw oauthError;

      if (isNativeApp()) {
        if (!data?.url) {
          throw new Error(`${providerLabel}ログインURLの取得に失敗しました。`);
        }
        await Browser.open({ url: data.url, presentationStyle: "fullscreen" });
      }
    } catch (e) {
      setError(getOAuthErrorMessage(provider, e));
      setOauthLoadingProvider("");
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

  const secondaryBtnStyle = {
    width: "100%",
    padding: 16,
    borderRadius: 12,
    fontWeight: 700,
    fontSize: 16,
    cursor: "pointer",
    marginTop: 10,
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
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0 14px" }}>
        <div style={{ flex: 1, height: 1, background: border }} />
        <span style={{ color: sub, fontSize: 13 }}>または</span>
        <div style={{ flex: 1, height: 1, background: border }} />
      </div>
      <button
        onClick={() => handleOAuth("apple")}
        disabled={loading || !!oauthLoadingProvider}
        style={{
          ...secondaryBtnStyle,
          background: text,
          border: `1px solid ${text}`,
          color: bg,
          opacity: loading || oauthLoadingProvider ? 0.7 : 1,
        }}
      >
        {oauthLoadingProvider === "apple" ? "Appleへ移動中..." : "Appleで続行"}
      </button>
      <button
        onClick={() => handleOAuth("google")}
        disabled={loading || !!oauthLoadingProvider}
        style={{
          ...secondaryBtnStyle,
          background: inputBg,
          border: `1px solid ${border}`,
          color: text,
          opacity: loading || oauthLoadingProvider ? 0.7 : 1,
        }}
      >
        {oauthLoadingProvider === "google" ? "Googleへ移動中..." : "Googleで続行"}
      </button>
      {mode === "login" && (
        <button onClick={() => { setMode("reset"); setError(""); }} style={{ width: "100%", padding: 14, borderRadius: 12, background: "none", border: `1px solid ${border}`, fontSize: 15, cursor: "pointer", color: sub, marginBottom: 8, marginTop: 14 }}>
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
