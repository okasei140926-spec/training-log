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
      <svg
        width="136.69"
        height="148"
        viewBox="0 0 136.69 148"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{
          width: "min(150px, 38vw, 38vh)",
          height: "auto",
          display: "block",
        }}
      >
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M 23.44 0.00 L 101.44 0.00 L 136.69 30.00 L 131.94 60.00 L 87.19 90.00 L 49.19 90.00 L 42.85 130.00 L 16.00 148.00 L 0.00 148.00 Z M 58.69 30.00 L 88.69 30.00 L 102.63 43.00 L 102.00 47.00 L 83.94 60.00 L 53.94 60.00 Z"
          fill="#FFFFFF"
        />
      </svg>
    </div>
  );
}
