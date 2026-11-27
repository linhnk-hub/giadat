/**
 * Frontend API URL helper for decoupled GitHub Pages + Render Backend deployment (M4.1).
 *
 * - Reads build-time `VITE_API_BASE_URL` (e.g. `https://example-backend.onrender.com`).
 * - When empty/unset (local same-origin development), returns normalized relative `/api/...` path.
 * - Never hardcodes a backend URL and never holds server secrets.
 */

function readViteApiBaseUrl(): string {
  try {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    return typeof env?.VITE_API_BASE_URL === 'string' ? env.VITE_API_BASE_URL : '';
  } catch {
    return '';
  }
}

export function resolveApiBaseUrl(baseUrlOverride?: string): string {
  const raw = typeof baseUrlOverride === 'string' ? baseUrlOverride : readViteApiBaseUrl();
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
}

export function buildApiUrl(path: string, baseUrlOverride?: string): string {
  const normalizedPath = `/${path.trim().replace(/^\/+/, '')}`;
  const baseUrl = resolveApiBaseUrl(baseUrlOverride);
  if (!baseUrl) {
    return normalizedPath;
  }
  return `${baseUrl}${normalizedPath}`;
}
