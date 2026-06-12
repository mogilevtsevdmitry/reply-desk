import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

/** Почтовый модуль (ADR-044): nodemailer или dev-режим log без SMTP_HOST. */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
