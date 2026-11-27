import React from 'react';
import { Landmark } from 'lucide-react';

/**
 * Clean, mobile-first institutional shell for public land-price lookup.
 * Intentionally omits admin links, version history tabs, DEMO toggles, and
 * complex appraisal sidebars so regular users see the lookup workflow immediately.
 */
export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="min-h-screen flex flex-col bg-[#F6F7F8] text-[#1F2429]">
      <header className="sticky top-0 z-30 border-b border-[#E2E5E9] bg-white">
        <div className="h-[3px] w-full bg-[#9D1D26]" aria-hidden="true" />
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#9D1D26] text-white">
              <Landmark className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-[14px] sm:text-[15px] font-bold tracking-tight text-[#1F2429] truncate">
                TRA CỨU NHANH GIÁ ĐẤT – KHÁNH HÒA
              </h1>
              <p className="text-[11px] sm:text-xs text-[#6B7280] truncate">
                Tải ảnh GeoSnapCam có GPS · Đối chiếu Giá Nhà nước, ECOVIS &amp; Thị trường
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full">
        <div className="mx-auto max-w-5xl px-3.5 py-4 sm:px-6 sm:py-6">
          {children}
        </div>
      </main>

      <footer className="border-t border-[#E2E5E9] bg-white">
        <div className="mx-auto max-w-5xl px-4 py-3 sm:px-6 text-[11px] leading-relaxed text-[#6B7280] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
          <span>
            Thông tin phục vụ tra cứu tham khảo nhanh; dữ liệu thị trường là giá rao bán, không phải giá giao dịch thành công.
          </span>
          <span className="shrink-0 text-[#4B5563]">Tỉnh Khánh Hòa</span>
        </div>
      </footer>
    </div>
  );
};
