import { useEffect, useState } from "react";

export default function SplashScreen({ visible }) {
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    const initialSplash = document.getElementById("initial-splash");
    if (initialSplash) {
      initialSplash.remove();
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return undefined;
    }

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
        background: "#0E9E88",
        opacity: visible ? 1 : 0,
        transition: visible ? "none" : "opacity 220ms ease",
        pointerEvents: visible ? "auto" : "none",
      }}
      aria-hidden={!visible}
    >
      <img
        src="/splash-logo.svg"
        alt=""
        aria-hidden="true"
        style={{
          width: "min(38vw, 38vh)",
          height: "auto",
          display: "block",
        }}
      />
    </div>
  );
}
