import type { Metadata } from 'next';
import { ReviewDetail } from '@/components/review/review-detail';

export const metadata: Metadata = { title: 'ReplyDesk — пакет реакции' };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReviewDetail reviewId={id} />;
}
