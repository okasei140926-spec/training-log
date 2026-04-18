import { useState, useRef, useEffect } from "react";
import { load, save } from "../utils/helpers";

export function useTimer() {
  const [intervalSec, setIntervalSec] = useState(() => load("intervalSec", 90));
  const [timerLeft, setTimerLeft] = useState(null);
  const timerRef = useRef(null);
  const [showTimerMenu, setShowTimerMenu] = useState(false);

  useEffect(() => { save("intervalSec", intervalSec); }, [intervalSec]);

  const startTimer = (sec) => {
    const s = sec || intervalSec;
    if (!s) return;
    if (timerRef.current) clearInterval(timerRef.current);
    setTimerLeft(s);
    timerRef.current = setInterval(() => {
      setTimerLeft(p => {
        if (p <= 1) {
          clearInterval(timerRef.current);
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
          return 0;
        }
        return p - 1;
      });
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimerLeft(null);
  };

  return {
    intervalSec, setIntervalSec,
    timerLeft,
    showTimerMenu, setShowTimerMenu,
    startTimer, stopTimer,
  };
}
