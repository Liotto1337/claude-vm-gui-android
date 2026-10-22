import { describe, expect, it } from 'vitest';
import { bridgeAllowed } from '../../bridge/auth';

describe('кого пускает dev-мост', () => {
  const token = 'secret-token';
  it('страница разработки или E2E с верным токеном', () => {
    expect(bridgeAllowed('http://127.0.0.1:4173', '/?token=secret-token', token)).toBe(true);
    expect(bridgeAllowed('http://localhost:5173', '/?token=secret-token', token)).toBe(true);
  });
  it('чужой сайт — нет, даже с токеном', () => expect(bridgeAllowed('https://evil.example', '/?token=secret-token', token)).toBe(false));
  it('без токена или с неверным — нет', () => {
    expect(bridgeAllowed('http://127.0.0.1:4173', '/', token)).toBe(false);
    expect(bridgeAllowed('http://127.0.0.1:4173', '/?token=guess', token)).toBe(false);
  });
  it('без Origin (не браузер) — нет', () => expect(bridgeAllowed(undefined, '/?token=secret-token', token)).toBe(false));
  it('похожий адрес — нет', () => expect(bridgeAllowed('http://127.0.0.1.evil.example:80', '/?token=secret-token', token)).toBe(false));
});
