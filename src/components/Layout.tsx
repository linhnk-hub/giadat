import React, { useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Camera,
  Compass,
  FileSpreadsheet,
  FileText,
  Home,
  Landmark,
  MapPin,
  Menu,
  Plus,
  Scale,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAppData } from '../context/AppDataContext';
import { ModuleId } from '../types/valuation';
import { navigateToPath } from '../utils/navigation';

interface NavItem {
  id: ModuleId;
  label: string;
  section: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Trang chủ & Tổng quan', section: 'Điều hành', icon: Home },
  { id: 'quick-lookup', label: 'Tra cứu nhanh từ ảnh GPS', section: 'Điều hành', icon: Compass },
  { id: 'parcel', label: 'Thông tin thửa đất', section: 'Hồ sơ tài sản', icon: MapPin },
  { id: 'photos', label: 'Ảnh thực địa & GPS', section: 'Hồ sơ tài sản', icon: Camera },
  { id: 'state-price', label: 'Bảng giá đất Nhà nước', section: 'Tra cứu nguồn giá', icon: Landmark },
  { id: 'ecovis', label: 'Khảo sát ECOVIS', section: 'Tra cứu nguồn giá', icon: Building2 },
  { id: 'market', label: 'Giá thị trường tham khảo', section: 'Tra cứu nguồn giá', icon: Search },
  { id: 'location-k', label: 'Phân tích vị trí & Hệ số K', section: 'Phân tích & Báo cáo', icon: Scale },
  { id: 'report', label: 'Báo cáo kết quả tra cứu', section: 'Phân tích & Báo cáo', icon: FileText },
];

