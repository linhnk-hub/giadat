import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, Plus, Scale, Trash2 } from 'lucide-react';
import { useAppData } from '../../context/AppDataContext';
import { AppliedKFactorItem, KFactorRuleRecord } from '../../types/valuation';
import { isAppliedKFactorDemo, isKFactorRuleDemo } from '../../utils/dossierIntegrity';
import { formatNumberVi } from '../../utils/formatters';
import { navigateToPath } from '../../utils/navigation';

export const LocationKFactorModule: React.FC = () => {
  const {
    activeDossier,
    activeKFactorRules,
    isDemoMode,
    updateLocationAnalysis,
    addAppliedKFactor,
    updateAppliedKFactor,
    removeAppliedKFactor,
    setActiveModule,
  } = useAppData();

  const { parcel, locationAnalysis } = activeDossier;
  const [selectedRuleId, setSelectedRuleId] = useState('');
  const [attachError, setAttachError] = useState<string | null>(null);

  // Custom documented K-factor form (strictly requires formula, condition, source doc, page)
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customValueStr, setCustomValueStr] = useState('');
  const [customFormula, setCustomFormula] = useState('');
  const [customCondition, setCustomCondition] = useState('');
  const [customSourceDoc, setCustomSourceDoc] = useState('');
  const [customSourcePage, setCustomSourcePage] = useState('');
  const [customInputSummary, setCustomInputSummary] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  const locationFactors = [
    {
      label: 'Khoảng cách đến đường chính',
      value: parcel.distanceToMainRoadM !== null ? `${formatNumberVi(parcel.distanceToMainRoadM)} m` : null,
    },
    {
      label: 'Độ rộng đường / hẻm tiếp giáp',
      value: parcel.roadAlleyWidthM !== null ? `${formatNumberVi(parcel.roadAlleyWidthM)} m` : null,
    },
    {
      label: 'Chiều rộng mặt tiền',
      value: parcel.frontageWidthM !== null ? `${formatNumberVi(parcel.frontageWidthM)} m` : null,
    },
    {
      label: 'Chiều sâu thửa đất',
      value: parcel.depthM !== null ? `${formatNumberVi(parcel.depthM)} m` : null,
    },
    {
      label: 'Số mặt tiền',
      value: parcel.frontageCount !== null ? `${parcel.frontageCount} mặt tiền` : null,
    },
    {
      label: 'Đường tiếp giáp trực tiếp',
      value: parcel.adjacentRoadName.trim() || null,
    },
    {
      label: 'Điều kiện giao thông',
      value: parcel.roadCondition.trim() || null,
    },
    {
      label: 'Loại đất theo Giấy chứng nhận',
      value: parcel.landTypeCertificate.trim() || null,
    },
  ];

  const evaluateRuleBasis = (rule: KFactorRuleRecord): {
    hasBasis: boolean;
    missingReasons: string[];
    inputSummary: string;
  } => {
    const missing: string[] = [];
    const summaryParts: string[] = [];

    if (!rule.formula.trim()) missing.push('Thiếu công thức áp dụng');
    if (!rule.applicableCondition.trim()) missing.push('Thiếu điều kiện áp dụng');
    if (!rule.sourceDocument.trim() || !rule.sourcePage.trim()) {
      missing.push('Thiếu nguồn tài liệu hoặc trang tham chiếu');
    }

    const req = rule.requiredInputFields.toLowerCase();
    if (req.includes('mặt tiền')) {
      if (parcel.frontageCount === null && parcel.frontageWidthM === null) {
        missing.push('Chưa có thông tin Số mặt tiền / Chiều rộng mặt tiền tại Module 2');
      } else {
        summaryParts.push(
          `Số mặt tiền: ${parcel.frontageCount ?? 'chưa có'}, Rộng MT: ${parcel.frontageWidthM ?? 'chưa có'}m`
        );
      }
    }
    if (req.includes('hẻm') || req.includes('đường')) {
      if (parcel.roadAlleyWidthM === null && !parcel.adjacentRoadName.trim()) {
        missing.push('Chưa có thông tin Chiều rộng đường/hẻm tại Module 2');
      } else {
        summaryParts.push(
          `Đường/hẻm rộng: ${parcel.roadAlleyWidthM ?? 'chưa có'}m, Tiếp giáp: ${parcel.adjacentRoadName || 'chưa có'}`
        );
      }
    }
    if (req.includes('khoảng cách')) {
      if (parcel.distanceToMainRoadM === null) {
        missing.push('Chưa có thông tin Khoảng cách đến đường chính tại Module 2');
      } else {
        summaryParts.push(`Cách đường chính: ${parcel.distanceToMainRoadM}m`);
      }
    }
    if (req.includes('chiều sâu')) {
      if (parcel.depthM === null) {
        missing.push('Chưa có thông tin Chiều sâu thửa đất tại Module 2');
      } else {
        summaryParts.push(`Chiều sâu: ${parcel.depthM}m`);
      }
    }

    if (summaryParts.length === 0) {
      summaryParts.push(
        `Diện tích: ${parcel.areaSqm ?? 'chưa có'}m², Đường/hẻm: ${parcel.roadAlleyWidthM ?? 'chưa có'}m, MT: ${parcel.frontageWidthM ?? 'chưa có'}m`
      );
    }

    return {
      hasBasis: missing.length === 0,
      missingReasons: missing,
      inputSummary: summaryParts.join('; '),
    };
  };

  const handleAttachRule = () => {
    setAttachError(null);
    const rule = activeKFactorRules.find((r) => r.id === selectedRuleId);
    if (!rule) return;

    const evalRes = evaluateRuleBasis(rule);
    const newItem: AppliedKFactorItem = {
      id: `applied-k-${Date.now()}`,
      ruleId: rule.id,
      factorName: rule.factorName,
      value: evalRes.hasBasis ? rule.factorValue : null,
      formula: rule.formula,
      applicableCondition: rule.applicableCondition,
      sourceDocument: rule.sourceDocument,
      sourcePage: rule.sourcePage,
      inputDataSummary: evalRes.inputSummary,
      hasSufficientBasis: evalRes.hasBasis,
      missingBasisReasons: evalRes.missingReasons,
      verificationStatus: 'chua_xac_minh',
      officerNote: '',
      isDemo: isKFactorRuleDemo(rule),
    };

    const res = addAppliedKFactor(newItem);
    if (!res.ok) {
      setAttachError(res.error || 'Không thể áp dụng quy định hệ số K này vào hồ sơ.');
      return;
    }
    setSelectedRuleId('');
  };

  const handleAddCustomKFactor = (e: React.FormEvent) => {
    e.preventDefault();
    setCustomError(null);
    setAttachError(null);

    const parsedVal = customValueStr.trim() ? Number(customValueStr) : null;
    if (!customName.trim()) {
      setCustomError('Vui lòng nhập tên hệ số K.');
      return;
    }

    const missing: string[] = [];
    if (parsedVal === null || !Number.isFinite(parsedVal) || parsedVal <= 0) {
      missing.push('Thiếu giá trị hệ số hợp lệ theo tài liệu nguồn');
    }
    if (!customFormula.trim()) missing.push('Thiếu công thức');
    if (!customCondition.trim()) missing.push('Thiếu điều kiện áp dụng');
    if (!customSourceDoc.trim()) missing.push('Thiếu nguồn tài liệu');
    if (!customSourcePage.trim()) missing.push('Thiếu trang tham chiếu');
    if (!customInputSummary.trim()) missing.push('Thiếu dữ liệu đầu vào đối chiếu');

    const hasBasis = missing.length === 0;

    const res = addAppliedKFactor({
      id: `applied-k-custom-${Date.now()}`,
      ruleId: 'manual-documented',
      factorName: customName.trim(),
      value: hasBasis ? parsedVal : null,
      formula: customFormula.trim() || 'Chưa có thông tin',
      applicableCondition: customCondition.trim() || 'Chưa có thông tin',
      sourceDocument: customSourceDoc.trim() || 'Chưa có thông tin',
      sourcePage: customSourcePage.trim() || 'Chưa có thông tin',
      inputDataSummary: customInputSummary.trim() || 'Chưa có thông tin',
      hasSufficientBasis: hasBasis,
      missingBasisReasons: missing,
      verificationStatus: 'chua_xac_minh',
      officerNote: '',
      isDemo: isDemoMode,
    });
    if (!res.ok) {
      setCustomError(res.error || 'Không thể thêm hệ số K vào hồ sơ.');
      return;
    }

    setCustomName('');
    setCustomValueStr('');
    setCustomFormula('');
    setCustomCondition('');
    setCustomSourceDoc('');
    setCustomSourcePage('');
    setCustomInputSummary('');
    setShowCustomForm(false);
  };

  const verifiedKItems = locationAnalysis.appliedKFactors.filter(
    (k) => k.hasSufficientBasis && k.verificationStatus === 'da_xac_minh' && k.value !== null
  );

  const combinedKProduct =
    verifiedKItems.length > 0
      ? verifiedKItems.reduce((acc, k) => acc * (k.value ?? 1), 1)
      : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="banking-card p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl">
            <div className="text-xs sm:text-[13px] font-medium text-[#6B7280]">
              Kiểm soát chặt chẽ căn cứ pháp lý · Tuyệt đối không tự đặt hệ số K
            </div>
            <h2 className="mt-1 banking-page-title">
              Module 7 · Phân tích vị trí thửa đất & Hệ số điều chỉnh K
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-[#4B5563]">
              Hệ thống chỉ tính hệ số K khi đã có đầy đủ: <strong className="text-[#1F2429]">giá trị, công thức, điều kiện áp dụng, nguồn tài liệu, trang tham chiếu, dữ liệu đầu vào</strong> và được <strong className="text-[#1F2429]">cán bộ xác minh</strong>. Khi thiếu bất kỳ căn cứ nào, hệ thống bắt buộc hiển thị <strong className="text-[#9D1D26]">“CHƯA ĐỦ CƠ SỞ TÍNH TOÁN”</strong>.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveModule('parcel')}
            className="banking-btn-secondary whitespace-nowrap shrink-0"
          >
            Bổ sung thông số thửa đất
          </button>
        </div>
      </div>

      {/* Section 1: Location Factors Summary */}
      <div className="banking-card p-5 sm:p-6 space-y-5">
        <div className="border-b border-[#E2E5E9] pb-3">
          <h3 className="banking-section-title">
            1. Tổng hợp yếu tố vị trí ảnh hưởng đến giá đất (từ Hồ sơ thửa đất)
          </h3>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {locationFactors.map((f) => (
            <div key={f.label} className="rounded-md border border-[#E2E5E9] bg-[#F8F9FA] p-3.5">
              <div className="text-xs text-[#6B7280]">{f.label}</div>
              <div
                className={`mt-1 text-[13px] font-semibold ${
                  f.value ? 'text-[#1F2429] font-mono tabular-nums' : 'text-[#8A5300]'
                }`}
              >
                {f.value ?? 'Chưa có thông tin'}
              </div>
            </div>
          ))}
        </div>

        {/* Officer-declared State Land Price Position */}
        <div className="grid grid-cols-1 gap-4 border-t border-[#E2E5E9] pt-4 md:grid-cols-3">
          <div>
            <label className="banking-label">
              Vị trí theo Bảng giá đất Nhà nước (cán bộ tự xác định)
            </label>
            <select
              value={locationAnalysis.selectedStatePosition}
              onChange={(e) =>
                updateLocationAnalysis({
                  selectedStatePosition: e.target.value,
                  statePositionVerified: false,
                })
              }
              className="banking-input"
            >
              <option value="">-- Chưa xác định vị trí --</option>
              <option value="Vị trí 1">Vị trí 1</option>
              <option value="Vị trí 2">Vị trí 2</option>
              <option value="Vị trí 3">Vị trí 3</option>
              <option value="Vị trí 4">Vị trí 4</option>
              <option value="Vị trí 5 / Còn lại">Vị trí 5 / Còn lại</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="banking-label">
              Căn cứ xác định vị trí theo văn bản pháp lý (Điều/Khoản/Trang nguồn)
            </label>
            <input
              type="text"
              placeholder="Ghi rõ điều khoản quy định phân loại vị trí trong NQ 15/2025/NQ-HĐND tỉnh Khánh Hòa..."
              value={locationAnalysis.statePositionBasis}
              onChange={(e) =>
                updateLocationAnalysis({ statePositionBasis: e.target.value })
              }
              className="banking-input"
            />
          </div>
        </div>

        <div>
          <label className="banking-label">
            Các yếu tố khác có căn cứ từ tài liệu nguồn (hình dáng thóp hậu/nở hậu, hành lang an toàn, quy hoạch...)
          </label>
          <textarea
            rows={2}
            placeholder="Chỉ ghi nhận các yếu tố có tài liệu/biên bản kiểm tra thực tế làm căn cứ..."
            value={locationAnalysis.otherDocumentedFactors}
            onChange={(e) =>
              updateLocationAnalysis({ otherDocumentedFactors: e.target.value })
            }
            className="w-full rounded-md border border-[#CBD2D9] bg-white px-3 py-2.5 text-sm text-[#1F2429] placeholder:text-[#6B7280] focus:border-[#9D1D26] focus:outline-none"
          />
        </div>

        <label className="inline-flex items-center gap-2.5 text-[13px] text-[#1F2429] cursor-pointer">
          <input
            type="checkbox"
            disabled={!locationAnalysis.selectedStatePosition || !locationAnalysis.statePositionBasis.trim()}
            checked={locationAnalysis.statePositionVerified}
            onChange={(e) =>
              updateLocationAnalysis({ statePositionVerified: e.target.checked })
            }
            className="h-4 w-4 rounded border-[#CBD2D9] accent-[#9D1D26]"
          />
          <span>
            <strong>Cán bộ xác nhận</strong> phân loại vị trí đất trên đã đối chiếu đúng văn bản pháp lý và thực địa.
          </span>
        </label>
      </div>

      {/* Section 2: K-Factor Calculation Engine */}
      <div className="banking-card p-5 sm:p-6 space-y-5">
        <div className="flex flex-col gap-3 border-b border-[#E2E5E9] pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="banking-section-title">
              2. Đánh giá và tính toán Hệ số K (có căn cứ nguồn)
            </h3>
            <p className="mt-1 text-[13px] text-[#4B5563]">
              Chọn quy định hệ số K từ danh mục đã nạp hoặc ghi nhận quy định có trích dẫn đầy đủ nguồn và trang tài liệu.
            </p>
          </div>

          <div
            className={`rounded-md border px-4 py-2.5 text-right shrink-0 ${
              combinedKProduct !== null
                ? 'border-[#B8DEC9] bg-[#ECF7F2]'
                : 'border-[#E8B8BC] bg-[#FDF2F3]'
            }`}
          >
            <div className="text-xs text-[#4B5563]">Kết quả tổng hợp hệ số K đủ điều kiện</div>
            {combinedKProduct !== null ? (
              <div className="font-mono text-base font-bold text-[#0B5D3F] tabular-nums mt-0.5">
                K tổng hợp = {formatNumberVi(combinedKProduct, 4)} ({verifiedKItems.length} hệ số đã xác minh)
              </div>
            ) : (
              <div className="font-mono text-[13px] font-bold text-[#9D1D26] mt-0.5">
                CHƯA ĐỦ CƠ SỞ TÍNH TOÁN
              </div>
            )}
          </div>
        </div>

        {/* Selector from loaded K-Factor Rules */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1">
            {activeKFactorRules.length > 0 ? (
              <select
                value={selectedRuleId}
                onChange={(e) => setSelectedRuleId(e.target.value)}
                className="banking-input"
              >
                <option value="">-- Chọn quy định hệ số K từ danh mục tài liệu nguồn ({activeKFactorRules.length}) --</option>
                {activeKFactorRules.map((r) => (
                  <option key={r.id} value={r.id}>
                    [{r.ruleCode}] {r.factorName} (K = {r.factorValue}) · {r.sourcePage}
                  </option>
                ))}
              </select>
            ) : (
              <div className="rounded-md border border-dashed border-[#CBD2D9] bg-[#F8F9FA] px-4 py-2.5 text-[13px] text-[#4B5563] flex items-center justify-between gap-2">
                <span>Chưa nạp bảng quy định hệ số K trong kho dữ liệu thật.</span>
                <button
                  type="button"
                  onClick={() => navigateToPath('/admin')}
                  className="inline-flex items-center gap-1.5 font-semibold text-[#9D1D26] hover:text-[#7F151D] hover:underline whitespace-nowrap cursor-pointer"
                >
                  <Database className="h-4 w-4" />
                  Cổng Quản trị (/admin)
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {activeKFactorRules.length > 0 && (
              <button
                type="button"
                disabled={!selectedRuleId}
                onClick={handleAttachRule}
                className="banking-btn-primary whitespace-nowrap"
              >
                <Plus className="h-4 w-4" />
                Áp dụng quy định này
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowCustomForm(!showCustomForm)}
              className="banking-btn-secondary whitespace-nowrap"
            >
              {showCustomForm ? 'Đóng biểu mẫu nhập' : 'Nhập hệ số từ văn bản'}
            </button>
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

        {/* Custom Documented K-Factor Form */}
        {showCustomForm && (
          <form
            onSubmit={handleAddCustomKFactor}
            className="rounded-md border border-[#E2E5E9] bg-[#F8F9FA] p-4 sm:p-5 space-y-4"
          >
            <div className="text-[13px] font-semibold text-[#1F2429]">
              Ghi nhận hệ số K có trích dẫn văn bản (nếu thiếu bất kỳ trường căn cứ nào, hệ số sẽ hiển thị “CHƯA ĐỦ CƠ SỞ TÍNH TOÁN”)
            </div>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="banking-label">
                  Tên hệ số K <span className="text-[#9D1D26]">*</span>
                </label>
                <input
                  type="text"
                  placeholder="VD: Hệ số điều chỉnh vị trí góc 2 mặt tiền"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="banking-input"
                />
              </div>
              <div>
                <label className="banking-label">Giá trị hệ số theo văn bản</label>
                <input
                  type="number"
                  step="0.001"
                  placeholder="VD: 1.1"
                  value={customValueStr}
                  onChange={(e) => setCustomValueStr(e.target.value)}
                  className="banking-input font-mono tabular-nums"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <div>
                <label className="banking-label">Công thức áp dụng</label>
                <input
                  type="text"
                  placeholder="VD: Đơn giá sau điều chỉnh = Đơn giá gốc × K"
                  value={customFormula}
                  onChange={(e) => setCustomFormula(e.target.value)}
                  className="banking-input"
                />
              </div>
              <div>
                <label className="banking-label">Điều kiện áp dụng</label>
                <input
                  type="text"
                  placeholder="Ghi rõ điều kiện theo văn bản pháp lý/nội bộ"
                  value={customCondition}
                  onChange={(e) => setCustomCondition(e.target.value)}
                  className="banking-input"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
              <div>
                <label className="banking-label">Nguồn tài liệu</label>
                <input
                  type="text"
                  placeholder="Tên văn bản/quyết định..."
                  value={customSourceDoc}
                  onChange={(e) => setCustomSourceDoc(e.target.value)}
                  className="banking-input"
                />
              </div>
              <div>
                <label className="banking-label">Trang tham chiếu</label>
                <input
                  type="text"
                  placeholder="VD: Điều 5 – Trang 14"
                  value={customSourcePage}
                  onChange={(e) => setCustomSourcePage(e.target.value)}
                  className="banking-input"
                />
              </div>
              <div>
                <label className="banking-label">Dữ liệu đầu vào đối chiếu</label>
                <input
                  type="text"
                  placeholder="VD: Số mặt tiền = 2; Rộng đường = 12m"
                  value={customInputSummary}
                  onChange={(e) => setCustomInputSummary(e.target.value)}
                  className="banking-input"
                />
              </div>
            </div>
            {customError && <div className="text-[13px] font-medium text-[#9D1D26]">{customError}</div>}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="banking-btn-primary"
              >
                Thêm vào bảng phân tích K
              </button>
            </div>
          </form>
        )}

        {/* Applied K-Factor Items List */}
        {locationAnalysis.appliedKFactors.length === 0 ? (
          <div className="rounded-md border border-dashed border-[#CBD2D9] p-8 text-center">
            <Scale className="mx-auto h-8 w-8 text-[#9D1D26]" />
            <div className="mt-2.5 font-mono text-sm font-bold text-[#9D1D26]">
              CHƯA ĐỦ CƠ SỞ TÍNH TOÁN
            </div>
            <p className="mt-1.5 text-[13px] text-[#4B5563] max-w-md mx-auto leading-relaxed">
              Chưa có hệ số K nào được gắn kèm đầy đủ công thức, điều kiện áp dụng, nguồn tài liệu, trang tham chiếu và xác minh đầu vào.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {locationAnalysis.appliedKFactors.map((item) => {
              const itemIsDemo = isAppliedKFactorDemo(item);
              const isContaminatedInReal = !activeDossier.isDemoDossier && itemIsDemo;
              const isCalculated =
                item.hasSufficientBasis &&
                item.verificationStatus === 'da_xac_minh' &&
                item.value !== null;

              return (
                <div
                  key={item.id}
                  className={`rounded-md border p-4 space-y-3 ${
                    isContaminatedInReal ? 'border-[#E8B8BC] bg-[#FDF2F3]/50' : 'border-[#E2E5E9] bg-white'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-[15px] font-semibold text-[#1F2429]">
                        {item.factorName}
                        {isContaminatedInReal && (
                          <span className="ml-2 font-mono text-xs font-bold text-[#9D1D26]">
                            [NHIỄM DỮ LIỆU DEMO – CẦN GỠ BỎ]
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[13px] text-[#4B5563]">
                        Nguồn tài liệu: <strong className="text-[#1F2429]">{item.sourceDocument}</strong> · Trang tham chiếu:{' '}
                        <strong className="text-[#1F2429]">{item.sourcePage}</strong>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        {isCalculated ? (
                          <div className="font-mono text-base font-bold text-[#0B5D3F] tabular-nums">
                            K = {formatNumberVi(item.value, 4)}
                          </div>
                        ) : (
                          <div className="font-mono text-xs font-bold text-[#9D1D26]">
                            CHƯA ĐỦ CƠ SỞ TÍNH TOÁN
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeAppliedKFactor(item.id)}
                        aria-label="Xóa hệ số K"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#6B7280] hover:bg-[#FDF2F3] hover:text-[#9D1D26] cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5 border-t border-[#E2E5E9] pt-3 text-[13px] sm:grid-cols-3">
                    <div>
                      <span className="text-[#6B7280]">Công thức:</span>{' '}
                      <span className="text-[#1F2429]">{item.formula}</span>
                    </div>
                    <div>
                      <span className="text-[#6B7280]">Điều kiện áp dụng:</span>{' '}
                      <span className="text-[#1F2429]">{item.applicableCondition}</span>
                    </div>
                    <div>
                      <span className="text-[#6B7280]">Dữ liệu đầu vào:</span>{' '}
                      <span className="text-[#1F2429]">{item.inputDataSummary}</span>
                    </div>
                  </div>

                  {!item.hasSufficientBasis && item.missingBasisReasons.length > 0 && (
                    <div className="rounded-md bg-[#FDF2F3] border border-[#E8B8BC] px-3.5 py-2.5 text-[13px] text-[#641016] flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-[#9D1D26]" />
                      <div>
                        <strong>Thiếu cơ sở tính toán:</strong> {item.missingBasisReasons.join('; ')}.
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E5E9] pt-3 text-[13px]">
                    <label className="inline-flex items-center gap-2 text-[#1F2429] cursor-pointer">
                      <input
                        type="checkbox"
                        disabled={!item.hasSufficientBasis}
                        checked={item.verificationStatus === 'da_xac_minh'}
                        onChange={(e) =>
                          updateAppliedKFactor(item.id, {
                            verificationStatus: e.target.checked ? 'da_xac_minh' : 'chua_xac_minh',
                          })
                        }
                        className="h-4 w-4 rounded border-[#CBD2D9] accent-[#9D1D26]"
                      />
                      <span>
                        Cán bộ xác minh dữ liệu đầu vào và điều kiện áp dụng hệ số K này
                      </span>
                    </label>

                    <span className="font-semibold">
                      {isCalculated ? (
                        <span className="inline-flex items-center gap-1.5 text-[#0B5D3F]">
                          <CheckCircle2 className="h-4 w-4" />
                          Đã xác minh · Đủ cơ sở
                        </span>
                      ) : (
                        <span className="text-[#8A5300]">Chưa xác minh / Chưa đủ cơ sở</span>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
