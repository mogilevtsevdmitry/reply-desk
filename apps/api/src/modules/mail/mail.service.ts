import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Отправка почты (ADR-044).
 *
 * Режимы:
 * - `smtp` — задан SMTP_HOST: реальная отправка через nodemailer;
 * - `log`  — SMTP_HOST не задан (локалка, тесты): письмо целиком пишется
 *   в pino-лог уровнем info с пометкой [mail:dev] — токен сброса пароля
 *   удобно доставать прямо из лога.
 *
 * Отправка fire-and-forget: ошибки логируются (logger.error) и НЕ валят
 * вызывающий флоу. Ретраев в MVP нет (ADR-044).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(config: ConfigService<Env, true>) {
    this.from = config.get('MAIL_FROM', { infer: true });
    const host = config.get('SMTP_HOST', { infer: true });
    if (host) {
      this.transporter = createTransport({
        host,
        port: config.get('SMTP_PORT', { infer: true }),
        secure: config.get('SMTP_SECURE', { infer: true }),
        auth:
          config.get('SMTP_USER', { infer: true }) !== undefined
            ? {
                user: config.get('SMTP_USER', { infer: true }),
                pass: config.get('SMTP_PASS', { infer: true }),
              }
            : undefined,
      });
    } else {
      this.transporter = null;
      this.logger.log('SMTP_HOST не задан — почта работает в режиме log ([mail:dev])');
    }
  }

  /** Режим работы: smtp (реальная отправка) или log (письмо в лог). */
  get mode(): 'smtp' | 'log' {
    return this.transporter ? 'smtp' : 'log';
  }

  /**
   * Асинхронная отправка письма. Никогда не бросает: любая ошибка —
   * logger.error, вызывающий флоу (регистрация, сброс пароля) не страдает.
   */
  async send(message: MailMessage): Promise<void> {
    try {
      if (!this.transporter) {
        // dev-режим log: письмо целиком в лог (только здесь текст письма попадает в логи)
        this.logger.log(
          `[mail:dev] to=${message.to} subject="${message.subject}"\n${message.text}`,
        );
        return;
      }
      await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      this.logger.log(`Письмо отправлено: subject="${message.subject}"`);
    } catch (err) {
      this.logger.error(
        `Не удалось отправить письмо subject="${message.subject}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
