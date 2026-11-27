import React from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Info } from 'lucide-react';
import { useAppData } from '../../context/AppDataContext';
import { formatDateTimeVi } from '../../utils/formatters';

const KHANH_HOA_DISTRICTS = [
  'TP. Nha Trang',
  'TP. Cam Ranh',
  'Thị xã Ninh Hòa',
  'Huyện Cam Lâm',
  'Huyện Diên Khánh',
  'Huyện Vạn Ninh',
  'Huyện Khánh Vĩnh',
  'Huyện Khánh Sơn',
  'Huyện Trường Sa',
];

const LAND_TYPES = [
  'Đất ở tại đô thị (ODT)',
  'Đất ở tại nông thôn (ONT)',
  'Đất thương mại, dịch vụ (TMD)',
  'Đất cơ sở sản xuất phi nông nghiệp (SKC)',
  'Đất trồng cây lâu năm (CLN)',
  'Đất trồng cây hàng năm khác (BHK)',
  'Đất nuôi trồng thủy sản (NTS)',
  'Đất hỗn hợp / Nhiều mục đích (ghi rõ ở ghi chú)',
];

const ROAD_CONDITIONS = [
  'Đường nhựa hiện trạng tốt',
  'Đường bê tông xi măng',
  'Đường cấp phối / đá dăm',
  'Đường đất / lối đi tự mở',
  'Đang thi công / quy hoạch mở rộng',
];

