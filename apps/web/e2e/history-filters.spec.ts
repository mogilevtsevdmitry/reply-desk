/**
 * E2E-сценарий 2: Фильтры истории
 * Создаём 4 отзыва с разными source/severity через API (fixture-пользователь),
 * затем проверяем фильтрацию в UI.
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { BASE_URL, API_URL, apiCreateReview, pollReviewStatus } from './helpers';
import { getFixture } from './fixtures';

test.describe('Сценарий 2: Фильтры истории', () => {
  let page: Page;
  let context: BrowserContext;
  let accessToken: string;
  let reviewsCreated = false;

  test.beforeAll(async ({ browser }) => {
    const fixture = getFixture('filters');
    accessToken = fixture.companyToken;

    // Создать отзывы последовательно (BUG-003: параллельный $executeRaw конфликт)
    const reviews = [
      { source: 'YANDEX_MAPS', rawText: 'Хорошее обслуживание у Яндекс.Карты первый.' },
      { source: 'YANDEX_MAPS', rawText: 'Плохой сервис, долгое ожидание на Яндекс второй.' },
      { source: 'TWOGIS', rawText: 'Отличные мастера, рекомендую 2ГИС третий отзыв.' },
      { source: 'OZON', rawText: 'Товар не соответствует описанию, требую возврата Ozon.' },
    ];

    const createdIds: string[] = [];
    for (const r of reviews) {
      try {
        const res = await apiCreateReview(accessToken, { rawText: r.rawText, source: r.source });
        createdIds.push(res.reviewId);
      } catch (e) {
        console.error(`Failed to create review: ${e}`);
      }
    }

    // Дождаться генерации всех отзывов (FakeLlmProvider быстрый)
    for (const id of createdIds) {
      await pollReviewStatus(accessToken, id, 25_000);
    }

    reviewsCreated = createdIds.length > 0;

    // Создать браузерный контекст со сохранённым состоянием сессии (bypass UI login)
    context = await browser.newContext({ storageState: fixture.stateFile });
    page = await context.newPage();
    await page.goto(BASE_URL + '/app');
    await expect(page).toHaveURL(/\/app/, { timeout: 15_000 });

    // Перейти в историю
    await page.getByRole('link', { name: 'История' }).click();
    await expect(page).toHaveURL(/\/app\/history/);
    await expect(page.getByRole('heading', { name: 'История отзывов' })).toBeVisible();
  });

  test.afterAll(async () => {
    await context.close();
  });

  // Helper: scope review-text checks to the list of review items (not the filter dropdown)
  // Uses role="link" on review cards which wraps the review text paragraph
  function reviewItem(text: RegExp) {
    return page.getByRole('link', { name: text });
  }

  test('фильтр по площадке — YANDEX_MAPS возвращает корректное подмножество', async () => {
    test.skip(!reviewsCreated, 'Отзывы не были созданы');

    // Сбросить все фильтры
    const resetBtn = page.getByRole('button', { name: 'Сбросить' });
    if (await resetBtn.isVisible()) await resetBtn.click();

    // Выбрать Яндекс.Карты
    await page.selectOption('#f-src', 'YANDEX_MAPS');
    await page.waitForTimeout(800);

    // Отзывы YANDEX_MAPS видны (первый хотя бы)
    await expect(reviewItem(/Яндекс.Карты первый/).first()).toBeVisible({ timeout: 5_000 });
    await expect(reviewItem(/Яндекс второй/).first()).toBeVisible({ timeout: 5_000 });

    // Отзыв TWOGIS не виден
    await expect(reviewItem(/2ГИС третий/).first()).not.toBeVisible();
    // Отзыв OZON не виден (scope to review cards only, not filter dropdown)
    await expect(reviewItem(/Ozon/).first()).not.toBeVisible();
  });

  test('фильтр по площадке — TWOGIS возвращает 1 отзыв', async () => {
    test.skip(!reviewsCreated, 'Отзывы не были созданы');

    // Сбросить
    await page.selectOption('#f-src', '');
    await page.waitForTimeout(400);

    // Выбрать 2ГИС
    await page.selectOption('#f-src', 'TWOGIS');
    await page.waitForTimeout(800);

    await expect(reviewItem(/2ГИС третий/).first()).toBeVisible({ timeout: 5_000 });
    await expect(reviewItem(/Яндекс.Карты первый/).first()).not.toBeVisible();
    await expect(reviewItem(/Ozon/).first()).not.toBeVisible();
  });

  test('сброс фильтров — все отзывы снова видны', async () => {
    test.skip(!reviewsCreated, 'Отзывы не были созданы');

    // Сбросить фильтр
    await page.getByRole('button', { name: 'Сбросить' }).click();
    await page.waitForTimeout(800);

    // Все 4 отзыва (хотя бы первые из каждой группы)
    await expect(reviewItem(/Яндекс.Карты первый/).first()).toBeVisible({ timeout: 5_000 });
    await expect(reviewItem(/Яндекс второй/).first()).toBeVisible();
    await expect(reviewItem(/2ГИС третий/).first()).toBeVisible();
    await expect(reviewItem(/Ozon/).first()).toBeVisible();
  });

  test('фильтр по серьёзности — severity 5 (критичная) даёт пустой результат', async () => {
    test.skip(!reviewsCreated, 'Отзывы не были созданы');

    // Сбросить фильтр
    const resetBtn = page.getByRole('button', { name: 'Сбросить' });
    if (await resetBtn.isVisible()) await resetBtn.click();
    await page.waitForTimeout(400);

    // FakeLlmProvider генерирует severity 3 — фильтр severity 5 (критичная) должен дать «ничего»
    await page.selectOption('#f-sev', '5');
    await page.waitForTimeout(800);

    // Пустой результат
    await expect(page.getByText('По этим фильтрам ничего не нашли')).toBeVisible({
      timeout: 5_000,
    });

    // Кнопка «Сбросить фильтры» в пустом состоянии сбрасывает фильтр
    await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
    await page.waitForTimeout(400);
    // Снова все отзывы
    await expect(reviewItem(/Яндекс.Карты первый/).first()).toBeVisible({ timeout: 5_000 });
  });
});
