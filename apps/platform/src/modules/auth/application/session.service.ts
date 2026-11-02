import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { PRODUCTS, type Product, type RequestScope, isProduct } from '@platform/kernel';
import type { Role } from '@platform/platform-contracts';
import { ENV, type Env, type ScopeResolver } from '@platform/server';
import { PlatformPrismaService } from '../../database/platform-prisma.service.js';

/**
 * Session issue and resolution (TDD-001 §7.1).
 *
 * The raw token is returned to the caller once and never stored: the database
 * holds only its SHA-256 digest, so a database disclosure does not yield usable
 * sessions.
 *
 * The `session` table is deliberately outside row-level security — the scope is
 * derived FROM it, so it cannot itself be scoped. Resolution goes through the
 * `app_resolve_session` definer function, which returns exactly what the guard
 * needs and nothing else, keeping the `user` table protected by RLS as normal.
 */
export { SESSION_COOKIE } from '@platform/server';
const SESSION_TTL_HOURS = 12;

/** Product Session (docs/product/stories/product-session.md): the JWT a
 * product sends with every platform call lasts 12 hours, and so does every
 * refreshed one. */
export const PRODUCT_TOKEN_TTL_SECONDS = 12 * 60 * 60;
/** How long a product can keep refreshing without the user signing in again.
 * The story leaves it open; 30 days is the usual "remember me" span. */
export const PRODUCT_REFRESH_TTL_DAYS = 30;
/** Who issues the product JWT, as its `iss`. */
export const PRODUCT_TOKEN_ISSUER = 'platform';

export interface ProductTokens {
  /** The JWT, and when it expires (ISO). */
  readonly token: string;
  readonly expiresAt: string;
}

export interface ProductSession extends ProductTokens {
  /** Exchanged for a new JWT at POST /product-session/refresh. */
  readonly refreshToken: string;
  readonly refreshExpiresAt: string;
}

/** A JWT has three dot-separated parts; a platform session token is hex. */
const looksLikeJwt = (token: string) => token.split('.').length === 3;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ResolvedSessionRow {
  session_id: string;
  user_id: string;
  merchant_id: string;
  role: Role;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED';
  expires_at: Date;
  revoked_at: Date | null;
  brand_ids: string[];
  products: string[];
  product_roles: Record<string, string> | null;
  location_ids: string[];
  /** Set for a product session; its token is a refresh token. */
  product: string | null;
}

