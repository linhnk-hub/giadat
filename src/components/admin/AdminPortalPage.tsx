import React, { useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Database,
  LogOut,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useAdminAuth } from '../../context/AdminAuthContext';
import { DataManagementModule } from '../modules/DataManagementModule';
import { formatDateTimeVi } from '../../utils/formatters';
import { navigateToPath } from '../../utils/navigation';
import { firestoreDatabaseId } from '../../firebase';

function getAuthMethodLabel(method: string): string {
  switch (method) {
    case 'firebase_auth_firestore_rules_a1':
      return 'Single Fixed Admin Email (Firebase Auth + Firestore Rules)';
    default:
      return 'Single Fixed Admin Email (Firebase Auth + Firestore Rules)';
  }
}

export const AdminPortalPage: React.FC = () => {
  const { adminSession, signOutAdmin, reverifySession, isBusy } = useAdminAuth();
  const [rechecking, setRechecking] = useState(false);

  const handleRecheck = async () => {
    setRechecking(true);
    try {
      await reverifySession(true);
    } finally {
      setRechecking(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F7F8] text-[#1F2429]">
      {/* Institutional Top Navigation */}
      <header className="sticky top-0 z-30 border-b border-[#E2E5E9] bg-white">
        <div className="h-[3px] w-full bg-[#9D1D26]" aria-hidden="true" />
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#9D1D26] text-white">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold tracking-tight text-[#1F2429] truncate">
                TRA CỨU NHANH GIÁ ĐẤT – KHÁNH HÒA
              </div>
              <div className="text-xs text-[#6B7280]">
                Khu vực Quản trị (Admin Portal) · Cloud Firestore ({firestoreDatabaseId})
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => navigateToPath('/')}
              className="banking-btn-secondary !min-h-[36px] !px-3 !py-1.5 !text-[13px]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Giao diện tra cứu</span>
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void signOutAdmin()}
              className="banking-btn-primary !min-h-[36px] !px-3.5 !py-1.5 !text-[13px]"
            >
              <LogOut className="h-3.5 w-3.5" />
              Đăng xuất
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        {/* Verified Admin Session Summary */}
        <section className="banking-card p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#0B5D3F]">
                <CheckCircle2 className="h-4 w-4" />
                Phiên Quản trị đã xác minh với Firebase Auth & Cloud Firestore Rules
              </div>
              <h1 className="mt-1.5 banking-page-title">
                Quản trị Kho dữ liệu Giá đất Khánh Hòa
              </h1>
              <p className="mt-1.5 text-sm leading-relaxed text-[#4B5563]">
                Đang đăng nhập với tài khoản{' '}
                <span className="font-mono font-medium text-[#1F2429]">
                  {adminSession?.email || adminSession?.uid}
                </span>
                . Mọi thao tác nạp phiên bản, kích hoạt, khôi phục (rollback) và cập nhật danh mục PDF được thực thi trực tiếp trên Cloud Firestore database{' '}
                <code className="font-mono text-[13px] text-[#1F2429]">{firestoreDatabaseId}</code>.
              </p>
            </div>

            <button
              type="button"
              disabled={rechecking}
              onClick={() => void handleRecheck()}
              className="banking-btn-secondary shrink-0"
            >
              <RefreshCw className={`h-4 w-4 ${rechecking ? 'animate-spin' : ''}`} />
              Xác minh lại phiên
            </button>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 border-t border-[#E2E5E9] pt-5 sm:grid-cols-3 text-[13px]">
            <div>
              <div className="text-[#6B7280]">Cơ chế bảo vệ</div>
              <div className="mt-1 font-semibold text-[#1F2429]">
                {getAuthMethodLabel(adminSession?.authMethod || '')}
              </div>
            </div>
            <div>
              <div className="text-[#6B7280]">Cloud Firestore Database ID</div>
              <div className="mt-1 inline-flex items-center gap-1.5 font-mono font-medium text-[#1F2429]">
                <Database className="h-3.5 w-3.5 text-[#0B5D3F]" />
                {adminSession?.databaseId || firestoreDatabaseId}
              </div>
            </div>
            <div>
              <div className="text-[#6B7280]">Thời điểm xác minh</div>
              <div className="mt-1 font-mono font-medium text-[#1F2429]">
                {formatDateTimeVi(adminSession?.serverVerifiedAt)}
              </div>
            </div>
          </div>
        </section>

        {/* Direct Cloud Firestore Dataset Management */}
        <section className="space-y-3">
          <DataManagementModule />
        </section>
      </main>
    </div>
  );
};
