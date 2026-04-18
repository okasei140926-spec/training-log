import { useState } from "react";
import { supabase } from "../utils/supabase";

export default function Auth({ onClose }) {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        await supabase.from("profiles").insert({
          id: data.user.id,
          username,
        });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 32, maxWidth: 400, margin: "0 auto" }}>
      <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", marginTop: 16 }}>✕</button>
      <h2 style={{ marginBottom: 24 }}>
        {mode === "login" ? "ログイン" : "新規登録"}
      </h2>
      {mode === "signup" && (
        <input
          placeholder="ユーザー名"
          value={username}
          onChange={e => setUsername(e.target.value)}
          style={{ display: "block", width: "100%", marginBottom: 12, padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
        />
      )}
      <input
        placeholder="メールアドレス"
        value={email}
        onChange={e => setEmail(e.target.value)}
        style={{ display: "block", width: "100%", marginBottom: 12, padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
      />
      <input
        type="password"
        placeholder="パスワード"
        value={password}
        onChange={e => setPassword(e.target.value)}
        style={{ display: "block", width: "100%", marginBottom: 12, padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
      />
      {error && <p style={{ color: "red", marginBottom: 12 }}>{error}</p>}
      <button
        onClick={handleSubmit}
        disabled={loading}
        style={{ width: "100%", padding: 12, borderRadius: 8, background: "#4ade80", border: "none", fontWeight: 700, fontSize: 16 }}
      >
        {loading ? "処理中..." : mode === "login" ? "ログイン" : "登録"}
      </button>
      <button
        onClick={() => setMode(mode === "login" ? "signup" : "login")}
        style={{ width: "100%", marginTop: 12, padding: 12, borderRadius: 8, background: "none", border: "1px solid #ccc" }}
      >
        {mode === "login" ? "新規登録はこちら" : "ログインはこちら"}
      </button>
    </div>
  );
}
