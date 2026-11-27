import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { NextFunction, Request, Response } from 'express';
import { getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_ADMIN_EMAIL = 'linhnk2013@gmail.com';
export const VALID_UID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
const SINGLE_EMAIL_REGEX = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export type AdminAuthMatchSource = 'single_fixed_admin_email';

export interface VerifiedAdminIdentity {
  uid: string;
  email: string;
  emailVerified: true;
  displayName: string | null;
  matchedBy: AdminAuthMatchSource;
  tokenIssuedAt: number;
  tokenExpiresAt: number;
}

export interface AdminAuthenticatedRequest extends Request {
  firebaseToken?: DecodedIdToken;
  adminUser?: VerifiedAdminIdentity;
}

interface FirebaseAppletConfig {
  projectId?: string;
}

let cachedProjectId: string | null | undefined;

export function resolveFirebaseProjectId(
  env: NodeJS.ProcessEnv = process.env,
  useCache = env === process.env
): string | null {
  if (useCache && cachedProjectId !== undefined) {
    return cachedProjectId;
  }

  let fileProjectId = '';
  try {
    const configPath = path.resolve(__dirname, '../firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as FirebaseAppletConfig;
      fileProjectId = parsed.projectId?.trim() ?? '';
    }
  } catch {
    // Fail closed if config file cannot be read or parsed
  }

  const projectId = (env.FIREBASE_PROJECT_ID?.trim() || fileProjectId).trim();
  if (!projectId || projectId === 'remixed-project-id') {
    if (useCache) {
      cachedProjectId = null;
    }
    return null;
  }

  if (useCache) {
    cachedProjectId = projectId;
  }
  return projectId;
}

function getFirebaseAdminApp(): App | null {
  const projectId = resolveFirebaseProjectId();
  if (!projectId) {
    return null;
  }
  if (getApps().length > 0) {
    return getApp();
  }
  // Verifying Firebase ID tokens with verifyIdToken(token) uses Google's public JWKS
  // and requires only projectId (no IAM role or service account key needed).
  return initializeApp({ projectId });
}

export function isValidSingleEmail(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 254) {
    return false;
  }
  if (trimmed.includes(',') || trimmed.includes(';')) {
    return false;
  }
  return SINGLE_EMAIL_REGEX.test(trimmed);
}

export type ConfiguredAdminEmailResult =
  | { valid: true; email: string; source: 'env' | 'default' }
  | { valid: false; email: null; source: 'invalid_env' };

/**
 * Resolves the single fixed Admin email on the server:
 * - If process.env.ADMIN_EMAIL is not defined at all: defaults to DEFAULT_ADMIN_EMAIL.
 * - If process.env.ADMIN_EMAIL exists and is a single valid email: uses normalized (trim + lowercase).
 * - If process.env.ADMIN_EMAIL exists but is empty, whitespace-only, a list, or malformed:
 *   FAILS CLOSED (valid: false -> HTTP 503).
 */
export function resolveConfiguredAdminEmail(
  env: NodeJS.ProcessEnv = process.env
): ConfiguredAdminEmailResult {
  const hasEnvVar = Object.prototype.hasOwnProperty.call(env, 'ADMIN_EMAIL') && env.ADMIN_EMAIL !== undefined;

  if (!hasEnvVar) {
    return {
      valid: true,
      email: DEFAULT_ADMIN_EMAIL,
      source: 'default',
    };
  }

  const normalized = String(env.ADMIN_EMAIL).trim().toLowerCase();
  if (!normalized || !isValidSingleEmail(normalized)) {
    return {
      valid: false,
      email: null,
      source: 'invalid_env',
    };
  }

  return {
    valid: true,
    email: normalized,
    source: 'env',
  };
}

export function parseBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader || typeof authorizationHeader !== 'string') {
    return null;
  }
  const match = authorizationHeader.match(
    /^Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/
  );
  if (!match) {
    return null;
  }
  return match[1];
}

export type DecodedTokenLike = Pick<DecodedIdToken, 'uid' | 'email' | 'email_verified'> & {
  sub?: string;
  name?: string;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
};

export type SingleAdminAuthDecision =
  | { status: 200; authorized: true; identity: VerifiedAdminIdentity }
  | { status: 401 | 403 | 503; authorized: false; code: string; error: string };

/**
 * Pure Single Fixed Admin Email authorization evaluator:
 * - Strictly operates on a cryptographically verified Firebase ID token.
 * - Fails closed (503) if ADMIN_EMAIL env var is present but empty/malformed.
 * - Requires valid UID, email_verified === true, valid single email, and exact
 *   case-insensitive match against the configured server Admin email.
 * - Never uses Custom Claims, ADMIN_UIDS, ADMIN_EMAILS, localStorage, or Firestore Registry.
 */