export const ParcelFormModule: React.FC = () => {
  const { activeDossier, updateParcelInfo, setActiveModule } = useAppData();
  const parcel = activeDossier.parcel;

  const parseNumInput = (val: string): number | null => {
    if (val.trim() === '') return null;
    const n = Number(val);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const missingRequired: string[] = [];
  if (!parcel.address.trim()) missingRequired.push('Địa chỉ thửa đất');
  if (!parcel.wardCommune.trim()) missingRequired.push('Xã/Phường');
  if (!parcel.streetName.trim()) missingRequired.push('Tuyến đường');
  if (!parcel.parcelNumber.trim()) missingRequired.push('Số thửa');
  if (!parcel.mapSheetNumber.trim()) missingRequired.push('Tờ bản đồ');
  if (!parcel.landTypeCertificate.trim()) missingRequired.push('Loại đất theo Giấy chứng nhận');
  if (parcel.areaSqm === null || parcel.areaSqm <= 0) missingRequired.push('Diện tích (m²)');

  const missingPhysical: string[] = [];
  if (parcel.frontageWidthM === null) missingPhysical.push('Chiều rộng mặt tiền');
  if (parcel.depthM === null) missingPhysical.push('Chiều sâu thửa đất');
  if (parcel.distanceToMainRoadM === null) missingPhysical.push('Khoảng cách đến đường chính');
  if (!parcel.adjacentRoadName.trim()) missingPhysical.push('Đường tiếp giáp trực tiếp');
  if (parcel.roadAlleyWidthM === null) missingPhysical.push('Chiều rộng đường/hẻm');
  if (parcel.frontageCount === null) missingPhysical.push('Số mặt tiền');
  if (!parcel.roadCondition.trim()) missingPhysical.push('Tình trạng đường giao thông');

  return (
    <div className="space-y-6">
      {/* Header & Rule Notice */}
      <div className="banking-card p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-xs sm:text-[13px] font-medium text-[#6B7280]">
              Hồ sơ pháp lý & hiện trạng · Nguồn dữ liệu: Cán bộ nhập trực tiếp
            </div>
            <h2 className="mt-1 banking-page-title">
              Module 2 · Thông tin thửa đất tài sản bảo đảm
            </h2>
            <p className="mt-1.5 text-[13px] text-[#4B5563]">
              Mã hồ sơ: <span className="font-mono font-semibold text-[#1F2429]">{parcel.dossierCode}</span>
              {' · '}
              Cập nhật gần nhất: <span className="font-mono tabular-nums text-[#1F2429]">{formatDateTimeVi(parcel.updatedAt)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setActiveModule('photos')}
              className="banking-btn-primary whitespace-nowrap"
            >
              Tiếp theo: Ảnh & GPS
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-md border border-[#E2E5E9] bg-[#F8F9FA] px-4 py-3 text-[13px] leading-relaxed text-[#4B5563]">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#9D1D26]" />
          <span>
            Hệ thống <strong className="text-[#1F2429]">không tự động xác định vị trí đất</strong> (VT1, VT2, VT3...) chỉ dựa vào địa chỉ hoặc tọa độ GPS. Các trường có dấu <span className="text-[#9D1D26] font-semibold">*</span> là thông tin bắt buộc; các trường để trống sẽ được ghi nhận là <strong className="text-[#1F2429]">“Chưa có thông tin”</strong> trong phân tích vị trí và báo cáo.
          </span>
        </div>
      </div>

      {/* Completeness Summary */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="banking-card p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-[#1F2429]">Kiểm tra trường pháp lý bắt buộc</span>
            {missingRequired.length === 0 ? (
              <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#0B5D3F]">
                <CheckCircle2 className="h-4 w-4" />
                Đã điền đủ 7/7 trường bắt buộc
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#9D1D26]">
                <AlertCircle className="h-4 w-4" />
                Còn thiếu {missingRequired.length} trường bắt buộc
              </span>
            )}
          </div>
          {missingRequired.length > 0 && (
            <p className="mt-2 text-[13px] text-[#7F151D]">
              Thiếu: {missingRequired.join(', ')}.
            </p>
          )}
        </div>

        <div className="banking-card p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-[#1F2429]">Thông số hiện trạng phục vụ phân tích vị trí</span>
            <span className="text-[13px] font-mono font-semibold text-[#1F2429] tabular-nums">
              {7 - missingPhysical.length}/7 đã nhập
            </span>
          </div>
          <p className="mt-2 text-[13px] text-[#4B5563]">
            {missingPhysical.length === 0
              ? 'Đầy đủ thông số kỹ thuật hiện trạng để đối chiếu điều kiện áp dụng hệ số K.'
              : `Chưa có thông tin: ${missingPhysical.join(', ')}.`}
          </p>
        </div>
      </div>

      {/* Form Section A: Administrative & Legal Certificate Data */}
      <div className="banking-card p-5 sm:p-6 space-y-5">
        <div className="border-b border-[#E2E5E9] pb-3">
          <h3 className="banking-section-title">
            A. Thông tin định danh hồ sơ & Giấy chứng nhận quyền sử dụng đất
          </h3>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="banking-label">Mã hồ sơ tra cứu</label>
            <input
              type="text"
              value={parcel.dossierCode}
              onChange={(e) => updateParcelInfo({ dossierCode: e.target.value })}
              className="banking-input font-mono"
            />
          </div>
          <div>
            <label className="banking-label">Tên tài sản / Khách hàng tham chiếu</label>
            <input
              type="text"
              placeholder="VD: TSBĐ ông/bà Nguyễn Văn A"
              value={parcel.collateralName}
              onChange={(e) => updateParcelInfo({ collateralName: e.target.value })}
              className="banking-input"
            />
          </div>
          <div>
            <label className="banking-label">Cán bộ thực hiện tra cứu</label>
            <input
              type="text"
              placeholder="Họ tên cán bộ tín dụng / thẩm định"
              value={parcel.officerName}
              onChange={(e) => updateParcelInfo({ officerName: e.target.value })}
              className="banking-input"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="banking-label">
              Địa chỉ thửa đất theo Giấy chứng nhận <span className="text-[#9D1D26]">*</span>
            </label>
            <input
              type="text"
              placeholder="Số nhà, tên đường/tổ dân phố/thôn theo sổ đỏ..."
              value={parcel.address}
              onChange={(e) => updateParcelInfo({ address: e.target.value })}
              className="banking-input"
            />
          </div>
          <div>
            <label className="banking-label">Huyện / Thị xã / Thành phố</label>
            <select
              value={parcel.districtCity}
              onChange={(e) => updateParcelInfo({ districtCity: e.target.value })}
              className="banking-input"
            >
              <option value="">-- Chọn địa bàn tỉnh Khánh Hòa --</option>
              {KHANH_HOA_DISTRICTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="banking-label">
              Xã / Phường / Thị trấn <span className="text-[#9D1D26]">*</span>
            </label>
            <input
              type="text"
              placeholder="VD: Phường Phước Hải"
              value={parcel.wardCommune}
              onChange={(e) => updateParcelInfo({ wardCommune: e.target.value })}
              className="banking-input"
            />
          </div>
          <div>
            <label className="banking-label">
              Tuyến đường chính liên quan <span className="text-[#9D1D26]">*</span>
            </label>
            <input
              type="text"
              placeholder="VD: Đường Lê Hồng Phong"
              value={parcel.streetName}
              onChange={(e) => updateParcelInfo({ streetName: e.target.value })}
              className="banking-input"
            />
          </div>
          <div>
            <label className="banking-label">Đoạn đường tham chiếu (nếu biết)</label>
            <input
              type="text"
              placeholder="VD: Từ Mã Vòng đến Phong Châu"
              value={parcel.roadSegmentRef}
              onChange={(e) => updateParcelInfo({ roadSegmentRef: e.target.value })}
              className="banking-input"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="banking-label">
              Số thửa <span className="text-[#9D1D26]">*</span>
            </label>
            <input
              type="text"
              placeholder="VD: 125"
              value={parcel.parcelNumber}
              onChange={(e) => updateParcelInfo({ parcelNumber: e.target.value })}
              className="banking-input font-mono"
            />
          </div>
          <div>
            <label className="banking-label">
              Tờ bản đồ số <span className="text-[#9D1D26]">*</span>
            </label>
            <input
              type="text"
              placeholder="VD: 42"
              value={parcel.mapSheetNumber}
              onChange={(e) => updateParcelInfo({ mapSheetNumber: e.target.value })}
              className="banking-input font-mono"
            />
          </div>
          <div>
            <label className="banking-label">
              Loại đất theo Giấy chứng nhận <span className="text-[#9D1D26]">*</span>
            </label>
            <select
              value={parcel.landTypeCertificate}
              onChange={(e) => updateParcelInfo({ landTypeCertificate: e.target.value })}
              className="banking-input"
            >
              <option value="">-- Chọn loại đất theo GCN --</option>
              {LAND_TYPES.map((lt) => (
                <option key={lt} value={lt}>
                  {lt}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="banking-label">
              Diện tích theo GCN (m²) <span className="text-[#9D1D26]">*</span>
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="VD: 100.5"
              value={parcel.areaSqm ?? ''}
              onChange={(e) => updateParcelInfo({ areaSqm: parseNumInput(e.target.value) })}
              className="banking-input font-mono tabular-nums"
            />
          </div>
        </div>
      </div>

      {/* Form Section B: Physical & Road Access Attributes */}
      <div className="banking-card p-5 sm:p-6 space-y-5">
        <div className="border-b border-[#E2E5E9] pb-3">
          <h3 className="banking-section-title">
            B. Thông số kỹ thuật thực địa & Giao thông tiếp giáp
          </h3>
          <p className="mt-1 text-[13px] text-[#4B5563]">
            Dùng làm đầu vào cho Module 7 (Phân tích vị trí & Hệ số K). Nếu chưa đo đạc thực địa, hãy để trống để hệ thống ghi nhận “Chưa có thông tin”.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="banking-label">Chiều rộng mặt tiền (m)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Chưa có thông tin"
              value={parcel.frontageWidthM ?? ''}
              onChange={(e) => updateParcelInfo({ frontageWidthM: parseNumInput(e.target.value) })}
              className="banking-input font-mono tabular-nums"
            />
          </div>
          <div>
            <label className="banking-label">Chiều sâu thửa đất (m)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Chưa có thông tin"
              value={parcel.depthM ?? ''}
              onChange={(e) => updateParcelInfo({ depthM: parseNumInput(e.target.value) })}
              className="banking-input font-mono tabular-nums"
            />
          </div>
          <div>
            <label className="banking-label">Khoảng cách đến đường chính (m)</label>
            <input
              type="number"
              min="0"
              step="0.1"
              placeholder="0 nếu mặt tiền đường chính"
              value={parcel.distanceToMainRoadM ?? ''}
              onChange={(e) => updateParcelInfo({ distanceToMainRoadM: parseNumInput(e.target.value) })}
              className="banking-input font-mono tabular-nums"
            />
          </div>
          <div>
            <label className="banking-label">Số mặt tiền tiếp giáp đường</label>
            <select
              value={parcel.frontageCount ?? ''}
              onChange={(e) =>
                updateParcelInfo({
                  frontageCount: e.target.value === '' ? null : Number(e.target.value),
                })
              }
              className="banking-input"
            >
              <option value="">-- Chưa có thông tin --</option>
              <option value="1">1 mặt tiền</option>
              <option value="2">2 mặt tiền (lô góc / 2 đầu)</option>
              <option value="3">3 mặt tiền</option>
              <option value="4">4 mặt tiền</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="banking-label">Đường / Hẻm tiếp giáp trực tiếp</label>
            <input
              type="text"
              placeholder="VD: Mặt tiền đường Lê Hồng Phong hoặc Hẻm số 15..."
              value={parcel.adjacentRoadName}
              onChange={(e) => updateParcelInfo({ adjacentRoadName: e.target.value })}
              className="banking-input"
            />
          </div>
          <div>
            <label className="banking-label">Chiều rộng đường/hẻm tiếp giáp (m)</label>
            <input
              type="number"
              min="0"
              step="0.1"
              placeholder="VD: 4.5"
              value={parcel.roadAlleyWidthM ?? ''}
              onChange={(e) => updateParcelInfo({ roadAlleyWidthM: parseNumInput(e.target.value) })}
              className="banking-input font-mono tabular-nums"
            />
          </div>
          <div>
            <label className="banking-label">Tình trạng đường giao thông</label>
            <select
              value={parcel.roadCondition}
              onChange={(e) => updateParcelInfo({ roadCondition: e.target.value })}
              className="banking-input"
            >
              <option value="">-- Chưa có thông tin --</option>
              {ROAD_CONDITIONS.map((rc) => (
                <option key={rc} value={rc}>
                  {rc}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="banking-label">
            Thông tin bổ sung khác (hình dáng thửa đất, quy hoạch lộ giới, tranh chấp, công trình trên đất...)
          </label>
          <textarea
            rows={3}
            placeholder="Ghi nhận hiện trạng thực tế, lộ giới quy hoạch trên sổ, diện tích không công nhận (nếu có)..."
            value={parcel.additionalNotes}
            onChange={(e) => updateParcelInfo({ additionalNotes: e.target.value })}
            className="w-full rounded-md border border-[#CBD2D9] bg-white px-3 py-2.5 text-sm text-[#1F2429] placeholder:text-[#6B7280] focus:border-[#9D1D26] focus:outline-none"
          />
        </div>

        {/* Officer Confirmation Gate */}
        <div className="border-t border-[#E2E5E9] pt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="inline-flex items-start gap-2.5 text-sm text-[#1F2429] cursor-pointer">
            <input
              type="checkbox"
              checked={parcel.officerConfirmedParcelInfo}
              onChange={(e) =>
                updateParcelInfo({ officerConfirmedParcelInfo: e.target.checked })
              }
              className="mt-1 h-4 w-4 rounded border-[#CBD2D9] accent-[#9D1D26]"
            />
            <span>
              <strong>Cán bộ xác nhận</strong> thông tin thửa đất đã đối chiếu đúng với Giấy chứng nhận và ghi nhận thực tế ban đầu.
            </span>
          </label>

          <span className="text-[13px] font-semibold whitespace-nowrap">
            {parcel.officerConfirmedParcelInfo ? (
              <span className="text-[#0B5D3F]">Trạng thái: Đã xác nhận</span>
            ) : (
              <span className="text-[#8A5300]">Trạng thái: Chưa xác nhận</span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
};
