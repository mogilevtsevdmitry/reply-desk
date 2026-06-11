import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import {
  CompanyDto,
  CompanyMeResponse,
  CreateCompanyDto,
  CreateCompanyDtoSchema,
  CreateCompanyResponse,
  UpdateCompanyDto,
  UpdateCompanyDtoSchema,
} from '@replydesk/contracts';
import { AuthUser, CurrentCompanyId, CurrentUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CompanyService } from './company.service';

@Controller('company')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  /** Онбординг (один раз) → { company, accessToken } (ADR-005). */
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateCompanyDtoSchema)) dto: CreateCompanyDto,
  ): Promise<CreateCompanyResponse> {
    return this.companyService.create(user.userId, dto);
  }

  /** Компания + usage текущего периода — счётчик лимита в UI (ADR-022). */
  @Get('me')
  async getMe(@CurrentCompanyId() companyId: string): Promise<CompanyMeResponse> {
    return this.companyService.getMeWithUsage(companyId);
  }

  @Patch('me')
  async update(
    @CurrentCompanyId() companyId: string,
    @Body(new ZodValidationPipe(UpdateCompanyDtoSchema)) dto: UpdateCompanyDto,
  ): Promise<CompanyDto> {
    return this.companyService.update(companyId, dto);
  }
}
