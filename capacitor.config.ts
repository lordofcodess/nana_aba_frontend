import type { CapacitorConfig } from "@capacitor/cli";

// Native iOS/Android shell around the Vite build in dist/.
// appId is permanent once published to the stores.
const config: CapacitorConfig = {
  appId: "com.nanaaba.app",
  appName: "Nana Aba",
  webDir: "dist",
  ios: {
    contentInset: "never",
  },
};

export default config;
