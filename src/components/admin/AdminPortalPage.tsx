import React, { useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Database,
  Globe,
  LogOut,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  History,
} from 'lucide-react';
import { useAdminAuth } from '../../context/AdminAuthContext';
import { DataManagementModule } from '../modules/DataManagementModule';
import { formatDateTimeVi } from '../../utils/formatters';
import { navigateToPath } from '../../utils/navigation';

const UPCOMING_ADMIN_MODULES = [
  {
    id: 'datasets-firestore',
    milestone: 'M1.2',
    status: 'active' as const,
    title: 'Quản lý Bộ dữ liệu Excel / CSV / JSON & Lưu trữ máy chủ',
    description:
      'Lưu trữ bền vững dữ liệu Giá Nhà nước, ECOVIS, Thị trường và Quy định K theo từng phiên bản trên máy chủ, hỗ trợ tọa độ không gian GPS (tùy chọn), xem trước kiểm lỗi, xuất JSON và khôi phục phiên bản.',
    icon: Database,
  },
  {
    id: 'sources-registry',
    milestone: 'M2 / M5',
    status: 'upcoming' as const,
    title: 'Danh mục nguồn Website BĐS & Facebook Group',
    description:
      'Quản lý nguồn dữ liệu tham khảo, phân loại nguồn công khai / hạn chế / nhập tay, theo dõi trạng thái cập nhật và lỗi kiểm tra.',
    icon: Globe,
  },
  {
    id: 'geo-k-config',
    milestone: 'M3 / M4',
    status: 'upcoming' as const,
    title: 'Cấu hình bán kính lân cận & quy tắc Hệ số K',
    description:
      'Thiết lập bán kính tìm kiếm giá thị trường lân cận và các tiêu chí có căn cứ phục vụ đề xuất hệ số K tự động.',
    icon: SlidersHorizontal,
  },
  {
    id: 'audit-backup',
    milestone: 'M5',
    status: 'upcoming' as const,
    title: 'Nhật ký thao tác Admin & Sao lưu dữ liệu',
    description:
      'Ghi nhận lịch sử thay đổi phiên bản, kiểm tra trạng thái hệ thống và sao lưu/khôi phục toàn bộ kho dữ liệu.',
    icon: History,
  },
];

function getAuthMethodLabel(method: string): string {
  switch (method) {
    case 'single_fixed_admin_email':
      return 'Email Quản trị cố định (Xác minh máy chủ)';
    default:
      return 'Email Quản trị cố định (Xác minh máy chủ)';
  }
}

export const AdminPortalPage: React.FC = () => {
  const { adminSession, signOutAdmin, reverifySession, isBusy } = useAdminAuth();
  const [activeTab, setActiveTab] = useState<'datasets' | 'overview'>('datasets');
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
                Khu vực Quản trị (Admin Portal) · Single Fixed Admin Email
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
        {/* Welcome & Verified Authentication Status */}
        <section className="banking-card p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#0B5D3F]">
                <CheckCircle2 className="h-4 w-4" />
                Phiên Quản trị đã được máy chủ xác minh
              </div>
              <h1 className="mt-1.5 banking-page-title">
                Chào mừng Quản trị viên
              </h1>
              <p className="mt-1.5 text-sm leading-relaxed text-[#4B5563]">
                Đang đăng nhập với tài khoản{' '}
                <span className="font-mono font-medium text-[#1F2429]">
                  {adminSession?.email || adminSession?.uid}
                </span>
                . Mọi thao tác nhạy cảm và các đường dẫn{' '}
                <code className="font-mono text-[13px] text-[#1F2429]">/api/admin/*</code> đều được bảo vệ bằng xác minh Firebase ID token ở máy chủ.
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
              <div className="text-[#6B7280]">Cơ chế phân quyền máy chủ</div>
              <div className="mt-1 font-semibold text-[#1F2429]">
                {getAuthMethodLabel(adminSession?.authMethod || '')}
              </div>
            </div>
            <div>
              <div className="text-[#6B7280]">Firebase UID (rút gọn)</div>
              <div className="mt-1 font-mono font-medium text-[#1F2429]">
                {adminSession?.uid ? `${adminSession.uid.slice(0, 10)}…` : '—'}
              </div>
            </div>
            <div>
              <div className="text-[#6B7280]">Thời điểm xác minh máy chủ</div>
              <div className="mt-1 font-mono font-medium text-[#1F2429]">
                {formatDateTimeVi(adminSession?.serverVerifiedAt)}
              </div>
            </div>
          </div>
        </section>

        {/* Section Switcher: M1.2 Datasets vs Roadmap Overview */}
        <div className="flex items-center gap-2 border-b border-[#E2E5E9] pb-px">
          <button
            type="button"
            onClick={() => setActiveTab('datasets')}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'datasets'
                ? 'border-[#9D1D26] text-[#9D1D26]'
                : 'border-transparent text-[#4B5563] hover:text-[#1F2429]'
            }`}
          >
            Quản lý Bộ dữ liệu nguồn (M1.2)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'overview'
                ? 'border-[#9D1D26] text-[#9D1D26]'
                : 'border-transparent text-[#4B5563] hover:text-[#1F2429]'
            }`}
          >
            Tổng quan lộ trình Admin Portal
          </button>
        </div>

        {activeTab === 'overview' ? (
          <section className="space-y-4">
            <div>
              <h2 className="banking-section-title">
                Các phân hệ quản trị theo lộ trình triển khai
              </h2>
              <p className="mt-1 text-sm text-[#4B5563]">
                M1.1 (Xác thực Admin) và M1.2 (Quản lý bộ dữ liệu máy chủ CSV/Excel/JSON, tọa độ không gian và lịch sử phiên bản) đã hoạt động. Các phân hệ M2–M5 sẽ được kích hoạt ở các giai đoạn tiếp theo.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {UPCOMING_ADMIN_MODULES.map((mod) => {
                const Icon = mod.icon;
                const isActiveMod = mod.status === 'active';
                return (
                  <div
                    key={mod.id}
                    className="banking-card p-5 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <div
                          className={`flex h-9 w-9 items-center justify-center rounded-md border ${
                            isActiveMod
                              ? 'bg-[#ECF7F2] border-[#B8DEC9] text-[#0B5D3F]'
                              : 'bg-[#F6F7F8] border-[#E2E5E9] text-[#4B5563]'
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <span
                          className={`font-mono text-xs font-semibold ${
                            isActiveMod ? 'text-[#0B5D3F]' : 'text-[#6B7280]'
                          }`}
                        >
                          {isActiveMod ? `Đang hoạt động (${mod.milestone})` : `Dự kiến ${mod.milestone}`}
                        </span>
                      </div>
                      <h3 className="mt-3 text-[15px] font-semibold text-[#1F2429]">{mod.title}</h3>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-[#4B5563]">
                        {mod.description}
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-[#E2E5E9] flex items-center justify-between text-[13px]">
                      {isActiveMod ? (
                        <button
                          type="button"
                          onClick={() => setActiveTab('datasets')}
                          className="font-semibold text-[#9D1D26] hover:text-[#7F151D] hover:underline cursor-pointer"
                        >
                          Mở phân hệ Quản lý Bộ dữ liệu →
                        </button>
                      ) : (
                        <span className="text-[#6B7280]">Chưa triển khai ở giai đoạn hiện tại</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : (
          <section className="space-y-3">
            <DataManagementModule />
          </section>
        )}
      </main>
    </div>
  );
};
