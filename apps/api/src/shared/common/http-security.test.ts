/**
 * The browser-facing rules every API response follows: which websites may
 * call the API with the user's credentials, and the headers that stop the
 * responses from being framed or content-sniffed.
 */
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import { corsOrigins, securityHeaders } from './http-security.js';

const env = {
  ADMIN_PUBLIC_URL: 'https://www.sugrpay.com',
  ACCOUNTS_PUBLIC_URL: 'https://www.sugrpay.com/accounts',
  PAYMENT_PUBLIC_URL: 'https://www.sugrpay.com/pay',
  CORS_EXTRA_ORIGINS: ['https://main.d2t9agxhkkuf4e.amplifyapp.com/'],
} as unknown as Env;

describe('corsOrigins', () => {
  const origins = corsOrigins(env);

  it('allows the web app and the extra origins, by origin only (no path, no slash)', () => {
    expect([...origins].sort()).toEqual([
      'https://main.d2t9agxhkkuf4e.amplifyapp.com',
      'https://www.sugrpay.com',
    ]);
  });

  it('refuses look-alike and plain-http origins', () => {
    for (const origin of [
      'https://evil.com',
      'https://www.sugrpay.com.evil.com',
      'https://evilsugrpay.com',
      'http://www.sugrpay.com',
      'null',
    ]) {
      expect(origins.has(origin)).toBe(false);
    }
  });
});

describe('securityHeaders', () => {
  const run = (secure: boolean) => {
    const headers: Record<string, string> = {};
    const response = {
      setHeader: (name: string, value: string) => (headers[name] = value),
    } as unknown as Response;
    const next = vi.fn();
    securityHeaders({ secure } as Request, response, next);
    expect(next).toHaveBeenCalledOnce();
    return headers;
  };

  it('forbids sniffing, framing and referrers on every response', () => {
    const headers = run(false);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Content-Security-Policy']).toBe("frame-ancestors 'none'");
    expect(headers['Referrer-Policy']).toBe('no-referrer');
  });

  it('pins HTTPS only when the request came over HTTPS', () => {
    expect(run(false)['Strict-Transport-Security']).toBeUndefined();
    expect(run(true)['Strict-Transport-Security']).toMatch(/max-age=31536000/);
  });
});
