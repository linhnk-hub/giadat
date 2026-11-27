import React from 'react';
import {
  ArrowRight,
  Building2,
  Camera,
  FileText,
  Landmark,
  MapPin,
  Scale,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { useAppData } from '../../context/AppDataContext';
import { ModuleId } from '../../types/valuation';
import { formatDateTimeVi } from '../../utils/formatters';
import { navigateToPath } from '../../utils/navigation';

export const HomeDashboard: React.FC = () => {
  const {
    setActiveModule,
    isDemoMode,
    setIsDemoMode,
    realStateCount,
    realEcovisCount,
    realKRulesCount,
    realMarketCount,
    activeStateMeta,
    activeEcovisMeta,
    activeKRulesMeta,
    activeMarketMeta,
    pdfDocuments,
    activeDossier,
  } = useAppData();

  const quickActions: Array<{
    id: ModuleId;
    step: string;
    title: string;
    description: string;
    actionLabel: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      id: 'state-price',
      step: '01',
      title: 'Tra cứu Bảng giá đất Nhà nước',
      description:
        'Tra cứu nguyên trạng Bảng giá đất Nhà nước (Nghị quyết 15/2025/NQ-HĐND tỉnh Khánh Hòa) kèm trích dẫn phụ lục và trang nguồn.',
      actionLabel: 'Mở tra cứu bảng giá',
      icon: Landmark,
    },
    {
      id: 'location-k',
      step: '02',
      title: 'Phân tích vị trí & Hệ số K',
      description:
        'Đánh giá yếu tố mặt tiền, chiều sâu, độ rộng hẻm, khoảng cách đường chính và kiểm tra căn cứ pháp lý trước khi áp dụng hệ số K.',
      actionLabel: 'Phân tích vị trí & K',
      icon: Scale,
    },
    {
      id: 'market',
      step: '03',
      title: 'Khảo sát giá thị trường',
      description:
        'Tiếp nhận đường dẫn tin rao hoặc nhập thủ công, tự động tính đơn giá/m², lọc tin trùng và phân loại xác minh sơ bộ.',
      actionLabel: 'Mở khảo sát thị trường',
      icon: Search,
    },
    {
      id: 'report',
      step: '04',
      title: 'Báo cáo kết quả tra cứu',
      description:
        'Tổng hợp 11 mục thông tin thửa đất, GPS, bảng giá, ECOVIS, giá rao bán, hệ số K và xuất báo cáo chuẩn A4 (PDF / Excel).',
      actionLabel: 'Xem & xuất báo cáo',
      icon: FileText,
    },
  ];

  const parcelRequiredChecks = [
    { label: 'Địa chỉ thửa đất', ok: Boolean(activeDossier.parcel.address.trim()) },
    { label: 'Xã/Phường', ok: Boolean(activeDossier.parcel.wardCommune.trim()) },
    { label: 'Tuyến đường', ok: Boolean(activeDossier.parcel.streetName.trim()) },
    {
      label: 'Số thửa & Tờ bản đồ',
      ok: Boolean(activeDossier.parcel.parcelNumber.trim() && activeDossier.parcel.mapSheetNumber.trim()),
    },
    { label: 'Loại đất theo GCN', ok: Boolean(activeDossier.parcel.landTypeCertificate.trim()) },
    { label: 'Diện tích (m²)', ok: activeDossier.parcel.areaSqm !== null && activeDossier.parcel.areaSqm > 0 },
  ];
  const completedParcelCount = parcelRequiredChecks.filter((c) => c.ok).length;

  const dataStatusRows = [
    {
      name: 'Bảng giá đất Nhà nước (NQ 15/2025/NQ-HĐND)',
      category: 'Dữ liệu pháp lý chính thức',
      rowCount: realStateCount,
      version: activeStateMeta?.versionLabel ?? 'Chưa nạp phiên bản',
      updatedAt: activeStateMeta ? formatDateTimeVi(activeStateMeta.importedAt) : 'Chưa cập nhật',
      ready: realStateCount > 0,
      target: 'state-price' as ModuleId,
    },
    {
      name: 'Báo cáo khảo sát giá đất ECOVIS',
      category: 'Dữ liệu khảo sát độc lập',
      rowCount: realEcovisCount,
      version: activeEcovisMeta?.versionLabel ?? 'Chưa nạp phiên bản',
      updatedAt: activeEcovisMeta ? formatDateTimeVi(activeEcovisMeta.importedAt) : 'Chưa cập nhật',
      ready: realEcovisCount > 0,
      target: 'ecovis' as ModuleId,
    },
    {
      name: 'Dữ liệu khảo sát giá thị trường',
      category: 'Dữ liệu rao bán tham khảo',
      rowCount: realMarketCount,
      version:
        activeMarketMeta?.versionLabel ??
        (realMarketCount > 0 ? 'Nhập thủ công' : 'Chưa có tin rao'),
      updatedAt: activeMarketMeta
        ? formatDateTimeVi(activeMarketMeta.importedAt)
        : realMarketCount > 0
        ? 'Cập nhật thủ công'
        : 'Chưa cập nhật',
      ready: realMarketCount > 0,
      target: 'market' as ModuleId,
    },
    {
      name: 'Danh mục quy định Hệ số K',
      category: 'Căn cứ tính toán điều chỉnh',
      rowCount: realKRulesCount,
      version: activeKRulesMeta?.versionLabel ?? 'Chưa nạp quy định',
      updatedAt: activeKRulesMeta ? formatDateTimeVi(activeKRulesMeta.importedAt) : 'Chưa cập nhật',
      ready: realKRulesCount > 0,
      target: 'location-k' as ModuleId,
    },
  ];

  return (
    <div className="space-y-7">
      {/* Institutional Orientation Section */}
      <section className="banking-card p-6 sm:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="text-xs sm:text-[13px] font-medium text-[#9D1D26]">
              Hệ thống nghiệp vụ hỗ trợ thẩm định tài sản bảo đảm · Tỉnh Khánh Hòa
            </div>
            <h2 className="mt-1.5 banking-page-title">
              Tra cứu nhanh giá đất – Khánh Hòa
            </h2>
            <p className="mt-2.5 text-sm sm:text-[15px] leading-relaxed text-[#4B5563]">
              Tổng hợp độc lập Bảng giá đất Nhà nước, báo cáo khảo sát ECOVIS, ảnh thực địa GPS và thông tin rao bán thị trường theo đúng nguồn tài liệu tham chiếu. Mọi kết quả chỉ phục vụ tra cứu hỗ trợ và bắt buộc được cán bộ kiểm tra, xác nhận trước khi lập hồ sơ thẩm định.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setActiveModule('quick-lookup')}
              className="banking-btn-primary"
            >
              <Camera className="h-4 w-4" />
              <span>Tra cứu nhanh từ ảnh GeoSnapCamera</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveModule('parcel')}
              className="banking-btn-secondary"
            >
              <MapPin className="h-4 w-4 text-[#9D1D26]" />
              <span>Nhập hồ sơ thửa đất</span>
            </button>
          </div>
        </div>

        {/* Active Dossier Summary Strip */}
        <div className="mt-6 border-t border-[#E2E5E9] pt-5 grid grid-cols-2 gap-5 sm:grid-cols-4">
          <div>
            <div className="text-xs sm:text-[13px] text-[#6B7280]">Hồ sơ đang mở</div>
            <div className="mt-1 font-mono text-[15px] font-semibold text-[#1F2429] tabular-nums">
              {activeDossier.parcel.dossierCode}
            </div>
            <div className="mt-0.5 text-xs text-[#6B7280] truncate">
              {activeDossier.parcel.wardCommune || 'Chưa nhập Xã/Phường'}
            </div>
          </div>
          <div>
            <div className="text-xs sm:text-[13px] text-[#6B7280]">Trường bắt buộc thửa đất</div>
            <div className="mt-1 text-[15px] font-bold text-[#1F2429] tabular-nums">
              {completedParcelCount} / {parcelRequiredChecks.length}
            </div>
            <div className="mt-0.5 text-xs text-[#6B7280]">
              {activeDossier.parcel.officerConfirmedParcelInfo ? (
                <span className="text-[#0B5D3F] font-medium">Cán bộ đã xác nhận</span>
              ) : (
                'Chưa xác nhận hồ sơ'
              )}
            </div>
          </div>
          <div>
            <div className="text-xs sm:text-[13px] text-[#6B7280]">Ảnh thực địa & Tham chiếu</div>
            <div className="mt-1 text-[15px] font-bold text-[#1F2429] tabular-nums">
              {activeDossier.photos.length} ảnh ·{' '}
              {activeDossier.attachedStateRefs.length + activeDossier.attachedEcovisRefs.length} bảng giá
            </div>
            <div className="mt-0.5 text-xs text-[#6B7280]">
              {activeDossier.attachedMarketIds.length} tin thị trường gắn kèm
            </div>
          </div>
          <div>
            <div className="text-xs sm:text-[13px] text-[#6B7280]">Tài liệu PDF lưu trữ</div>
            <div className="mt-1 text-[15px] font-bold text-[#1F2429] tabular-nums">
              {pdfDocuments.length} tài liệu
            </div>
            <div className="mt-0.5 text-xs text-[#6B7280]">Lưu nguồn tham chiếu</div>
          </div>
        </div>
      </section>

      {/* Official Dataset Inventory Status Table */}
      <section className="banking-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#E2E5E9] px-5 py-4 sm:px-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="banking-section-title">Trạng thái kho dữ liệu nguồn chính thức</h3>
            <p className="mt-0.5 text-[13px] text-[#6B7280]">
              Chỉ thống kê dữ liệu thật đã được kiểm tra và nạp qua Cổng Quản trị. Hệ thống tuyệt đối không trộn dữ liệu minh họa (DEMO) vào đây.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => navigateToPath('/admin')}
              className="banking-btn-secondary text-[13px] min-h-[36px] py-1.5 px-3"
            >
              Cổng Quản trị (/admin)
            </button>
            <button
              type="button"
              onClick={() => setIsDemoMode(!isDemoMode)}
              className={`inline-flex items-center justify-center min-h-[36px] rounded-md px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                isDemoMode
                  ? 'bg-[#8A5300] text-white hover:bg-[#6E4200]'
                  : 'border border-[#EAD196] bg-[#FEF7E6] text-[#6E4200] hover:bg-[#FDEFC8]'
              }`}
            >
              {isDemoMode ? 'Tắt chế độ DEMO' : 'Xem thử với dữ liệu DEMO'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px] sm:text-sm">
            <thead>
              <tr className="border-b border-[#E2E5E9] bg-[#F9FAFB] text-xs sm:text-[13px] font-semibold text-[#4B5563]">
                <th className="px-5 py-3 sm:px-6">Nhóm dữ liệu nguồn</th>
                <th className="px-4 py-3">Phân loại nguồn</th>
                <th className="px-4 py-3 text-right">Số dòng dữ liệu thật</th>
                <th className="px-4 py-3">Phiên bản hiện hành</th>
                <th className="px-4 py-3">Cập nhật gần nhất</th>
                <th className="px-4 py-3">Trạng thái</th>
                <th className="px-5 py-3 sm:px-6 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E5E9]">
              {dataStatusRows.map((row) => (
                <tr key={row.name} className="hover:bg-[#F9FAFB] transition-colors">
                  <td className="px-5 py-3.5 sm:px-6 font-semibold text-[#1F2429]">{row.name}</td>
                  <td className="px-4 py-3.5 text-[13px] text-[#4B5563]">{row.category}</td>
                  <td className="px-4 py-3.5 text-right font-semibold text-[#1F2429] tabular-nums">
                    {row.rowCount.toLocaleString('vi-VN')}
                  </td>
                  <td className="px-4 py-3.5 text-[13px] font-mono text-[#4B5563]">{row.version}</td>
                  <td className="px-4 py-3.5 text-[13px] font-mono text-[#4B5563] tabular-nums whitespace-nowrap">
                    {row.updatedAt}
                  </td>
                  <td className="px-4 py-3.5 text-[13px] font-semibold whitespace-nowrap">
                    {row.ready ? (
                      <span className="text-[#0B5D3F]">Đã nạp dữ liệu thật</span>
                    ) : (
                      <span className="text-[#8A5300]">Chưa có dữ liệu nguồn</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 sm:px-6 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        if (row.ready) {
                          setActiveModule(row.target);
                        } else {
                          navigateToPath('/admin');
                        }
                      }}
                      className="text-[13px] font-semibold text-[#9D1D26] hover:text-[#7F151D] hover:underline whitespace-nowrap cursor-pointer"
                    >
                      {row.ready ? 'Mở tra cứu' : 'Quản trị (/admin)'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Core Operational Modules */}
      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="banking-section-title">Các chức năng nghiệp vụ chính</h3>
            <p className="mt-0.5 text-[13px] text-[#6B7280]">
              Luồng làm việc tuần tự từ nhập hồ sơ thửa đất, đối chiếu 3 nguồn giá độc lập đến xuất báo cáo tra cứu chuẩn A4.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveModule('ecovis')}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#9D1D26] hover:text-[#7F151D] hover:underline cursor-pointer"
          >
            <Building2 className="h-4 w-4" />
            Tra cứu nhanh ECOVIS
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {quickActions.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.id}
                className="banking-card flex flex-col justify-between p-5 hover:border-[#CBD2D9] transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between text-xs text-[#6B7280]">
                    <span className="font-mono font-semibold text-[#9D1D26]">Mục {item.step}</span>
                    <Icon className="h-4 w-4 text-[#6B7280]" />
                  </div>
                  <h4 className="mt-3 text-base font-semibold text-[#1F2429] leading-snug">
                    {item.title}
                  </h4>
                  <p className="mt-2 text-[13px] leading-relaxed text-[#4B5563]">
                    {item.description}
                  </p>
                </div>

                <div className="mt-5 pt-3 border-t border-[#F0F2F5]">
                  <button
                    type="button"
                    onClick={() => setActiveModule(item.id)}
                    className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#9D1D26] hover:text-[#7F151D] cursor-pointer"
                  >
                    <span>{item.actionLabel}</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Governance & Compliance Reminder */}
      <section className="banking-card p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[#9D1D26]" />
          <div className="space-y-1.5 text-[13px] sm:text-sm leading-relaxed text-[#4B5563]">
            <div className="text-[15px] font-semibold text-[#1F2429]">
              Nguyên tắc kiểm soát dữ liệu và giới hạn trách nhiệm nghiệp vụ
            </div>
            <p>
              1. Hệ thống không tự tạo giá đất, không tự suy diễn vị trí đất, hệ số K hoặc loại đất khi chưa có căn cứ pháp lý và xác nhận của cán bộ.
            </p>
            <p>
              2. Dữ liệu Bảng giá đất Nhà nước (NQ 15/2025/NQ-HĐND), báo cáo khảo sát ECOVIS, giá rao bán thị trường và kết quả trích xuất hỗ trợ AI luôn được phân tách nguồn rõ ràng; giá rao bán không phải là giá giao dịch thực tế.
            </p>
            <p>
              3. Kết quả tổng hợp từ ứng dụng là tài liệu tra cứu tham khảo nội bộ, không thay thế chứng thư hoặc kết quả thẩm định giá chính thức theo quy định của ngân hàng và pháp luật.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
