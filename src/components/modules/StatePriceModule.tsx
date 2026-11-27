import React, { useMemo, useState } from 'react';
import { Check, Database, Landmark, Plus, Search, Trash2 } from 'lucide-react';
import { useAppData } from '../../context/AppDataContext';
import { isStateRecordDemo } from '../../utils/dossierIntegrity';
import { formatCurrencyVnd, normalizeVietnameseText } from '../../utils/formatters';
import { navigateToPath } from '../../utils/navigation';

export const StatePriceModule: React.FC = () => {
  const {
    activeStateRecords,
    isDemoMode,
    setIsDemoMode,
    setActiveModule,
    activeDossier,
    attachStateReference,
    updateAttachedStateRef,
    removeAttachedStateRef,
  } = useAppData();

  const [wardQuery, setWardQuery] = useState('');
  const [streetQuery, setStreetQuery] = useState('');
  const [segmentQuery, setSegmentQuery] = useState('');
  const [endpointQuery, setEndpointQuery] = useState('');
  const [landTypeFilter, setLandTypeFilter] = useState('');
  const [positionFilter, setPositionFilter] = useState('');
  const [attachError, setAttachError] = useState<string | null>(null);

  const uniqueLandTypes = useMemo(
    () => Array.from(new Set(activeStateRecords.map((r) => r.landType))).sort(),
    [activeStateRecords]
  );

  const uniquePositions = useMemo(
    () => Array.from(new Set(activeStateRecords.map((r) => r.position))).sort(),
    [activeStateRecords]
  );

  const filteredRecords = useMemo(() => {
    const nWard = normalizeVietnameseText(wardQuery);
    const nStreet = normalizeVietnameseText(streetQuery);
    const nSeg = normalizeVietnameseText(segmentQuery);
    const nEnd = normalizeVietnameseText(endpointQuery);

    return activeStateRecords.filter((rec) => {
      if (nWard && !normalizeVietnameseText(`${rec.wardCommune} ${rec.districtCity}`).includes(nWard)) {
        return false;
      }
      if (nStreet && !normalizeVietnameseText(rec.streetName).includes(nStreet)) {
        return false;
      }
      if (nSeg && !normalizeVietnameseText(rec.roadSegment).includes(nSeg)) {
        return false;
      }
      if (nEnd && !normalizeVietnameseText(`${rec.startPoint} ${rec.endPoint}`).includes(nEnd)) {
        return false;
      }
      if (landTypeFilter && rec.landType !== landTypeFilter) {
        return false;
      }
      if (positionFilter && rec.position !== positionFilter) {
        return false;
      }
      return true;
    });
  }, [activeStateRecords, wardQuery, streetQuery, segmentQuery, endpointQuery, landTypeFilter, positionFilter]);

  const fillFromParcel = () => {
    setWardQuery(activeDossier.parcel.wardCommune || '');
    setStreetQuery(activeDossier.parcel.streetName || '');
    setSegmentQuery(activeDossier.parcel.roadSegmentRef || '');
  };

  const resetFilters = () => {
    setWardQuery('');
    setStreetQuery('');
    setSegmentQuery('');
    setEndpointQuery('');
    setLandTypeFilter('');
    setPositionFilter('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="banking-card p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-xs sm:text-[13px] font-medium text-[#6B7280]">
              Nguồn pháp lý chính thức · Lưu nguyên trạng dữ liệu nguồn, không tự chỉnh sửa giá trị
            </div>
            <h2 className="mt-1 banking-page-title">
              Module 4 · Tra cứu Bảng giá đất Nhà nước (Tỉnh Khánh Hòa)
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-[#4B5563]">
              Tra cứu theo Nghị quyết 15/2025/NQ-HĐND tỉnh Khánh Hòa hoặc các bảng giá đất do cơ quan nhà nước ban hành đã nạp trong Quản lý dữ liệu nguồn.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={fillFromParcel}
              className="banking-btn-secondary whitespace-nowrap"
            >
              Lấy từ khóa từ Hồ sơ thửa đất
            </button>
            <button
              type="button"
              onClick={() => navigateToPath('/admin')}
              className="banking-btn-secondary whitespace-nowrap"
            >
              <Database className="h-4 w-4 text-[#9D1D26]" />
              Cổng Quản trị (/admin)
            </button>
          </div>
        </div>

        {/* Search Filters */}
        <div className="mt-5 grid grid-cols-1 gap-3.5 border-t border-[#E2E5E9] pt-5 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="banking-label">Xã / Phường / Địa bàn</label>
            <input
              type="text"
              placeholder="VD: Phước Hải, Cam Đức..."
              value={wardQuery}
              onChange={(e) => setWardQuery(e.target.value)}
              className="banking-input"
            />
          </div>
          <div>
            <label className="banking-label">Tuyến đường</label>
            <input
              type="text"
              placeholder="VD: Lê Hồng Phong, Trần Phú..."
              value={streetQuery}
              onChange={(e) => setStreetQuery(e.target.value)}
              className="banking-input"
            />
          </div>
          <div>
            <label className="banking-label">Đoạn đường</label>
            <input
              type="text"
              placeholder="Nhập tên đoạn đường..."
              value={segmentQuery}
              onChange={(e) => setSegmentQuery(e.target.value)}
              className="banking-input"
            />
          </div>
          <div>
            <label className="banking-label">Điểm đầu / Điểm cuối</label>
            <input
              type="text"
              placeholder="VD: Mã Vòng, Phong Châu..."
              value={endpointQuery}
              onChange={(e) => setEndpointQuery(e.target.value)}
              className="banking-input"
            />
          </div>
          <div>
            <label className="banking-label">Loại đất</label>
            <select
              value={landTypeFilter}
              onChange={(e) => setLandTypeFilter(e.target.value)}
              className="banking-input"
            >
              <option value="">Tất cả loại đất</option>
              {uniqueLandTypes.map((lt) => (
                <option key={lt} value={lt}>
                  {lt}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="banking-label">Vị trí đất</label>
            <div className="flex gap-2">
              <select
                value={positionFilter}
                onChange={(e) => setPositionFilter(e.target.value)}
                className="banking-input"
              >
                <option value="">Tất cả vị trí</option>
                {uniquePositions.map((pos) => (
                  <option key={pos} value={pos}>
                    {pos}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={resetFilters}
                className="banking-btn-secondary whitespace-nowrap shrink-0"
              >
                Xóa lọc
              </button>
            </div>
          </div>
        </div>
      </div>

      {attachError && (
        <div className="rounded-md border border-[#E8B8BC] bg-[#FDF2F3] px-4 py-3 text-[13px] text-[#641016] flex items-center justify-between gap-2">
          <span>{attachError}</span>
          <button
            type="button"
            onClick={() => setAttachError(null)}
            className="font-semibold text-[#9D1D26] underline shrink-0 cursor-pointer"
          >
            Đóng
          </button>
        </div>
      )}

      {/* Results Table or Empty State */}
      {activeStateRecords.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#CBD2D9] bg-white px-6 py-12 text-center">
          <Landmark className="mx-auto h-9 w-9 text-[#9D1D26]" />
          <h3 className="mt-3 text-base font-semibold text-[#1F2429]">
            Chưa có dữ liệu Bảng giá đất Nhà nước trong kho dữ liệu thật
          </h3>
          <p className="mt-1.5 text-sm text-[#4B5563] max-w-lg mx-auto leading-relaxed">
            Để đảm bảo tính pháp lý, ứng dụng không tự tạo sẵn bảng giá đất. Vui lòng nạp tệp Excel/CSV trích xuất từ Nghị quyết 15/2025/NQ-HĐND tỉnh Khánh Hòa tại Cổng Quản trị, hoặc bật chế độ DEMO để kiểm thử giao diện.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => navigateToPath('/admin')}
              className="banking-btn-primary"
            >
              Đi tới Cổng Quản trị (/admin)
            </button>
            <button
              type="button"
              onClick={() => setIsDemoMode(true)}
              className="inline-flex min-h-[40px] items-center justify-center rounded-md border border-[#EAD196] bg-[#FEF7E6] px-4 py-2 text-sm font-semibold text-[#6E4200] hover:bg-[#FCEEC8] cursor-pointer"
            >
              Bật dữ liệu DEMO minh họa
            </button>
          </div>
        </div>
      ) : (
        <div className="banking-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#E2E5E9] bg-[#F8F9FA] px-5 py-3 text-[13px] text-[#4B5563]">
            <span className="inline-flex items-center gap-1.5">
              <Search className="h-4 w-4 text-[#6B7280]" />
              Hiển thị <strong className="font-mono text-[#1F2429] tabular-nums">{filteredRecords.length}</strong> /{' '}
              <span className="font-mono tabular-nums">{activeStateRecords.length}</span> bản ghi
              {isDemoMode && ' · Đang xem dữ liệu DEMO minh họa'}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-[#E2E5E9] bg-[#F8F9FA] font-semibold text-[#1F2429]">
                  <th className="px-4 py-3">Tuyến đường & Đoạn đường</th>
                  <th className="px-4 py-3">Xã/Phường</th>
                  <th className="px-4 py-3">Loại đất & Vị trí</th>
                  <th className="px-4 py-3 text-right">Đơn giá</th>
                  <th className="px-4 py-3">Văn bản pháp lý & Trang nguồn</th>
                  <th className="px-4 py-3 text-right">Gắn hồ sơ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E5E9]">
                {filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-[#6B7280]">
                      Không tìm thấy bản ghi nào phù hợp với điều kiện lọc.
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((rec) => {
                    const isAttached = activeDossier.attachedStateRefs.some(
                      (a) => a.record.id === rec.id
                    );
                    return (
                      <tr key={rec.id} className="hover:bg-[#F9FAFB] align-top">
                        <td className="px-4 py-3.5">
                          <div className="font-semibold text-[#1F2429]">{rec.streetName}</div>
                          {rec.roadSegment && (
                            <div className="mt-0.5 text-[#4B5563]">{rec.roadSegment}</div>
                          )}
                          {(rec.startPoint || rec.endPoint) && (
                            <div className="mt-0.5 text-xs text-[#6B7280]">
                              Điểm đầu: {rec.startPoint || '—'} · Điểm cuối: {rec.endPoint || '—'}
                            </div>
                          )}
                          <div className="mt-0.5 font-mono text-xs text-[#6B7280]">
                            Mã: {rec.recordCode}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-[#1F2429]">
                          <div>{rec.wardCommune}</div>
                          {rec.districtCity && (
                            <div className="text-xs text-[#6B7280]">{rec.districtCity}</div>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-[#4B5563]">
                          <div className="font-medium text-[#1F2429]">{rec.landType}</div>
                          <div className="mt-0.5">{rec.position}</div>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <div className="font-mono text-sm font-bold text-[#1F2429] tabular-nums">
                            {formatCurrencyVnd(rec.unitPrice)}
                          </div>
                          <div className="text-xs text-[#6B7280]">{rec.unit}</div>
                        </td>
                        <td className="px-4 py-3.5 text-[#4B5563] max-w-xs">
                          <div className="font-medium text-[#1F2429]">{rec.legalDocumentName}</div>
                          <div className="mt-0.5 text-xs">
                            Nguồn: {rec.sourcePageOrAppendix}
                            {rec.effectiveDate ? ` · Hiệu lực: ${rec.effectiveDate}` : ''}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-right whitespace-nowrap">
                          {isAttached ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-[#0B5D3F]">
                              <Check className="h-4 w-4" />
                              Đã gắn
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setAttachError(null);
                                const res = attachStateReference(rec);
                                if (!res.ok) setAttachError(res.error || 'Không thể gắn bản ghi này.');
                              }}
                              className="inline-flex min-h-[34px] items-center gap-1 rounded-md border border-[#E8B8BC] bg-[#FDF2F3] px-3 py-1.5 text-[13px] font-semibold text-[#9D1D26] hover:bg-[#F9E3E5] cursor-pointer"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Gắn hồ sơ
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Attached State Price References for Active Dossier */}
      {activeDossier.attachedStateRefs.length > 0 && (
        <div className="banking-card p-5 space-y-3">
          <div className="border-b border-[#E2E5E9] pb-2.5">
            <h3 className="banking-section-title">
              Bản ghi Bảng giá Nhà nước đã gắn vào hồ sơ {activeDossier.parcel.dossierCode}
            </h3>
          </div>
          <div className="divide-y divide-[#E2E5E9]">
            {activeDossier.attachedStateRefs.map((ref) => {
              const isContaminated = !activeDossier.isDemoDossier && isStateRecordDemo(ref.record);
              return (
              <div
                key={ref.record.id}
                className={`py-3.5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between ${
                  isContaminated ? 'bg-[#FDF2F3] px-3 -mx-3 rounded-md' : ''
                }`}
              >
                <div className="text-[13px] space-y-0.5">
                  <div className="font-semibold text-[#1F2429]">
                    {ref.record.streetName} · {ref.record.position} ·{' '}
                    <span className="font-mono font-bold text-[#9D1D26] tabular-nums">
                      {formatCurrencyVnd(ref.record.unitPrice)}
                    </span>
                    {isContaminated && (
                      <span className="ml-2 font-mono font-bold text-[#9D1D26]">
                        [NHIỄM DỮ LIỆU DEMO – CẦN GỠ BỎ]
                      </span>
                    )}
                  </div>
                  <div className="text-[#4B5563]">
                    {ref.record.legalDocumentName} · {ref.record.sourcePageOrAppendix}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-[13px]">
                  <label className="inline-flex items-center gap-2 text-[#1F2429] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ref.officerConfirmedMatch}
                      onChange={(e) =>
                        updateAttachedStateRef(ref.record.id, {
                          officerConfirmedMatch: e.target.checked,
                        })
                      }
                      className="h-4 w-4 rounded border-[#CBD2D9] accent-[#9D1D26]"
                    />
                    <span>Cán bộ xác nhận khớp tuyến/đoạn đường</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => removeAttachedStateRef(ref.record.id)}
                    className="inline-flex items-center gap-1 text-[#9D1D26] hover:text-[#7F151D] font-semibold cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Gỡ bỏ
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
