export const S = {
  root:        { minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "'Helvetica Neue', sans-serif", maxWidth: 430, margin: "0 auto", position: "relative", paddingBottom: 80 },
  header:      { padding: "24px 20px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" },
  appLabel:    { fontSize: 11, color: "var(--text2)", letterSpacing: 3, textTransform: "uppercase", marginBottom: 4 },
  headerTitle: { fontSize: 22, fontWeight: 700 },
  pillBtn:     { background: "var(--card2)", color: "var(--text)", padding: "6px 14px", borderRadius: 20, fontSize: 12, border: "1px solid var(--border2)", cursor: "pointer" },
  sLabel:      { fontSize: 11, color: "var(--text2)", letterSpacing: 3, marginBottom: 12, textTransform: "uppercase" },
  bottomNav:   { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "var(--nav-bg)", backdropFilter: "blur(20px)", borderTop: "1px solid var(--border)", display: "flex", padding: "12px 0 20px" },
};

export const css = `
  :root {
    --bg: #0a0a0a;
    --card: #161616;
    --card2: #202020;
    --card-modal: #1a1a1a;
    --border: #2e2e2e;
    --border2: #3c3c3c;
    --border3: #4a4a4a;
    --text: #ffffff;
    --text2: #999999;
    --text3: #7a7a7a;
    --text4: #5a5a5a;
    --text5: #3e3e3e;
    --nav-bg: #0a0a0aee;
    --input-bg: #202020;
    --btn-secondary: #2a2a2a;
  }
  .theme-light {
    --bg: #f2f2f2;
    --card: #ffffff;
    --card2: #e8e8e8;
    --card-modal: #fafafa;
    --border: #d0d0d0;
    --border2: #b8b8b8;
    --border3: #a0a0a0;
    --text: #111111;
    --text2: #555555;
    --text3: #444444;
    --text4: #333333;
    --text5: #888888;
    --nav-bg: #f2f2f2ee;
    --input-bg: #e8e8e8;
    --btn-secondary: #e0e0e0;
  }
  * { box-sizing: border-box; }
  input { outline: none; }
  button { cursor: pointer; border: none; }
  ::-webkit-scrollbar { width: 0; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  .fade-in { animation: fadeIn 0.3s ease forwards; }
  .pressable {
    transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.15s ease;
    cursor: pointer;
  }
  .pressable:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.5); }
  .pressable:active { transform: translateY(0); box-shadow: none; }
`;
