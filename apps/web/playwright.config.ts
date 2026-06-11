import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration.
 * Тесты запускаются против изолированного окружения (API :4100, Web :3100).
 * Запуск: pnpm --filter @replydesk/web test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  /* Максимальное время одного теста — 60 с */
  timeout: 60_000,
  /* Общий таймаут прогона */
  globalTimeout: 600_000,
  /* Не запускать параллельно тесты в одном файле — они используют общую БД */
  fullyParallel: false,
  /* Не повторять автоматически упавшие тесты в CI */
  retries: process.env.CI ? 1 : 0,
  /* Один воркер — тесты меняют глобальное состояние БД */
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100',
    /* Трейсы собираются при первом падении */
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    /* API URL для прямых запросов из тестов */
    extraHTTPHeaders: {
      'x-e2e-test': '1',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
