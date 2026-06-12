/**
 * E2E-сценарий 3: Ошибка генерации (ADR-042)
 * Отзыв с [[FAKE:NETWORK]] → FAILED → возврат к форме с сохранённым текстом +
 * сообщение «Лимит не потрачен» + кнопка «Повторить генерацию». Кнопка шлёт
 * текущее содержимое формы новым POST /reviews: убираем маркер из textarea →
 * «Повторить» → DONE, пакет реакции готов.
 *
 * ADR-019: маркер [[FAKE:NETWORK]] вызывает LlmNetworkError в FakeLlmProvider.
 * ADR-002: FAILED возвращает лимит (декремент-компенсация).
 * ADR-042: упавшая генерация не сохраняется — отзыв удаляется на сервере,
 * текст остаётся в форме на клиенте.
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { BASE_URL } from './helpers';
import { getFixture } from './fixtures';

// Маркер сетевой ошибки (ADR-019)
const FAKE_MARKER = '[[FAKE:NETWORK]]';
const REVIEW_TEXT = 'Отзыв с ошибкой сети для теста повторной генерации.';
const FAKE_NETWORK_TEXT = `${REVIEW_TEXT} ${FAKE_MARKER}`;

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

  test('[[FAKE:NETWORK]] → FAILED → возврат к форме: текст сохранён, сообщение об ошибке, кнопка Повторить', async () => {
    // Убедиться что на главном экране
    await expect(page.getByRole('heading', { name: 'Новый отзыв' })).toBeVisible({ timeout: 5_000 });

    // Ввести отзыв с маркером ошибки
    await page.getByLabel('Текст отзыва').fill(FAKE_NETWORK_TEXT);
    await page.getByRole('button', { name: 'Сгенерировать пакет реакции' }).click();

    // Пайплайн виден
    await expect(page.getByRole('heading', { name: 'Собираем пакет реакции' })).toBeVisible({ timeout: 10_000 });

    // FAILED → возврат к форме с блоком ошибки (ADR-042)
    await expect(page.getByText('Не получилось собрать пакет')).toBeVisible({ timeout: 30_000 });

    // Текст FAILED: «Лимит не потрачен» (ADR-002, обязательная формулировка)
    await expect(
      page.getByText('Лимит не потрачен', { exact: false }),
    ).toBeVisible({ timeout: 5_000 });

    // Полный текст согласно COPY.md
    await expect(
      page.getByText(
        'Лимит не потрачен, текст остался в форме — попробуйте ещё раз.',
        { exact: false },
      ),
    ).toBeVisible();

    // Форма видна, текст отзыва сохранён в textarea (состояние не сбрасывается)
    await expect(page.getByLabel('Текст отзыва')).toHaveValue(FAKE_NETWORK_TEXT);

    // Кнопка «Повторить генерацию» видима и кликабельна
    const retryBtn = page.getByRole('button', { name: 'Повторить генерацию' });
    await expect(retryBtn).toBeVisible();
    await expect(retryBtn).toBeEnabled();

    // Карточек результата НЕ должно быть — генерация не удалась
    await expect(page.getByRole('heading', { name: 'Пакет реакции готов' })).not.toBeVisible();
  });

  test('убрать маркер из textarea → Повторить → новый POST /reviews → DONE', async () => {
    // Исправить текст: убрать маркер ошибки (кнопка шлёт текущее содержимое формы)
    await page.getByLabel('Текст отзыва').fill(REVIEW_TEXT);

    // Нажать «Повторить генерацию» — новая отправка тех же данных формы
    await page.getByRole('button', { name: 'Повторить генерацию' }).click();

    // Рейка перезапускается: снова виден пайплайн
    await expect(page.getByRole('heading', { name: 'Собираем пакет реакции' })).toBeVisible({ timeout: 10_000 });

    // Доходит до результата
    await expect(page.getByRole('heading', { name: 'Пакет реакции готов' })).toBeVisible({ timeout: 30_000 });

    // Блока ошибки больше нет
    await expect(page.getByText('Не получилось собрать пакет')).not.toBeVisible();
  });
});
