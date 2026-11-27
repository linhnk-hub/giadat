import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Printer,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { useAppData } from '../../context/AppDataContext';
import {
  buildAutoWarnings,
  buildReferenceSources,
  isAppliedKFactorDemo,
  isEcovisRecordDemo,
  isMarketListingDemo,
  isStateRecordDemo,
} from '../../utils/dossierIntegrity';
import {
  buildGoogleMapsUrl,
  formatCoordinate,
  formatCurrencyVnd,
  formatDateTimeVi,
  formatNumberVi,
  getCoordinateSourceLabel,
  sanitizeExternalUrl,
} from '../../utils/formatters';
import { formatDistanceVi } from '../../utils/geoLookup';
import { exportReportToExcel } from '../../utils/importExport';

export const ReportModule: React.FC = () => {
  const {
    activeDossier,
    activeDossierIntegrity,
    allKnownMarketListings,
    pdfDocuments,
    isDemoMode,
    updateReportNotes,
    removeContaminatedItem,
  } = useAppData();

  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const { parcel, photos, attachedStateRefs, attachedEcovisRefs, locationAnalysis } = activeDossier;

  // Resolve against allKnownMarketListings so legacy contaminated DEMO market IDs in real dossiers remain visible
  const attachedMarketListings = useMemo(() => {
    const idSet = new Set(activeDossier.attachedMarketIds);
    return allKnownMarketListings.filter((m) => idSet.has(m.id));
  }, [allKnownMarketListings, activeDossier.attachedMarketIds]);

  const verifiedMarketListings = attachedMarketListings.filter(
    (m) => m.verificationStatus === 'da_xac_minh_so_bo'
  );
  const unverifiedMarketListings = attachedMarketListings.filter(
    (m) => m.verificationStatus === 'chua_xac_minh'
  );

  // Shared auto warnings & reference sources (100% synchronized with Excel export)
  const autoWarnings = useMemo(
    () => buildAutoWarnings(activeDossier, attachedMarketListings, activeDossierIntegrity),
    [activeDossier, attachedMarketListings, activeDossierIntegrity]
  );

  const referenceSources = useMemo(
    () => buildReferenceSources(activeDossier, attachedMarketListings, pdfDocuments),
    [activeDossier, attachedMarketListings, pdfDocuments]
  );

  const isExportBlocked = activeDossierIntegrity.isContaminatedRealDossier;
  const isDemoReport = activeDossierIntegrity.hasAnyDemoData || activeDossierIntegrity.status === 'isolated_demo';

  const handleExportExcel = async () => {
    setExportError(null);
    if (isExportBlocked) {
      setExportError(
        'Bị chặn xuất báo cáo: Hồ sơ thật đang chứa dữ liệu DEMO. Vui lòng kiểm tra và gỡ bỏ các bản ghi DEMO trước khi xuất.'
      );
      return;
    }
    setExportingExcel(true);
    try {
      await exportReportToExcel(activeDossier, attachedMarketListings, pdfDocuments, isDemoMode);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : 'Không thể xuất tệp Excel do lỗi kiểm soát tính toàn vẹn dữ liệu.'
      );
    } finally {
      setExportingExcel(false);
    }
  };

  const handlePrintPdf = () => {
    setExportError(null);
    if (isExportBlocked) {
      setExportError(
        'Bị chặn in/lưu PDF: Hồ sơ thật đang chứa dữ liệu DEMO. Vui lòng gỡ bỏ các bản ghi DEMO trước khi in hồ sơ.'
      );
      return;
    }
    window.print();
  };

  const renderVerificationText = (
    verified: boolean,
    verifiedLabel = 'Đã xác minh',
    unverifiedLabel = 'Chưa xác minh'
  ) =>
    verified ? (
      <span className="inline-flex items-center gap-1 text-[#0B5D3F] font-semibold">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {verifiedLabel}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-[#8A5300] font-semibold">
        <AlertTriangle className="h-3.5 w-3.5" />
        {unverifiedLabel}
      </span>
    );

  const renderOriginText = (isDemoRecord: boolean) => {
    if (!isDemoRecord) {
      return <span className="text-[#0B5D3F] font-semibold">Dữ liệu thật</span>;
    }
    if (!activeDossier.isDemoDossier) {
      return <span className="text-[#9D1D26] font-bold">NHIỄM DEMO</span>;
    }
    return <span className="text-[#8A5300] font-semibold">DEMO (Minh họa)</span>;
  };

  const renderComponentOriginLabel = (
    status: 'chua_gan' | 'du_lieu_that' | 'du_lieu_demo' | 'nhiem_demo'
  ) => {
    if (status === 'chua_gan') return <span className="text-[#6B7280]">Chưa gắn dữ liệu</span>;
    if (status === 'du_lieu_that') return <span className="text-[#0B5D3F] font-semibold">Dữ liệu thật</span>;
    if (status === 'du_lieu_demo') return <span className="text-[#8A5300] font-semibold">DEMO (Minh họa tách biệt)</span>;
    return <span className="text-[#9D1D26] font-bold">NHIỄM DỮ LIỆU DEMO – CẦN GỠ BỎ</span>;
  };

  return (
    <div className="space-y-6">
      {/* Export Toolbar (Hidden in print) */}
      <div className="no-print banking-card p-5 sm:p-6 space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-xs sm:text-[13px] font-medium text-[#6B7280]">
              Phiếu tổng hợp nội bộ · Xuất Excel (.xlsx) & In PDF chuẩn A4
            </div>
            <h2 className="mt-1 banking-page-title">
              Module 8 · Báo cáo tổng hợp kết quả tra cứu giá đất
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-[#4B5563]">
              Tổng hợp đầy đủ 11 hạng mục, kiểm soát nguồn gốc <strong className="text-[#1F2429]">Dữ liệu thật / DEMO</strong> trên từng bản ghi và phân tách trạng thái <strong className="text-[#1F2429]">Đã xác minh / Chưa xác minh</strong>.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={exportingExcel || isExportBlocked}
              title={
                isExportBlocked
                  ? 'Bị chặn xuất vì hồ sơ thật đang chứa dữ liệu DEMO'
                  : undefined
              }
              className="banking-btn-secondary whitespace-nowrap disabled:cursor-not-allowed"
            >
              <FileSpreadsheet className="h-4 w-4 text-[#0B5D3F]" />
              {exportingExcel
                ? 'Đang xuất Excel...'
                : isDemoReport
                ? 'Xuất Excel DEMO (.xlsx)'
                : 'Xuất Excel (.xlsx)'}
            </button>
            <button
              type="button"
              onClick={handlePrintPdf}
              disabled={isExportBlocked}
              title={
                isExportBlocked
                  ? 'Bị chặn in/PDF vì hồ sơ thật đang chứa dữ liệu DEMO'
                  : undefined
              }
              className="banking-btn-primary whitespace-nowrap disabled:cursor-not-allowed"
            >
              <Printer className="h-4 w-4" />
              {isDemoReport ? 'In / Lưu PDF DEMO' : 'In / Lưu PDF chuẩn A4'}
            </button>
          </div>
        </div>

        {exportError && (
          <div className="rounded-md border border-[#E8B8BC] bg-[#FDF2F3] px-4 py-3 text-[13px] font-medium text-[#641016]">
            {exportError}
          </div>
        )}

        {/* Contamination Inspection & Manual Remediation Panel (Never auto-deletes legacy data) */}
        {activeDossierIntegrity.isContaminatedRealDossier && (
          <div className="rounded-md border border-[#E8B8BC] bg-[#FDF2F3] p-4 space-y-3">
            <div className="flex items-start gap-2.5 text-[13px] text-[#641016]">
              <ShieldAlert className="h-5 w-5 shrink-0 text-[#9D1D26] mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold text-[#7F151D]">
                  PHÁT HIỆN DỮ LIỆU DEMO TRONG HỒ SƠ THẬT ({activeDossierIntegrity.contaminatedItems.length} bản ghi) – ĐÃ CHẶN XUẤT BÁO CÁO THẬT
                </div>
                <p className="text-[#641016] leading-relaxed">
                  Hệ thống phát hiện các bản ghi mang nguồn DEMO đang tồn tại trong hồ sơ thật{' '}
                  <strong className="font-mono">{parcel.dossierCode}</strong> (có thể đã được lưu từ phiên trước). Hệ thống <strong>không tự động xóa ngầm</strong> và <strong>không chuyển thành dữ liệu thật</strong> — cán bộ vui lòng kiểm tra và chủ động gỡ bỏ từng bản ghi DEMO dưới đây:
                </p>
              </div>
            </div>

            <div className="divide-y divide-[#E8B8BC] rounded-md border border-[#E8B8BC] bg-white">
              {activeDossierIntegrity.contaminatedItems.map((item) => (
                <div
                  key={`${item.category}-${item.id}`}
                  className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-[13px]"
                >
                  <div>
                    <div className="font-semibold text-[#1F2429]">
                      [{item.categoryLabel}] {item.label}
                    </div>
                    <div className="text-xs text-[#9D1D26]">{item.reason}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeContaminatedItem(item)}
                    className="inline-flex min-h-[34px] items-center gap-1.5 rounded-md border border-[#E8B8BC] bg-[#FDF2F3] px-3 py-1.5 text-xs font-semibold text-[#9D1D26] hover:bg-[#F9E3E5] whitespace-nowrap cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Gỡ bản ghi DEMO này
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Printable Institutional Report Document */}
      <div className="print-container banking-card p-6 sm:p-8 space-y-8">
        {/* Report Title Block */}
        <div className="border-b-2 border-[#9D1D26] pb-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-xs font-bold tracking-wide text-[#9D1D26] uppercase">
                PHIẾU TỔNG HỢP TRA CỨU THAM KHẢO GIÁ ĐẤT – TỈNH KHÁNH HÒA
              </div>
              <h3 className="mt-1 text-xl sm:text-2xl font-bold text-[#1F2429]">
                Báo cáo kết quả tra cứu tài sản bảo đảm
              </h3>
              <div className="mt-2 text-[13px] text-[#4B5563]">
                Mã hồ sơ: <strong className="font-mono text-[#1F2429]">{parcel.dossierCode}</strong>
                {parcel.collateralName ? ` · Tài sản/KH: ${parcel.collateralName}` : ''}
                {parcel.officerName ? ` · Cán bộ lập: ${parcel.officerName}` : ''}
                {' · '}Thời điểm tổng hợp:{' '}
                <span className="font-mono tabular-nums text-[#1F2429]">{formatDateTimeVi(new Date().toISOString())}</span>
              </div>
            </div>
            <div className="text-xs sm:text-right max-w-xs">
              {activeDossierIntegrity.isContaminatedRealDossier ? (
                <div className="font-bold text-[#9D1D26]">
                  [HỒ SƠ THẬT BỊ NHIỄM DỮ LIỆU DEMO – BỊ CHẶN XUẤT BÁO CÁO THẬT]
                </div>
              ) : isDemoReport ? (
                <div className="font-bold text-[#9D1D26]">
                  [BÁO CÁO CHẾ ĐỘ DEMO – KHÔNG DÙNG THẨM ĐỊNH]
                </div>
              ) : (
                <div className="font-semibold text-[#0B5D3F]">
                  Dữ liệu nghiệp vụ thực tế · Tài liệu tham khảo nội bộ (không phải chứng thư thẩm định)
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Component Provenance Audit Table */}
        <section className="print-break-inside-avoid space-y-3">
          <div className="border-b border-[#E2E5E9] pb-2">
            <h4 className="text-[15px] font-bold text-[#1F2429]">
              Kiểm soát nguồn gốc dữ liệu từng thành phần trong hồ sơ
            </h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] border border-[#E2E5E9]">
              <thead>
                <tr className="bg-[#F8F9FA] border-b border-[#E2E5E9] text-[#1F2429] font-semibold">
                  <th className="px-3.5 py-2.5">Thành phần dữ liệu</th>
                  <th className="px-3.5 py-2.5 text-right">Bản ghi thật</th>
                  <th className="px-3.5 py-2.5 text-right">Bản ghi DEMO</th>
                  <th className="px-3.5 py-2.5">Phân loại nguồn gốc</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E5E9]">
                {activeDossierIntegrity.componentOrigins.map((row) => (
                  <tr
                    key={row.component}
                    className={row.originStatus === 'nhiem_demo' ? 'bg-[#FDF2F3]/70' : undefined}
                  >
                    <td className="px-3.5 py-2.5 font-medium text-[#1F2429]">{row.component}</td>
                    <td className="px-3.5 py-2.5 text-right font-mono tabular-nums text-[#1F2429]">
                      {row.realCount}
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-mono tabular-nums text-[#1F2429]">
                      {row.demoCount}
                    </td>
                    <td className="px-3.5 py-2.5">{renderComponentOriginLabel(row.originStatus)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 1. Thông tin thửa đất */}
        <section className="print-break-inside-avoid space-y-3">
          <div className="flex items-center justify-between border-b border-[#E2E5E9] pb-2">
            <h4 className="text-[15px] font-bold text-[#1F2429]">1. Thông tin thửa đất</h4>
            <span className="text-[13px]">
              {renderVerificationText(
                parcel.officerConfirmedParcelInfo,
                'Đã xác nhận đối chiếu GCN',
                'Chưa xác nhận'
              )}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-2.5 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <span className="text-[#6B7280]">Địa chỉ thửa đất:</span>{' '}
              <strong className="text-[#1F2429]">{parcel.address || 'Chưa có thông tin'}</strong>
            </div>
            <div>
              <span className="text-[#6B7280]">Xã/Phường – Địa bàn:</span>{' '}
              <strong className="text-[#1F2429]">
                {[parcel.wardCommune, parcel.districtCity].filter(Boolean).join(', ') || 'Chưa có thông tin'}
              </strong>
            </div>
            <div>
              <span className="text-[#6B7280]">Số thửa / Tờ bản đồ:</span>{' '}
              <strong className="font-mono text-[#1F2429]">
                {parcel.parcelNumber || 'Chưa có'} / {parcel.mapSheetNumber || 'Chưa có'}
              </strong>
            </div>
            <div>
              <span className="text-[#6B7280]">Loại đất theo GCN:</span>{' '}
              <strong className="text-[#1F2429]">{parcel.landTypeCertificate || 'Chưa có thông tin'}</strong>
            </div>
            <div>
              <span className="text-[#6B7280]">Diện tích:</span>{' '}
              <strong className="font-mono text-[#1F2429] tabular-nums">
                {parcel.areaSqm !== null ? `${formatNumberVi(parcel.areaSqm)} m²` : 'Chưa có thông tin'}
              </strong>
            </div>
            <div>
              <span className="text-[#6B7280]">Mặt tiền × Chiều sâu:</span>{' '}
              <strong className="font-mono text-[#1F2429] tabular-nums">
                {parcel.frontageWidthM !== null ? `${formatNumberVi(parcel.frontageWidthM)}m` : 'Chưa có'} ×{' '}
                {parcel.depthM !== null ? `${formatNumberVi(parcel.depthM)}m` : 'Chưa có'}
              </strong>
            </div>
          </div>
          {parcel.additionalNotes && (
            <div className="text-[13px] text-[#4B5563]">
              <span className="text-[#6B7280]">Thông tin bổ sung:</span> {parcel.additionalNotes}
            </div>
          )}
        </section>

        {/* 2. Hình ảnh thực địa & 3. Tọa độ GPS và bản đồ */}
        <section className="print-break-inside-avoid space-y-3">
          <div className="border-b border-[#E2E5E9] pb-2">
            <h4 className="text-[15px] font-bold text-[#1F2429]">
              2. Hình ảnh thực địa & 3. Tọa độ GPS và liên kết bản đồ
            </h4>
          </div>
          {photos.length === 0 ? (
            <p className="text-[13px] text-[#6B7280]">Chưa có hình ảnh thực địa nào được tải lên cho hồ sơ này.</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                {photos.map((p, idx) => {
                  const mapsUrl = buildGoogleMapsUrl(p.activeLatitude, p.activeLongitude);
                  return (
                    <div key={p.id} className="rounded-md border border-[#E2E5E9] overflow-hidden text-[13px]">
                      {p.previewDataUrl ? (
                        <img
                          src={p.previewDataUrl}
                          alt={`Ảnh thực địa ${idx + 1}`}
                          referrerPolicy="no-referrer"
                          className="h-36 w-full object-cover bg-[#F6F7F8]"
                        />
                      ) : (
                        <div className="h-24 flex items-center justify-center bg-[#F6F7F8] text-[#6B7280]">
                          Ảnh #{idx + 1}: {p.fileName}
                        </div>
                      )}
                      <div className="p-3.5 space-y-1">
                        <div className="font-semibold text-[#1F2429] truncate">
                          Ảnh #{idx + 1} · {p.fileName}
                        </div>
                        <div className="font-mono text-[#1F2429] tabular-nums">
                          GPS: {formatCoordinate(p.activeLatitude, p.activeLongitude)}
                        </div>
                        <div className="text-[#4B5563]">
                          Nguồn: {getCoordinateSourceLabel(p.coordinateSource)}
                        </div>
                        <div className="text-[#4B5563]">
                          Chụp lúc: {p.capturedAt ? formatDateTimeVi(p.capturedAt) : 'Chưa có'}
                        </div>
                        <div>
                          {renderVerificationText(
                            p.officerConfirmedCoordinates && p.officerConfirmedAtParcel,
                            'Đã xác nhận tọa độ & tại thửa đất',
                            'Chưa xác nhận đầy đủ'
                          )}
                        </div>
                        {mapsUrl && (
                          <div className="pt-1">
                            <a
                              href={mapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-semibold text-[#9D1D26] hover:underline"
                            >
                              Mở vị trí trên Google Maps <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* 4. Thông tin tuyến đường và đoạn đường */}
        <section className="print-break-inside-avoid space-y-3">
          <div className="border-b border-[#E2E5E9] pb-2">
            <h4 className="text-[15px] font-bold text-[#1F2429]">
              4. Thông tin tuyến đường và đoạn đường liên quan
            </h4>
          </div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-2.5 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <span className="text-[#6B7280]">Tuyến đường chính:</span>{' '}
              <strong className="text-[#1F2429]">{parcel.streetName || 'Chưa có thông tin'}</strong>
            </div>
            <div>
              <span className="text-[#6B7280]">Đoạn đường tham chiếu:</span>{' '}
              <strong className="text-[#1F2429]">{parcel.roadSegmentRef || 'Chưa có thông tin'}</strong>
            </div>
            <div>
              <span className="text-[#6B7280]">Đường/Hẻm tiếp giáp trực tiếp:</span>{' '}
              <strong className="text-[#1F2429]">{parcel.adjacentRoadName || 'Chưa có thông tin'}</strong>
            </div>
            <div>
              <span className="text-[#6B7280]">Độ rộng đường/hẻm:</span>{' '}
              <strong className="font-mono text-[#1F2429] tabular-nums">
                {parcel.roadAlleyWidthM !== null ? `${formatNumberVi(parcel.roadAlleyWidthM)} m` : 'Chưa có thông tin'}
              </strong>
            </div>
            <div>
              <span className="text-[#6B7280]">Khoảng cách ra đường chính:</span>{' '}
              <strong className="font-mono text-[#1F2429] tabular-nums">
                {parcel.distanceToMainRoadM !== null
                  ? `${formatNumberVi(parcel.distanceToMainRoadM)} m`
                  : 'Chưa có thông tin'}
              </strong>
            </div>
            <div>
              <span className="text-[#6B7280]">Tình trạng đường giao thông:</span>{' '}
              <strong className="text-[#1F2429]">{parcel.roadCondition || 'Chưa có thông tin'}</strong>
            </div>
          </div>

          {(attachedStateRefs.length > 0 || attachedEcovisRefs.length > 0) && (
            <div className="overflow-x-auto pt-1">
              <table className="w-full text-left text-[13px] border border-[#E2E5E9]">
                <thead>
                  <tr className="bg-[#F8F9FA] border-b border-[#E2E5E9] text-[#1F2429] font-semibold">
                    <th className="px-3.5 py-2.5">Nguồn đối chiếu đoạn đường</th>
                    <th className="px-3.5 py-2.5">Tuyến đường</th>
                    <th className="px-3.5 py-2.5">Đoạn đường</th>
                    <th className="px-3.5 py-2.5">Điểm đầu</th>
                    <th className="px-3.5 py-2.5">Điểm cuối</th>
                    <th className="px-3.5 py-2.5">Nguồn gốc</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E5E9]">
                  {attachedStateRefs.map((ref) => (
                    <tr key={`seg-state-${ref.record.id}`}>
                      <td className="px-3.5 py-2.5 font-medium text-[#1F2429]">Bảng giá Nhà nước</td>
                      <td className="px-3.5 py-2.5 font-semibold text-[#1F2429]">{ref.record.streetName}</td>
                      <td className="px-3.5 py-2.5 text-[#4B5563]">{ref.record.roadSegment || 'Chưa ghi rõ'}</td>
                      <td className="px-3.5 py-2.5 text-[#4B5563]">{ref.record.startPoint || 'Chưa ghi rõ'}</td>
                      <td className="px-3.5 py-2.5 text-[#4B5563]">{ref.record.endPoint || 'Chưa ghi rõ'}</td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap">{renderOriginText(isStateRecordDemo(ref.record))}</td>
                    </tr>
                  ))}
                  {attachedEcovisRefs.map((ref) => (
                    <tr key={`seg-ecovis-${ref.record.id}`}>
                      <td className="px-3.5 py-2.5 font-medium text-[#1F2429]">Khảo sát ECOVIS (độc lập)</td>
                      <td className="px-3.5 py-2.5 font-semibold text-[#1F2429]">{ref.record.streetName}</td>
                      <td className="px-3.5 py-2.5 text-[#4B5563]">{ref.record.roadSegment || 'Chưa ghi rõ'}</td>
                      <td className="px-3.5 py-2.5 text-[#6B7280]">Theo mô tả ECOVIS</td>
                      <td className="px-3.5 py-2.5 text-[#6B7280]">Theo mô tả ECOVIS</td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap">{renderOriginText(isEcovisRecordDemo(ref.record))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 5. Giá đất Nhà nước */}
        <section className="print-break-inside-avoid space-y-3">
          <div className="border-b border-[#E2E5E9] pb-2">
            <h4 className="text-[15px] font-bold text-[#1F2429]">
              5. Giá đất Nhà nước (Nguồn văn bản pháp lý chính thức)
            </h4>
          </div>
          {attachedStateRefs.length === 0 ? (
            <p className="text-[13px] text-[#6B7280]">Chưa gắn bản ghi tra cứu Bảng giá đất Nhà nước vào hồ sơ.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px] border border-[#E2E5E9]">
                <thead>
                  <tr className="bg-[#F8F9FA] border-b border-[#E2E5E9] text-[#1F2429] font-semibold">
                    <th className="px-3.5 py-2.5">Tuyến đường & Đoạn đường</th>
                    <th className="px-3.5 py-2.5">Loại đất / Vị trí</th>
                    <th className="px-3.5 py-2.5 text-right">Đơn giá</th>
                    <th className="px-3.5 py-2.5">Văn bản & Trang nguồn</th>
                    <th className="px-3.5 py-2.5">Nguồn gốc</th>
                    <th className="px-3.5 py-2.5">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E5E9]">
                  {attachedStateRefs.map((ref) => {
                    const recIsDemo = isStateRecordDemo(ref.record);
                    return (
                      <tr
                        key={ref.record.id}
                        className={!activeDossier.isDemoDossier && recIsDemo ? 'bg-[#FDF2F3]/70' : undefined}
                      >
                        <td className="px-3.5 py-2.5">
                          <div className="font-semibold text-[#1F2429]">{ref.record.streetName}</div>
                          <div className="text-[#4B5563]">
                            {ref.record.roadSegment || `${ref.record.startPoint} - ${ref.record.endPoint}`}
                          </div>
                          {ref.matchTier && (
                            <div
                              className={`mt-0.5 text-xs font-semibold ${
                                ref.matchTier === 'exact_location' ? 'text-[#0B5D3F]' : 'text-[#8A5300]'
                              }`}
                            >
                              {ref.matchTier === 'exact_location'
                                ? 'Đúng vị trí / cùng tuyến'
                                : 'Tham chiếu lân cận'}
                              {ref.distanceMeters !== null && ref.distanceMeters !== undefined
                                ? ` · ${formatDistanceVi(ref.distanceMeters)}`
                                : ''}
                            </div>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 text-[#1F2429]">
                          {ref.record.landType} · {ref.record.position}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-mono font-bold tabular-nums text-[#1F2429] whitespace-nowrap">
                          {formatCurrencyVnd(ref.record.unitPrice)}
                        </td>
                        <td className="px-3.5 py-2.5 text-[#4B5563]">
                          {ref.record.legalDocumentName} ({ref.record.sourcePageOrAppendix})
                        </td>
                        <td className="px-3.5 py-2.5 whitespace-nowrap">{renderOriginText(recIsDemo)}</td>
                        <td className="px-3.5 py-2.5 whitespace-nowrap">
                          {renderVerificationText(ref.officerConfirmedMatch)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 6. Giá khảo sát ECOVIS */}
        <section className="print-break-inside-avoid space-y-3">
          <div className="border-b border-[#E2E5E9] pb-2">
            <h4 className="text-[15px] font-bold text-[#1F2429]">
              6. Giá khảo sát ECOVIS (Độc lập – Không mặc định là giá thị trường hiện tại)
            </h4>
          </div>
          {attachedEcovisRefs.length === 0 ? (
            <p className="text-[13px] text-[#6B7280]">Chưa gắn bản ghi khảo sát ECOVIS vào hồ sơ.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px] border border-[#E2E5E9]">
                <thead>
                  <tr className="bg-[#F8F9FA] border-b border-[#E2E5E9] text-[#1F2429] font-semibold">
                    <th className="px-3.5 py-2.5">Tuyến đường & Đoạn đường (ECOVIS)</th>
                    <th className="px-3.5 py-2.5">Loại đất / Vị trí</th>
                    <th className="px-3.5 py-2.5 text-right">Đơn giá khảo sát</th>
                    <th className="px-3.5 py-2.5">Nguồn & Thời điểm khảo sát</th>
                    <th className="px-3.5 py-2.5">Nguồn gốc</th>
                    <th className="px-3.5 py-2.5">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E5E9]">
                  {attachedEcovisRefs.map((ref) => {
                    const recIsDemo = isEcovisRecordDemo(ref.record);
                    return (
                      <tr
                        key={ref.record.id}
                        className={!activeDossier.isDemoDossier && recIsDemo ? 'bg-[#FDF2F3]/70' : undefined}
                      >
                        <td className="px-3.5 py-2.5">
                          <div className="font-semibold text-[#1F2429]">{ref.record.streetName}</div>
                          <div className="text-[#4B5563]">{ref.record.roadSegment || 'Chưa ghi rõ'}</div>
                          {ref.matchTier && (
                            <div
                              className={`mt-0.5 text-xs font-semibold ${
                                ref.matchTier === 'exact_location' ? 'text-[#0B5D3F]' : 'text-[#8A5300]'
                              }`}
                            >
                              {ref.matchTier === 'exact_location'
                                ? 'Đúng vị trí / cùng tuyến'
                                : 'Tham chiếu lân cận'}
                              {ref.distanceMeters !== null && ref.distanceMeters !== undefined
                                ? ` · ${formatDistanceVi(ref.distanceMeters)}`
                                : ''}
                            </div>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 text-[#1F2429]">
                          {ref.record.landType} · {ref.record.position}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-mono font-bold tabular-nums text-[#1F2429] whitespace-nowrap">
                          {formatCurrencyVnd(ref.record.surveyUnitPrice)}
                        </td>
                        <td className="px-3.5 py-2.5 text-[#4B5563]">
                          {ref.record.sourceDocument} ({ref.record.appendixAndPage}) · Thời điểm:{' '}
                          {ref.record.surveyOrReportDate || 'Chưa xác định'}
                        </td>
                        <td className="px-3.5 py-2.5 whitespace-nowrap">{renderOriginText(recIsDemo)}</td>
                        <td className="px-3.5 py-2.5 whitespace-nowrap">
                          {renderVerificationText(ref.officerConfirmedMatch)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 7. Giá rao bán tham khảo */}
        <section className="print-break-inside-avoid space-y-3">
          <div className="border-b border-[#E2E5E9] pb-2">
            <h4 className="text-[15px] font-bold text-[#1F2429]">
              7. Giá rao bán tham khảo thị trường (Không phải giá giao dịch thực tế)
            </h4>
          </div>
          {attachedMarketListings.length === 0 ? (
            <p className="text-[13px] text-[#6B7280]">Chưa gắn tin rao bán thị trường vào hồ sơ.</p>
          ) : (
            <div className="space-y-3">
              <div className="text-[13px] text-[#4B5563]">
                Tổng tin gắn kèm: <strong className="font-mono text-[#1F2429]">{attachedMarketListings.length}</strong> ·{' '}
                Đã xác minh sơ bộ: <strong className="font-mono text-[#0B5D3F]">{verifiedMarketListings.length}</strong> ·{' '}
                Chưa xác minh: <strong className="font-mono text-[#8A5300]">{unverifiedMarketListings.length}</strong>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px] border border-[#E2E5E9]">
                  <thead>
                    <tr className="bg-[#F8F9FA] border-b border-[#E2E5E9] text-[#1F2429] font-semibold">
                      <th className="px-3.5 py-2.5">Nguồn tin & Địa chỉ</th>
                      <th className="px-3.5 py-2.5 text-right">Diện tích</th>
                      <th className="px-3.5 py-2.5 text-right">Giá rao bán</th>
                      <th className="px-3.5 py-2.5 text-right">Đơn giá/m²</th>
                      <th className="px-3.5 py-2.5">Nguồn gốc</th>
                      <th className="px-3.5 py-2.5">Xác minh</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E5E9]">
                    {attachedMarketListings.map((m) => {
                      const safeUrl = sanitizeExternalUrl(m.url);
                      const recIsDemo = isMarketListingDemo(m);
                      return (
                        <tr
                          key={m.id}
                          className={!activeDossier.isDemoDossier && recIsDemo ? 'bg-[#FDF2F3]/70' : undefined}
                        >
                          <td className="px-3.5 py-2.5">
                            <div className="font-semibold text-[#1F2429]">{m.address}</div>
                            <div className="text-[#4B5563]">
                              {m.sourceName}
                              {m.postedDate ? ` · Đăng: ${m.postedDate}` : ''}
                              {safeUrl && (
                                <>
                                  {' · '}
                                  <a
                                    href={safeUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-medium text-[#9D1D26] underline"
                                  >
                                    Liên kết gốc
                                  </a>
                                </>
                              )}
                            </div>
                          </td>
                          <td className="px-3.5 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                            {m.areaSqm !== null ? `${formatNumberVi(m.areaSqm)} m²` : 'Chưa có'}
                          </td>
                          <td className="px-3.5 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                            {formatCurrencyVnd(m.askingPriceVnd)}
                          </td>
                          <td className="px-3.5 py-2.5 text-right font-mono font-bold tabular-nums text-[#1F2429] whitespace-nowrap">
                            {formatCurrencyVnd(m.unitPricePerSqm)}
                          </td>
                          <td className="px-3.5 py-2.5 whitespace-nowrap">{renderOriginText(recIsDemo)}</td>
                          <td className="px-3.5 py-2.5 whitespace-nowrap">
                            {m.verificationStatus === 'da_xac_minh_so_bo'
                              ? renderVerificationText(true, 'Đã xác minh sơ bộ')
                              : m.verificationStatus === 'loai_tru'
                              ? <span className="text-[#6B7280]">Đã loại trừ</span>
                              : renderVerificationText(false, '', 'Chưa xác minh')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {/* 8. Phân tích vị trí & 9. Hệ số K */}
        <section className="print-break-inside-avoid space-y-3">
          <div className="border-b border-[#E2E5E9] pb-2">
            <h4 className="text-[15px] font-bold text-[#1F2429]">
              8. Phân tích vị trí & 9. Hệ số K và căn cứ tính toán
            </h4>
          </div>
          <div className="text-[13px] space-y-1.5">
            <div>
              <span className="text-[#6B7280]">Vị trí theo Bảng giá Nhà nước (cán bộ nhận định):</span>{' '}
              <strong className="text-[#1F2429]">
                {locationAnalysis.selectedStatePosition || 'Chưa xác định'}
              </strong>{' '}
              · {renderVerificationText(locationAnalysis.statePositionVerified)}
            </div>
            <div>
              <span className="text-[#6B7280]">Căn cứ phân loại vị trí:</span>{' '}
              <span className="text-[#1F2429]">
                {locationAnalysis.statePositionBasis || 'Chưa ghi nhận căn cứ văn bản'}
              </span>
            </div>
            {locationAnalysis.otherDocumentedFactors && (
              <div>
                <span className="text-[#6B7280]">Yếu tố khác có căn cứ:</span>{' '}
                <span className="text-[#1F2429]">{locationAnalysis.otherDocumentedFactors}</span>
              </div>
            )}
          </div>

          {locationAnalysis.appliedKFactors.length === 0 ? (
            <div className="rounded-md border border-[#E8B8BC] bg-[#FDF2F3] px-3.5 py-2.5 text-[13px] font-semibold text-[#7F151D]">
              Hệ số K: CHƯA ĐỦ CƠ SỞ TÍNH TOÁN (chưa có quy định nguồn và xác minh đầu vào).
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px] border border-[#E2E5E9]">
                <thead>
                  <tr className="bg-[#F8F9FA] border-b border-[#E2E5E9] text-[#1F2429] font-semibold">
                    <th className="px-3.5 py-2.5">Hệ số K</th>
                    <th className="px-3.5 py-2.5 text-right">Giá trị</th>
                    <th className="px-3.5 py-2.5">Công thức & Điều kiện</th>
                    <th className="px-3.5 py-2.5">Nguồn & Trang</th>
                    <th className="px-3.5 py-2.5">Nguồn gốc</th>
                    <th className="px-3.5 py-2.5">Xác minh</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E5E9]">
                  {locationAnalysis.appliedKFactors.map((k) => {
                    const recIsDemo = isAppliedKFactorDemo(k);
                    const ready =
                      k.hasSufficientBasis &&
                      k.verificationStatus === 'da_xac_minh' &&
                      k.value !== null;
                    return (
                      <tr
                        key={k.id}
                        className={!activeDossier.isDemoDossier && recIsDemo ? 'bg-[#FDF2F3]/70' : undefined}
                      >
                        <td className="px-3.5 py-2.5 font-semibold text-[#1F2429]">{k.factorName}</td>
                        <td className="px-3.5 py-2.5 text-right font-mono font-bold tabular-nums whitespace-nowrap">
                          {ready ? (
                            <span className="text-[#0B5D3F]">{formatNumberVi(k.value, 4)}</span>
                          ) : (
                            <span className="text-[#9D1D26]">CHƯA ĐỦ CƠ SỞ TÍNH TOÁN</span>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 text-[#4B5563]">
                          <div>{k.formula}</div>
                          <div className="text-xs text-[#6B7280]">ĐK: {k.applicableCondition}</div>
                        </td>
                        <td className="px-3.5 py-2.5 text-[#4B5563]">
                          {k.sourceDocument} ({k.sourcePage})
                        </td>
                        <td className="px-3.5 py-2.5 whitespace-nowrap">{renderOriginText(recIsDemo)}</td>
                        <td className="px-3.5 py-2.5 whitespace-nowrap">
                          {renderVerificationText(ready)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 10. Nhận xét và cảnh báo */}
        <section className="print-break-inside-avoid space-y-3">
          <div className="border-b border-[#E2E5E9] pb-2">
            <h4 className="text-[15px] font-bold text-[#1F2429]">10. Nhận xét và cảnh báo nghiệp vụ</h4>
          </div>

          {autoWarnings.length > 0 && (
            <div className="rounded-md border border-[#EAD196] bg-[#FEF7E6] p-4 space-y-1.5 text-[13px] text-[#6E4200]">
              <div className="font-semibold">Cảnh báo kiểm soát tự động từ hệ thống:</div>
              <ul className="list-disc pl-5 space-y-1">
                {autoWarnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="no-print">
            <label className="banking-label">
              Nhận xét bổ sung của cán bộ ngân hàng
            </label>
            <textarea
              rows={3}
              placeholder="Nhập nhận xét tổng hợp, đề xuất xác minh thực địa bổ sung hoặc ghi chú trình cấp phê duyệt..."
              value={activeDossier.reportNotes}
              onChange={(e) => updateReportNotes(e.target.value)}
              className="w-full rounded-md border border-[#CBD2D9] bg-white px-3 py-2.5 text-sm text-[#1F2429] placeholder:text-[#6B7280] focus:border-[#9D1D26] focus:outline-none"
            />
          </div>

          {activeDossier.reportNotes && (
            <div className="text-[13px] text-[#1F2429]">
              <strong>Nhận xét của cán bộ:</strong> {activeDossier.reportNotes}
            </div>
          )}

          <p className="text-xs text-[#6B7280] italic leading-relaxed">
            Tuyên bố miễn trừ nghiệp vụ: Báo cáo tổng hợp từ ứng dụng chỉ dùng để tra cứu nhanh và tham khảo nguồn dữ liệu. Mọi đề xuất AI (nếu có) không phải là kết quả thẩm định giá chính thức. Cán bộ chịu trách nhiệm đối chiếu hồ sơ gốc và tuân thủ quy chế định giá tài sản bảo đảm hiện hành.
          </p>
        </section>

        {/* 11. Nguồn tài liệu tham chiếu */}
        <section className="print-break-inside-avoid space-y-2.5">
          <div className="border-b border-[#E2E5E9] pb-2">
            <h4 className="text-[15px] font-bold text-[#1F2429]">11. Danh mục nguồn tài liệu tham chiếu</h4>
          </div>
          {referenceSources.length === 0 ? (
            <p className="text-[13px] text-[#6B7280]">Chưa có tài liệu nguồn nào được trích dẫn trong hồ sơ này.</p>
          ) : (
            <ul className="divide-y divide-[#E2E5E9] text-[13px]">
              {referenceSources.map((src, idx) => (
                <li key={idx} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-[#1F2429]">{src.category}:</span>{' '}
                    <span className="text-[#1F2429]">{src.title}</span>{' '}
                    <span className="text-[#6B7280]">({src.detail})</span>{' '}
                    <span className="text-xs font-medium text-[#4B5563]">· [{src.originLabel}]</span>
                  </div>
                  <span>{renderVerificationText(src.verified)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Export footer hint in non-print */}
        <div className="no-print border-t border-[#E2E5E9] pt-4 flex items-center justify-end gap-2 text-xs text-[#6B7280]">
          <Download className="h-3.5 w-3.5 text-[#9D1D26]" />
          <span>
            {isExportBlocked
              ? 'Đang bị chặn xuất báo cáo thật do phát hiện bản ghi DEMO trong hồ sơ. Vui lòng gỡ các bản ghi DEMO ở khung cảnh báo phía trên.'
              : 'Sử dụng nút “Xuất Excel (.xlsx)” hoặc “In / Lưu PDF chuẩn A4” ở đầu trang để lưu hồ sơ.'}
          </span>
        </div>
      </div>
    </div>
  );
};

