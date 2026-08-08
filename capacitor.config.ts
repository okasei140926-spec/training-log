import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.okanishiseita.ironlog",
  appName: "PUMP",
  webDir: "build",
  backgroundColor: "#0f0f0f",
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      autoHide: true,
      backgroundColor: "#0f0f0f",
    },
  },
};

export default config;
