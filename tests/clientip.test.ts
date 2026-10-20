import { describe, it, expect } from 'vitest';
import { clientIp } from '@/lib/client-ip';

const headers = (xff?: string) => ({ get: (name: string) => (name.toLowerCase() === 'x-forwarded-for' ? (xff ?? null) : null) });

describe('clientIp', () => {
  it('trusts no header when there is no proxy', () => {
    expect(clientIp(headers('6.6.6.6'), 0)).toBe('local');
  });

  it('reads the entry added by the single trusted proxy, not the one the client wrote', () => {
    // The client sent "1.1.1.1"; our proxy appended the address it actually saw.
    expect(clientIp(headers('1.1.1.1, 203.0.113.9'), 1)).toBe('203.0.113.9');
  });

  it('cannot be spoofed by prepending more addresses', () => {
    expect(clientIp(headers('9.9.9.9, 8.8.8.8, 203.0.113.9'), 1)).toBe('203.0.113.9');
  });

  it('counts back through several proxies', () => {
    expect(clientIp(headers('198.51.100.7, 10.0.0.2, 10.0.0.3'), 2)).toBe('10.0.0.2');
  });

  it('does not guess when the chain is shorter than the proxies in front', () => {
    expect(clientIp(headers(), 1)).toBe('unknown');
    expect(clientIp(headers('203.0.113.9'), 2)).toBe('unknown');
  });
});
