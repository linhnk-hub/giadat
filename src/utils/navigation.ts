export const APP_NAVIGATE_EVENT = 'khanhhoa:navigate';

function readViteBaseUrl(): string {
  try {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    return typeof env?.BASE_URL === 'string' ? env.BASE_URL : '/';
  } catch {
    return '/';
  }
}

function inferRelativeSubpathPrefix(): string {
  if (typeof window === 'undefined') return '';
  const path = window.location.pathname || '/';
  const adminMatch = path.match(/^\/([^/]+)\/admin(?:\/|$)/);
  if (adminMatch && adminMatch[1]) {
    return `/${adminMatch[1]}`;
  }
  const repoRootMatch = path.match(/^\/([^/]+)\/?$/);
  if (repoRootMatch && repoRootMatch[1] && repoRootMatch[1] !== 'admin') {
    return `/${repoRootMatch[1]}`;
  }
  return '';
}

/**
 * Normalizes a Vite BASE_URL (e.g. '/', './', '/repo/', '/repo') into a
 * prefix suitable for pathname matching: '' for root, or '/repo' (no trailing slash).
 */
export function normalizeBasePrefix(baseUrl?: string): string {
  const raw = typeof baseUrl === 'string' ? baseUrl : readViteBaseUrl();
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '/') {
    return '';
  }
  if (trimmed === './') {
    return inferRelativeSubpathPrefix();
  }
  const stripped = trimmed.replace(/^\/+|\/+$/g, '');
  return stripped ? `/${stripped}` : '';
}

/**
 * Strips the configured repository base prefix from a browser pathname,
 * returning a logical app path starting with '/' (e.g. '/' or '/admin').
 */
export function stripBasePath(pathname: string, baseUrl?: string): string {
  const rawPath = pathname && pathname.startsWith('/') ? pathname : `/${pathname || ''}`;
  const prefix = normalizeBasePrefix(baseUrl);
  if (!prefix) {
    return rawPath || '/';
  }
  if (rawPath === prefix || rawPath === `${prefix}/`) {
    return '/';
  }
  if (rawPath.startsWith(`${prefix}/`)) {
    const remainder = rawPath.slice(prefix.length);
    return remainder.startsWith('/') ? remainder : `/${remainder}`;
  }
  return rawPath;
}

/**
 * Prepends the configured repository base prefix to a logical app path.
 * Preserves '/<repo>/' for root and '/<repo>/admin' for admin routes.
 */
export function withBasePath(appPath: string, baseUrl?: string): string {
  const normalizedLogical = appPath.startsWith('/') ? appPath : `/${appPath}`;
  const prefix = normalizeBasePrefix(baseUrl);
  if (!prefix) {
    return normalizedLogical;
  }
  if (normalizedLogical === '/') {
    return `${prefix}/`;
  }
  return `${prefix}${normalizedLogical}`;
}

export function getCurrentPathname(baseUrl?: string): string {
  if (typeof window === 'undefined') return '/';
  return stripBasePath(window.location.pathname || '/', baseUrl);
}

export function isAdminPath(pathname: string, baseUrl?: string): boolean {
  const logical = stripBasePath(pathname, baseUrl);
  return logical === '/admin' || logical.startsWith('/admin/');
}

export function navigateToPath(targetPath: string, baseUrl?: string): void {
  if (typeof window === 'undefined') return;
  const logical = stripBasePath(targetPath.startsWith('/') ? targetPath : `/${targetPath}`, baseUrl);
  const fullPath = withBasePath(logical, baseUrl);
  if (window.location.pathname !== fullPath) {
    window.history.pushState({}, '', fullPath);
  }
  window.dispatchEvent(
    new CustomEvent(APP_NAVIGATE_EVENT, { detail: { pathname: logical, fullPathname: fullPath } })
  );
}
