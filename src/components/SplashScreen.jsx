import { useEffect, useState } from "react";

export default function SplashScreen({ visible }) {
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setMounted(false), 360);
    return () => window.clearTimeout(timeoutId);
  }, [visible]);

  if (!mounted) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(circle at 50% 38%, rgba(91, 213, 209, 0.24), rgba(91, 213, 209, 0.06) 34%, transparent 58%), linear-gradient(180deg, #ffffff 0%, #f2fbfb 52%, #edf8f9 100%)",
        opacity: visible ? 1 : 0,
        transition: "opacity 340ms ease",
        pointerEvents: visible ? "auto" : "none",
      }}
      aria-hidden={!visible}
    >
      <style>{`
        @keyframes pumpSplashPulse {
          0%, 100% { transform: scale(1); opacity: 0.92; }
          50% { transform: scale(1.045); opacity: 1; }
        }
        @keyframes pumpSplashGlow {
          0%, 100% { box-shadow: 0 18px 44px rgba(18, 199, 194, 0.22); }
          50% { box-shadow: 0 22px 60px rgba(18, 199, 194, 0.34); }
        }
      `}</style>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          animation: "pumpSplashPulse 1300ms ease-in-out infinite",
        }}
      >
        <div
          style={{
            width: 92,
            height: 92,
            borderRadius: 28,
            background: "linear-gradient(135deg, #0F5E63, #12C7C2 58%, #77E6DF)",
            display: "grid",
            placeItems: "center",
            animation: "pumpSplashGlow 1300ms ease-in-out infinite",
          }}
        >
          <div style={{ position: "relative", width: 48, height: 34 }}>
            <div
              style={{
                position: "absolute",
                left: 1,
                top: 5,
                width: 25,
                height: 25,
                borderRadius: 10,
                border: "5px solid rgba(255,255,255,0.94)",
                transform: "rotate(45deg)",
              }}
            />
            <div
              style={{
                position: "absolute",
                right: 1,
                top: 5,
                width: 25,
                height: 25,
                borderRadius: 10,
                border: "5px solid rgba(255,255,255,0.94)",
                transform: "rotate(45deg)",
              }}
            />
          </div>
        </div>

        <div
          style={{
            fontSize: 30,
            fontWeight: 950,
            letterSpacing: 4,
            color: "#0F3F43",
            textShadow: "0 12px 28px rgba(15, 94, 99, 0.16)",
          }}
        >
          PUMP
        </div>
      </div>
    </div>
  );
}
