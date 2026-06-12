import { computeRefund, isFullRefundEligible } from './prorata';

/**
 * Pro-rata возврат (ADR-036): по фактическим дням оплаченного периода
 * (expiresAt − paidAt), с cap на исходную сумму платежа.
 */
describe('computeRefund — pro-rata возврат за подписку', () => {
  const D = (iso: string) => new Date(iso);

  it('половина периода → половина суммы (целые дни, округление вниз)', () => {
    const r = computeRefund({
      price: 79_000,
      paidAt: D('2026-06-01T00:00:00Z'),
      expiresAt: D('2026-07-01T00:00:00Z'), // 30 дней
      now: D('2026-06-16T00:00:00Z'), // осталось 15 дней
    });
    expect(r.totalDays).toBe(30);
    expect(r.daysLeft).toBe(15);
    expect(r.amount).toBe(39_500);
  });

  it('отмена сразу после оплаты → возврат не больше исходной суммы (cap)', () => {
    const r = computeRefund({
      price: 79_000,
      paidAt: D('2026-06-01T00:00:00Z'),
      expiresAt: D('2026-07-01T00:00:00Z'),
      now: D('2026-06-01T00:00:01Z'), // прошла 1 секунда
    });
    expect(r.daysLeft).toBe(29); // floor: неполный день не возвращается
    expect(r.amount).toBeLessThanOrEqual(79_000);
  });

  it('clock skew: now раньше paidAt → daysLeft зажат totalDays, amount зажат price', () => {
    const r = computeRefund({
      price: 79_000,
      paidAt: D('2026-06-01T12:00:00Z'),
      expiresAt: D('2026-07-01T12:00:00Z'),
      now: D('2026-06-01T00:00:00Z'), // «раньше» оплаты
    });
    expect(r.daysLeft).toBe(r.totalDays);
    expect(r.amount).toBe(79_000); // cap: не больше оплаты
  });

  it('период истёк → возврат 0', () => {
    const r = computeRefund({
      price: 219_000,
      paidAt: D('2026-03-01T00:00:00Z'),
      expiresAt: D('2026-06-01T00:00:00Z'),
      now: D('2026-06-02T00:00:00Z'),
    });
    expect(r.daysLeft).toBe(0);
    expect(r.amount).toBe(0);
  });

  it('границы месяцев: 31-дневный месяц (май→июнь) не даёт возврат больше оплаты', () => {
    // Грабли habby: totalDays по фиксированным 30 дням давал refund > оплаты
    const r = computeRefund({
      price: 79_000,
      paidAt: D('2026-05-01T00:00:00Z'),
      expiresAt: D('2026-06-01T00:00:00Z'), // setMonth(+1): 31 день
      now: D('2026-05-01T00:00:00Z'),
    });
    expect(r.totalDays).toBe(31);
    expect(r.amount).toBe(79_000);
    expect(r.amount).toBeLessThanOrEqual(79_000);
  });

  it('февраль (28 дней) считается по фактической длине', () => {
    const r = computeRefund({
      price: 79_000,
      paidAt: D('2026-02-01T00:00:00Z'),
      expiresAt: D('2026-03-01T00:00:00Z'),
      now: D('2026-02-15T00:00:00Z'),
    });
    expect(r.totalDays).toBe(28);
    expect(r.daysLeft).toBe(14);
    expect(r.amount).toBe(39_500);
  });

  it('годовая подписка: 12 месяцев, осталась треть', () => {
    const r = computeRefund({
      price: 699_000,
      paidAt: D('2026-01-01T00:00:00Z'),
      expiresAt: D('2027-01-01T00:00:00Z'), // 365 дней
      now: D('2026-09-01T00:00:00Z'),
    });
    expect(r.totalDays).toBe(365);
    expect(r.daysLeft).toBe(122);
    expect(r.amount).toBe(Math.floor((699_000 * 122) / 365));
  });

  it('вырожденный период (paidAt == expiresAt) не делит на ноль', () => {
    const r = computeRefund({
      price: 79_000,
      paidAt: D('2026-06-01T00:00:00Z'),
      expiresAt: D('2026-06-01T00:00:00Z'),
      now: D('2026-06-01T00:00:00Z'),
    });
    expect(r.totalDays).toBe(1);
    expect(r.amount).toBe(0);
  });
});

/**
 * Правило 24 часов (ADR-041): отмена в течение суток после оплаты без
 * использованных генераций → полный возврат; иначе — pro-rata.
 */
describe('isFullRefundEligible — правило 24 часов', () => {
  const D = (iso: string) => new Date(iso);
  const paidAt = D('2026-06-12T10:00:00Z');

  it('отмена через минуту без генераций → полный возврат', () => {
    expect(
      isFullRefundEligible({ paidAt, now: D('2026-06-12T10:01:00Z'), usedGenerations: 0 }),
    ).toBe(true);
  });

  it('отмена в течение 24 часов, но генерации были → pro-rata', () => {
    expect(
      isFullRefundEligible({ paidAt, now: D('2026-06-12T10:01:00Z'), usedGenerations: 1 }),
    ).toBe(false);
  });

  it('отмена позже 24 часов без генераций → pro-rata', () => {
    expect(
      isFullRefundEligible({ paidAt, now: D('2026-06-13T10:00:01Z'), usedGenerations: 0 }),
    ).toBe(false);
  });

  it('граница: ровно 24 часа → окно закрыто (строго меньше)', () => {
    expect(
      isFullRefundEligible({ paidAt, now: D('2026-06-13T10:00:00Z'), usedGenerations: 0 }),
    ).toBe(false);
  });

  it('за секунду до границы 24 часов → полный возврат', () => {
    expect(
      isFullRefundEligible({ paidAt, now: D('2026-06-13T09:59:59Z'), usedGenerations: 0 }),
    ).toBe(true);
  });

  it('clock skew: now раньше paidAt → не full (отработает pro-rata с cap)', () => {
    expect(
      isFullRefundEligible({ paidAt, now: D('2026-06-12T09:59:59Z'), usedGenerations: 0 }),
    ).toBe(false);
  });
});
