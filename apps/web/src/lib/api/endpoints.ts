import {
  AuthTokenResponseSchema,
  BillingOverviewSchema,
  CancelSubscriptionResponseSchema,
  CheckoutResponseSchema,
  CompanyDtoSchema,
  CompanyMeResponseSchema,
  CreateCompanyResponseSchema,
  CreateReviewResponseSchema,
  ListReviewsResponseSchema,
  RegisterResponseSchema,
  RetryReviewResponseSchema,
  ReviewWithGenerationSchema,
  type AuthTokenResponse,
  type BillingOverview,
  type CancelSubscriptionResponse,
  type CheckoutDto,
  type CheckoutResponse,
  type CompanyDto,
  type CompanyMeResponse,
  type CreateCompanyDto,
  type CreateCompanyResponse,
  type CreateReviewDto,
  type CreateReviewResponse,
  type ListReviewsResponse,
  type LoginDto,
  type RegisterDto,
  type RegisterResponse,
  type RetryReviewResponse,
  type ReviewWithGeneration,
  type UpdateCompanyDto,
} from '@replydesk/contracts';
import { apiJson, apiRequest } from './client';

// ---------- Auth ----------

export const register = (dto: RegisterDto): Promise<RegisterResponse> =>
  apiJson('/auth/register', RegisterResponseSchema, { method: 'POST', body: dto });

export const login = (dto: LoginDto): Promise<AuthTokenResponse> =>
  apiJson('/auth/login', AuthTokenResponseSchema, { method: 'POST', body: dto });

export const logout = async (): Promise<void> => {
  await apiRequest('/auth/logout', { method: 'POST' });
};

// ---------- Company ----------

export const getCompanyMe = (): Promise<CompanyMeResponse> =>
  apiJson('/company/me', CompanyMeResponseSchema);

export const createCompany = (dto: CreateCompanyDto): Promise<CreateCompanyResponse> =>
  apiJson('/company', CreateCompanyResponseSchema, { method: 'POST', body: dto });

export const updateCompany = (dto: UpdateCompanyDto): Promise<CompanyDto> =>
  apiJson('/company/me', CompanyDtoSchema, { method: 'PATCH', body: dto });

// ---------- Billing ----------

export const getBilling = (): Promise<BillingOverview> =>
  apiJson('/billing', BillingOverviewSchema);

/** Покупка подписки или пакета → URL страницы оплаты ЮKassa (redirect). */
export const billingCheckout = (dto: CheckoutDto): Promise<CheckoutResponse> =>
  apiJson('/billing/checkout', CheckoutResponseSchema, { method: 'POST', body: dto });

export const setAutoRenew = async (enabled: boolean): Promise<void> => {
  await apiRequest('/billing/auto-renew', { method: 'POST', body: { enabled } });
};

export const unbindCard = async (): Promise<void> => {
  await apiRequest('/billing/unbind-card', { method: 'POST' });
};

export const cancelSubscription = (): Promise<CancelSubscriptionResponse> =>
  apiJson('/billing/cancel', CancelSubscriptionResponseSchema, { method: 'POST' });

// ---------- Reviews ----------

export const createReview = (dto: CreateReviewDto): Promise<CreateReviewResponse> =>
  apiJson('/reviews', CreateReviewResponseSchema, { method: 'POST', body: dto });

export const retryReview = (reviewId: string): Promise<RetryReviewResponse> =>
  apiJson(`/reviews/${reviewId}/retry`, RetryReviewResponseSchema, { method: 'POST' });

export const getReview = (reviewId: string): Promise<ReviewWithGeneration> =>
  apiJson(`/reviews/${reviewId}`, ReviewWithGenerationSchema);

/** Параметры фильтров истории (сериализуются в query GET /reviews). */
export interface ReviewFilters {
  source?: string;
  category?: string;
  severity?: number;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
}

export function listReviews(
  filters: ReviewFilters,
  page: number,
  pageSize: number,
): Promise<ListReviewsResponse> {
  const params = new URLSearchParams();
  if (filters.source) params.set('source', filters.source);
  if (filters.category) params.set('category', filters.category);
  if (filters.severity) params.set('severity', String(filters.severity));
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  return apiJson(`/reviews?${params.toString()}`, ListReviewsResponseSchema);
}

/** Кол-во отзывов за последние 30 дней — для history-sub. */
export const countReviewsLast30Days = async (): Promise<number> => {
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const res = await listReviews({ from }, 1, 1);
  return res.total;
};
