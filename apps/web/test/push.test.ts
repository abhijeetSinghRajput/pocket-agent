import { describe, expect, it } from 'vitest';
import { detectPushSupport, isIos } from '@/lib/push';

const base = {
  configured: true,
  secure: true,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0',
  standalone: false,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
};
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

describe('detectPushSupport', () => {
  it('desktop Chrome on a secure origin is supported', () => {
    expect(detectPushSupport(base).kind).toBe('supported');
  });
  it('reports missing configuration and insecure origins first', () => {
    expect(detectPushSupport({ ...base, configured: false }).kind).toBe('not_configured');
    expect(detectPushSupport({ ...base, secure: false }).kind).toBe('insecure');
  });
  it('iOS needs the Home Screen app', () => {
    expect(isIos(IPHONE)).toBe(true);
    expect(detectPushSupport({ ...base, userAgent: IPHONE, hasPushManager: false }).kind).toBe(
      'ios_install_required',
    );
    expect(detectPushSupport({ ...base, userAgent: IPHONE, standalone: true }).kind).toBe('supported');
  });
  it('browsers without the APIs are unsupported', () => {
    expect(detectPushSupport({ ...base, hasPushManager: false }).kind).toBe('unsupported');
  });
});
