import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/shared-browser",
  reporter: "list",
  webServer: {
    command: "npm run dev -- --port 5180",
    url: "http://127.0.0.1:5180",
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      VITE_SUPABASE_URL: "https://shared-study.test",
      VITE_SUPABASE_PUBLISHABLE_KEY: "public-contract-test-key",
      VITE_SUPABASE_SHARED_BACKEND: "true",
    },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:5180",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
      args: ["--no-sandbox"],
    },
  },
});
