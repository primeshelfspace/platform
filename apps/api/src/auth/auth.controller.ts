import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  loginSchema,
  registerSchema,
  setPasswordSchema,
  setPasswordWithTokenSchema,
  type LoginInput,
  type RegisterInput,
  type RequestScope,
  type SetPasswordInput,
  type SetPasswordWithTokenInput,
} from '@fenwick/shared';
import { zodPipe } from '../common/zod-validation.pipe.js';
import { CurrentScope, Public, RequirePermission } from '../tenancy/authorisation.js';
import { AuthService, type AuthenticatedUser } from './auth.service.js';
import { SESSION_COOKIE } from './session.service.js';

/**
 * FR-AUTH-001, 003, 004, 010.
 *
 * `/auth/me` and `/auth/logout` require a session but no particular privilege —
 * every signed-in user must be able to see who they are and sign out. The guard
 * fails closed on a route with no declared requirement, so they cannot simply be
 * left bare; ORGANISATION_PROFILE READ is the one cell every one of the six
 * roles holds (FRS-001 §3.3), which makes it the honest way to say "authenticated
 * is the requirement" without inventing a matrix entry that would then need a
 * row in the generated authorisation test.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @Public()
  @HttpCode(200)
  async login(
    @Body(zodPipe(loginSchema)) body: LoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ token: string; expiresAt: string; user: AuthenticatedUser }> {
    const result = await this.auth.login({
      email: body.email,
      password: body.password,
      sourceIp: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });

    // Set for browser clients that talk to this API directly and same-site.
    response.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: request.secure,
      expires: result.expiresAt,
      path: '/',
    });

    // Also returned in the body, because apps/admin is a separate origin: its
    // server sets its OWN httpOnly cookie and replays this token upstream. A
    // cookie issued on this origin cannot be read there, and SameSite=None
    // would need HTTPS to work at all in local development. The token is only
    // ever handled server-side by that app — it never reaches its browser.
    return {
      token: result.token,
      expiresAt: result.expiresAt.toISOString(),
      user: result.user,
    };
  }

  /**
   * FR-ONB: self-serve signup. Public, and the only write in this API that
   * creates a tenant.
   *
   * Answers with nothing but an acknowledgement: the account is not usable
   * until the emailed link is followed, so there is no session to hand back
   * and nothing about the new account worth returning.
   */
  @Post('register')
  @Public()
  @HttpCode(202)
  async register(
    @Body(zodPipe(registerSchema)) body: RegisterInput,
    @Req() request: Request,
  ): Promise<{ ok: true }> {
    await this.auth.register(body, {
      sourceIp: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
    return { ok: true };
  }

  /**
   * FR-AUTH-006. Public because the emailed token IS the credential — the
   * whole point is that the caller has no session yet. Answers in the shape of
   * a sign-in, because it is one: the link is followed once and the new owner
   * continues into onboarding without a second trip through /login.
   */
  @Post('set-password/token')
  @Public()
  @HttpCode(200)
  async setPasswordWithToken(
    @Body(zodPipe(setPasswordWithTokenSchema)) body: SetPasswordWithTokenInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ token: string; expiresAt: string; user: AuthenticatedUser }> {
    const result = await this.auth.setPasswordWithToken(body.token, body.newPassword, {
      sourceIp: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });

    response.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: request.secure,
      expires: result.expiresAt,
      path: '/',
    });

    return {
      token: result.token,
      expiresAt: result.expiresAt.toISOString(),
      user: result.user,
    };
  }

  @Post('logout')
  @RequirePermission('ORGANISATION_PROFILE', 'READ', { brandFrom: 'none' })
  @HttpCode(204)
  async logout(
    @CurrentScope() scope: RequestScope,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(scope);
    response.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  @RequirePermission('ORGANISATION_PROFILE', 'READ', { brandFrom: 'none' })
  async me(@CurrentScope() scope: RequestScope): Promise<CurrentUserResponse> {
    const profile = await this.auth.profile(scope);

    // Role and brand assignments come off the scope the guard already resolved
    // rather than the row, so what the client sees is exactly what is being
    // enforced — the two cannot drift apart mid-session.
    return {
      id: scope.userId,
      merchantId: scope.merchantId,
      email: profile?.email ?? '',
      name: profile?.name ?? '',
      role: scope.role,
      assignedBrandIds: scope.assignedBrandIds,
      mustResetPassword: profile?.mustResetPassword ?? false,
    };
  }

  /**
   * FR-AUTH-007/021. Requires only a live session, not the current password —
   * see AuthService.setPassword for why. Used both by the forced first-login
   * reset (INVITED, temporary password) and any later voluntary change.
   */
  @Post('set-password')
  @RequirePermission('ORGANISATION_PROFILE', 'READ', { brandFrom: 'none' })
  @HttpCode(200)
  async setPassword(
    @CurrentScope() scope: RequestScope,
    @Body(zodPipe(setPasswordSchema)) body: SetPasswordInput,
  ): Promise<{ ok: true }> {
    await this.auth.setPassword(scope, body.newPassword);
    return { ok: true };
  }
}

export interface CurrentUserResponse {
  id: string;
  merchantId: string;
  email: string;
  name: string;
  role: string;
  assignedBrandIds: readonly string[];
  mustResetPassword: boolean;
}
