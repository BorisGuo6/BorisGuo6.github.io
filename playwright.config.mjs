import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:8878",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "python3 -m http.server 8878 --bind 127.0.0.1",
    port: 8878,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
