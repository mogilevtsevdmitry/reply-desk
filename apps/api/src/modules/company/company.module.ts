import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsageModule } from '../usage/usage.module';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';

@Module({
  imports: [AuthModule, UsageModule],
  controllers: [CompanyController],
  providers: [CompanyService],
})
export class CompanyModule {}
