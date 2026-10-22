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

  it('refuses paths a browser would read as another site (backslash, tab, newline)', () => {
    for (const value of [
      '/\\evil.example',
      '/\\/evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      '/%09/evil.example'.replace('%09', '\t'),
    ]) {
      expect(safeReturnTo(value, apps)).toBe('/');
    }
  });

  it('keeps an ordinary path with its query and hash intact', () => {
    expect(safeReturnTo('/invoices?status=PAID#top', apps)).toBe('/invoices?status=PAID#top');
    expect(safeReturnTo('/a/../b', apps)).toBe('/b');
  });

  it('falls back when nothing is given', () => {
    expect(safeReturnTo(undefined, apps)).toBe('/');
    expect(safeReturnTo('', apps, '/x')).toBe('/x');
  });
});
