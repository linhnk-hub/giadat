import React, { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { AdminAuthProvider } from './context/AdminAuthContext';
import { AppDataProvider, useAppData } from './context/AppDataContext';
import { Layout } from './components/Layout';
import { AdminRouteGuard } from './components/admin/AdminRouteGuard';
import { HomeDashboard } from './components/modules/HomeDashboard';
import { QuickLookupModule } from './components/modules/QuickLookupModule';
import { ParcelFormModule } from './components/modules/ParcelFormModule';
import { PhotoGpsModule } from './components/modules/PhotoGpsModule';
import { StatePriceModule } from './components/modules/StatePriceModule';
import { EcovisModule } from './components/modules/EcovisModule';
import { MarketSurveyModule } from './components/modules/MarketSurveyModule';
import { LocationKFactorModule } from './components/modules/LocationKFactorModule';
import { ReportModule } from './components/modules/ReportModule';
import {
  APP_NAVIGATE_EVENT,
  getCurrentPathname,
  isAdminPath,
  navigateToPath,
} from './utils/navigation';

const ProtectedAdminRedirectNotice: React.FC = () => (
  <div className="banking-card p-8 text-center max-w-lg mx-auto my-8">
    <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-md bg-[#9D1D26] text-white">
      <ShieldCheck className="h-5 w-5" />
    </div>
    <h2 className="mt-4 text-lg font-semibold text-[#1F2429]">
      Quản lý dữ liệu nguồn thuộc khu vực Quản trị (Admin)
    </h2>
    <p className="mt-2 text-sm leading-relaxed text-[#4B5563]">
      Chức năng nạp bộ dữ liệu, chuyển phiên bản và quản lý tài liệu nguồn đã được tách khỏi giao diện công khai và yêu cầu xác thực Quản trị viên tại máy chủ.
    </p>
    <button
      type="button"
      onClick={() => navigateToPath('/admin')}
      className="mt-5 banking-btn-primary"
    >
      Đi tới Cổng Quản trị (/admin)
    </button>
  </div>
);

const ActiveModuleView: React.FC = () => {
  const { activeModule } = useAppData();

  switch (activeModule) {
    case 'home':
      return <HomeDashboard />;
    case 'quick-lookup':
      return <QuickLookupModule />;
    case 'parcel':
      return <ParcelFormModule />;
    case 'photos':
      return <PhotoGpsModule />;
    case 'state-price':
      return <StatePriceModule />;
    case 'ecovis':
      return <EcovisModule />;
    case 'market':
      return <MarketSurveyModule />;
    case 'location-k':
      return <LocationKFactorModule />;
    case 'data-management':
      // Never render DataManagementModule in the public app even if client state is altered
      return <ProtectedAdminRedirectNotice />;
    case 'report':
      return <ReportModule />;
    default:
      return <HomeDashboard />;
  }
};

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

  return (
    <Layout>
      <ActiveModuleView />
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
