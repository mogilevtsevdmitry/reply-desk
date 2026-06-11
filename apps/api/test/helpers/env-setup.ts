/**
 * setupFiles: устанавливает переменные окружения для интеграционных тестов
 * ДО загрузки модулей. Значения из globalSetup пробрасываются через _INT_* переменные.
 */

// globalSetup записывает реальные порты сюда
if (process.env['_INT_DATABASE_URL']) {
  process.env['DATABASE_URL'] = process.env['_INT_DATABASE_URL'];
}
if (process.env['_INT_REDIS_URL']) {
  process.env['REDIS_URL'] = process.env['_INT_REDIS_URL'];
}

// Обязательные переменные для AppModule
process.env['NODE_ENV'] = 'test';
process.env['JWT_ACCESS_SECRET'] = 'integration-test-secret-min-32-characters!!';
process.env['JWT_ACCESS_TTL'] = '15m';
process.env['LLM_PROVIDER'] = 'fake';
process.env['WORKER_EMBEDDED'] = 'true';
process.env['SIMILARITY_THRESHOLD'] = '0.3';
process.env['LIMIT_FREE'] = '10';
process.env['LIMIT_START'] = '100';
process.env['LIMIT_BUSINESS'] = '1000';