export function evaluateSingleAdminAuthorization(
  decoded: DecodedTokenLike | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): SingleAdminAuthDecision {
  const configured = resolveConfiguredAdminEmail(env);
  if (!configured.valid || !configured.email) {
    return {
      status: 503,
      authorized: false,
      code: 'ADMIN_CONFIG_INVALID',
      error:
        'Cấu hình biến môi trường ADMIN_EMAIL trên máy chủ không hợp lệ. Truy cập quản trị bị từ chối mặc định.',
    };
  }

  if (
    !decoded ||
    typeof decoded.uid !== 'string' ||
    !VALID_UID_REGEX.test(decoded.uid) ||
    (decoded.sub !== undefined && decoded.sub !== decoded.uid)
  ) {
    return {
      status: 401,
      authorized: false,
      code: 'TOKEN_CLAIMS_INVALID',
      error: 'Token xác thực không chứa UID hợp lệ.',
    };
  }

  if (decoded.email_verified !== true || !isValidSingleEmail(decoded.email)) {
    return {
      status: 403,
      authorized: false,
      code: 'ADMIN_FORBIDDEN',
      error:
        'Tài khoản cần có địa chỉ email hợp lệ đã được xác minh để truy cập khu vực Quản trị.',
    };
  }

  const verifiedEmail = decoded.email.trim().toLowerCase();
  if (verifiedEmail !== configured.email) {
    return {
      status: 403,
      authorized: false,
      code: 'ADMIN_FORBIDDEN',
      error:
        'Tài khoản đã đăng nhập nhưng không phải Quản trị viên được máy chủ cấp quyền (Access Denied).',
    };
  }

  return {
    status: 200,
    authorized: true,
    identity: {
      uid: decoded.uid,
      email: verifiedEmail,
      emailVerified: true,
      displayName:
        typeof decoded.name === 'string' && decoded.name.trim()
          ? decoded.name.trim().slice(0, 120)
          : null,
      matchedBy: 'single_fixed_admin_email',
      tokenIssuedAt: typeof decoded.iat === 'number' ? decoded.iat : 0,
      tokenExpiresAt: typeof decoded.exp === 'number' ? decoded.exp : 0,
    },
  };
}

/**
 * Express middleware protecting all /api/admin/* endpoints:
 * - Verifies Firebase ID token (RS256 signature, expiry, issuer, audience, UID).
 * - Evaluates Single Fixed Admin Email authorization on the verified token.
 * - Fails closed (401/403/503) and sets Cache-Control: no-store.
 */
export async function requireAdminAuth(
  req: AdminAuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');

  const projectId = resolveFirebaseProjectId();
  const adminApp = getFirebaseAdminApp();
  if (!projectId || !adminApp) {
    res.status(503).json({
      authenticated: false,
      isAdmin: false,
      code: 'AUTH_NOT_CONFIGURED',
      error:
        'Hệ thống xác thực Firebase chưa được cấu hình đầy đủ trên máy chủ. Truy cập quản trị bị từ chối mặc định.',
    });
    return;
  }

  const configuredAdmin = resolveConfiguredAdminEmail();
  if (!configuredAdmin.valid || !configuredAdmin.email) {
    res.status(503).json({
      authenticated: false,
      isAdmin: false,
      code: 'ADMIN_CONFIG_INVALID',
      error:
        'Cấu hình biến môi trường ADMIN_EMAIL trên máy chủ không hợp lệ. Truy cập quản trị bị từ chối mặc định.',
    });
    return;
  }

  const token = parseBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({
      authenticated: false,
      isAdmin: false,
      code: 'MISSING_OR_INVALID_TOKEN',
      error: 'Yêu cầu xác thực quản trị hợp lệ (Bearer Firebase ID token).',
    });
    return;
  }

  try {
    const decoded = await getAuth(adminApp).verifyIdToken(token);

    // Explicit defense-in-depth checks on issuer, audience, subject, and UID
    const expectedIssuer = `https://securetoken.google.com/${projectId}`;
    if (
      decoded.iss !== expectedIssuer ||
      decoded.aud !== projectId ||
      typeof decoded.uid !== 'string' ||
      !VALID_UID_REGEX.test(decoded.uid) ||
      decoded.sub !== decoded.uid
    ) {
      res.status(401).json({
        authenticated: false,
        isAdmin: false,
        code: 'TOKEN_CLAIMS_INVALID',
        error: 'Token xác thực không khớp dự án hoặc không hợp lệ.',
      });
      return;
    }

    req.firebaseToken = decoded;

    const decision = evaluateSingleAdminAuthorization(decoded);
    if (!decision.authorized) {
      res.status(decision.status).json({
        authenticated: decision.status !== 401,
        isAdmin: false,
        code: decision.code,
        error: decision.error,
      });
      return;
    }

    req.adminUser = decision.identity;
    next();
  } catch (err) {
    const errorCode =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code)
        : '';

    const isExpired = errorCode === 'auth/id-token-expired';
    res.status(401).json({
      authenticated: false,
      isAdmin: false,
      code: isExpired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
      error: isExpired
        ? 'Phiên đăng nhập quản trị đã hết hạn. Vui lòng đăng nhập lại.'
        : 'Token xác thực không hợp lệ hoặc không thể xác minh chữ ký.',
    });
  }
}
