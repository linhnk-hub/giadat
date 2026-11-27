import type { NextFunction, Request, Response } from 'express';

export interface ParsedCorsConfig {
  allowedOrigins: Set<string>;
  invalidEntries: string[];
}

const ALLOWED_CORS_METHODS = 'GET, POST, DELETE, OPTIONS';
const ALLOWED_CORS_HEADERS = 'Authorization, Content-Type';
const CORS_MAX_AGE_SECONDS = '600';

/**
 * Validates and parses a comma-separated CORS_ALLOWED_ORIGINS list.
 * Strict rules:
 * - Exact origin only: scheme (http/https) + hostname + optional port.
 * - Rejects wildcards (*), paths (/admin, /api), trailing slashes, queries, hashes, or credentials.
 */
export function parseAllowedOrigins(rawValue?: string): ParsedCorsConfig {
  const allowedOrigins = new Set<string>();
  const invalidEntries: string[] = [];

  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return { allowedOrigins, invalidEntries };
  }

  for (const part of rawValue.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed === '*' || trimmed.includes('*') || trimmed.endsWith('/')) {
      invalidEntries.push(trimmed);
      continue;
    }

    try {
      const parsed = new URL(trimmed);
      const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';
      const hasNoCredentials = !parsed.username && !parsed.password;
      const hasNoPathOrParams =
        parsed.pathname === '/' && !parsed.search && !parsed.hash && parsed.origin === trimmed;

      if (!isHttp || !hasNoCredentials || !hasNoPathOrParams) {
        invalidEntries.push(trimmed);
        continue;
      }

      allowedOrigins.add(parsed.origin);
    } catch {
      invalidEntries.push(trimmed);
    }
  }

  return { allowedOrigins, invalidEntries };
}

export interface CorsMiddlewareOptions {
  rawAllowedOrigins?: string;
  isProduction?: boolean;
  logger?: Pick<Console, 'warn'>;
}

/**
 * Strict allowlist CORS middleware for GitHub Pages -> Render Backend communication.
 * Must be registered BEFORE adminRouter so OPTIONS preflight returns 204 without
 * triggering requireAdminAuth (401), while keeping actual requests fully protected.
 */
export function createCorsMiddleware(options: CorsMiddlewareOptions = {}) {
  const raw =
    options.rawAllowedOrigins !== undefined
      ? options.rawAllowedOrigins
      : process.env.CORS_ALLOWED_ORIGINS;
  const isProduction = options.isProduction ?? process.env.NODE_ENV === 'production';
  const logger = options.logger ?? console;

  const { allowedOrigins, invalidEntries } = parseAllowedOrigins(raw);

  if (invalidEntries.length > 0) {
    logger.warn(
      `[CORS] Ignored ${invalidEntries.length} invalid origin entry(ies) in CORS_ALLOWED_ORIGINS. Origins must be exact scheme://host[:port] without trailing slash, path, or wildcard.`
    );
  }

  if (isProduction && allowedOrigins.size === 0) {
    logger.warn(
      '[CORS] CORS_ALLOWED_ORIGINS is not configured (or empty) in production. Cross-origin browser requests will NOT receive Access-Control-Allow-Origin.'
    );
  }

  return function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
    res.vary('Origin');

    const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
    const isAllowedOrigin = requestOrigin.length > 0 && allowedOrigins.has(requestOrigin);

    if (isAllowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Access-Control-Allow-Methods', ALLOWED_CORS_METHODS);
      res.setHeader('Access-Control-Allow-Headers', ALLOWED_CORS_HEADERS);
      res.setHeader('Access-Control-Max-Age', CORS_MAX_AGE_SECONDS);
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  };
}
