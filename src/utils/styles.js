export const S = {
  root: { minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "'Helvetica Neue', sans-serif", maxWidth: 430, margin: "0 auto", paddingBottom: 110 },
  header: {
    padding: "14px 20px 10px",
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
    padding: "12px 0 20px",
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
    --accent: #22C55E;
    --accent2: #38BDF8;
    --shadow-card: 0 10px 28px rgba(0,0,0,0.28);
    --shadow-soft: 0 8px 20px rgba(56,189,248,0.12);
    --success-soft: rgba(34, 197, 94, 0.14);
    --success-border: rgba(34, 197, 94, 0.3);
    --info-soft: rgba(56, 189, 248, 0.14);
    --info-border: rgba(56, 189, 248, 0.28);
    --focus-ring: 0 0 0 4px rgba(56, 189, 248, 0.16);
  }
  .theme-light {
    --bg: #F8FAFC;
    --card: #ffffff;
    --card2: #F8FBFF;
    --card-modal: #ffffff;
    --border: #86EFAC;
    --border2: #D9E4EF;
    --border3: #C6D5E3;
    --text: #0F172A;
    --text2: #64748B;
    --text3: #94A3B8;
    --text4: #B1BFCD;
    --text5: #CBD5E1;
    --nav-bg: rgba(255,255,255,0.92);
    --input-bg: #FFFFFF;
    --btn-secondary: #F1F5F9;
    --accent: #22C55E;
    --accent2: #38BDF8;
    --shadow-card: 0 10px 28px rgba(15,23,42,0.06);
    --shadow-soft: 0 10px 24px rgba(56,189,248,0.10);
    --success-soft: #ECFDF5;
    --success-border: #BBF7D0;
    --info-soft: #E0F2FE;
    --info-border: #BAE6FD;
    --focus-ring: 0 0 0 4px rgba(56, 189, 248, 0.16);
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
