export const S = {
  root: {
    background: "var(--bg)",
    color: "var(--text)",
    fontFamily: "'Helvetica Neue', sans-serif",
    width: "100%",
    maxWidth: 430,
    margin: "0 auto",
    paddingBottom: "var(--bottom-nav-scroll-padding)",
  },
  page: {
    padding: "18px 18px var(--bottom-nav-scroll-padding)",
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
	    left: 0,
	    right: 0,
	    width: "100%",
	    zIndex: 520,
	    display: "flex",
	    alignItems: "flex-end",
	    height: "var(--bottom-nav-height)",
	    paddingBottom: "var(--safe-bottom)",
	    boxSizing: "border-box",
	    pointerEvents: "none",
	    background: "var(--bottom-nav-bg)",
	    backdropFilter: "blur(10px)",
	    WebkitBackdropFilter: "blur(10px)",
	    borderTop: "none",
	    boxShadow: "none",
	  },
  bottomNavInner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    maxWidth: 430,
    margin: "0 auto",
    height: 56,
    padding: "0 12px",
    boxSizing: "border-box",
    background: "var(--bottom-nav-bg)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    borderTop: "1px solid var(--border2)",
    boxShadow: "0 -12px 28px var(--bottom-nav-shadow)",
    pointerEvents: "auto",
  },
};

export const css = `
  :root {
    --safe-bottom: env(safe-area-inset-bottom, 0px);
    --bottom-nav-base-height: 56px;
    --bottom-nav-height: calc(var(--bottom-nav-base-height) + var(--safe-bottom));
    --bottom-nav-clearance: calc(188px + var(--safe-bottom));
    --bottom-nav-scroll-padding: calc(var(--bottom-nav-clearance) + 24px);
  }
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
    --bottom-nav-bg: rgba(15, 19, 20, 0.97);
    --bottom-nav-shadow: rgba(0,0,0,0.34);
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
    --home-bg: linear-gradient(180deg, #05090B 0%, #071012 52%, #05090B 100%);
    --home-card: linear-gradient(180deg, rgba(13,22,25,0.98), rgba(8,14,17,0.99));
    --home-inner-card: linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.025));
    --home-card-border: rgba(255,255,255,0.07);
    --home-inner-border: rgba(255,255,255,0.08);
    --home-row-border: rgba(255,255,255,0.08);
    --home-title: #ffffff;
    --home-text: #ffffff;
    --home-muted: rgba(255,255,255,0.58);
    --home-muted2: rgba(255,255,255,0.72);
    --home-shadow: 0 18px 40px rgba(0,0,0,0.42);
  }
  .theme-light {
    --bg: #e2eaea;
    --card: #ffffff;
    --card2: #f0f5f5;
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
    --bottom-nav-bg: rgba(255,255,255,0.98);
    --bottom-nav-shadow: rgba(15,94,99,0.13);
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
    --home-bg: #e2eaea;
    --home-card: #ffffff;
    --home-inner-card: linear-gradient(180deg, #ffffff, #F8FBFB);
    --home-card-border: rgba(18,199,194,0.10);
    --home-inner-border: rgba(18,199,194,0.12);
    --home-row-border: rgba(15,94,99,0.10);
    --home-title: #0A3F44;
    --home-text: #0A3F44;
    --home-muted: #8BA4A8;
    --home-muted2: #5D7A7E;
    --home-shadow: 0 14px 30px rgba(15,94,99,0.08);
  }
  .app-shell {
    height: var(--app-height);
    min-height: var(--app-height);
    background: var(--bg);
  }
  * { box-sizing: border-box; }
  input { outline: none; }
  button { cursor: pointer; border: none; }
  html, body, #root { background: var(--bg); }
  body { background: var(--bg); }
  body[data-log-set-input-active="true"] [data-bottom-nav="true"] {
    display: none !important;
  }
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
