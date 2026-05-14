export const S = {
  root: {
    background: "var(--bg)",
    color: "var(--text)",
    fontFamily: "'Helvetica Neue', sans-serif",
    width: "100%",
    maxWidth: 430,
    margin: "0 auto",
    paddingBottom: "calc(96px + var(--safe-bottom))",
  },
  page: {
    padding: "18px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  header: {
    padding: "calc(14px + var(--safe-top)) 18px 12px",
    borderBottom: "1px solid rgba(18, 199, 194, 0.08)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    position: "sticky",
    top: 0,
    zIndex: 50,
    background: "var(--nav-bg)",
    backdropFilter: "blur(24px)",
    boxShadow: "0 10px 26px rgba(15,94,99,0.06)",
  },
  appLabel: { fontSize: 9, color: "var(--text3)", letterSpacing: 2.2, textTransform: "uppercase", marginBottom: 2 },
  headerTitle: { fontSize: 22, fontWeight: 800, lineHeight: 1.05 },
  pillBtn: {
    background: "linear-gradient(180deg, var(--card), var(--card2))",
    color: "var(--text)",
    padding: "10px 15px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    border: "1px solid rgba(18, 199, 194, 0.1)",
    boxShadow: "var(--shadow-soft)",
    cursor: "pointer",
  },
  sLabel: { fontSize: 11, color: "var(--text2)", letterSpacing: 2.5, marginBottom: 10, textTransform: "uppercase" },
  sectionCard: {
    background: "var(--card)",
    borderRadius: 22,
    padding: 16,
    border: "1px solid rgba(18, 199, 194, 0.1)",
    boxShadow: "var(--shadow-card)",
  },
  subtleCard: {
    background: "linear-gradient(180deg, var(--card2), var(--card))",
    borderRadius: 18,
    padding: 14,
    border: "1px solid rgba(18, 199, 194, 0.08)",
    boxShadow: "var(--shadow-soft)",
  },
  bottomNav: {
    position: "fixed",
    bottom: 0,
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(calc(100vw - 8px), 430px)",
    background: "var(--nav-bg)",
    backdropFilter: "blur(24px)",
    border: "1px solid rgba(18, 199, 194, 0.08)",
    borderRadius: 20,
    boxShadow: "0 6px 16px rgba(15,94,99,0.08)",
    display: "flex",
    padding: "6px 8px calc(8px + var(--safe-bottom))",
  },
};

export const css = `
  :root {
    --bg: #0f0f0f;
    --card: #1a1a1a;
    --card2: #242424;
    --card-modal: #1e1e1e;
    --border: #86EFAC;
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
    --accent: #12C7C2;
    --accent2: #33E1DB;
    --shadow-card: 0 10px 28px rgba(0,0,0,0.28);
    --shadow-soft: 0 8px 20px rgba(18,199,194,0.14);
    --success-soft: rgba(18, 199, 194, 0.14);
    --success-border: rgba(18, 199, 194, 0.3);
    --info-soft: rgba(51, 225, 219, 0.14);
    --info-border: rgba(51, 225, 219, 0.28);
    --focus-ring: 0 0 0 4px rgba(51, 225, 219, 0.18);
    --danger: #ef4444;
  }
  .theme-light {
    --bg: linear-gradient(180deg, #F7FBFB 0%, #F1F6F7 100%);
    --card: #ffffff;
    --card2: #F8FBFB;
    --card-modal: #ffffff;
    --border: #86EFAC;
    --border2: #D8E6E8;
    --border3: #C7D8DA;
    --text: #0A3F44;
    --text2: #5D7A7E;
    --text3: #8BA4A8;
    --text4: #A9BDC0;
    --text5: #C8D5D8;
    --nav-bg: rgba(255,255,255,0.88);
    --input-bg: #FFFFFF;
    --btn-secondary: #EEF5F6;
    --accent: #12C7C2;
    --accent2: #33E1DB;
    --shadow-card: 0 14px 30px rgba(15,94,99,0.08);
    --shadow-soft: 0 12px 24px rgba(18,199,194,0.1);
    --success-soft: #E8FCFB;
    --success-border: #BFEFED;
    --info-soft: #ECFCFD;
    --info-border: #C4F3F2;
    --focus-ring: 0 0 0 4px rgba(51, 225, 219, 0.2);
  }
  .app-shell {
    min-height: 100vh;
    min-height: 100dvh;
    background: var(--bg);
  }
  * { box-sizing: border-box; }
  input { outline: none; }
  button { cursor: pointer; border: none; }
  html, body, #root { background: var(--bg); }
  body { background: var(--bg); }
  input:focus, textarea:focus, select:focus {
    border-color: var(--accent2) !important;
    box-shadow: var(--focus-ring);
  }
  ::-webkit-scrollbar { width: 0; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  .fade-in { opacity: 1; }
  .pressable {
    transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.15s ease;
    cursor: pointer;
  }
  .pressable:hover { transform: translateY(-2px); box-shadow: var(--shadow-soft); }
  .pressable:active { transform: translateY(0); box-shadow: none; }
`;
