import type { MailMessage } from './mail.service';

/**
 * Шаблоны писем (русский, голос COPY.md: спокойный профессионал, без восклицаний).
 * Вёрстка — простая инлайновая, светлый фон (почтовые клиенты тёмную тему
 * рендерят сами). В письмах нет ПД сверх адреса получателя.
 */

const wrap = (title: string, bodyHtml: string): string => `<!doctype html>
<html lang="ru">
<body style="margin:0;padding:0;background:#f4f5f7;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#1f2329;">
    <div style="background:#ffffff;border:1px solid #e3e6ea;border-radius:8px;padding:32px;">
      <p style="margin:0 0 24px;font-size:18px;font-weight:bold;color:#1f2329;">ReplyDesk</p>
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:bold;color:#1f2329;">${title}</h1>
      ${bodyHtml}
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#8a9099;text-align:center;">ReplyDesk — ответы на отзывы клиентов с помощью AI</p>
  </div>
</body>
</html>`;

const button = (href: string, label: string): string =>
  `<p style="margin:24px 0;"><a href="${href}" style="display:inline-block;background:#2f6fed;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;">${label}</a></p>`;

/** Приветственное письмо после регистрации. */
export function welcomeEmail(to: string, appUrl: string): MailMessage {
  const subject = 'Добро пожаловать в ReplyDesk';
  const text = [
    'Добро пожаловать в ReplyDesk',
    '',
    'Аккаунт создан. Вот что теперь умеет ваш пульт управления репутацией:',
    '',
    '— Готовый ответ для площадки: вставьте отзыв клиента — через восемь секунд получите текст, который можно публиковать.',
    '— Задача для команды: по каждому отзыву сервис формирует внутреннее задание — что исправить и кому.',
    '— План возврата клиента: рекомендации, как вернуть недовольного клиента.',
    '',
    'На бесплатном тарифе — 10 генераций в месяц, без карты.',
    '',
    `Начать: ${appUrl}`,
    '',
    'Если вы не создавали аккаунт в ReplyDesk — просто проигнорируйте это письмо.',
  ].join('\n');
  const html = wrap(
    'Добро пожаловать в ReplyDesk',
    `
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">Аккаунт создан. Вот что теперь умеет ваш пульт управления репутацией:</p>
      <ul style="margin:0 0 16px;padding-left:20px;font-size:14px;line-height:1.8;">
        <li><strong>Готовый ответ для площадки</strong> — вставьте отзыв клиента, через восемь секунд получите текст, который можно публиковать.</li>
        <li><strong>Задача для команды</strong> — по каждому отзыву сервис формирует внутреннее задание: что исправить и кому.</li>
        <li><strong>План возврата клиента</strong> — рекомендации, как вернуть недовольного клиента.</li>
      </ul>
      <p style="margin:0 0 8px;font-size:14px;line-height:1.6;">На бесплатном тарифе — 10 генераций в месяц, без карты.</p>
      ${button(appUrl, 'Открыть пульт')}
      <p style="margin:0;font-size:12px;color:#8a9099;line-height:1.6;">Если вы не создавали аккаунт в ReplyDesk — просто проигнорируйте это письмо.</p>
    `,
  );
  return { to, subject, html, text };
}

/** Письмо со ссылкой на сброс пароля. Ссылка действует 1 час (ADR-043). */
export function passwordResetEmail(to: string, resetUrl: string): MailMessage {
  const subject = 'Восстановление пароля в ReplyDesk';
  const text = [
    'Восстановление пароля',
    '',
    'Вы запросили восстановление пароля в ReplyDesk. Перейдите по ссылке и задайте новый пароль:',
    '',
    resetUrl,
    '',
    'Ссылка действует один час и работает только один раз.',
    '',
    'Если это были не вы — просто проигнорируйте письмо, пароль останется прежним.',
  ].join('\n');
  const html = wrap(
    'Восстановление пароля',
    `
      <p style="margin:0 0 8px;font-size:14px;line-height:1.6;">Вы запросили восстановление пароля в ReplyDesk. Нажмите кнопку и задайте новый пароль.</p>
      ${button(resetUrl, 'Задать новый пароль')}
      <p style="margin:0 0 16px;font-size:13px;color:#5b6470;line-height:1.6;">Если кнопка не работает, скопируйте ссылку в браузер:<br /><a href="${resetUrl}" style="color:#2f6fed;word-break:break-all;">${resetUrl}</a></p>
      <p style="margin:0 0 8px;font-size:13px;color:#5b6470;line-height:1.6;">Ссылка действует один час и работает только один раз.</p>
      <p style="margin:0;font-size:12px;color:#8a9099;line-height:1.6;">Если это были не вы — просто проигнорируйте письмо, пароль останется прежним.</p>
    `,
  );
  return { to, subject, html, text };
}