const MODULE_TITLES: Record<ModuleId, string> = {
  home: 'Trang chủ',
  'quick-lookup': 'Tra cứu nhanh từ ảnh GeoSnapCamera & GPS',
  parcel: 'Nhập thông tin thửa đất',
  photos: 'Ảnh thực địa và phân tích GPS',
  'state-price': 'Tra cứu Bảng giá đất Nhà nước',
  ecovis: 'Tra cứu dữ liệu khảo sát ECOVIS',
  market: 'Khảo sát giá thị trường tham khảo',
  'location-k': 'Phân tích vị trí và Hệ số K',
  'data-management': 'Quản lý dữ liệu nguồn',
  report: 'Báo cáo tổng hợp kết quả tra cứu',
};

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    activeModule,
    setActiveModule,
    isDemoMode,
    setIsDemoMode,
    dossiers,
    activeDossier,
    activeDossierIntegrity,
    selectDossier,
    createNewDossier,
    storageWarning,
  } = useAppData();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const groupedSections = ['Điều hành', 'Hồ sơ tài sản', 'Tra cứu nguồn giá', 'Phân tích & Báo cáo'];

  const handleSelectModule = (id: ModuleId) => {
    setActiveModule(id);
    setMobileMenuOpen(false);
  };

  const renderSidebarContent = () => (
    <div className="flex h-full flex-col bg-white border-r border-[#E2E5E9] text-[#1F2429]">
      {/* Institutional Deep Red Brand Header */}
      <div className="bg-[#9D1D26] px-5 py-5 text-white border-b-2 border-[#0B5D3F]">
        <button
          type="button"
          onClick={() => handleSelectModule('home')}
          className="text-left w-full rounded focus-visible:outline-2 focus-visible:outline-white cursor-pointer"
        >
          <div className="text-[15px] font-bold tracking-tight text-white leading-snug">
            TRA CỨU GIÁ ĐẤT
          </div>
          <div className="mt-0.5 text-xs text-white/85 font-normal">
            Tỉnh Khánh Hòa · Nghiệp vụ TSBĐ
          </div>
        </button>
      </div>

      {/* Active Dossier Switcher */}
      <div className="border-b border-[#E2E5E9] bg-[#F9FAFB] px-4 py-3.5">
        <div className="flex items-center justify-between text-xs text-[#4B5563] mb-1.5">
          <span className="font-medium">
            {isDemoMode ? 'Hồ sơ DEMO (tạm trong phiên)' : 'Hồ sơ nghiệp vụ thật'}
          </span>
          <button
            type="button"
            onClick={createNewDossier}
            className="inline-flex items-center gap-1 text-[#9D1D26] hover:text-[#7F151D] font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            Tạo mới
          </button>
        </div>
        <select
          aria-label="Chọn hồ sơ tài sản bảo đảm"
          value={activeDossier.id}
          onChange={(e) => selectDossier(e.target.value)}
          className="w-full min-h-[38px] rounded-md border border-[#CBD2D9] bg-white px-2.5 py-1.5 text-[13px] font-mono text-[#1F2429] focus:border-[#9D1D26] focus:outline-none"
        >
          {dossiers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.parcel.dossierCode}
              {d.parcel.wardCommune ? ` – ${d.parcel.wardCommune}` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="Điều hướng chính">
        {groupedSections.map((section) => {
          const items = NAV_ITEMS.filter((item) => item.section === section);
          return (
            <div key={section}>
              <div className="px-2.5 pb-1.5 text-xs font-semibold text-[#6B7280] tracking-wide uppercase">
                {section}
              </div>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const Icon = item.icon;
                  const active = activeModule === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectModule(item.id)}
                      className={`flex w-full min-h-[40px] items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#FDF2F3] text-[#9D1D26] font-semibold'
                          : 'text-[#374151] hover:bg-[#F3F4F6] hover:text-[#1F2429] font-medium'
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          active ? 'text-[#9D1D26]' : 'text-[#6B7280]'
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Data Mode Footer Switch (Real vs Isolated DEMO) & Admin Link */}
      <div className="border-t border-[#E2E5E9] bg-[#F9FAFB] px-4 py-3.5 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[#1F2429] font-semibold text-[13px]">Chế độ DEMO minh họa</span>
          <button
            type="button"
            role="switch"
            aria-checked={isDemoMode}
            onClick={() => setIsDemoMode(!isDemoMode)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
              isDemoMode ? 'bg-[#8A5300]' : 'bg-[#CBD2D9]'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-xs transition-transform ${
                isDemoMode ? 'translate-x-4.5' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-[#6B7280]">
          {isDemoMode
            ? 'Đang mở hồ sơ DEMO tạm trong phiên, hoàn toàn tách biệt với hồ sơ thật.'
            : 'Đang dùng kho dữ liệu và hồ sơ thật của đơn vị (chặn tuyệt đối dữ liệu DEMO).'}
        </p>

        <div className="mt-3 pt-3 border-t border-[#E2E5E9]">
          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              navigateToPath('/admin');
            }}
            className="flex w-full min-h-[38px] items-center justify-between rounded-md border border-[#CBD2D9] bg-white px-3 py-2 text-left text-[13px] font-medium text-[#1F2429] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
          >
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#9D1D26]" />
              Cổng Quản trị (Admin)
            </span>
            <span className="font-mono text-xs text-[#6B7280]">/admin</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[#F6F7F8] text-[#1F2429]">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden lg:flex lg:w-68 lg:shrink-0 lg:flex-col lg:fixed lg:inset-y-0">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-[#1F2429]/50"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="relative flex w-72 max-w-[86vw] flex-col">
            <button
              type="button"
              aria-label="Đóng menu"
              onClick={() => setMobileMenuOpen(false)}
              className="absolute right-3 top-4 z-10 rounded-md p-1.5 text-white/90 hover:bg-white/15 cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
            {renderSidebarContent()}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col lg:pl-68 min-w-0">
        {/* Institutional Top Header with Deep Red Top Accent */}
        <header className="no-print sticky top-0 z-30 border-t-[3px] border-t-[#9D1D26] border-b border-b-[#E2E5E9] bg-white">
          <div className="flex h-15 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                aria-label="Mở menu điều hướng"
                onClick={() => setMobileMenuOpen(true)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-md text-[#374151] hover:bg-[#F3F4F6] lg:hidden cursor-pointer"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="flex items-center gap-2 text-sm sm:text-[15px] min-w-0">
                <span className="hidden sm:inline text-[#6B7280] whitespace-nowrap font-medium">
                  Khánh Hòa
                </span>
                <span className="hidden sm:inline text-[#CBD2D9]" aria-hidden="true">
                  /
                </span>
                <h1 className="font-semibold text-[#1F2429] truncate">
                  {MODULE_TITLES[activeModule]}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <span className="hidden md:inline text-[13px] font-mono text-[#6B7280] whitespace-nowrap">
                {activeDossier.parcel.dossierCode}
              </span>
              <button
                type="button"
                onClick={() => setActiveModule('report')}
                className="banking-btn-primary text-[13px] sm:text-sm px-3.5 py-2"
              >
                <FileSpreadsheet className="h-4 w-4" />
                <span>Báo cáo tra cứu</span>
              </button>
            </div>
          </div>
        </header>

        {/* Critical Contamination Warning Banner */}
        {activeDossierIntegrity.isContaminatedRealDossier && (
          <div className="no-print border-b border-[#E8B8BC] bg-[#FDF2F3] px-4 py-3 sm:px-6 lg:px-8">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 text-[13px] text-[#641016]">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-[#9D1D26]" />
                <span>
                  <strong className="font-semibold text-[#7F151D]">
                    CẢNH BÁO NHIỄM DỮ LIỆU DEMO ({activeDossierIntegrity.contaminatedItems.length} bản ghi):
                  </strong>{' '}
                  Hồ sơ thật <span className="font-mono font-semibold">{activeDossier.parcel.dossierCode}</span> đang chứa dữ liệu DEMO. Hệ thống đã <strong>CHẶN xuất báo cáo thật</strong> cho đến khi cán bộ kiểm tra và gỡ bỏ thủ công.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveModule('report')}
                className="font-semibold text-[#9D1D26] underline underline-offset-2 hover:text-[#641016] whitespace-nowrap shrink-0 cursor-pointer"
              >
                Kiểm tra & gỡ dữ liệu DEMO
              </button>
            </div>
          </div>
        )}

        {/* Explicit DEMO Mode Isolation Warning Banner */}
        {isDemoMode && (
          <div className="no-print border-b border-[#EAD196] bg-[#FEF7E6] px-4 py-3 sm:px-6 lg:px-8">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 text-[13px] text-[#6E4200]">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-[#8A5300]" />
                <span>
                  <strong className="font-semibold">CHẾ ĐỘ DỮ LIỆU MINH HỌA (DEMO) – HỒ SƠ TẠM TÁCH BIỆT:</strong>{' '}
                  Mọi thao tác gắn dữ liệu trong chế độ này chỉ áp dụng trên hồ sơ DEMO tạm trong phiên, không lưu vào hồ sơ nghiệp vụ thật và không dùng cho thẩm định chính thức.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsDemoMode(false)}
                className="font-semibold text-[#6E4200] underline underline-offset-2 hover:text-[#1F2429] whitespace-nowrap shrink-0 cursor-pointer"
              >
                Quay lại hồ sơ & dữ liệu thật
              </button>
            </div>
          </div>
        )}

        {storageWarning && (
          <div className="no-print border-b border-[#E8B8BC] bg-[#FDF2F3] px-4 py-2.5 text-[13px] text-[#7F151D] sm:px-6 lg:px-8">
            <div className="mx-auto max-w-6xl">{storageWarning}</div>
          </div>
        )}

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>

        {/* Institutional Footer */}
        <footer className="no-print border-t border-[#E2E5E9] bg-white px-4 py-4 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-6xl flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between text-xs text-[#6B7280]">
            <span>
              Tra Cứu Nhanh Giá Đất – Tỉnh Khánh Hòa · Hệ thống hỗ trợ nghiệp vụ thẩm định tài sản bảo đảm
            </span>
            <span>
              Tài liệu tra cứu tham khảo nội bộ, không thay thế chứng thư thẩm định giá chính thức
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
};
