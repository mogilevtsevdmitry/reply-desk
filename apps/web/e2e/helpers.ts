/**
 * Вспомогательные функции для E2E-тестов ReplyDesk.
 * API_URL — изолированное окружение :4100.
 */

import { type Page, type BrowserContext, expect } from '@playwright/test';

export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4100/api/v1';
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3100';

let _counter = Date.now();
/** Уникальный email для каждого теста. */
export function uniqueEmail(): string {
  return `e2e-${++_counter}@test.ru`;
}

/**
 * Регистрация + логин через API, возвращает accessToken и email.
 * Rate limit на /auth/*: 10 req/min. При 429 — ждём и повторяем.
 */
export async function apiRegisterAndLogin(
  email: string,
  password = 'Test1234!',
): Promise<{ accessToken: string; email: string }> {
  // register
  const regRes = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!regRes.ok && regRes.status !== 409) {
    throw new Error(`Register failed: ${regRes.status} ${await regRes.text()}`);
  }

  // login — retry on 429 (rate limit 10 req/min)
  let lastError = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 7_000 * attempt));
    const loginRes = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    });
    if (loginRes.status === 429) {
      lastError = `429 rate limited`;
      continue;
    }
    if (!loginRes.ok) {
      throw new Error(`Login failed: ${loginRes.status} ${await loginRes.text()}`);
    }
    const { accessToken } = (await loginRes.json()) as { accessToken: string };
    return { accessToken, email };
  }
  throw new Error(`Login failed after retries: ${lastError}`);
}

/** Создание компании через API, возвращает новый accessToken с companyId. */
export async function apiCreateCompany(
  accessToken: string,
  name = 'Тест Салон Е2Е',
): Promise<{ accessToken: string; companyId: string }> {
  const res = await fetch(`${API_URL}/company`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      name,
      niche: 'SALON',
      toneOfVoice: { tone: 'neutral', examples: [] },
    }),
  });
  if (!res.ok) throw new Error(`CreateCompany failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { accessToken: string; company: { id: string } };
  return { accessToken: body.accessToken, companyId: body.company.id };
}

/** POST /reviews через API, возвращает reviewId/generationId. */
export async function apiCreateReview(
  accessToken: string,
  params: {
    rawText: string;
    source?: string;
    rating?: number;
    authorName?: string;
  },
): Promise<{ reviewId: string; generationId: string }> {
  const res = await fetch(`${API_URL}/reviews`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      source: params.source ?? 'YANDEX_MAPS',
      rawText: params.rawText,
      ...(params.rating ? { rating: params.rating } : {}),
      ...(params.authorName ? { authorName: params.authorName } : {}),
    }),
  });
  if (!res.ok) throw new Error(`CreateReview failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ reviewId: string; generationId: string }>;
}

/** Дождаться финального статуса генерации (DONE или FAILED) через SSE. */
export async function waitForGenerationDone(
  accessToken: string,
  generationId: string,
  timeoutMs = 30_000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${API_URL}/reviews?pageSize=1`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = (await res.json()) as { items: Array<{ generation?: { status: string } }> };
    // Проверяем через polling REST, не через SSE (SSE требует fetch+stream)
    // Используем GET /reviews/:id чтобы получить конкретную генерацию
    const genRes = await fetch(`${API_URL}/generations/${generationId}/status`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => null);
    if (!genRes?.ok) {
      // Если нет отдельного status endpoint, получаем через reviews
      break;
    }
    const status = (await genRes.json()) as { status: string };
    if (status.status === 'DONE' || status.status === 'FAILED') return status.status;
    await new Promise((r) => setTimeout(r, 500));
  }
  return 'TIMEOUT';
}

/**
 * Дождаться DONE/FAILED через периодические запросы GET /reviews/:id.
 * FakeLlmProvider быстрый — обычно < 2s.
 */
export async function pollReviewStatus(
  accessToken: string,
  reviewId: string,
  timeoutMs = 20_000,
): Promise<'DONE' | 'FAILED' | 'TIMEOUT'> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 800));
    const res = await fetch(`${API_URL}/reviews/${reviewId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) continue;
    const data = (await res.json()) as { generation?: { status: string } };
    const st = data.generation?.status;
    if (st === 'DONE') return 'DONE';
    if (st === 'FAILED') return 'FAILED';
  }
  return 'TIMEOUT';
}

/**
 * Установить токен в localStorage браузера так, чтобы AuthProvider подхватил его.
 * Используем cookie rd_refresh и память токена через window.__RD_SET_TOKEN__ (не стандартно),
 * поэтому лучше сделать настоящий логин через форму или передать token в API_URL через куку.
 *
 * Более надёжно: использовать browserContext.addCookies + localStorage injection.
 */
export async function injectAuthSession(page: Page, accessToken: string): Promise<void> {
  // Токен хранится в module-level переменной в token.ts
  // Способ: устанавливаем через evaluate перед навигацией на protected route
  await page.goto(BASE_URL + '/login');
  await page.evaluate((token: string) => {
    // Шим: AuthProvider подхватывает токен при subscribe
    // Токен живёт в module singleton, но через window можно пробросить
    window.dispatchEvent(
      new CustomEvent('__rd_inject_token__', { detail: token }),
    );
  }, accessToken);
}

/** Выполнить логин через UI-форму. */
export async function loginViaUI(page: Page, email: string, password = 'Test1234!'): Promise<void> {
  await page.goto(BASE_URL + '/login');
  await page.getByLabel('Электронная почта').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти в пульт' }).click();
}

/**
 * Navigate to /app using a pre-authenticated page.
 * The browser context must be created with the user's storageState (see getFixture().stateFile).
 * This bypasses UI login and avoids the /auth/* rate limit (10 req/min).
 *
 * Usage:
 *   const context = await browser.newContext({ storageState: fixture.stateFile });
 *   const page = await context.newPage();
 *   await navigateToApp(page);
 */
export async function navigateToApp(page: Page): Promise<void> {
  await page.goto(BASE_URL + '/app');
  await expect(page).toHaveURL(/\/app/, { timeout: 15_000 });
}

/**
 * @deprecated Use browser.newContext({ storageState: fixture.stateFile }) instead.
 * Kept for backwards compatibility.
 */
export async function loginViaRefreshCookie(
  context: BrowserContext,
  page: Page,
  _refreshCookie: string,
): Promise<void> {
  await page.goto(BASE_URL + '/app');
  await expect(page).toHaveURL(/\/app/, { timeout: 15_000 });
}

/** Дождаться появления пайплайн-панели. */
export async function waitForPipeline(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Собираем пакет реакции' })).toBeVisible({ timeout: 15_000 });
}

/** Дождаться появления карточек результата (все 4). */
export async function waitForResultCards(page: Page): Promise<void> {
  // Заголовок «Пакет реакции готов» появляется после 900 мс удержания (ADR-023)
  await expect(page.getByRole('heading', { name: 'Пакет реакции готов' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Публичный ответ' })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('heading', { name: 'Внутренняя задача' })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('heading', { name: 'Классификация' })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('heading', { name: 'Возврат клиента' })).toBeVisible({ timeout: 5_000 });
}
