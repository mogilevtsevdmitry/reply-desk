/**
 * E2E-сценарий 1: Полный happy path
 * Регистрация → онбординг 3 шага → /app → генерация → пайплайн →
 * 4 карточки → блок «Исходный отзыв» → копирование → тост → история.
 *
 * E2E-сценарий 5: Viewport 360px
 * Happy path на 360×800 — элементы доступны, верхняя панель вместо сайдбара.
 *
 * Примечание: тесты регистрации используют новых пользователей
 * (не из fixtures, т.к. онбординг проходит только один раз).
 * Fixture-пользователь 'happyPath' уже прошёл онбординг и используется
 * для тестов без онбординга (прямая проверка /app).
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { BASE_URL, uniqueEmail, waitForPipeline, waitForResultCards } from './helpers';
import { getFixture } from './fixtures';

const PASSWORD = 'Test1234!';
const REVIEW_TEXT =
  'Отличный сервис, мастер Ольга — профессионал своего дела. Запись удобная, пришла вовремя, всё прошло на уровне. Рекомендую всем своим подругам!';
const AUTHOR_NAME = 'Мария';

/** Выполнить онбординг (шаги 1–3) после редиректа из регистрации. */
async function completeOnboarding(page: Page): Promise<void> {
  // Шаг 1 — компания и ниша
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByRole('heading', { name: 'Расскажите о компании' })).toBeVisible();
  await page.getByLabel('Название компании').fill('Тест Салон E2E');
  // Ниша по умолчанию SALON — проверяем, что выбрана
  await expect(page.getByRole('radio', { name: 'Салон красоты' })).toBeChecked();
  await page.getByRole('button', { name: 'Продолжить' }).click();

  // Шаг 2 — тон бренда
  await expect(page.getByRole('heading', { name: 'Каким голосом отвечает бренд' })).toBeVisible();
  // Нейтральный тон выбран по умолчанию
  await expect(page.getByRole('radio', { name: /Нейтральный/ })).toBeChecked();
  await page.getByRole('button', { name: 'Продолжить' }).click();

  // Шаг 3 — примеры (необязательны, пропускаем)
  await expect(page.getByRole('heading', { name: 'Покажите, как вы пишете' })).toBeVisible();
  await page.getByRole('button', { name: 'Открыть пульт' }).click();

  // Редирект в /app
  await expect(page).toHaveURL(/\/app/, { timeout: 15_000 });
}

