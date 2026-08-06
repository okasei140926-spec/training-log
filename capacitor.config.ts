import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.okanishiseita.ironlog",
  appName: "PUMP",
  webDir: "build",
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      autoHide: true,
    },
  },
};

export default config;
