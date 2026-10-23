import type { NextFunction, Request, Response } from 'express';
import type { Env } from '../config/env.js';

/**
 * The browser origins allowed to call the API: the web app's public addresses
 * (admin, Accounts and payment pages may share one) plus CORS_EXTRA_ORIGINS,
 * e.g. the Amplify default domain during a migration.
 */
export function corsOrigins(env: Env): Set<string> {
  return new Set(
    [
      env.ADMIN_PUBLIC_URL,
      env.ACCOUNTS_PUBLIC_URL,
      env.PAYMENT_PUBLIC_URL,
      ...env.CORS_EXTRA_ORIGINS,
    ].map((url) => new URL(url).origin),
  );
}

/**
 * Headers every API response carries. The API serves JSON and PDFs, never a
 * page to be framed or a script to be sniffed. No Content-Security-Policy
 * beyond frame-ancestors: a stricter one would break the browser's built-in
 * viewer for the invoice PDF, which customers open in a new tab.
 */
export function securityHeaders(request: Request, response: Response, next: NextFunction): void {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (request.secure) {
    response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}
