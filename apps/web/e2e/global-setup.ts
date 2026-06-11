/**
 * Глобальный setup Playwright: создаём всех тестовых пользователей
 * заранее через UI-форму входа (чтобы правильно установить rd_refresh httpOnly cookie),
 * сохраняем storageState браузера для каждого пользователя.
 *
 * Fixture-файл: e2e/fixtures/users.json — метаданные (email, accessToken, companyToken)
 * Storage-state файлы: e2e/fixtures/{key}-state.json — cookies + localStorage Playwright
 *
 * Идемпотентность: перед сессиями сбрасываем UsageCounter и Reviews для тест-пользователей
 * через прямой SQL (docker exec) — чтобы повторный прогон начинался с чистого slate.
 */
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4100/api/v1';
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3100';
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const USERS_FILE = path.join(FIXTURES_DIR, 'users.json');

async function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Register via API. Returns true if newly created, false if already existed (409).
 * Throws on unexpected errors.
 */
async function apiRegister(email: string, password: string): Promise<boolean> {
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, acceptTerms: true, acceptLlm: true }),
  });
  if (res.status === 409) return false; // already exists
  if (!res.ok) {
    throw new Error(`Register failed ${email}: ${res.status} ${await res.text()}`);
  }
  return true; // newly created
}

async function apiGetCompanyToken(
  email: string,
  password: string,
): Promise<{ accessToken: string; companyToken: string; companyId: string } | null> {
  // Login via API to get token (for company setup only, not for browser sessions)
  let accessToken: string | null = null;
  for (let i = 0; i < 6; i++) {
    const loginRes = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (loginRes.status === 429) {
      console.log(`    [rate-limited] waiting 12s (attempt ${i + 1}/6)...`);
      await wait(12_000);
      continue;
    }
    if (!loginRes.ok) return null;
    const body = (await loginRes.json()) as { accessToken: string };
    accessToken = body.accessToken;
    break;
  }
  if (!accessToken) return null;

  // Create or get company
  const companyRes = await fetch(`${API_URL}/company`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      name: `E2E Company ${email}`,
      niche: 'SALON',
      toneOfVoice: { tone: 'neutral', examples: [] },
    }),
  });

  if (companyRes.ok) {
    const body = (await companyRes.json()) as {
      accessToken: string;
      company: { id: string };
    };
    return { accessToken, companyToken: body.accessToken, companyId: body.company.id };
  }

  // Company already exists
  const errBody = (await companyRes.json()) as { code?: string };
  if (errBody.code === 'COMPANY_EXISTS') {
    const meRes = await fetch(`${API_URL}/company/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!meRes.ok) return null;
    const me = (await meRes.json()) as { id: string };
    return { accessToken, companyToken: accessToken, companyId: me.id };
  }

  return null;
}

/**
 * Do a full UI session creation and save Playwright storageState.
 *
 * Strategy (ADR-025, уточнено после первого прогона CI):
 * 1. Register via API first (idempotent — 409 means already exists).
 *    After this call the user ALWAYS exists, so a UI register attempt would
 *    get 409 and never redirect (this exact bug broke global-setup on the
 *    fresh CI database; locally users persisted between runs and masked it).
 * 2. Always login via UI form. For a brand-new user (no company yet) the
 *    GuestOnly guard redirects to /onboarding (guards.tsx), which is
 *    completed below; existing users land on /app directly.
 *    IMPORTANT: existing users may already have a valid rd_refresh cookie in storageState.
 *    We use a fresh context (no prior cookies) to force a new login.
 *
 * Using login via UI rather than pure API calls ensures the httpOnly
 * rd_refresh cookie is set on the correct API origin, so storageState captures it.
 */
async function createUserSession(
  email: string,
  password: string,
  stateFile: string,
): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  // Fresh context — NO prior storageState, so rd_refresh cookie is absent
  // and the app doesn't auto-redirect before we fill the form.
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Login via UI form.
    // Go to /login → wait for the auth bootstrap to finish (status: loading → guest)
    // before filling the form. This prevents a race where the page auto-redirects
    // if a stale cookie triggers a successful /auth/refresh.
    await page.goto(BASE_URL + '/login');
    // Wait until the form is actually visible (bootstrap done → status=guest → GuestOnly renders form)
    await page.getByLabel('Электронная почта').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByLabel('Электронная почта').fill(email);
    await page.getByLabel('Пароль').fill(password);
    await page.getByRole('button', { name: 'Войти в пульт' }).click();
    // After login, the GuestOnly guard fires router.replace('/app' | '/onboarding') — wait for it
    await page.waitForURL(/\/(app|onboarding)/, { timeout: 20_000 });

    if (page.url().includes('/onboarding')) {
      // Complete onboarding (3 steps, single /onboarding URL — no navigation between steps)
      await page.getByLabel('Название компании').fill('E2E Test Salon');
      await page.getByRole('button', { name: 'Продолжить' }).click();
      // Wait for step 2 to load (tone of voice)
      await page.waitForTimeout(1000);
      await page.getByRole('button', { name: 'Продолжить' }).click();
      // Wait for step 3 to load (examples)
      await page.waitForTimeout(1000);
      await page.getByRole('button', { name: 'Открыть пульт' }).click();
      await page.waitForURL(/\/app/, { timeout: 20_000 });
    }

    // Save storage state (cookies + localStorage) for this user
    await context.storageState({ path: stateFile });
  } finally {
    await browser.close();
  }
}

/**
 * Сброс данных тест-пользователей перед прогоном для идемпотентности.
 * Удаляет UsageCounter-строки и Review/Generation для всех e2e-*@test-e2e.ru пользователей.
 * Использует docker exec на контейнер rd-e2e-pg напрямую (без Prisma-зависимости в web-пакете).
 */
function resetE2eUserData(): void {
  const sql = `
    DELETE FROM "Generation" g
    USING "Review" r
    JOIN "Company" c ON r."companyId" = c.id
    JOIN "User" u ON u."companyId" = c.id
    WHERE g."reviewId" = r.id AND u.email LIKE 'e2e-%@test-e2e.ru';

    DELETE FROM "Review" r
    USING "Company" c
    JOIN "User" u ON u."companyId" = c.id
    WHERE r."companyId" = c.id AND u.email LIKE 'e2e-%@test-e2e.ru';

    DELETE FROM "UsageCounter" uc
    USING "Company" c
    JOIN "User" u ON u."companyId" = c.id
    WHERE uc."companyId" = c.id AND u.email LIKE 'e2e-%@test-e2e.ru';
  `;
  try {
    execSync(
      `docker exec rd-e2e-pg psql -U replydesk_e2e -d replydesk_e2e -c "${sql.replace(/"/g, '\\"').replace(/\n\s*/g, ' ')}"`,
      { stdio: 'pipe' },
    );
    console.log('  [cleanup] E2E user data reset OK\n');
  } catch (e) {
    console.warn('  [cleanup] WARNING: DB reset failed (non-fatal):', String(e).slice(0, 200));
  }
}

