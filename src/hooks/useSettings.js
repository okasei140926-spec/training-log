import { useState, useEffect } from "react";
import { load, save } from "../utils/helpers";

const DEFAULT_WEEKLY_SET_TARGETS = Object.fromEntries(
  ["胸", "背中", "四頭", "ハム", "尻", "肩", "二頭", "三頭", "腹筋"].map((bp) => [bp, 10])
);

export function useSettings() {
  const [isDark, setIsDark] = useState(() => load("isDark", true));
  const [unit, setUnit] = useState(() => load("unit", "kg"));
  const [showOnboarding, setShowOnboarding] = useState(() => !load("onboardingDone", false));
  const [weekStartDay, setWeekStartDay] = useState(() => load("weekStartDay", "monday"));
  const [weeklySetTargets, setWeeklySetTargets] = useState(() => ({
    ...DEFAULT_WEEKLY_SET_TARGETS,
    ...load("weeklySetTargets", {}),
  }));

  useEffect(() => { save("isDark", isDark); }, [isDark]);
  useEffect(() => { save("unit", unit); }, [unit]);
  useEffect(() => { save("weekStartDay", weekStartDay); }, [weekStartDay]);
  useEffect(() => { save("weeklySetTargets", weeklySetTargets); }, [weeklySetTargets]);

  const completeOnboarding = () => {
    save("onboardingDone", true);
    setShowOnboarding(false);
  };

  return {
    isDark, setIsDark,
    unit, setUnit,
    showOnboarding, completeOnboarding,
    weekStartDay, setWeekStartDay,
    weeklySetTargets, setWeeklySetTargets,
  };
}
