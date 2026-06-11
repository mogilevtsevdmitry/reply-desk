/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.int-spec.ts'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  moduleNameMapper: {
    // Резолвим workspace-пакет @replydesk/contracts через его source
    '@replydesk/contracts': '<rootDir>/../../packages/contracts/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'CommonJS',
          moduleResolution: 'Node',
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          strictPropertyInitialization: false,
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true,
          target: 'ES2023',
          lib: ['ES2023'],
        },
      },
    ],
  },
  // Testcontainers стартуют долго — увеличиваем таймауты глобально
  testTimeout: 120_000,
  // Тесты не запускаем параллельно — один набор контейнеров на весь прогон
  maxWorkers: 1,
  // Глобальный setup: поднять PostgreSQL + Redis один раз для всего прогона
  globalSetup: '<rootDir>/test/helpers/global-setup.ts',
  globalTeardown: '<rootDir>/test/helpers/global-teardown.ts',
  setupFiles: ['<rootDir>/test/helpers/env-setup.ts'],
};
