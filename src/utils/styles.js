export const S = {
  root: { minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "'Helvetica Neue', sans-serif", maxWidth: 430, margin: "0 auto", paddingBottom: 0 },
  header: { padding: "24px 20px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 50, background: "var(--bg)" },
  appLabel: { fontSize: 11, color: "var(--text2)", letterSpacing: 3, textTransform: "uppercase", marginBottom: 4 },
  headerTitle: { fontSize: 22, fontWeight: 700 },
  pillBtn: { background: "var(--card2)", color: "var(--text)", padding: "6px 14px", borderRadius: 20, fontSize: 12, border: "1px solid var(--border2)", cursor: "pointer" },
  sLabel: { fontSize: 11, color: "var(--text2)", letterSpacing: 3, marginBottom: 12, textTransform: "uppercase" },
  bottomNav: { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "var(--nav-bg)", backdropFilter: "blur(20px)", borderTop: "1px solid var(--border)", display: "flex", padding: "12px 0 20px" },
};

export const css = `
  :root {
    --bg: #0f0f0f;
    --card: #1a1a1a;
    --card2: #242424;
    --card-modal: #1e1e1e;
    --border: #22c55e;
    --border2: #333333;
    --border3: #444444;
    --text: #ffffff;
    --text2: #aaaaaa;
    --text3: #888888;
    --text4: #666666;
    --text5: #444444;
    --nav-bg: #0f0f0fee;
    --input-bg: #242424;
    --btn-secondary: #2a2a2a;
    --accent: #22c55e;
    --accent2: #ff7a00;
  }
  .theme-light {
    --bg: #f5f5f5;
    --card: #ffffff;
    --card2: #f0f0f0;
    --card-modal: #ffffff;
    --border: #22c55e;
    --border2: #dddddd;
    --border3: #cccccc;
    --text: #111111;
    --text2: #555555;
    --text3: #777777;
    --text4: #999999;
    --text5: #bbbbbb;
    --nav-bg: #ffffffee;
    --input-bg: #f0f0f0;
    --btn-secondary: #e5e5e5;
    --accent: #22c55e;
    --accent2: #ff7a00;
  }
  * { box-sizing: border-box; }
  input { outline: none; }
  button { cursor: pointer; border: none; }
  ::-webkit-scrollbar { width: 0; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  .fade-in { opacity: 1; }
  .pressable {
    transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.15s ease;
    cursor: pointer;
  }
  .pressable:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.5); }
  .pressable:active { transform: translateY(0); box-shadow: none; }
`;
