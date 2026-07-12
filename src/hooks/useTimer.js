import { useState, useRef, useEffect } from "react";
import { load, save } from "../utils/helpers";

export function useTimer() {
  const [intervalSec, setIntervalSec] = useState(() => load("intervalSec", 90));
  const [timerLeft, setTimerLeft] = useState(null);
  const timerRef = useRef(null);
  const timerEndAtRef = useRef(null); // absolute timestamp when timer should reach 0
  const [showTimerMenu, setShowTimerMenu] = useState(false);

  useEffect(() => { save("intervalSec", intervalSec); }, [intervalSec]);

  const startTimer = (sec) => {
    const s = sec || intervalSec;
    if (!s) return;
    if (timerRef.current) clearInterval(timerRef.current);
    const endAt = Date.now() + s * 1000;
    timerEndAtRef.current = endAt;
    setTimerLeft(s);

    const tick = () => {
      const remaining = Math.ceil((timerEndAtRef.current - Date.now()) / 1000);
      if (remaining <= 0) {
        clearInterval(timerRef.current);
        timerRef.current = null;
        timerEndAtRef.current = null;
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        setTimerLeft(0);
      } else {
        setTimerLeft(remaining);
      }
    };

    timerRef.current = setInterval(tick, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    timerEndAtRef.current = null;
    setTimerLeft(null);
  };

  // Re-sync on foreground restore (setInterval pauses in background)
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && timerEndAtRef.current !== null) {
        const remaining = Math.ceil((timerEndAtRef.current - Date.now()) / 1000);
        if (remaining <= 0) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          timerEndAtRef.current = null;
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
          setTimerLeft(0);
        } else {
          setTimerLeft(remaining);
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return {
    intervalSec, setIntervalSec,
    timerLeft,
    showTimerMenu, setShowTimerMenu,
    startTimer, stopTimer,
  };
}
