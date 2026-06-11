/**
 * Загрузка fixture-данных о пользователях, созданных в global-setup.ts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const FIXTURES_FILE = path.join(__dirname, 'fixtures', 'users.json');

export interface UserFixture {
  email: string;
  password: string;
  accessToken: string;
  companyToken: string;
  companyId: string;
  /** Path to Playwright storageState file for this user (cookies + localStorage) */
  stateFile: string;
  /** @deprecated use stateFile instead */
  refreshCookie: string;
}

export function loadFixtures(): Record<string, UserFixture> {
  if (!fs.existsSync(FIXTURES_FILE)) {
    throw new Error(`Fixtures not found: ${FIXTURES_FILE}. Run global-setup first.`);
  }
  return JSON.parse(fs.readFileSync(FIXTURES_FILE, 'utf-8')) as Record<string, UserFixture>;
}

export function getFixture(key: string): UserFixture {
  const fixtures = loadFixtures();
  const user = fixtures[key];
  if (!user) throw new Error(`Fixture '${key}' not found. Available: ${Object.keys(fixtures).join(', ')}`);
  return user;
}
