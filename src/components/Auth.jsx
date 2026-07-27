import { useCallback, useEffect, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { supabase } from "../utils/supabase";
import {
  getAppleOAuthDisabledMessage,
  getOAuthErrorMessage,
  getOAuthPendingFailureMessage,
  getOAuthProviderLabel,
  getOAuthRedirectUrl,
  isAppleOAuthEnabled,
  isNativeApp,
} from "../utils/oauth";
import { isInAppBrowser } from "../utils/invite";

// ─── Apple Sign In helpers ────────────────────────────────────────────────────
const generateNonce = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => chars[b % chars.length]).join("");
};

const sha256Hex = async (str) => {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

export default function Auth({ onClose, isDark }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [oauthLoadingProvider, setOauthLoadingProvider] = useState("");
  const oauthTimeoutRef = useRef(null);
  const oauthResumeCheckTimeoutRef = useRef(null);
  const oauthStartedAtRef = useRef(0);
  const nativeOauthHandledRef = useRef(false);
  const nativeOauthCleanupRef = useRef(() => { });

  const clearOauthPendingState = useCallback((nextError = "") => {
    if (oauthTimeoutRef.current) {
      window.clearTimeout(oauthTimeoutRef.current);
      oauthTimeoutRef.current = null;
    }
    if (oauthResumeCheckTimeoutRef.current) {
      window.clearTimeout(oauthResumeCheckTimeoutRef.current);
      oauthResumeCheckTimeoutRef.current = null;
    }

    if (nextError) setError(nextError);
    setOauthLoadingProvider("");
    setLoading(false);
    oauthStartedAtRef.current = 0;
  }, []);

  const stopNativeOAuthWatchers = useCallback(() => {
    const cleanup = nativeOauthCleanupRef.current;
    nativeOauthCleanupRef.current = () => { };
    cleanup?.();
  }, []);

  const completeNativeOAuth = useCallback((nextError = "") => {
    nativeOauthHandledRef.current = true;
    stopNativeOAuthWatchers();
    clearOauthPendingState(nextError);
  }, [clearOauthPendingState, stopNativeOAuthWatchers]);

  const bg = isDark ? "#1a1a1a" : "#fff";
  const text = isDark ? "#fff" : "#000";
  const sub = isDark ? "#aaa" : "#666";
  const border = isDark ? "#333" : "#ddd";
  const inputBg = isDark ? "#2a2a2a" : "#fff";

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        completeNativeOAuth("");
        onClose();
      }
    });

    const handleOAuthError = (event) => {
      const message = event?.detail?.message;
      completeNativeOAuth(message || "OAuthログインに失敗しました。");
    };

    const handleOAuthComplete = () => {
      completeNativeOAuth("");
    };

    window.addEventListener("pump-oauth-error", handleOAuthError);
    window.addEventListener("pump-oauth-complete", handleOAuthComplete);
    return () => {
      stopNativeOAuthWatchers();
      subscription?.unsubscribe?.();
      window.removeEventListener("pump-oauth-error", handleOAuthError);
      window.removeEventListener("pump-oauth-complete", handleOAuthComplete);
    };
  }, [completeNativeOAuth, onClose, stopNativeOAuthWatchers]);

  const startNativeOAuthWatchers = async (provider) => {
    stopNativeOAuthWatchers();
    nativeOauthHandledRef.current = false;
    oauthStartedAtRef.current = Date.now();

    const failWithMessage = (reason = "default") => {
      if (nativeOauthHandledRef.current) return;
      Browser.close().catch(() => { });
      completeNativeOAuth(getOAuthPendingFailureMessage(provider, reason));
    };

    const scheduleResumeCheck = () => {
      if (nativeOauthHandledRef.current) return;
      if (oauthResumeCheckTimeoutRef.current) {
        window.clearTimeout(oauthResumeCheckTimeoutRef.current);
      }

      oauthResumeCheckTimeoutRef.current = window.setTimeout(() => {
        if (nativeOauthHandledRef.current) return;
        if (Date.now() - oauthStartedAtRef.current < 800) return;
        failWithMessage();
      }, 300);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        scheduleResumeCheck();
      }
    };

    const handleWindowFocus = () => {
      scheduleResumeCheck();
    };

    const browserFinishedListener = await Browser.addListener("browserFinished", () => {
      // Delay to allow the custom URL scheme callback to be processed first.
      // On iPad the URL callback and browserFinished can race; without delay
      // failWithMessage fires before nativeOauthHandledRef is set to true.
      window.setTimeout(() => failWithMessage("cancelled"), 800);
    });

    const appStateListener = await CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) {
        scheduleResumeCheck();
      }
    });

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);

    oauthTimeoutRef.current = window.setTimeout(() => {
      failWithMessage();
    }, provider === "apple" ? 10000 : 45000);

    nativeOauthCleanupRef.current = () => {
      if (oauthTimeoutRef.current) {
        window.clearTimeout(oauthTimeoutRef.current);
        oauthTimeoutRef.current = null;
      }
      if (oauthResumeCheckTimeoutRef.current) {
        window.clearTimeout(oauthResumeCheckTimeoutRef.current);
        oauthResumeCheckTimeoutRef.current = null;
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
      browserFinishedListener?.remove?.();
      appStateListener?.remove?.();
    };
  };

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

  const handleOAuth = async (provider) => {
    if (provider === "google" && !isNativeApp() && isInAppBrowser()) {
      setError("Googleログインはアプリ内ブラウザでは利用できません。SafariまたはChromeで開いてください。");
      setOauthLoadingProvider("");
      setLoading(false);
      return;
    }

    // Native Apple Sign In via WKScriptMessageHandler (AppleSignInBridge.swift)
    if (provider === "apple" && isNativeApp()) {
      setError("");
      setLoading(true);
      setOauthLoadingProvider("apple");
      try {
        const rawNonce = generateNonce();
        const hashedNonce = await sha256Hex(rawNonce);
        console.log("[AppleSignIn] postMessage start");

        const detail = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            window.removeEventListener("appleSignInResult", handler);
            reject(new Error("Apple Sign In timed out"));
          }, 60000);
          const handler = (e) => {
            clearTimeout(timer);
            window.removeEventListener("appleSignInResult", handler);
            if (e.detail?.error) reject(new Error(e.detail.error));
            else resolve(e.detail);
          };
          window.addEventListener("appleSignInResult", handler);
          window.webkit.messageHandlers.appleSignIn.postMessage({ nonce: hashedNonce });
        });

        console.log("[AppleSignIn] result received", detail);
        if (!detail?.identityToken) throw new Error("Apple Sign Inからtokenを取得できませんでした。");
        const { error: signInError } = await supabase.auth.signInWithIdToken({
          provider: "apple",
          token: detail.identityToken,
          nonce: rawNonce,
        });
        if (signInError) {
          console.error("[AppleSignIn] signInWithIdToken error", signInError);
          throw signInError;
        }
        console.log("[AppleSignIn] sign in success");
        // onClose() triggered by supabase.auth.onAuthStateChange
      } catch (e) {
        if (e.message === "cancelled") {
          setOauthLoadingProvider("");
          setLoading(false);
          return;
        }
        console.error("[AppleSignIn] error", e);
        setError(getOAuthErrorMessage("apple", e));
        setOauthLoadingProvider("");
        setLoading(false);
      }
      return;
    }

    // Web Apple Sign In: gate by env var (REACT_APP_ENABLE_APPLE_OAUTH)
    if (provider === "apple" && !isAppleOAuthEnabled()) {
      setError(getAppleOAuthDisabledMessage());
      setOauthLoadingProvider("");
      setLoading(false);
      return;
    }

    const providerLabel = getOAuthProviderLabel(provider);
    setError("");
    setLoading(false);
    nativeOauthHandledRef.current = false;
    setOauthLoadingProvider(provider);

    try {
      if (isNativeApp()) {
        await startNativeOAuthWatchers(provider);
      }

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
      completeNativeOAuth("");
    }
  };

  const copyCurrentLink = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const el = document.createElement("textarea");
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopiedLink(true);
    window.setTimeout(() => setCopiedLink(false), 1800);
  };

  const inputStyle = {
    display: "block", width: "100%", marginBottom: 12,
    padding: "14px 16px", borderRadius: 12, fontSize: 16,
    border: `1px solid ${border}`, boxSizing: "border-box",
    outline: "none", color: text, background: inputBg,
  };

  const btnStyle = {
    width: "100%", padding: 16, borderRadius: 12,
    background: "linear-gradient(135deg, var(--accent), var(--accent2))", border: "none",
    fontWeight: 700, fontSize: 16, cursor: "pointer", color: "#fff",
    boxShadow: "var(--shadow-soft)",
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
      <div style={{ padding: 24, maxWidth: 430, margin: "0 auto", minHeight: "100vh", display: "flex", alignItems: "center" }}>
        <div style={{ width: "100%", textAlign: "center", background: bg, border: `1px solid ${border}`, borderRadius: 26, boxShadow: "var(--shadow-card)", padding: 28 }}>
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
      </div>
    );
  }

  if (mode === "reset") {
    return (
      <div style={{ padding: 24, maxWidth: 430, margin: "0 auto", minHeight: "100vh", display: "flex", alignItems: "center" }}>
        <div style={{ width: "100%", background: bg, border: `1px solid ${border}`, borderRadius: 26, boxShadow: "var(--shadow-card)", padding: 24 }}>
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
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 430, margin: "0 auto", minHeight: "100vh", display: "flex", alignItems: "center" }}>
      <div style={{ width: "100%", background: bg, border: `1px solid ${border}`, borderRadius: 28, boxShadow: "var(--shadow-card)", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: sub }}>✕</button>
      </div>
      <h2 style={{ marginBottom: 6, fontSize: 24, color: text }}>
        {mode === "login" ? "ログイン" : "新規登録"}
      </h2>
      <div style={{ color: sub, fontSize: 13, marginBottom: 20 }}>
        PUMPでトレーニングを記録しましょう
      </div>
      {mode === "signup" && (
        <input placeholder="ユーザー名" value={username} onChange={e => setUsername(e.target.value)} style={inputStyle} />
      )}
      <input placeholder="メールアドレス" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} />
      <input type="password" placeholder="パスワード（6文字以上）" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} />
      {error && (
        <div style={{ color: "red", marginBottom: 12, fontSize: 14, lineHeight: 1.6 }}>
          <div>{error}</div>
          {error.includes("アプリ内ブラウザ") && (
            <button
              onClick={copyCurrentLink}
              style={{
                marginTop: 10,
                padding: "9px 12px",
                borderRadius: 999,
                border: `1px solid ${border}`,
                background: inputBg,
                color: text,
                fontWeight: 800,
                fontSize: 13,
              }}
            >
              {copiedLink ? "コピーしました" : "リンクをコピー"}
            </button>
          )}
        </div>
      )}
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
    </div>
  );
}
