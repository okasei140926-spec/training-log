import { createContext, useContext } from "react";

const UserSettingsContext = createContext(undefined);

export function UserSettingsProvider({ bodyWeightKg, children }) {
  return (
    <UserSettingsContext.Provider value={{ bodyWeightKg }}>
      {children}
    </UserSettingsContext.Provider>
  );
}

export function useUserSettings() {
  const context = useContext(UserSettingsContext);
  if (context === undefined) {
    throw new Error("useUserSettings must be used within a UserSettingsProvider");
  }
  return context;
}
