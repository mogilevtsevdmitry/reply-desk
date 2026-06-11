import base from '@replydesk/config/eslint';
import globals from 'globals';

export default [
  ...base,
  // CJS-файлы конфигурации (jest.config.js и т.п.) — CommonJS Node-окружение
  {
    files: ['**/*.config.js', '**/*.config.cjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  // Файлы тестов (дополнительно к правилам из base)
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];
