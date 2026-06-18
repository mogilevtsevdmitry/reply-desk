import { installProxyDispatcher } from './proxy-bootstrap';

/**
 * Проверяем только решающую логику: ставится ли диспетчер при наличии proxy-env
 * и НЕ ставится при его отсутствии. Реальный глобальный диспетчер undici не
 * трогаем (инъекция setDispatcher/createAgent), чтобы не влиять на другие тесты.
 */
describe('installProxyDispatcher', () => {
  const noop = () => undefined;

  it('ставит диспетчер при HTTPS_PROXY', () => {
    const setDispatcher = jest.fn();
    const agent = {};
    const installed = installProxyDispatcher({
      env: { HTTPS_PROXY: 'http://proxy.nl:3128' },
      setDispatcher,
      createAgent: () => agent,
      log: noop,
    });

    expect(installed).toBe(true);
    expect(setDispatcher).toHaveBeenCalledTimes(1);
    expect(setDispatcher).toHaveBeenCalledWith(agent);
  });

  it('ставит диспетчер при lowercase http_proxy', () => {
    const setDispatcher = jest.fn();
    const installed = installProxyDispatcher({
      env: { http_proxy: 'http://proxy.nl:3128' },
      setDispatcher,
      createAgent: () => ({}),
      log: noop,
    });

    expect(installed).toBe(true);
    expect(setDispatcher).toHaveBeenCalledTimes(1);
  });

  it('НЕ ставит диспетчер, если proxy-env отсутствует', () => {
    const setDispatcher = jest.fn();
    const installed = installProxyDispatcher({
      env: { NO_PROXY: '10.0.0.0/8' },
      setDispatcher,
      createAgent: () => ({}),
      log: noop,
    });

    expect(installed).toBe(false);
    expect(setDispatcher).not.toHaveBeenCalled();
  });

  it('игнорирует пустую/whitespace строку прокси', () => {
    const setDispatcher = jest.fn();
    const installed = installProxyDispatcher({
      env: { HTTPS_PROXY: '   ' },
      setDispatcher,
      createAgent: () => ({}),
      log: noop,
    });

    expect(installed).toBe(false);
    expect(setDispatcher).not.toHaveBeenCalled();
  });
});
