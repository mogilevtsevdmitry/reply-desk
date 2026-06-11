import { Module } from '@nestjs/common';
import { GenerationModule } from '../generation/generation.module';
import { UsageModule } from '../usage/usage.module';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [UsageModule, GenerationModule],
  controllers: [ReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
