import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.okanishiseita.ironlog",
  appName: "PUMP",
  webDir: "build",
  backgroundColor: "#F7FBFB",
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      autoHide: true,
      backgroundColor: "#F7FBFB",
    },
  },
};

export default config;
