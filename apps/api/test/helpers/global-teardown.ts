/**
 * Jest globalTeardown: останавливает контейнеры после завершения всех тестов.
 */
export default async function globalTeardown(): Promise<void> {
  console.log('\n[globalTeardown] Останавливаем контейнеры...');

  await Promise.allSettled([
    global.__PG_CONTAINER__?.stop(),
    global.__REDIS_CONTAINER__?.stop(),
  ]);

  console.log('[globalTeardown] Готово.\n');
}
