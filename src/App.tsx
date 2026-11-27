import React, { useEffect, useState } from 'react';
import { AdminAuthProvider } from './context/AdminAuthContext';
import { AppDataProvider } from './context/AppDataContext';
import { Layout } from './components/Layout';
import { AdminRouteGuard } from './components/admin/AdminRouteGuard';
import { QuickLookupModule } from './components/modules/QuickLookupModule';
import {
  APP_NAVIGATE_EVENT,
  getCurrentPathname,
  isAdminPath,
} from './utils/navigation';

const AppRouter: React.FC = () => {
  const [pathname, setPathname] = useState<string>(() => getCurrentPathname());

  useEffect(() => {
    const syncPath = () => setPathname(getCurrentPathname());
    window.addEventListener('popstate', syncPath);
    window.addEventListener(APP_NAVIGATE_EVENT, syncPath);
    return () => {
      window.removeEventListener('popstate', syncPath);
      window.removeEventListener(APP_NAVIGATE_EVENT, syncPath);
    };
  }, []);

  if (isAdminPath(pathname)) {
    return <AdminRouteGuard />;
  }

  // Simplified public experience: lands directly on the mobile-first land price lookup screen.
  // Admin management, version history, and dataset operations are strictly isolated at /admin.
  return (
    <Layout>
      <QuickLookupModule />
    </Layout>
  );
};

export default function App() {
  return (
    <AdminAuthProvider>
      <AppDataProvider>
        <AppRouter />
      </AppDataProvider>
    </AdminAuthProvider>
  );
}
