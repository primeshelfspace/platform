import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './session.js';

const apps = ['http://localhost:3002', 'http://localhost:3000'];

describe('safeReturnTo', () => {
  it('keeps a path on the current app', () => {
    expect(safeReturnTo('/team?x=1', apps)).toBe('/team?x=1');
  });

  it('keeps an absolute URL on one of the platform’s apps', () => {
    expect(safeReturnTo('http://localhost:3000/invoices', apps)).toBe(
      'http://localhost:3000/invoices',
    );
  });

  it('refuses another site, a protocol-relative URL and junk', () => {
    expect(safeReturnTo('https://evil.example/x', apps)).toBe('/');
    expect(safeReturnTo('//evil.example/x', apps)).toBe('/');
    expect(safeReturnTo('javascript:alert(1)', apps)).toBe('/');
    expect(safeReturnTo('http://localhost:3999/', apps, '/home')).toBe('/home');
  });

  it('falls back when nothing is given', () => {
    expect(safeReturnTo(undefined, apps)).toBe('/');
    expect(safeReturnTo('', apps, '/x')).toBe('/x');
  });
});
