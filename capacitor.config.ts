import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.okanishiseita.ironlog",
  appName: "PUMP",
  webDir: "build",
  backgroundColor: "#0E9E88",
  plugins: {
    SplashScreen: {
      launchShowDuration: 100,
      autoHide: true,
      backgroundColor: "#0E9E88",
    },
  },
};

export default config;
