import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://localhost:3006', trace: 'on-first-retry' },
  webServer: {
    command: 'npm start',
    url: 'http://localhost:3006',
    reuseExistingServer: true,
    timeout: 120000
  }
});