test.describe('Сценарий 1: Полный happy path (новый пользователь)', () => {
  let page: Page;
  let context: BrowserContext;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    page = await context.newPage();
  });

  test.afterEach(async () => {
    await context.close();
  });

  test('регистрация → онбординг → генерация → карточки → копирование → история', async () => {
    const email = uniqueEmail();

    // ---------- Регистрация ----------
    await page.goto(BASE_URL + '/register');
    await expect(page.getByRole('heading', { name: 'Создайте аккаунт' })).toBeVisible();
    await page.getByLabel('Электронная почта').fill(email);
    await page.getByLabel('Пароль').fill(PASSWORD);

    // Кнопка задизейблена, пока не отмечены ОБА согласия (152-ФЗ)
    const submit = page.getByRole('button', { name: 'Создать аккаунт' });
    await expect(submit).toBeDisabled();
    const checkboxes = page.getByRole('checkbox');
    await expect(checkboxes).toHaveCount(2);
    await checkboxes.nth(0).check();
    await expect(submit).toBeDisabled(); // одного согласия недостаточно
    await checkboxes.nth(1).check();
    await expect(submit).toBeEnabled();
    await submit.click();

    // Редирект на онбординг после регистрации
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });

    // ---------- Онбординг 3 шага ----------
    await completeOnboarding(page);

    // ---------- Главный экран /app ----------
    await expect(page.getByRole('heading', { name: 'Новый отзыв' })).toBeVisible();

    // Навигация: ссылки видны
    await expect(page.getByRole('link', { name: 'Генерация' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'История' })).toBeVisible();

    // ---------- Заполнение формы отзыва ----------
    await page.getByLabel('Текст отзыва').fill(REVIEW_TEXT);
    // Площадка Яндекс.Карты выбрана по умолчанию
    await expect(page.getByRole('radio', { name: 'Яндекс.Карты' })).toBeChecked();
    // Выбрать оценку 5
    await page.getByRole('radio', { name: 'Оценка 5 из 5' }).click();
    // Имя клиента (ADR-024)
    await page.getByLabel('Имя клиента').fill(AUTHOR_NAME);
    // Нажать генерацию
    await page.getByRole('button', { name: 'Сгенерировать пакет реакции' }).click();

    // ---------- Анимация пайплайна видна ----------
    await waitForPipeline(page);
    // Текст отзыва виден в пайплайне (цитата с borderLeft)
    await expect(page.locator('p').filter({ hasText: /Отличный сервис/ }).first()).toBeVisible();
    // Статусная реплика пайплайна (p[role=status] внутри панели, не тост)
    await expect(page.locator('p[role="status"][aria-live="polite"]')).toBeVisible();

    // ---------- 4 карточки появились ----------
    await waitForResultCards(page);

    // ---------- Блок «Исходный отзыв» ----------
    await expect(page.getByRole('heading', { name: 'Исходный отзыв' })).toBeVisible();
    // Имя клиента в блоке исходного отзыва
    await expect(page.getByText(AUTHOR_NAME, { exact: true }).first()).toBeVisible();
    // Текст отзыва (ищем начало)
    await expect(page.getByText(/Отличный сервис/, { exact: false }).first()).toBeVisible();

    // ---------- Копирование публичного ответа ----------
    // По умолчанию выбран «Нейтральный» тон
    await expect(page.getByRole('tab', { name: 'Нейтральный' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // Нажать «Скопировать ответ»
    await page.getByRole('button', { name: 'Скопировать ответ' }).click();

    // Тост «Скопировано в буфер обмена»
    await expect(page.getByText('Скопировано в буфер обмена')).toBeVisible({ timeout: 5_000 });

    // Проверить содержимое clipboard
    const clipboardText = await page.evaluate(async () => navigator.clipboard.readText());
    expect(clipboardText.length).toBeGreaterThan(10);
    expect(clipboardText).not.toContain('<script');
    expect(clipboardText).not.toContain('[[FAKE');

    // ---------- Отзыв появился в истории ----------
    await page.getByRole('link', { name: 'История' }).click();
    await expect(page).toHaveURL(/\/app\/history/);
    await expect(page.getByRole('heading', { name: 'История отзывов' })).toBeVisible();

    // В истории должна быть хотя бы одна запись с текстом нашего отзыва
    await expect(
      page.getByText(/Отличный сервис/, { exact: false }).first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Сценарий 5: Viewport 360px (существующий пользователь)', () => {
  let page: Page;
  let context: BrowserContext;

  test.beforeEach(async ({ browser }) => {
    const fixture = getFixture('happyPath');
    // Use saved storageState to bypass UI login (avoids /auth/* rate limit)
    context = await browser.newContext({
      storageState: fixture.stateFile,
      viewport: { width: 360, height: 800 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    page = await context.newPage();
  });

  test.afterEach(async () => {
    await context.close();
  });

  test('happy path на 360×800 — верхняя панель, генерация, карточки', async () => {
    // Контекст создан с storageState в beforeEach — идём прямо в /app
    await page.goto(BASE_URL + '/app');
    await expect(page).toHaveURL(/\/app/, { timeout: 15_000 });

    // ---------- Верхняя панель вместо сайдбара (≤880px, ADR-008) ----------
    // Ссылки навигации доступны на мобильном
    await expect(page.getByRole('link', { name: 'История' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Генерация' })).toBeVisible();

    // ---------- Форма генерации ----------
    await expect(page.getByRole('heading', { name: 'Новый отзыв' })).toBeVisible();
    const textarea = page.getByLabel('Текст отзыва');
    await expect(textarea).toBeVisible();
    await textarea.fill('Хорошее место, буду приходить ещё.');

    // Площадка доступна на мобильном
    await expect(page.getByRole('radio', { name: 'Яндекс.Карты' })).toBeVisible();

    // Нажать кнопку генерации
    await page.getByRole('button', { name: 'Сгенерировать пакет реакции' }).click();

    // Пайплайн виден
    await waitForPipeline(page);

    // Карточки результата
    await waitForResultCards(page);

    // Карточки читаемы на 360px — заголовки видны
    await expect(page.getByRole('heading', { name: 'Публичный ответ' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Внутренняя задача' })).toBeVisible();
  });
});

test.describe('Юридические документы: чекбоксы и /legal/[slug]', () => {
  test('ссылки из формы регистрации ведут на /legal/* — документ открывается (200, заголовок виден)', async ({
    page,
  }) => {
    await page.goto(BASE_URL + '/register');
    await expect(page.getByRole('heading', { name: 'Создайте аккаунт' })).toBeVisible();

    // Ссылка из первого чекбокса (target=_blank) указывает на /legal/terms-of-service
    const tosLink = page.getByRole('link', { name: 'пользовательское соглашение' });
    await expect(tosLink).toHaveAttribute('href', '/legal/terms-of-service');
    await expect(tosLink).toHaveAttribute('target', '_blank');

    // Ссылка из второго чекбокса — на /legal/consent-llm
    const llmLink = page.getByRole('link', {
      name: 'согласие на передачу данных из отзывов в LLM Anthropic (США)',
    });
    await expect(llmLink).toHaveAttribute('href', '/legal/consent-llm');

    // Документ открывается без авторизации: статус 200, заголовок виден
    const res = await page.goto(BASE_URL + '/legal/consent-llm');
    expect(res?.status()).toBe(200);
    await expect(
      page.getByRole('heading', {
        name: 'Согласие на передачу данных зарубежному поставщику ИИ (трансграничная передача)',
      }),
    ).toBeVisible();

    // Остальные документы тоже доступны
    for (const slug of ['privacy-policy', 'terms-of-service', 'consent-pd']) {
      const r = await page.goto(`${BASE_URL}/legal/${slug}`);
      expect(r?.status()).toBe(200);
      await expect(page.locator('h1')).toBeVisible();
    }

    // Несуществующий slug → 404
    const notFound = await page.goto(BASE_URL + '/legal/no-such-doc');
    expect(notFound?.status()).toBe(404);
  });
});
