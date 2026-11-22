import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.js",
  use: {
    baseURL: "http://127.0.0.1:4187",
    channel: process.env.BROWSER_CHANNEL || undefined,
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4187 --strictPort",
    url: "http://127.0.0.1:4187",
    reuseExistingServer: !process.env.CI,
  },
});
