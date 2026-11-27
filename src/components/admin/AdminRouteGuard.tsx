import React from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useAdminAuth } from '../../context/AdminAuthContext';
import { AdminAccessDenied } from './AdminAccessDenied';
import { AdminLoginPage } from './AdminLoginPage';
import { AdminPortalPage } from './AdminPortalPage';

export const AdminRouteGuard: React.FC = () => {
  const { status } = useAdminAuth();

  if (status === 'loading' || status === 'verifying') {
    return (
      <div className="min-h-screen bg-[#F6F7F8] flex flex-col">
        <div className="h-[3px] w-full bg-[#9D1D26]" aria-hidden="true" />
        <div className="flex flex-1 flex-col items-center justify-center px-4">
          <div className="banking-card px-8 py-6 flex flex-col items-center gap-3 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-md bg-[#9D1D26] text-white">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="inline-flex items-center gap-2 text-sm font-medium text-[#1F2429]">
              <Loader2 className="h-4 w-4 animate-spin text-[#9D1D26]" />
              <span>
                {status === 'verifying'
                  ? 'Đang xác minh quyền Quản trị với máy chủ...'
                  : 'Đang kiểm tra phiên xác thực...'}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'access_denied') {
    return <AdminAccessDenied />;
  }

  if (status === 'authorized') {
    return <AdminPortalPage />;
  }

  // Deny by default for 'unauthenticated' and 'error'
  return <AdminLoginPage />;
};