@Injectable()
export class SessionService implements ScopeResolver {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PlatformPrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issue(
    userId: string,
    context: { sourceIp?: string | null; userAgent?: string | null } = {},
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);

    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: SessionService.hash(token),
        expiresAt,
        sourceIp: context.sourceIp ?? null,
        userAgent: context.userAgent ?? null,
      },
    });

    return { token, expiresAt };
  }

  /**
   * Resolves a raw session token into the immutable request scope. Returns null
   * for anything unknown, expired, revoked, or belonging to a non-active user —
   * the caller turns all of those into the same 401 without distinguishing them.
   */
  async resolve(token: string, sourceIp: string | null): Promise<RequestScope | null> {
    if (looksLikeJwt(token)) return this.resolveProductToken(token, sourceIp);

    const row = await this.rowByToken(token);
    // A product session's token is a refresh token: it gets a new JWT, and is
    // never accepted for an API call itself.
    if (!row || row.product !== null || !this.isLive(row)) return null;
    return this.scopeOf(row, sourceIp);
  }

  // --- Product Session ------------------------------------------------------

  /**
   * Starts a product session when a user continues into a product: a refresh
   * token (stored only as a digest, like a session token) and the first
   * 12-hour JWT. The caller has already checked the product is enabled.
   */
  async issueProductSession(
    scope: RequestScope,
    product: Product,
    context: { sourceIp?: string | null; userAgent?: string | null } = {},
  ): Promise<ProductSession> {
    const secret = this.productSecret();
    const refreshToken = randomBytes(32).toString('hex');
    const refreshExpiresAt = new Date(Date.now() + PRODUCT_REFRESH_TTL_DAYS * 24 * 3600 * 1000);
    const session = await this.prisma.session.create({
      data: {
        userId: scope.userId,
        tokenHash: SessionService.hash(refreshToken),
        expiresAt: refreshExpiresAt,
        product,
        sourceIp: context.sourceIp ?? null,
        userAgent: context.userAgent ?? null,
      },
      select: { id: true },
    });
    const jwt = await this.signProductToken(secret, {
      sessionId: session.id,
      userId: scope.userId,
      merchantId: scope.merchantId,
      product,
    });
    return { ...jwt, refreshToken, refreshExpiresAt: refreshExpiresAt.toISOString() };
  }

  /**
   * A new 12-hour JWT for a refresh token, without signing in again. Refused
   * (401) for an unknown or revoked token, a token that is not a product
   * session's, a suspended user, or a product no longer enabled; and, with
   * code SIGN_IN_REQUIRED, once the refresh token itself has expired.
   */
  async refreshProductToken(refreshToken: string): Promise<ProductTokens> {
    const secret = this.productSecret();
    const row = await this.rowByToken(refreshToken);
    const product = row?.product;
    if (!row || !product || !isProduct(product) || row.revoked_at) {
      throw new UnauthorizedException({
        message: 'refresh token is not valid',
        code: 'INVALID_REFRESH_TOKEN',
      });
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      throw new UnauthorizedException({
        message: 'the session has ended; sign in again',
        code: 'SIGN_IN_REQUIRED',
      });
    }
    if (row.status === 'SUSPENDED' || !(row.products ?? []).includes(product)) {
      throw new UnauthorizedException({
        message: 'refresh token is not valid',
        code: 'INVALID_REFRESH_TOKEN',
      });
    }
    return this.signProductToken(secret, {
      sessionId: row.session_id,
      userId: row.user_id,
      merchantId: row.merchant_id,
      product,
    });
  }

  /**
   * A product JWT, as a scope: valid signature, issuer and audience (a
   * product), not expired, naming a live product session of that same user,
   * company and product, and the product still enabled for the company. The
   * user's role, brands and product roles are read fresh from the database on
   * every call, so a role change shows at once. Null for anything else.
   */
  private async resolveProductToken(
    token: string,
    sourceIp: string | null,
  ): Promise<RequestScope | null> {
    const secret = this.env.PRODUCT_JWT_SECRET;
    if (!secret) return null;
    let payload;
    try {
      ({ payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
        issuer: PRODUCT_TOKEN_ISSUER,
        audience: [...PRODUCTS],
        algorithms: ['HS256'],
      }));
    } catch {
      return null;
    }
    const product = typeof payload.aud === 'string' ? payload.aud : null;
    const sessionId = payload['sid'];
    if (!product || !isProduct(product) || typeof sessionId !== 'string' || !UUID.test(sessionId)) {
      return null;
    }
    const rows = await this.prisma.$queryRaw<ResolvedSessionRow[]>`
      SELECT * FROM app_resolve_session_by_id(${sessionId}::uuid)
    `;
    const row = rows[0];
    if (
      !row ||
      row.product !== product ||
      row.user_id !== payload.sub ||
      row.merchant_id !== payload['mid'] ||
      !this.isLive(row) ||
      !(row.products ?? []).includes(product)
    ) {
      return null;
    }
    return {
      ...this.scopeOf(row, sourceIp),
      tokenProduct: product,
      tokenExpiresAt: new Date(payload.exp! * 1000).toISOString(),
    };
  }

  private async signProductToken(
    secret: string,
    claims: { sessionId: string; userId: string; merchantId: string; product: Product },
  ): Promise<ProductTokens> {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + PRODUCT_TOKEN_TTL_SECONDS;
    const token = await new SignJWT({ mid: claims.merchantId, sid: claims.sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(PRODUCT_TOKEN_ISSUER)
      .setAudience(claims.product)
      .setSubject(claims.userId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .setJti(randomUUID())
      .sign(new TextEncoder().encode(secret));
    return { token, expiresAt: new Date(expiresAt * 1000).toISOString() };
  }

  private productSecret(): string {
    const secret = this.env.PRODUCT_JWT_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException(
        'product sign-in is not configured (PRODUCT_JWT_SECRET)',
      );
    }
    return secret;
  }

  private async rowByToken(token: string): Promise<ResolvedSessionRow | undefined> {
    const rows = await this.prisma.$queryRaw<ResolvedSessionRow[]>`
      SELECT * FROM app_resolve_session(${SessionService.hash(token)})
    `;
    return rows[0];
  }

  /** Not revoked, not expired, and the user not suspended. SUSPENDED may not
   * hold a session at all. INVITED is allowed through: it is how a session
   * issued to a first-login, mustResetPassword user is able to reach
   * /auth/set-password in the first place — see AuthService.login. */
  private isLive(row: ResolvedSessionRow): boolean {
    return (
      !row.revoked_at &&
      new Date(row.expires_at).getTime() > Date.now() &&
      row.status !== 'SUSPENDED'
    );
  }

  private scopeOf(row: ResolvedSessionRow, sourceIp: string | null): RequestScope {
    return {
      merchantId: row.merchant_id,
      userId: row.user_id,
      role: row.role,
      assignedBrandIds: row.brand_ids ?? [],
      sessionId: row.session_id,
      sourceIp,
      products: (row.products ?? []).filter(isProduct),
      productRoles: Object.fromEntries(
        Object.entries(row.product_roles ?? {}).filter(([product]) => isProduct(product)),
      ) as Partial<Record<Product, string>>,
      assignedLocationIds: row.location_ids ?? [],
    };
  }

  /**
   * Whether a brand id belongs to the scope's company. Asked by the request
   * guard for roles that cover every brand (Owner, Admin): their scope lists no
   * brands, so without this a request naming another company's brand id would
   * pass the guard and be stopped only by row-level security. Looked up inside
   * the scope, so RLS answers it: a brand of another company is simply not
   * visible. A malformed id is not a brand.
   */
  async brandInCompany(scope: RequestScope, brandId: string): Promise<boolean> {
    if (!UUID.test(brandId)) return false;
    const brand = await this.prisma.withScope(scope, (tx) =>
      tx.brand.findFirst({
        where: { id: brandId, merchantId: scope.merchantId },
        select: { id: true },
      }),
    );
    return brand !== null;
  }

  async touch(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { lastSeenAt: new Date() },
    });
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  /** Housekeeping for the scheduled queue. */
  async purgeExpired(): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return result.count;
  }
}
