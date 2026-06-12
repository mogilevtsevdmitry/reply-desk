/**
 * Типы API ЮKassa v3 (https://yookassa.ru/developers/api).
 * Подход перенесён из проверенной интеграции habby-tracker.
 */

export type YkAmount = { value: string; currency: 'RUB' };

export type YkCard = {
  first6?: string;
  last4: string;
  expiry_month?: string;
  expiry_year?: string;
  card_type?: string;
  issuer_country?: string;
  issuer_name?: string;
};

export type YkPaymentMethod =
  | { type: 'bank_card'; id: string; saved: boolean; title?: string; card?: YkCard }
  | { type: 'yoo_money'; id: string; saved: boolean; title?: string };

export type YkPayment = {
  id: string;
  status: 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled';
  paid: boolean;
  amount: YkAmount;
  description?: string;
  payment_method?: YkPaymentMethod;
  captured_at?: string;
  created_at: string;
  confirmation?: { type: 'redirect'; confirmation_url: string; return_url: string };
  metadata?: Record<string, string>;
  refunded_amount?: YkAmount;
};

export type YkReceiptItem = {
  description: string;
  quantity: string;
  amount: YkAmount;
  vat_code: 1 | 2 | 3 | 4 | 5 | 6;
  payment_subject: 'service' | 'commodity';
  payment_mode: 'full_payment' | 'partial_prepayment';
};

export type YkReceipt = {
  customer: { email?: string; phone?: string };
  items: YkReceiptItem[];
  tax_system_code?: 1 | 2 | 3 | 4 | 5 | 6;
};

export type YkCreatePaymentInput = {
  amount: YkAmount;
  capture: boolean;
  confirmation?: { type: 'redirect'; return_url: string };
  save_payment_method?: boolean;
  payment_method_id?: string;
  description?: string;
  receipt?: YkReceipt;
  metadata?: Record<string, string>;
};

export type YkRefund = {
  id: string;
  payment_id: string;
  status: 'succeeded' | 'canceled' | 'pending';
  amount: YkAmount;
  created_at: string;
};

/** Тело HTTP-уведомления ЮKassa (подписи нет — перепроверяем через GET, ADR-038). */
export type YkWebhookEvent =
  | { event: 'payment.succeeded'; object: YkPayment }
  | { event: 'payment.canceled'; object: YkPayment }
  | { event: 'payment.waiting_for_capture'; object: YkPayment }
  | { event: 'refund.succeeded'; object: YkRefund };

/** Копейки → строка суммы ЮKassa ("790.00"). */
export function kopecksToYkValue(kopecks: number): string {
  return (kopecks / 100).toFixed(2);
}

/** Чек 54-ФЗ: НПД (tax_system_code 6), без НДС (vat_code 1). */
export function buildReceipt(input: {
  email: string;
  amountKopecks: number;
  description: string;
}): YkReceipt {
  return {
    customer: { email: input.email },
    items: [
      {
        description: input.description,
        quantity: '1.00',
        amount: { value: kopecksToYkValue(input.amountKopecks), currency: 'RUB' },
        vat_code: 1,
        payment_subject: 'service',
        payment_mode: 'full_payment',
      },
    ],
    tax_system_code: 6,
  };
}
