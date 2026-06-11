/**
 * E2E-сценарий 6: XSS-рендер
 * Отзыв с <script>alert(1)</script> и markdown-инъекцией →
 * рендер безопасен (нет диалогов, скрипт не исполнился),
 * текст виден как текст, копирование отдаёт исходный текст.
 *
 * ResultCards рендерит тексты генерации только через React (текстовые ноды,
 * без dangerouslySetInnerHTML) — XSS невозможен по архитектуре.
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { BASE_URL, waitForPipeline, waitForResultCards } from './helpers';
import { getFixture } from './fixtures';

// XSS-payload в тексте отзыва
const XSS_TEXT = '<script>alert(1)</script> Обычный текст с инъекцией.';
const XSS_IMG_TEXT = '"><img src=x onerror="alert(2)"> продолжение отзыва.';
const MARKDOWN_TEXT = '**жирный** и _курсив_ и `код` — это markdown-инъекция в отзыв.';

test.describe('Сценарий 6: XSS-рендер', () => {
  let page: Page;
  let context: BrowserContext;
  let alertFired = false;

  test.beforeAll(async ({ browser }) => {
    const fixture = getFixture('xss');
    // Use saved storageState to bypass UI login (avoids /auth/* rate limit)
    context = await browser.newContext({
      storageState: fixture.stateFile,
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    page = await context.newPage();

    // Перехватывать все диалоги (alert/confirm/prompt) — фиксируем и закрываем
    page.on('dialog', async (dialog) => {
      alertFired = true;
      await dialog.dismiss();
    });

    await page.goto(BASE_URL + '/app');
    await expect(page).toHaveURL(/\/app/, { timeout: 15_000 });
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('<script>alert(1)</script> в тексте отзыва — скрипт не исполняется', async () => {
    alertFired = false;

    await expect(page.getByRole('heading', { name: 'Новый отзыв' })).toBeVisible({ timeout: 5_000 });

    await page.getByLabel('Текст отзыва').fill(XSS_TEXT);
    await page.getByRole('button', { name: 'Сгенерировать пакет реакции' }).click();

    await waitForPipeline(page);
    await waitForResultCards(page);

    // alert() НЕ должен был сработать
    expect(alertFired).toBe(false);

    // «Исходный отзыв» блок виден
    await expect(page.getByRole('heading', { name: 'Исходный отзыв' })).toBeVisible();

    // Нет script-тегов с содержимым нашего XSS-пейлоада (инжектированных через textContent)
    const xssInjected = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script')).some(
        (s) => !s.src && s.textContent?.includes('alert(1)'),
      ),
    );
    expect(xssInjected).toBe(false);

    // img с onerror не инжектирован
    const imgOnerror = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img')).some(
        (img) => img.getAttribute('onerror') !== null,
      ),
    );
    expect(imgOnerror).toBe(false);
  });

  test('img onerror XSS — скрипт не исполняется', async () => {
    alertFired = false;

    // Перейти к форме
    await page.getByRole('link', { name: 'Генерация' }).click();
    await expect(page.getByRole('heading', { name: 'Новый отзыв' })).toBeVisible();

    await page.getByLabel('Текст отзыва').fill(XSS_IMG_TEXT);
    await page.getByRole('button', { name: 'Сгенерировать пакет реакции' }).click();

    await waitForPipeline(page);
    await waitForResultCards(page);

    expect(alertFired).toBe(false);

    // Нет элементов с реальным onerror-атрибутом (не просто текст в value/textContent)
    const onerrorFound = await page.evaluate(
      () => Array.from(document.querySelectorAll('[onerror]')).length > 0,
    );
    expect(onerrorFound).toBe(false);
  });

  test('копирование публичного ответа — clipboard содержит текст без HTML-тегов', async () => {
    // Нажать «Скопировать ответ»
    await page.getByRole('button', { name: 'Скопировать ответ' }).click();
    await expect(page.getByText('Скопировано в буфер обмена')).toBeVisible({ timeout: 5_000 });

    const clipboardText = await page.evaluate(async () => navigator.clipboard.readText());

    // Clipboard содержит текст (не пустой)
    expect(clipboardText.length).toBeGreaterThan(5);

    // FakeLlmProvider генерирует ответ на русском — проверяем, что нет сырых HTML
    expect(clipboardText).not.toContain('<script');
    expect(clipboardText).not.toContain('onerror=');
    expect(clipboardText).not.toContain('javascript:');
  });

  test('markdown-инъекция в тексте отзыва рендерится как plain text', async () => {
    alertFired = false;

    await page.getByRole('link', { name: 'Генерация' }).click();
    await expect(page.getByRole('heading', { name: 'Новый отзыв' })).toBeVisible();

    await page.getByLabel('Текст отзыва').fill(MARKDOWN_TEXT);
    await page.getByRole('button', { name: 'Сгенерировать пакет реакции' }).click();

    await waitForPipeline(page);
    await waitForResultCards(page);

    expect(alertFired).toBe(false);

    // В DOM нет опасных паттернов (javascript:, onerror, srcdoc)
    const dangerousPatterns = await page.evaluate(() => {
      const html = document.body.innerHTML;
      return (
        html.includes('javascript:') ||
        html.includes('onerror=') ||
        html.includes('srcdoc=')
      );
    });
    expect(dangerousPatterns).toBe(false);

    // «Исходный отзыв» не содержит <strong>/<em> от markdown (plain text рендер)
    const markdownRendered = await page.evaluate(() => {
      // Проверяем что в блоке исходного отзыва нет strong/em тегов с текстом «жирный»
      // (их нет если markdown НЕ был обработан, а отображён как текст)
      const source = document.querySelector('article h3');
      if (!source) return false;
      const article = source.closest('article');
      if (!article) return false;
      const strong = article.querySelectorAll('strong, em');
      // Ни один из этих тегов не должен содержать наш контент
      return Array.from(strong).some(
        (el) => el.textContent?.includes('жирный') || el.textContent?.includes('курсив'),
      );
    });
    // Markdown НЕ был отрендерен — false
    expect(markdownRendered).toBe(false);
  });
});
