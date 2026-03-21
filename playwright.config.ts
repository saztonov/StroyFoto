import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  retries: 1,
  fullyParallel: false,
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    serviceWorkers: "allow",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: [
    {
      command: "pnpm dev:api",
      port: 3001,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "pnpm dev:web",
      port: 5173,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
