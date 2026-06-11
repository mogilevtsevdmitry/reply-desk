/**
 * E2E-сценарий 3: Ошибка генерации
 * Отзыв с [[FAKE:NETWORK]] → FAILED → сообщение об ошибке + «Лимит не потрачен» +
 * кнопка «Повторить генерацию» → повтор с тем же маркером → снова FAILED (ожидаемо).
 *
 * ADR-019: маркер [[FAKE:NETWORK]] вызывает LlmNetworkError в FakeLlmProvider.
 * ADR-002: FAILED возвращает лимит (декремент-компенсация).
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { BASE_URL } from './helpers';
import { getFixture } from './fixtures';

// Маркер сетевой ошибки (ADR-019)
const FAKE_NETWORK_TEXT = 'Отзыв с ошибкой сети [[FAKE:NETWORK]] для теста.';

test.describe('Сценарий 3: Ошибка генерации (FAILED + Повторить)', () => {
  let page: Page;
  let context: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    const fixture = getFixture('error');
    // Use saved storageState to bypass UI login (avoids /auth/* rate limit)
    context = await browser.newContext({ storageState: fixture.stateFile });
    page = await context.newPage();
    await page.goto(BASE_URL + '/app');
    await expect(page).toHaveURL(/\/app/, { timeout: 15_000 });
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('[[FAKE:NETWORK]] → пайплайн останавливается → сообщение об ошибке → кнопка Повторить', async () => {
    // Убедиться что на главном экране
    await expect(page.getByRole('heading', { name: 'Новый отзыв' })).toBeVisible({ timeout: 5_000 });

    // Ввести отзыв с маркером ошибки
    await page.getByLabel('Текст отзыва').fill(FAKE_NETWORK_TEXT);
    await page.getByRole('button', { name: 'Сгенерировать пакет реакции' }).click();

    // Пайплайн виден
    await expect(page.getByRole('heading', { name: 'Собираем пакет реакции' })).toBeVisible({ timeout: 10_000 });

    // Ждём FAILED-состояние: блок ошибки появляется в панели пайплайна
    await expect(page.getByText('Не получилось собрать пакет')).toBeVisible({ timeout: 30_000 });

    // Текст FAILED содержит «Лимит не потрачен» (ADR-002, обязательная формулировка)
    await expect(
      page.getByText('Лимит не потрачен', { exact: false }),
    ).toBeVisible({ timeout: 5_000 });

    // Полный текст согласно COPY.md
    await expect(
      page.getByText(
        'Сервис генерации не ответил вовремя. Лимит не потрачен — попробуйте ещё раз, отзыв сохранён.',
        { exact: false },
      ),
    ).toBeVisible();

    // Кнопка «Повторить генерацию» видима и кликабельна
    const retryBtn = page.getByRole('button', { name: 'Повторить генерацию' });
    await expect(retryBtn).toBeVisible();
    await expect(retryBtn).toBeEnabled();

    // Карточек результата НЕ должно быть — пайплайн остановлен
    await expect(page.getByRole('heading', { name: 'Пакет реакции готов' })).not.toBeVisible();
  });

  test('повтор с тем же маркером снова FAILED — UI корректно показывает второй FAILED', async () => {
    // Нажать «Повторить генерацию»
    await page.getByRole('button', { name: 'Повторить генерацию' }).click();

    // Рейка перезапускается (ADR-003): снова виден пайплайн
    await expect(page.getByRole('heading', { name: 'Собираем пакет реакции' })).toBeVisible({ timeout: 10_000 });

    // Снова FAILED (тот же маркер [[FAKE:NETWORK]])
    await expect(page.getByText('Не получилось собрать пакет')).toBeVisible({ timeout: 30_000 });

    // «Лимит не потрачен» виден во второй раз тоже
    await expect(page.getByText('Лимит не потрачен', { exact: false })).toBeVisible();

    // Кнопка «Повторить» снова видима
    await expect(page.getByRole('button', { name: 'Повторить генерацию' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Повторить генерацию' })).toBeEnabled();
  });
});
