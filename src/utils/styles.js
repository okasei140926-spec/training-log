export const S = {
  root: {
    minHeight: "100dvh",
    background: "var(--bg)",
    color: "var(--text)",
    fontFamily: "'Helvetica Neue', sans-serif",
    maxWidth: 430,
    margin: "0 auto",
    paddingBottom: "calc(110px + var(--safe-bottom))",
  },
  header: {
    padding: "calc(14px + var(--safe-top)) 20px 10px",
    borderBottom: "1px solid var(--border2)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    position: "sticky",
    top: 0,
    zIndex: 50,
    background: "var(--nav-bg)",
    backdropFilter: "blur(18px)",
    boxShadow: "0 8px 24px rgba(15,23,42,0.06)",
  },
  appLabel: { fontSize: 8, color: "var(--text3)", letterSpacing: 2, textTransform: "uppercase", marginBottom: 2 },
  headerTitle: { fontSize: 20, fontWeight: 700, lineHeight: 1.1 },
  pillBtn: {
    background: "var(--card)",
    color: "var(--text)",
    padding: "8px 14px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    border: "1px solid var(--border2)",
    boxShadow: "var(--shadow-card)",
    cursor: "pointer",
  },
  sLabel: { fontSize: 11, color: "var(--text2)", letterSpacing: 3, marginBottom: 12, textTransform: "uppercase" },
  bottomNav: {
    position: "fixed",
    bottom: 0,
    left: "50%",
    transform: "translateX(-50%)",
    width: "100%",
    maxWidth: 430,
    background: "var(--nav-bg)",
    backdropFilter: "blur(20px)",
    borderTop: "1px solid var(--border2)",
    boxShadow: "0 -10px 30px rgba(15,23,42,0.08)",
    display: "flex",
    padding: "12px 0 calc(20px + var(--safe-bottom))",
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
  }
  .theme-light {
    --bg: #F3F5F7;
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
    --nav-bg: rgba(255,255,255,0.92);
    --input-bg: #FFFFFF;
    --btn-secondary: #EEF5F6;
    --accent: #12C7C2;
    --accent2: #33E1DB;
    --shadow-card: 0 10px 28px rgba(15,94,99,0.08);
    --shadow-soft: 0 12px 24px rgba(18,199,194,0.14);
    --success-soft: #E8FCFB;
    --success-border: #BFEFED;
    --info-soft: #ECFCFD;
    --info-border: #C4F3F2;
    --focus-ring: 0 0 0 4px rgba(51, 225, 219, 0.2);
  }
  * { box-sizing: border-box; }
  input { outline: none; }
  button { cursor: pointer; border: none; }
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