export default async function globalSetup(): Promise<void> {
  console.log('\n[global-setup] Creating E2E test user sessions...\n');

  // Reset test user data for idempotent re-runs
  resetE2eUserData();

  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  const password = 'Test1234!';
  const users: Record<string, unknown> = {};

  const userDefs = [
    { key: 'happyPath', email: 'e2e-happy@test-e2e.ru' },
    { key: 'filters', email: 'e2e-filters@test-e2e.ru' },
    { key: 'error', email: 'e2e-error@test-e2e.ru' },
    { key: 'limit', email: 'e2e-limit@test-e2e.ru' },
    { key: 'xss', email: 'e2e-xss@test-e2e.ru' },
  ];

  for (const def of userDefs) {
    console.log(`  Creating session: ${def.email}`);
    const stateFile = path.join(FIXTURES_DIR, `${def.key}-state.json`);

    try {
      // Register via API (idempotent — 409 means already exists).
      // После этого пользователь существует всегда → в браузере только login.
      await apiRegister(def.email, password);
      await wait(500);

      // Full browser session to get proper cookies
      await createUserSession(def.email, password, stateFile);

      // Also get API tokens for test helpers (creating reviews etc.)
      await wait(2000); // wait after UI login to avoid rate limit on API login below
      const tokens = await apiGetCompanyToken(def.email, password);
      if (!tokens) {
        console.error(`  Could not get API token for ${def.email}`);
        continue;
      }

      users[def.key] = {
        email: def.email,
        password,
        accessToken: tokens.accessToken,
        companyToken: tokens.companyToken,
        companyId: tokens.companyId,
        stateFile,
        // refreshCookie is no longer needed — we use storageState files instead
        refreshCookie: '',
      };
      console.log('  OK');
    } catch (e) {
      console.error(`  FAILED for ${def.email}: ${e}`);
    }

    // Wait between users to avoid rate limiting (10 req/min on /auth/*)
    await wait(3000);
  }

  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  console.log(`\n[global-setup] Sessions saved.\n`);
}
