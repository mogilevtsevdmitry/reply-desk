import base from '@replydesk/config/eslint';

export default [
  // next-env.d.ts генерируется Next.js (triple-slash references) — не линтим.
  { ignores: ['next-env.d.ts'] },
  ...base,
];
