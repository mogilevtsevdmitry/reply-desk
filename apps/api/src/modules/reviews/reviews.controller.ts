import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  CreateReviewDto,
  CreateReviewDtoSchema,
  CreateReviewResponse,
  ListReviewsQuery,
  ListReviewsQuerySchema,
  ListReviewsResponse,
  ReviewWithGeneration,
} from '@replydesk/contracts';
import { CurrentCompanyId } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ReviewsService } from './reviews.service';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  /** 202: генерация принята в работу; 402 LIMIT_EXCEEDED при исчерпанном лимите. */
  @Post()
  @HttpCode(202)
  async create(
    @CurrentCompanyId() companyId: string,
    @Body(new ZodValidationPipe(CreateReviewDtoSchema)) dto: CreateReviewDto,
  ): Promise<CreateReviewResponse> {
    return this.reviewsService.create(companyId, dto);
  }

  @Get()
  async list(
    @CurrentCompanyId() companyId: string,
    @Query(new ZodValidationPipe(ListReviewsQuerySchema)) query: ListReviewsQuery,
  ): Promise<ListReviewsResponse> {
    return this.reviewsService.list(companyId, query);
  }

  @Get(':id')
  async getOne(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
  ): Promise<ReviewWithGeneration> {
    return this.reviewsService.getOne(companyId, id);
  }
}
