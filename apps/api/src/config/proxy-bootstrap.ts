import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

/**
 * Прокси для исходящего трафика (ADR-045).
 *
 * Node 22 нативный fetch (undici) НЕ читает HTTP(S)_PROXY/NO_PROXY автоматически.
 * `@anthropic-ai/sdk` v0.104 работает поверх глобального fetch и не имеет своей
 * proxy-логики, поэтому без явного диспетчера env-переменные прокси игнорируются
 * и запросы к Anthropic идут напрямую с РФ-ноды (geo-block).
 *
 * `EnvHttpProxyAgent` читает HTTP_PROXY/HTTPS_PROXY/NO_PROXY (+ lowercase) из env
 * и роутит весь native fetch через форвард-прокси. NO_PROXY с in-cluster хостами
 * (postgres/redis/vault) исключает их из проксирования.
 *
 * Важно: вызывать ДО первого исходящего fetch — в самом верху main.ts/worker.ts.
 */

export interface InstallProxyDispatcherDeps {
  env?: NodeJS.ProcessEnv;
  setDispatcher?: typeof setGlobalDispatcher;
  createAgent?: () => unknown;
  log?: (message: string) => void;
}

const PROXY_ENV_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const;

/**
 * Ставит EnvHttpProxyAgent глобальным диспетчером undici, если в env задан хотя бы
 * один из HTTP(S)_PROXY. Возвращает true, если диспетчер установлен.
 * Идемпотентна по смыслу вызова: дублирующий вызов просто переустановит агента.
 */
export function installProxyDispatcher(deps: InstallProxyDispatcherDeps = {}): boolean {
  const env = deps.env ?? process.env;
  const setDispatcher = deps.setDispatcher ?? setGlobalDispatcher;
  const createAgent = deps.createAgent ?? (() => new EnvHttpProxyAgent());
  const log = deps.log ?? ((m: string) => console.log(m));

  const hasProxy = PROXY_ENV_KEYS.some((k) => {
    const v = env[k];
    return typeof v === 'string' && v.trim().length > 0;
  });

  if (!hasProxy) {
    return false;
  }

  setDispatcher(createAgent() as Parameters<typeof setGlobalDispatcher>[0]);
  log('[proxy] EnvHttpProxyAgent установлен глобальным диспетчером undici (HTTP(S)_PROXY обнаружен)');
  return true;
}

// Side-effect: автоматически ставим диспетчер при импорте этого модуля из
// entrypoint'ов (main.ts/worker.ts). В юнит-тестах (NODE_ENV=test) не трогаем
// реальный глобальный диспетчер — логику проверяет proxy-bootstrap.spec.ts через
// инъекцию зависимостей.
if (process.env.NODE_ENV !== 'test') {
  installProxyDispatcher();
}
