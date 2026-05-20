import { useEffect, useState } from "react";

export default function SplashScreen({ visible }) {
  const [mounted, setMounted] = useState(visible);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      const frameId = window.requestAnimationFrame(() => {
        setEntered(true);
      });
      return () => window.cancelAnimationFrame(frameId);
    }

    setEntered(false);
    const timeoutId = window.setTimeout(() => {
      setMounted(false);
    }, 220);
    return () => {
      window.clearTimeout(timeoutId);
    };
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
        background: "#F7FBFC",
        opacity: visible && entered ? 1 : 0,
        transition: "opacity 220ms ease",
        pointerEvents: visible ? "auto" : "none",
      }}
      aria-hidden={!visible}
    >
      <img
        src="/app-icon-192.png"
        alt=""
        aria-hidden="true"
        style={{
          width: 96,
          height: 96,
          display: "block",
        }}
      />
    </div>
  );
}
