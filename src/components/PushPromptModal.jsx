export default function PushPromptModal({
  isOpen,
  title,
  body,
  note,
  primaryLabel = "通知をオンにする",
  secondaryLabel = "あとで",
  onPrimary,
  onSecondary,
  busy = false,
  showPrimary = true,
}) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1600,
        background: "rgba(15, 23, 42, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 360,
          background: "var(--card)",
          borderRadius: 24,
          padding: "22px 18px 18px",
          border: "1px solid var(--border2)",
          boxShadow: "0 24px 60px rgba(15, 23, 42, 0.18)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 58,
            height: 58,
            margin: "0 auto 14px",
            borderRadius: 29,
            background: "linear-gradient(135deg, var(--accent), var(--accent2))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 26,
            boxShadow: "var(--shadow-soft)",
          }}
        >
          🔔
        </div>

        <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)", marginBottom: 10 }}>
          {title}
        </div>
        <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.7, marginBottom: 8 }}>
          {body}
        </div>
        {note && (
          <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.7, marginBottom: 16 }}>
            {note}
          </div>
        )}

        {showPrimary && (
          <button
            onClick={onPrimary}
            disabled={busy}
            style={{
              width: "100%",
              padding: "13px 16px",
              borderRadius: 14,
              background: "linear-gradient(135deg, var(--accent), #4ADE80)",
              color: "#fff",
              border: "1px solid transparent",
              fontSize: 14,
              fontWeight: 800,
              boxShadow: "var(--shadow-soft)",
              opacity: busy ? 0.8 : 1,
            }}
          >
            {busy ? "設定中..." : primaryLabel}
          </button>
        )}

        <button
          onClick={onSecondary}
          disabled={busy}
          style={{
            marginTop: 10,
            background: "none",
            border: "none",
            color: "var(--text3)",
            fontSize: 13,
            fontWeight: 700,
            padding: 8,
          }}
        >
          {secondaryLabel}
        </button>
      </div>
    </div>
  );
}
