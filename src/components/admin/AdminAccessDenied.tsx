import React from 'react';
import { ArrowLeft, LogOut, ShieldX } from 'lucide-react';
import { useAdminAuth } from '../../context/AdminAuthContext';
import { navigateToPath } from '../../utils/navigation';

export const AdminAccessDenied: React.FC = () => {
  const { firebaseUser, errorMessage, signOutAdmin, isBusy } = useAdminAuth();

  return (
    <div className="min-h-screen bg-[#F6F7F8] flex flex-col">
      <div className="h-[3px] w-full bg-[#9D1D26]" aria-hidden="true" />
      <div className="flex flex-1 flex-col justify-center px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-md banking-card p-6 sm:p-7">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#FDF2F3] text-[#9D1D26] border border-[#E8B8BC]">
              <ShieldX className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[#1F2429]">
                Không có quyền Quản trị (403)
              </h1>
              <p className="text-[13px] text-[#6B7280]">Access Denied · Xác minh máy chủ</p>
            </div>
          </div>

          <div className="mt-5 space-y-3 text-sm leading-relaxed text-[#4B5563]">
            <p>
              Tài khoản{' '}
              <span className="font-mono font-semibold text-[#1F2429]">
                {firebaseUser?.email || 'đang đăng nhập'}
              </span>{' '}
              đã xác thực thành công với Firebase Authentication, nhưng{' '}
              <strong className="text-[#1F2429]">
                không nằm trong danh sách Quản trị viên được máy chủ cấp quyền
              </strong>
              .
            </p>
            {errorMessage && (
              <p className="rounded-md border border-[#E8B8BC] bg-[#FDF2F3] px-3.5 py-2.5 text-[13px] text-[#641016]">
                {errorMessage}
              </p>
            )}
            <p className="text-[13px] text-[#6B7280]">
              Hệ thống tách biệt giữa đăng nhập (Authentication) và phân quyền quản trị (Authorization). Vui lòng đăng xuất để đổi tài khoản quản trị hợp lệ hoặc quay lại ứng dụng tra cứu.
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void signOutAdmin()}
              className="banking-btn-primary flex-1"
            >
              <LogOut className="h-4 w-4" />
              Đăng xuất & đổi tài khoản
            </button>
            <button
              type="button"
              onClick={() => navigateToPath('/')}
              className="banking-btn-secondary"
            >
              <ArrowLeft className="h-4 w-4" />
              Về trang tra cứu
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
