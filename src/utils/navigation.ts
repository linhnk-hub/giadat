export const APP_NAVIGATE_EVENT = 'khanhhoa:navigate';

export function getCurrentPathname(): string {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname || '/';
}

export function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

export function navigateToPath(targetPath: string): void {
  if (typeof window === 'undefined') return;
  const normalized = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
  if (window.location.pathname !== normalized) {
    window.history.pushState({}, '', normalized);
  }
  window.dispatchEvent(new CustomEvent(APP_NAVIGATE_EVENT, { detail: { pathname: normalized } }));
}
