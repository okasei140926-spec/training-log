import { useState, useEffect } from "react";
import { load, save } from "../utils/helpers";

export function useSettings() {
  const [isDark, setIsDark] = useState(() => load("isDark", true));
  const [unit, setUnit] = useState(() => load("unit", "kg"));
  const [showOnboarding, setShowOnboarding] = useState(() => !load("onboardingDone", false));

  useEffect(() => { save("isDark", isDark); }, [isDark]);
  useEffect(() => { save("unit", unit); }, [unit]);

  const completeOnboarding = () => {
    save("onboardingDone", true);
    setShowOnboarding(false);
  };

  return { isDark, setIsDark, unit, setUnit, showOnboarding, completeOnboarding };
}
