import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Filter,
  Globe,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import { useAppData } from '../../context/AppDataContext';
import { MarketListingRecord } from '../../types/valuation';
import {
  formatCurrencyVnd,
  formatNumberVi,
  normalizeVietnameseText,
  sanitizeExternalUrl,
} from '../../utils/formatters';

export const MarketSurveyModule: React.FC = () => {
  const {
    activeMarketListings,
    addManualMarketListing,
    updateMarketListingStatus,
    removeMarketListing,
    removeDuplicateMarketListings,
    activeDossier,
    toggleAttachMarketListing,
    isDemoMode,
  } = useAppData();

  // URL check state
  const [urlInput, setUrlInput] = useState('');
  const [inspectingUrl, setInspectingUrl] = useState(false);
  const [urlInspectionMsg, setUrlInspectionMsg] = useState<{
    type: 'info' | 'warning';
    text: string;
    extractedTitle?: string;
    extractedDesc?: string;
  } | null>(null);

  // Manual entry form state
  const [sourceName, setSourceName] = useState('');
  const [postedDate, setPostedDate] = useState('');
  const [wardCommune, setWardCommune] = useState(activeDossier.parcel.wardCommune || '');
  const [address, setAddress] = useState('');
  const [areaStr, setAreaStr] = useState('');
  const [priceStr, setPriceStr] = useState('');
  const [propertyType, setPropertyType] = useState('Đất ở đô thị');
  const [locationInfo, setLocationInfo] = useState('');
  const [verificationNote, setVerificationNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | MarketListingRecord['verificationStatus']>('all');
  const [dedupBanner, setDedupBanner] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);

  const areaNum = areaStr.trim() ? Number(areaStr) : null;
  const priceNum = priceStr.trim() ? Number(priceStr) : null;
  const previewUnitPrice =
    areaNum !== null && priceNum !== null && Number.isFinite(areaNum) && Number.isFinite(priceNum) && areaNum > 0 && priceNum > 0
      ? Math.round(priceNum / areaNum)
      : null;

  const handleInspectUrl = async () => {
    if (!urlInput.trim()) return;
    setInspectingUrl(true);
    setUrlInspectionMsg(null);
    try {
      const resp = await fetch('/api/inspect-listing-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim() }),
      });
      const data = await resp.json();
      if (data.accessible) {
        if (!sourceName && data.sourceDomain) {
          setSourceName(data.sourceDomain);
        }
        setUrlInspectionMsg({
          type: 'info',
          text: data.note || 'Đã đọc được tiêu đề công khai để đối chiếu.',
          extractedTitle: data.pageTitle,
          extractedDesc: data.pageDescription,
        });
      } else {
        if (!sourceName && data.sourceDomain) {
          setSourceName(data.sourceDomain);
        }
        setUrlInspectionMsg({
          type: 'warning',
          text:
            data.reason ||
            'Không truy cập được trang nguồn. Vui lòng nhập thủ công các thông số từ tin rao.',
        });
      }
    } catch {
      setUrlInspectionMsg({
        type: 'warning',
        text: 'Không kết nối được dịch vụ kiểm tra liên kết. Vui lòng nhập dữ liệu thủ công.',
      });
    } finally {
      setInspectingUrl(false);
    }
  };

  const handleAddListing = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!sourceName.trim()) {
      setFormError('Vui lòng nhập Nguồn tin (tên website, môi giới hoặc nguồn cung cấp).');
      return;
    }
    if (!address.trim()) {
      setFormError('Vui lòng nhập Địa chỉ bất động sản rao bán.');
      return;
    }
    if (areaNum === null || !Number.isFinite(areaNum) || areaNum <= 0) {
      setFormError('Diện tích phải là số lớn hơn 0.');
      return;
    }
    if (priceNum === null || !Number.isFinite(priceNum) || priceNum <= 0) {
      setFormError('Giá rao bán (VNĐ) phải là số lớn hơn 0.');
      return;
    }

    const safeUrl = urlInput.trim() ? sanitizeExternalUrl(urlInput.trim()) : '';
    if (urlInput.trim() && !safeUrl) {
      setFormError('Đường dẫn phải bắt đầu bằng http:// hoặc https://.');
      return;
    }

    const codePrefix = isDemoMode ? 'DEMO-TT' : 'TT';
    addManualMarketListing({
      listingCode: `${codePrefix}-${String(activeMarketListings.length + 1).padStart(3, '0')}`,
      sourceName: sourceName.trim(),
      url: safeUrl || '',
      postedDate: postedDate.trim(),
      address: address.trim(),
      wardCommune: wardCommune.trim(),
      areaSqm: areaNum,
      askingPriceVnd: priceNum,
      unitPricePerSqm: Math.round(priceNum / areaNum),
      propertyType: propertyType.trim() || 'Chưa phân loại',
      locationInfo: locationInfo.trim(),
      verificationStatus: 'chua_xac_minh',
      verificationNote:
        verificationNote.trim() || 'Mới nhập thủ công – chưa gọi điện xác minh thông tin.',
    });

    setUrlInput('');
    setAddress('');
    setAreaStr('');
    setPriceStr('');
    setLocationInfo('');
    setVerificationNote('');
    setUrlInspectionMsg(null);
  };

  const duplicateCount = useMemo(
    () => activeMarketListings.filter((m) => m.isDuplicate).length,
    [activeMarketListings]
  );

  const filteredListings = useMemo(() => {
    const q = normalizeVietnameseText(searchQuery);
    return activeMarketListings.filter((item) => {
      if (statusFilter !== 'all' && item.verificationStatus !== statusFilter) return false;
      if (
        q &&
        !normalizeVietnameseText(
          `${item.sourceName} ${item.address} ${item.wardCommune} ${item.locationInfo} ${item.propertyType}`
        ).includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [activeMarketListings, searchQuery, statusFilter]);

  const stats = useMemo(() => {
    const valid = activeMarketListings.filter(
      (m) => !m.isDuplicate && m.verificationStatus !== 'loai_tru' && m.unitPricePerSqm !== null
    );
    const verified = valid.filter((m) => m.verificationStatus === 'da_xac_minh_so_bo');
    const unverified = valid.filter((m) => m.verificationStatus === 'chua_xac_minh');

    const avg = (arr: MarketListingRecord[]) =>
      arr.length === 0
        ? null
        : Math.round(arr.reduce((sum, x) => sum + (x.unitPricePerSqm || 0), 0) / arr.length);

    return {
      totalValid: valid.length,
      verifiedCount: verified.length,
      unverifiedCount: unverified.length,
      avgVerified: avg(verified),
      avgUnverified: avg(unverified),
    };
  }, [activeMarketListings]);

  return (
    <div className="space-y-6">
      {/* Header & Market Data Disclaimer */}
      <div className="banking-card p-5 sm:p-6">
        <div className="text-xs sm:text-[13px] font-medium text-[#6B7280]">
          Dữ liệu thị trường tham khảo · Giá rao bán KHÔNG phải là giá giao dịch thực tế
        </div>
        <h2 className="mt-1 banking-page-title">
          Module 6 · Khảo sát giá rao bán thị trường bất động sản
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-[#4B5563] max-w-3xl">
          Tiếp nhận tin rao từ đường dẫn do cán bộ cung cấp, nhập thủ công hoặc nhập danh sách Excel/CSV. Công thức đơn giá chuẩn: <strong className="text-[#1F2429]">Đơn giá/m² = Giá rao bán / Diện tích</strong>.
        </p>

        <div className="mt-4 flex items-start gap-2.5 rounded-md border border-[#EAD196] bg-[#FEF7E6] px-4 py-3 text-[13px] leading-relaxed text-[#6E4200]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#8A5300]" />
          <span>
            <strong>Giới hạn tích hợp kỹ thuật:</strong> Hệ thống <strong>không giả lập</strong> việc tự động quét Facebook, Marketplace hoặc các trang bất động sản chặn truy cập tự động. Khi không truy cập trực tiếp được trang nguồn, hệ thống sẽ thông báo rõ để cán bộ mở trên trình duyệt và nhập thủ công thông số chính xác.
          </span>
        </div>
      </div>

      {/* Summary Strip separating Verified vs Unverified */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="banking-card p-4 sm:p-5">
          <div className="text-xs font-medium text-[#6B7280]">Tin rao hợp lệ (chưa tính tin loại/trùng)</div>
          <div className="mt-1.5 banking-figure text-[#1F2429]">
            {stats.totalValid}
          </div>
          <div className="mt-1 text-xs text-[#4B5563]">
            {stats.verifiedCount} xác minh sơ bộ · {stats.unverifiedCount} chưa xác minh
          </div>
        </div>
        <div className="banking-card p-4 sm:p-5">
          <div className="text-xs font-medium text-[#6B7280]">BQ đơn giá rao (Đã xác minh sơ bộ)</div>
          <div className="mt-1.5 font-mono text-lg sm:text-xl font-bold text-[#0B5D3F] tabular-nums">
            {stats.avgVerified !== null ? formatCurrencyVnd(stats.avgVerified) : 'Chưa có dữ liệu'}
          </div>
          <div className="mt-1 text-xs text-[#4B5563]">Vẫn là giá rao bán, chưa phải giá chốt</div>
        </div>
        <div className="banking-card p-4 sm:p-5">
          <div className="text-xs font-medium text-[#6B7280]">BQ đơn giá rao (Chưa xác minh)</div>
          <div className="mt-1.5 font-mono text-lg sm:text-xl font-bold text-[#8A5300] tabular-nums">
            {stats.avgUnverified !== null ? formatCurrencyVnd(stats.avgUnverified) : 'Chưa có dữ liệu'}
          </div>
          <div className="mt-1 text-xs text-[#4B5563]">Cần liên hệ kiểm chứng thông tin</div>
        </div>
        <div className="banking-card p-4 sm:p-5">
          <div className="text-xs font-medium text-[#6B7280]">Tin trùng lặp phát hiện</div>
          <div className="mt-1.5 banking-figure text-[#1F2429]">
            {duplicateCount}
          </div>
          <div className="mt-1">
            {duplicateCount > 0 ? (
              <button
                type="button"
                onClick={() => {
                  const removed = removeDuplicateMarketListings();
                  setDedupBanner(`Đã loại bỏ ${removed} tin rao trùng lặp (trùng đường dẫn hoặc trùng địa chỉ + diện tích + giá rao).`);
                }}
                className="text-xs font-semibold text-[#9D1D26] hover:text-[#7F151D] underline cursor-pointer"
              >
                Loại bỏ {duplicateCount} tin trùng
              </button>
            ) : (
              <span className="text-xs text-[#6B7280]">Không phát hiện tin trùng</span>
            )}
          </div>
        </div>
      </div>

      {dedupBanner && (
        <div className="rounded-md border border-[#B8DEC9] bg-[#ECF7F2] px-4 py-3 text-[13px] text-[#084730] flex items-center justify-between gap-2">
          <span>{dedupBanner}</span>
          <button
            type="button"
            onClick={() => setDedupBanner(null)}
            className="font-semibold underline shrink-0 cursor-pointer"
          >
            Đóng
          </button>
        </div>
      )}

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

      {/* Add Market Listing Form */}
      <form onSubmit={handleAddListing} className="banking-card p-5 sm:p-6 space-y-4">
        <div className="border-b border-[#E2E5E9] pb-3">
          <h3 className="banking-section-title">
            Tiếp nhận tin rao bán bất động sản (Kiểm tra URL công khai hoặc nhập thủ công)
          </h3>
        </div>

        {/* URL Inspector */}
        <div>
          <label className="banking-label">
            Đường dẫn tin rao bán (không bắt buộc nếu nhập trực tiếp từ khảo sát thực địa)
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="url"
              placeholder="https://..."
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className="banking-input flex-1"
            />
            <button
              type="button"
              onClick={handleInspectUrl}
              disabled={!urlInput.trim() || inspectingUrl}
              className="banking-btn-secondary whitespace-nowrap shrink-0"
            >
              {inspectingUrl ? (
                <Loader2 className="h-4 w-4 animate-spin text-[#9D1D26]" />
              ) : (
                <Globe className="h-4 w-4 text-[#9D1D26]" />
              )}
              Kiểm tra truy cập nguồn
            </button>
          </div>

          {urlInspectionMsg && (
            <div
              className={`mt-2.5 rounded-md border p-3.5 text-[13px] space-y-1 ${
                urlInspectionMsg.type === 'warning'
                  ? 'border-[#EAD196] bg-[#FEF7E6] text-[#6E4200]'
                  : 'border-[#B8DEC9] bg-[#ECF7F2] text-[#084730]'
              }`}
            >
              <div>{urlInspectionMsg.text}</div>
              {urlInspectionMsg.extractedTitle && (
                <div>
                  <strong>Tiêu đề trang:</strong> {urlInspectionMsg.extractedTitle}
                </div>
              )}
              {urlInspectionMsg.extractedDesc && (
                <div>
                  <strong>Mô tả công khai:</strong> {urlInspectionMsg.extractedDesc}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="banking-label">
              Nguồn tin <span className="text-[#9D1D26]">*</span>
            </label>
            <input
              type="text"
              placeholder="VD: Batdongsan.com.vn, Môi giới khu vực..."
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              className="banking-input"
            />
          </div>
          <div>
            <label className="banking-label">Ngày đăng tin</label>
            <input
              type="date"
              value={postedDate}
              onChange={(e) => setPostedDate(e.target.value)}
              className="banking-input font-mono"
            />
          </div>
          <div>
            <label className="banking-label">Xã / Phường</label>
            <input
              type="text"
              placeholder="VD: Phường Phước Hải"
              value={wardCommune}
              onChange={(e) => setWardCommune(e.target.value)}
              className="banking-input"
            />
          </div>
          <div>
            <label className="banking-label">Loại bất động sản</label>
            <input
              type="text"
              value={propertyType}
              onChange={(e) => setPropertyType(e.target.value)}
              className="banking-input"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <label className="banking-label">
              Địa chỉ bất động sản rao bán <span className="text-[#9D1D26]">*</span>
            </label>
            <input
              type="text"
              placeholder="Số nhà/đoạn đường, xã/phường..."
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="banking-input"
            />
          </div>
          <div className="lg:col-span-2">
            <label className="banking-label">
              Diện tích (m²) <span className="text-[#9D1D26]">*</span>
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="VD: 80"
              value={areaStr}
              onChange={(e) => setAreaStr(e.target.value)}
              className="banking-input font-mono tabular-nums"
            />
          </div>
          <div className="lg:col-span-3">
            <label className="banking-label">
              Giá rao bán (VNĐ) <span className="text-[#9D1D26]">*</span>
            </label>
            <input
              type="number"
              min="0"
              step="1000000"
              placeholder="VD: 4200000000"
              value={priceStr}
              onChange={(e) => setPriceStr(e.target.value)}
              className="banking-input font-mono tabular-nums"
            />
          </div>
          <div className="lg:col-span-2">
            <label className="banking-label">Đơn giá/m² tự tính</label>
            <div className="flex min-h-[40px] items-center rounded-md border border-[#E2E5E9] bg-[#F8F9FA] px-3 py-2 text-[13px] font-mono font-bold text-[#9D1D26] tabular-nums">
              {previewUnitPrice !== null ? formatCurrencyVnd(previewUnitPrice) : 'Chưa đủ dữ liệu'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="banking-label">Thông tin vị trí (mặt tiền/hẻm, chiều rộng đường...)</label>
            <input
              type="text"
              placeholder="VD: Hẻm bê tông 4m, cách đường chính 70m, ngang 5m..."
              value={locationInfo}
              onChange={(e) => setLocationInfo(e.target.value)}
              className="banking-input"
            />
          </div>
          <div>
            <label className="banking-label">Ghi chú xác minh</label>
            <input
              type="text"
              placeholder="Ghi rõ có công trình trên đất hay đất trống, tình trạng liên hệ..."
              value={verificationNote}
              onChange={(e) => setVerificationNote(e.target.value)}
              className="banking-input"
            />
          </div>
        </div>

        {formError && (
          <div className="rounded-md border border-[#E8B8BC] bg-[#FDF2F3] px-3.5 py-2.5 text-[13px] text-[#641016]">
            {formError}
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-2 border-t border-[#E2E5E9]">
          <span className="text-xs text-[#6B7280]">
            Mọi tin mới mặc định có trạng thái <strong className="text-[#1F2429]">Chưa xác minh</strong> cho đến khi cán bộ cập nhật.
          </span>
          <button
            type="submit"
            className="banking-btn-primary whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            Lưu tin rao tham khảo
          </button>
        </div>
      </form>

      {/* Market Listings Table */}
      <div className="banking-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#E2E5E9] bg-[#F8F9FA] px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#1F2429]">
            <Filter className="h-4 w-4 text-[#9D1D26]" />
            <span>Danh sách tin rao khảo sát ({filteredListings.length})</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Tìm địa chỉ, nguồn tin..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="banking-input !min-h-[36px] !py-1.5 !w-auto sm:min-w-[220px]"
            />
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as 'all' | MarketListingRecord['verificationStatus'])
              }
              className="banking-input !min-h-[36px] !py-1.5 !w-auto"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="chua_xac_minh">Chưa xác minh</option>
              <option value="da_xac_minh_so_bo">Đã xác minh sơ bộ</option>
              <option value="loai_tru">Đã loại trừ</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-[#E2E5E9] bg-[#F8F9FA] font-semibold text-[#1F2429]">
                <th className="px-4 py-3">Nguồn & Địa chỉ</th>
                <th className="px-4 py-3 text-right">Diện tích</th>
                <th className="px-4 py-3 text-right">Giá rao bán</th>
                <th className="px-4 py-3 text-right">Đơn giá/m²</th>
                <th className="px-4 py-3">Xác minh & Ghi chú</th>
                <th className="px-4 py-3 text-right">Hồ sơ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E5E9]">
              {filteredListings.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[#6B7280]">
                    Chưa có tin rao bán bất động sản nào trong danh sách. Hãy nhập tin khảo sát phía trên hoặc nạp tệp Excel khảo sát thị trường.
                  </td>
                </tr>
              ) : (
                filteredListings.map((item) => {
                  const isAttached = activeDossier.attachedMarketIds.includes(item.id);
                  const safeHref = sanitizeExternalUrl(item.url);
                  return (
                    <tr
                      key={item.id}
                      className={`align-top ${item.isDuplicate ? 'bg-[#FDF2F3]/50' : 'hover:bg-[#F9FAFB]'}`}
                    >
                      <td className="px-4 py-3.5 max-w-xs">
                        <div className="font-semibold text-[#1F2429]">{item.address}</div>
                        <div className="mt-0.5 text-[#4B5563]">
                          {item.sourceName}
                          {item.postedDate ? ` · Đăng: ${item.postedDate}` : ''}
                          {item.propertyType ? ` · ${item.propertyType}` : ''}
                        </div>
                        {item.locationInfo && (
                          <div className="mt-0.5 text-xs text-[#6B7280]">
                            Vị trí: {item.locationInfo}
                          </div>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono text-[#6B7280]">{item.listingCode}</span>
                          {safeHref && (
                            <a
                              href={safeHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-medium text-[#9D1D26] hover:underline"
                            >
                              Mở tin gốc <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          {item.isDuplicate && (
                            <span className="font-semibold text-[#9D1D26]">· Nghi trùng lặp</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-[#1F2429] whitespace-nowrap">
                        {item.areaSqm !== null ? `${formatNumberVi(item.areaSqm)} m²` : 'Chưa có'}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-[#1F2429] whitespace-nowrap">
                        {formatCurrencyVnd(item.askingPriceVnd)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono font-bold tabular-nums text-[#1F2429] whitespace-nowrap">
                        {formatCurrencyVnd(item.unitPricePerSqm)}
                      </td>
                      <td className="px-4 py-3.5 space-y-1.5 min-w-[200px]">
                        <select
                          aria-label="Trạng thái xác minh tin rao"
                          value={item.verificationStatus}
                          onChange={(e) =>
                            updateMarketListingStatus(
                              item.id,
                              e.target.value as MarketListingRecord['verificationStatus']
                            )
                          }
                          className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold bg-white ${
                            item.verificationStatus === 'da_xac_minh_so_bo'
                              ? 'border-[#B8DEC9] text-[#0B5D3F]'
                              : item.verificationStatus === 'loai_tru'
                              ? 'border-[#CBD2D9] text-[#6B7280]'
                              : 'border-[#EAD196] text-[#8A5300]'
                          }`}
                        >
                          <option value="chua_xac_minh">Chưa xác minh</option>
                          <option value="da_xac_minh_so_bo">Đã xác minh sơ bộ</option>
                          <option value="loai_tru">Loại trừ khỏi tham khảo</option>
                        </select>
                        <div className="text-xs text-[#4B5563]">{item.verificationNote}</div>
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setAttachError(null);
                              const res = toggleAttachMarketListing(item.id);
                              if (!res.ok) setAttachError(res.error || 'Không thể gắn tin rao này.');
                            }}
                            className={`inline-flex min-h-[34px] items-center gap-1 rounded-md px-3 py-1.5 text-[13px] font-semibold cursor-pointer ${
                              isAttached
                                ? 'bg-[#ECF7F2] text-[#0B5D3F] border border-[#B8DEC9]'
                                : 'bg-[#FDF2F3] text-[#9D1D26] border border-[#E8B8BC] hover:bg-[#F9E3E5]'
                            }`}
                          >
                            {isAttached ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                            {isAttached ? 'Đã gắn' : 'Gắn hồ sơ'}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeMarketListing(item.id)}
                            aria-label="Xóa tin rao"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#6B7280] hover:bg-[#FDF2F3] hover:text-[#9D1D26] cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
