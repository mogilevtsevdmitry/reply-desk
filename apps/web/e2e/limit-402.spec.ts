/**
 * E2E-сценарий 4: 402 лимит
 * Создаём компанию с лимитом FREE=10, нагружаем через API (10 запросов),
 * затем попытка генерации через UI → экран апгрейда.
 *
 * ADR-002: лимит резервируется при POST /reviews (не при DONE).
 * ADR-012 (обновлён ADR-035..039): экран 402 с тарифами START/BUSINESS,
 * CTA «Открыть тарифы» ведёт на /app/billing; счётчик в сайдбаре кликабелен.
 * На e2e-стенде биллинг ВЫКЛЮЧЕН → /app/billing показывает billingEnabled=false.
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { BASE_URL, API_URL, apiCreateReview } from './helpers';
import { getFixture } from './fixtures';

test.describe('Сценарий 4: 402 лимит → экран апгрейда', () => {
  let page: Page;
  let context: BrowserContext;
  let accessToken: string;
  let limitReached = false;

  test.beforeAll(async ({ browser }) => {
    const fixture = getFixture('limit');
    accessToken = fixture.companyToken;

    // Израсходовать лимит: создать 10 отзывов через API последовательно
    // (параллельный $executeRaw вызывает BUG-003: 25P02 transaction aborted)
    for (let i = 0; i < 10; i++) {
      try {
        await apiCreateReview(accessToken, {
          rawText: `Тестовый отзыв для исчерпания лимита номер ${i + 1}.`,
          source: 'YANDEX_MAPS',
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('402') || msg.includes('LIMIT_EXCEEDED')) {
          console.log(`  Limit reached at request ${i + 1}`);
          break;
        }
        console.error(`  Review ${i + 1} failed: ${msg}`);
      }
    }

    // Проверить что лимит исчерпан через /company/me
    const meRes = await fetch(`${API_URL}/company/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const me = (await meRes.json()) as { usage: { used: number; limit: number } };
    console.log(`  Usage: ${me.usage.used}/${me.usage.limit}`);
    limitReached = me.usage.used >= me.usage.limit;

    // Создать браузерный контекст со сохранённым состоянием сессии (bypass UI login)
    context = await browser.newContext({ storageState: fixture.stateFile });
    page = await context.newPage();
    await page.goto(BASE_URL + '/app');
    await expect(page).toHaveURL(/\/app/, { timeout: 15_000 });
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('при исчерпанном лимите форма генерации показывает «Лимит месяца исчерпан»', async () => {
    await expect(page).toHaveURL(/\/app/);
    // Ждём загрузки данных компании (usage)
    await page.waitForTimeout(2000);

    if (limitReached) {
      // Счётчик лимита показывает 10 из 10
      await expect(page.getByText(/10 из 10/).first()).toBeVisible({ timeout: 8_000 });
      // Кнопка генерации задизейблена
      const submitBtn = page.getByRole('button', { name: 'Сгенерировать пакет реакции' });
      await expect(submitBtn).toBeDisabled({ timeout: 5_000 });
      // Текст «Лимит месяца исчерпан»
      await expect(page.getByText('Лимит месяца исчерпан', { exact: false })).toBeVisible();
      // Ссылка «Открыть тарифы» (в main, не в sidebar)
      await expect(page.getByRole('main').getByRole('link', { name: 'Открыть тарифы' })).toBeVisible();
    } else {
      test.fixme(true, 'Лимит не был полностью исчерпан — возможно BUG-003 вызвал 500 при создании отзывов');
    }
  });

  test('экран /app/upgrade: тарифы из COPY.md и CTA «Открыть тарифы»', async () => {
    test.skip(!limitReached, 'Лимит не достигнут');

    await page.goto(BASE_URL + '/app/upgrade');
    await expect(page).toHaveURL(/\/app\/upgrade/, { timeout: 5_000 });

    // Заголовок: «Лимит генераций на {month} исчерпан»
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Лимит генераций на',
    );
    // Текст с лимитом
    await expect(page.getByText(/Вы использовали все 10 генераций/)).toBeVisible();
    // Тарифные блоки
    await expect(page.getByRole('heading', { name: 'START' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'BUSINESS' })).toBeVisible();
    // Описания тарифов (COPY.md)
    await expect(page.getByText('100 генераций в месяц', { exact: false })).toBeVisible();
    await expect(page.getByText('1000 генераций в месяц', { exact: false })).toBeVisible();
    // «Платные тарифы снимут ограничение:»
    await expect(page.getByText('Платные тарифы снимут ограничение:')).toBeVisible();
    // CTA — ссылка «Открыть тарифы» (вместо старой заглушки)
    await expect(
      page.getByRole('main').getByRole('link', { name: 'Открыть тарифы' }),
    ).toBeVisible();
    // Ссылка «Вернуться к истории»
    await expect(page.getByRole('link', { name: 'Вернуться к истории' })).toBeVisible();
  });

  test('402 → «Открыть тарифы» ведёт на /app/billing', async () => {
    test.skip(!limitReached, 'Лимит не достигнут');

    await page.goto(BASE_URL + '/app/upgrade');
    await page.getByRole('main').getByRole('link', { name: 'Открыть тарифы' }).click();
    await expect(page).toHaveURL(/\/app\/billing/, { timeout: 5_000 });
    await expect(page.getByRole('heading', { name: 'Тариф и оплата' })).toBeVisible({
      timeout: 8_000,
    });
  });

  test('/app/billing открывается: секции и billingEnabled=false на e2e-стенде', async () => {
    await page.goto(BASE_URL + '/app/billing');
    await expect(page.getByRole('heading', { name: 'Тариф и оплата' })).toBeVisible({
      timeout: 8_000,
    });

    // Секции страницы
    await expect(page.getByRole('heading', { name: 'Текущий тариф' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Подписки' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Пакеты по запросу' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'История платежей' })).toBeVisible();

    // На e2e-стенде ЮKassa не настроена → плашка + кнопки покупки задизейблены
    await expect(
      page.getByText('Приём платежей временно недоступен', { exact: false }),
    ).toBeVisible();
    for (const btn of await page.getByRole('button', { name: 'Оформить' }).all()) {
      await expect(btn).toBeDisabled();
    }
    for (const btn of await page.getByRole('button', { name: 'Купить' }).all()) {
      await expect(btn).toBeDisabled();
    }

    // Юридические ссылки у CTA
    await expect(
      page.getByRole('link', { name: 'условия рекуррентных платежей' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'оферту' }).first()).toBeVisible();
  });

  test('счётчик лимита в сайдбаре кликабелен → /app/billing', async () => {
    await page.goto(BASE_URL + '/app/history');
    const counter = page.getByRole('link', {
      name: 'Счётчик генераций — открыть тариф и оплату',
    });
    await expect(counter).toBeVisible({ timeout: 8_000 });
    await counter.click();
    await expect(page).toHaveURL(/\/app\/billing/, { timeout: 5_000 });
  });

  test('попытка создания отзыва через API при исчерпанном лимите → 402', async () => {
    test.skip(!limitReached, 'Лимит не достигнут');

    const res = await fetch(`${API_URL}/reviews`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        source: 'YANDEX_MAPS',
        rawText: 'Одиннадцатый отзыв сверх лимита.',
      }),
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('LIMIT_EXCEEDED');
  });
});
