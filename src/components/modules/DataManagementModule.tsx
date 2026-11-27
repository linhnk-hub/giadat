import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  FileJson,
  FileSpreadsheet,
  FileText,
  History,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAdminAuth } from '../../context/AdminAuthContext';
import { useAppData, type ServerActiveDatasetsSnapshot } from '../../context/AppDataContext';
import {
  DatasetKind,
  DatasetVersionMetadata,
  EcovisRecord,
  ImportPreviewResult,
  KFactorRuleRecord,
  MarketListingRecord,
  PdfReferenceDocument,
  StateLandPriceRecord,
} from '../../types/valuation';
import { formatBytes, formatDateTimeVi } from '../../utils/formatters';
import {
  downloadExcelTemplate,
  downloadJsonPayload,
  downloadJsonTemplate,
  parseSpreadsheetFile,
  validateAndPreviewImport,
} from '../../utils/importExport';

const DATASET_LABELS: Record<DatasetKind, string> = {
  state_price: 'Bảng giá đất Nhà nước (NQ 15/2025/NQ-HĐND Khánh Hòa)',
  ecovis: 'Dữ liệu khảo sát giá đất ECOVIS',
  k_factor_rules: 'Danh mục quy định Hệ số K',
  market_survey: 'Danh sách khảo sát giá thị trường',
};

interface AdminDatasetsOverview {
  storageBackend: 'server_json_file';
  updatedAt: string;
  counts: {
    statePrice: number;
    ecovis: number;
    kFactorRules: number;
    marketSurvey: number;
    totalVersions: number;
    pdfDocuments: number;
  };
  activeVersionIds: Record<DatasetKind, string | null>;
  versions: DatasetVersionMetadata[];
  pdfDocuments: Omit<PdfReferenceDocument, 'sessionObjectUrl'>[];
}

export const DataManagementModule: React.FC = () => {
  const { status: adminStatus, reverifySession, getAdminAuthHeaders } = useAdminAuth();
  const {
    isDemoMode,
    setIsDemoMode,
    allVersionHistory: localVersionHistory,
    commitDatasetVersion,
    activateDatasetVersion,
    applyServerActiveSnapshot,
    localVersionsCount,
    exportLocalDatasetsForMigration,
    pdfDocuments,
    addPdfDocument,
    removePdfDocument,
  } = useAppData();

  const [authActionError, setAuthActionError] = useState<string | null>(null);
  const [serverOverview, setServerOverview] = useState<AdminDatasetsOverview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [migrationMessage, setMigrationMessage] = useState<string | null>(null);

  // Excel/CSV/JSON import state
  const [selectedKind, setSelectedKind] = useState<DatasetKind>('state_price');
  const [sourceDocumentName, setSourceDocumentName] = useState('');
  const [versionLabel, setVersionLabel] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [importNotes, setImportNotes] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [commitSuccess, setCommitSuccess] = useState<string | null>(null);
  const [preview, setPreview] = useState<
    ImportPreviewResult<
      StateLandPriceRecord | EcovisRecord | KFactorRuleRecord | MarketListingRecord
    > | null
  >(null);
  const spreadsheetInputRef = useRef<HTMLInputElement | null>(null);

  // PDF upload state
  const [pdfTitle, setPdfTitle] = useState('');
  const [pdfCategory, setPdfCategory] =
    useState<PdfReferenceDocument['documentCategory']>('bang_gia_nha_nuoc');
  const [pdfPageCount, setPdfPageCount] = useState('');
  const [pdfEffectiveDate, setPdfEffectiveDate] = useState('');
  const [pdfAppendixNote, setPdfAppendixNote] = useState('');
  const [pdfError, setPdfError] = useState<string | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);

  const loadServerOverview = useCallback(async () => {
    if (adminStatus !== 'authorized') return;
    setLoadingOverview(true);
    try {
      const headers = await getAdminAuthHeaders(false);
      const res = await fetch('/api/admin/datasets', {
        method: 'GET',
        headers,
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setAuthActionError(body.error || 'Không thể tải danh sách bộ dữ liệu trên máy chủ.');
        return;
      }
      const data = (await res.json()) as AdminDatasetsOverview;
      setServerOverview(data);
    } catch {
      setAuthActionError('Không thể kết nối máy chủ để tải danh sách phiên bản bộ dữ liệu.');
    } finally {
      setLoadingOverview(false);
    }
  }, [adminStatus, getAdminAuthHeaders]);

  useEffect(() => {
    if (adminStatus === 'authorized') {
      void loadServerOverview();
    }
  }, [adminStatus, loadServerOverview]);

  const handleSpreadsheetSelected = async (file: File | null) => {
    if (!file) return;
    setParseError(null);
    setCommitSuccess(null);
    setPreview(null);

    try {
      const rows = await parseSpreadsheetFile(file);
      const tempVersionId = `v-${Date.now()}`;
      const result = validateAndPreviewImport(selectedKind, file.name, rows, {
        sourceDocumentName:
          sourceDocumentName.trim() || DATASET_LABELS[selectedKind],
        effectiveDate: effectiveDate.trim(),
        versionId: tempVersionId,
      });
      setPreview(result);
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : 'Không đọc được tệp Excel/CSV/JSON.'
      );
    } finally {
      if (spreadsheetInputRef.current) {
        spreadsheetInputRef.current.value = '';
      }
    }
  };

  const ensureVerifiedAdmin = async (): Promise<boolean> => {
    setAuthActionError(null);
    if (adminStatus !== 'authorized') {
      setAuthActionError('Phiên quản trị chưa được xác minh. Thao tác bị từ chối.');
      return false;
    }
    const stillAuthorized = await reverifySession(false);
    if (!stillAuthorized) {
      setAuthActionError('Máy chủ từ chối quyền Quản trị viên. Vui lòng đăng nhập lại.');
      return false;
    }
    return true;
  };

  const handleCommitImport = async () => {
    if (!preview || !preview.canCommit) return;
    if (!(await ensureVerifiedAdmin())) return;

    setActionBusy(true);
    setParseError(null);
    setCommitSuccess(null);

    try {
      const nowIso = new Date().toISOString();
      const versionId = `ver-${Date.now()}`;
      const label =
        versionLabel.trim() ||
        `Phiên bản ${new Date().toLocaleDateString('vi-VN')} (${preview.validRows.length} dòng)`;

      const metaPayload = {
        versionId,
        datasetKind: preview.datasetKind,
        versionLabel: label,
        sourceDocumentName:
          sourceDocumentName.trim() || DATASET_LABELS[preview.datasetKind],
        sourceFileName: preview.fileName,
        effectiveDate: effectiveDate.trim() || 'Chưa ghi ngày hiệu lực',
        importedAt: nowIso,
        rowCount: preview.validRows.length,
        spatialRecordsCount: preview.validSpatialCount ?? 0,
        notes: importNotes.trim(),
      };

      const headers = await getAdminAuthHeaders(false);
      const response = await fetch(`/api/admin/datasets/${preview.datasetKind}/versions`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          meta: metaPayload,
          records: preview.validRows,
          activate: true,
        }),
        cache: 'no-store',
      });

      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        version?: DatasetVersionMetadata;
        activeSnapshot?: ServerActiveDatasetsSnapshot;
      };

      if (!response.ok || !body.ok) {
        setParseError(
          body.error || 'Máy chủ từ chối lưu phiên bản dữ liệu mới. Dữ liệu gốc được giữ nguyên.'
        );
        return;
      }

      if (body.activeSnapshot) {
        applyServerActiveSnapshot(body.activeSnapshot);
      }

      // Mirror non-destructively into local backup state as well
      commitDatasetVersion(
        preview.datasetKind,
        metaPayload,
        preview.validRows as StateLandPriceRecord[]
      );

      await loadServerOverview();

      const spatialNote =
        (preview.validSpatialCount ?? 0) > 0
          ? ` (${preview.validSpatialCount} dòng có tọa độ GPS hợp lệ)`
          : '';
      setCommitSuccess(
        `Đã lưu bền vững lên máy chủ phiên bản "${label}" (${preview.validRows.length} dòng hợp lệ${spatialNote}) cho ${DATASET_LABELS[preview.datasetKind]}. Các phiên bản trước vẫn được giữ nguyên vẹn.`
      );
      setPreview(null);
      setVersionLabel('');
      setImportNotes('');
    } catch {
      setParseError('Không thể kết nối máy chủ để lưu phiên bản dữ liệu mới. Dữ liệu gốc được giữ nguyên.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleActivateVersion = async (kind: DatasetKind, versionId: string) => {
    if (!(await ensureVerifiedAdmin())) return;

    setActionBusy(true);
    setAuthActionError(null);
    setCommitSuccess(null);
    try {
      const headers = await getAdminAuthHeaders(false);
      const response = await fetch(
        `/api/admin/datasets/${kind}/versions/${encodeURIComponent(versionId)}/activate`,
        {
          method: 'POST',
          headers,
          cache: 'no-store',
        }
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        version?: DatasetVersionMetadata;
        activeSnapshot?: ServerActiveDatasetsSnapshot;
      };
      if (!response.ok || !body.ok) {
        setAuthActionError(body.error || 'Không thể khôi phục phiên bản đã chọn.');
        return;
      }
      if (body.activeSnapshot) {
        applyServerActiveSnapshot(body.activeSnapshot);
      }
      activateDatasetVersion(kind, versionId);
      await loadServerOverview();
      setCommitSuccess(
        `Đã kích hoạt lại phiên bản "${body.version?.versionLabel || versionId}" cho ${DATASET_LABELS[kind]}.`
      );
    } catch {
      setAuthActionError('Không thể kết nối máy chủ khi khôi phục phiên bản.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleExportVersionJson = async (kind: DatasetKind, versionId: string) => {
    if (!(await ensureVerifiedAdmin())) return;
    setAuthActionError(null);
    try {
      const headers = await getAdminAuthHeaders(false);
      const response = await fetch(
        `/api/admin/datasets/${kind}/versions/${encodeURIComponent(versionId)}/export`,
        {
          method: 'GET',
          headers,
          cache: 'no-store',
        }
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setAuthActionError(body.error || 'Không thể xuất tệp JSON phiên bản.');
        return;
      }
      const payload = await response.json();
      downloadJsonPayload(`${kind}_${versionId}.json`, payload);
    } catch {
      setAuthActionError('Không thể kết nối máy chủ để xuất tệp JSON.');
    }
  };

  const handleMigrateLocalToServer = async () => {
    if (!(await ensureVerifiedAdmin())) return;
    setActionBusy(true);
    setMigrationMessage(null);
    setAuthActionError(null);

    try {
      const localPayload = exportLocalDatasetsForMigration();
      const headers = await getAdminAuthHeaders(false);
      const response = await fetch('/api/admin/datasets/migrate-local', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(localPayload),
        cache: 'no-store',
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        importedVersions?: number;
        skippedVersions?: number;
        importedPdfs?: number;
        activeSnapshot?: ServerActiveDatasetsSnapshot;
      };
      if (!response.ok || !body.ok) {
        setAuthActionError(body.error || 'Không thể đồng bộ dữ liệu cục bộ lên máy chủ.');
        return;
      }
      if (body.activeSnapshot) {
        applyServerActiveSnapshot(body.activeSnapshot);
      }
      await loadServerOverview();
      setMigrationMessage(
        `Đồng bộ hoàn tất (không xóa dữ liệu cũ): đã chuyển ${body.importedVersions ?? 0} phiên bản mới, bỏ qua ${body.skippedVersions ?? 0} phiên bản đã tồn tại và đồng bộ ${body.importedPdfs ?? 0} hồ sơ PDF.`
      );
    } catch {
      setAuthActionError('Không thể kết nối máy chủ khi đồng bộ dữ liệu cục bộ.');
    } finally {
      setActionBusy(false);
    }
  };

  const handlePdfSelected = async (file: File | null) => {
    if (!file) return;
    setPdfError(null);
    if (!(await ensureVerifiedAdmin())) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setPdfError('Chỉ chấp nhận tệp định dạng PDF (.pdf).');
      return;
    }

    const sessionObjectUrl = URL.createObjectURL(file);
    const pdfPayload: Omit<PdfReferenceDocument, 'sessionObjectUrl'> = {
      id: `pdf-${Date.now()}`,
      fileName: file.name,
      documentTitle: pdfTitle.trim() || file.name.replace(/\.pdf$/i, ''),
      documentCategory: pdfCategory,
      pageCount: pdfPageCount.trim() ? Number(pdfPageCount) : null,
      effectiveDate: pdfEffectiveDate.trim(),
      appendixNote: pdfAppendixNote.trim(),
      fileSizeBytes: file.size,
      uploadedAt: new Date().toISOString(),
    };

    try {
      const headers = await getAdminAuthHeaders(false);
      const response = await fetch('/api/admin/datasets/pdfs', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pdfPayload),
        cache: 'no-store',
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        activeSnapshot?: ServerActiveDatasetsSnapshot;
      };
      if (!response.ok || !body.ok) {
        setPdfError(body.error || 'Không thể lưu thông tin tài liệu PDF lên máy chủ.');
        return;
      }
      if (body.activeSnapshot) {
        applyServerActiveSnapshot(body.activeSnapshot);
      }
      addPdfDocument({ ...pdfPayload, sessionObjectUrl });
      await loadServerOverview();
    } catch {
      setPdfError('Không thể kết nối máy chủ khi lưu hồ sơ PDF.');
      return;
    }

    setPdfTitle('');
    setPdfPageCount('');
    setPdfEffectiveDate('');
    setPdfAppendixNote('');
    if (pdfInputRef.current) {
      pdfInputRef.current.value = '';
    }
  };

  const handleRemovePdf = async (id: string) => {
    if (!(await ensureVerifiedAdmin())) return;
    try {
      const headers = await getAdminAuthHeaders(false);
      const response = await fetch(`/api/admin/datasets/pdfs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers,
        cache: 'no-store',
      });
      if (response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          activeSnapshot?: ServerActiveDatasetsSnapshot;
        };
        if (body.activeSnapshot) {
          applyServerActiveSnapshot(body.activeSnapshot);
        }
        await loadServerOverview();
      }
    } catch {
      // ignore network error and keep local state consistent if only local
    }
    removePdfDocument(id);
  };

  // Defense-in-depth: never render admin data management UI unless server-verified Admin
  if (adminStatus !== 'authorized') {
    return (
      <div className="rounded-md border border-[#E8B8BC] bg-[#FDF2F3] p-6 text-sm text-[#641016]">
        Truy cập bị từ chối (Access Denied). Khu vực quản lý dữ liệu chỉ dành cho Quản trị viên đã được xác minh tại máy chủ.
      </div>
    );
  }

  const displayedVersions = serverOverview?.versions ?? localVersionHistory;
  const serverVersionIds = new Set((serverOverview?.versions ?? []).map((v) => v.versionId));
  const unmigratedLocalCount = localVersionHistory.filter(
    (v) => !serverVersionIds.has(v.versionId)
  ).length;
  const errorIssuesCount = preview?.issues.filter((i) => i.severity === 'error').length ?? 0;
  const warningIssuesCount = preview?.issues.filter((i) => i.severity === 'warning').length ?? 0;

  return (
    <div className="space-y-6">
      {authActionError && (
        <div
          role="alert"
          className="rounded-md border border-[#E8B8BC] bg-[#FDF2F3] px-4 py-3 text-[13px] font-medium text-[#641016]"
        >
          {authActionError}
        </div>
      )}

      {/* Header, Server Storage Summary & Isolated DEMO Control */}
      <div className="banking-card p-5 sm:p-6 space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#0B5D3F]">
              <Database className="h-4 w-4" />
              M1.2 · Lưu trữ phiên bản tập trung trên máy chủ · Hỗ trợ Excel / CSV / JSON & Tọa độ GPS
            </div>
            <h2 className="mt-1 banking-page-title">
              Quản lý Bộ dữ liệu nguồn (Excel / CSV / JSON / PDF)
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-[#4B5563]">
              Nạp dữ liệu Bảng giá đất Nhà nước, báo cáo ECOVIS, quy định hệ số K và khảo sát thị trường. Dữ liệu sau khi kiểm lỗi và xác nhận sẽ được lưu bền vững theo từng phiên bản trên máy chủ để toàn bộ giao diện tra cứu công khai sử dụng thống nhất.
            </p>
          </div>

          <div className="rounded-md border border-[#EAD196] bg-[#FEF7E6] p-4 text-[13px] max-w-sm shrink-0">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-[#6E4200]">Khu vực dữ liệu DEMO tách biệt</span>
              <button
                type="button"
                onClick={() => setIsDemoMode(!isDemoMode)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                  isDemoMode
                    ? 'bg-[#8A5300] text-white hover:bg-[#6E4200]'
                    : 'bg-white border border-[#EAD196] text-[#6E4200] hover:bg-[#FCEEC8]'
                }`}
              >
                {isDemoMode ? 'Đang bật DEMO (Tắt)' : 'Bật dữ liệu DEMO'}
              </button>
            </div>
            <p className="mt-2 text-xs text-[#6E4200] leading-relaxed">
              Dữ liệu DEMO được gắn nhãn [DEMO] và cô lập hoàn toàn trong bộ nhớ phiên, tuyệt đối không lưu lẫn vào kho dữ liệu thật trên máy chủ.
            </p>
          </div>
        </div>

        {/* Live Server Dataset Counters */}
        <div className="grid grid-cols-2 gap-3 border-t border-[#E2E5E9] pt-4 sm:grid-cols-5 text-[13px]">
          <div className="rounded-md border border-[#E2E5E9] bg-[#F8F9FA] px-3.5 py-2.5">
            <div className="text-xs text-[#6B7280]">Giá Nhà nước</div>
            <div className="mt-0.5 font-mono text-base font-bold text-[#1F2429] tabular-nums">
              {(serverOverview?.counts.statePrice ?? 0).toLocaleString('vi-VN')} dòng
            </div>
          </div>
          <div className="rounded-md border border-[#E2E5E9] bg-[#F8F9FA] px-3.5 py-2.5">
            <div className="text-xs text-[#6B7280]">Khảo sát ECOVIS</div>
            <div className="mt-0.5 font-mono text-base font-bold text-[#1F2429] tabular-nums">
              {(serverOverview?.counts.ecovis ?? 0).toLocaleString('vi-VN')} dòng
            </div>
          </div>
          <div className="rounded-md border border-[#E2E5E9] bg-[#F8F9FA] px-3.5 py-2.5">
            <div className="text-xs text-[#6B7280]">Quy định Hệ số K</div>
            <div className="mt-0.5 font-mono text-base font-bold text-[#1F2429] tabular-nums">
              {(serverOverview?.counts.kFactorRules ?? 0).toLocaleString('vi-VN')} dòng
            </div>
          </div>
          <div className="rounded-md border border-[#E2E5E9] bg-[#F8F9FA] px-3.5 py-2.5">
            <div className="text-xs text-[#6B7280]">Tin thị trường</div>
            <div className="mt-0.5 font-mono text-base font-bold text-[#1F2429] tabular-nums">
              {(serverOverview?.counts.marketSurvey ?? 0).toLocaleString('vi-VN')} dòng
            </div>
          </div>
          <div className="rounded-md border border-[#E2E5E9] bg-[#F8F9FA] px-3.5 py-2.5 col-span-2 sm:col-span-1 flex flex-col justify-between">
            <div className="text-xs text-[#6B7280]">Phiên bản đã lưu</div>
            <div className="mt-0.5 flex items-center justify-between">
              <span className="font-mono text-base font-bold text-[#1F2429] tabular-nums">
                {serverOverview?.counts.totalVersions ?? 0}
              </span>
              <button
                type="button"
                disabled={loadingOverview}
                onClick={() => void loadServerOverview()}
                className="text-[#9D1D26] hover:text-[#7F151D] disabled:opacity-50 cursor-pointer"
                title="Làm mới danh sách từ máy chủ"
              >
                <RefreshCw className={`h-4 w-4 ${loadingOverview ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </div>

        {/* Non-destructive Migration Banner if browser localStorage has unsynced legacy real versions */}
        {localVersionsCount > 0 && unmigratedLocalCount > 0 && (
          <div className="rounded-md border border-[#E8B8BC] bg-[#FDF2F3] px-4 py-3.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-[13px] text-[#641016]">
            <div>
              <strong>Phát hiện {unmigratedLocalCount} phiên bản dữ liệu cục bộ trên trình duyệt</strong> chưa được đồng bộ lên máy chủ. Bạn có thể sao chép lên kho máy chủ mà không làm mất dữ liệu hiện có.
            </div>
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => void handleMigrateLocalToServer()}
              className="banking-btn-primary whitespace-nowrap shrink-0"
            >
              <Upload className="h-4 w-4" />
              Đồng bộ dữ liệu cục bộ lên máy chủ
            </button>
          </div>
        )}

        {migrationMessage && (
          <div className="rounded-md border border-[#B8DEC9] bg-[#ECF7F2] px-4 py-3 text-[13px] text-[#084730] flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#0B5D3F]" />
            <span>{migrationMessage}</span>
          </div>
        )}
      </div>

      {/* Section 1: Excel / CSV / JSON Import with Mandatory Preview & Validation */}
      <section className="banking-card p-5 sm:p-6 space-y-5">
        <div className="flex flex-col gap-3 border-b border-[#E2E5E9] pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="banking-section-title">
              1. Nhập dữ liệu từ Excel (.xlsx), CSV (.csv) hoặc JSON (.json)
            </h3>
            <p className="mt-1 text-[13px] text-[#4B5563]">
              Hỗ trợ thêm cột tọa độ không gian tùy chọn (<code className="font-mono text-[#1F2429]">vi_do</code>, <code className="font-mono text-[#1F2429]">kinh_do</code>) để chuẩn bị cho đối chiếu bán kính lân cận. Không tự động tạo tọa độ nếu nguồn không có.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => downloadExcelTemplate(selectedKind)}
              className="banking-btn-secondary !min-h-[36px] !px-3 !py-1.5 !text-[13px] whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5 text-[#0B5D3F]" />
              Tải mẫu Excel (.xlsx)
            </button>
            <button
              type="button"
              onClick={() => downloadJsonTemplate(selectedKind)}
              className="banking-btn-secondary !min-h-[36px] !px-3 !py-1.5 !text-[13px] whitespace-nowrap"
            >
              <FileJson className="h-3.5 w-3.5 text-[#9D1D26]" />
              Tải mẫu JSON (.json)
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="md:col-span-2">
            <label className="banking-label">
              Nhóm dữ liệu cần nạp <span className="text-[#9D1D26]">*</span>
            </label>
            <select
              value={selectedKind}
              onChange={(e) => {
                setSelectedKind(e.target.value as DatasetKind);
                setPreview(null);
                setParseError(null);
              }}
              className="banking-input"
            >
              <option value="state_price">{DATASET_LABELS.state_price}</option>
              <option value="ecovis">{DATASET_LABELS.ecovis}</option>
              <option value="k_factor_rules">{DATASET_LABELS.k_factor_rules}</option>
              <option value="market_survey">{DATASET_LABELS.market_survey}</option>
            </select>
          </div>
          <div>
            <label className="banking-label">Tên tài liệu / Văn bản nguồn</label>
            <input
              type="text"
              placeholder="VD: Nghị quyết 15/2025/NQ-HĐND"
              value={sourceDocumentName}
              onChange={(e) => setSourceDocumentName(e.target.value)}
              className="banking-input"
            />
          </div>
          <div>
            <label className="banking-label">Ngày hiệu lực / Thời điểm báo cáo</label>
            <input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className="banking-input font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="banking-label">Nhãn phiên bản dữ liệu (để lưu lịch sử)</label>
            <input
              type="text"
              placeholder="VD: NQ15-2025 v1.0 – Đợt nhập tháng 01/2026"
              value={versionLabel}
              onChange={(e) => setVersionLabel(e.target.value)}
              className="banking-input"
            />
          </div>
          <div>
            <label className="banking-label">Ghi chú phiên bản nhập</label>
            <input
              type="text"
              placeholder="Ghi rõ phạm vi địa bàn, người kiểm tra bảng..."
              value={importNotes}
              onChange={(e) => setImportNotes(e.target.value)}
              className="banking-input"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={spreadsheetInputRef}
            type="file"
            accept=".xlsx,.csv,.json"
            onChange={(e) => handleSpreadsheetSelected(e.target.files?.[0] ?? null)}
            className="hidden"
          />
          <button
            type="button"
            disabled={actionBusy}
            onClick={() => spreadsheetInputRef.current?.click()}
            className="banking-btn-primary"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Chọn tệp Excel (.xlsx) / CSV / JSON để xem trước & kiểm lỗi
          </button>
          <span className="text-[13px] text-[#6B7280]">
            Kiểm tra cột bắt buộc, mã trùng, định dạng số VNĐ/thập phân và tọa độ GPS chuẩn WGS84 trước khi lưu máy chủ.
          </span>
        </div>

        {parseError && (
          <div className="rounded-md border border-[#E8B8BC] bg-[#FDF2F3] p-3.5 text-[13px] text-[#641016]">
            <strong>Lỗi nhập dữ liệu:</strong> {parseError} — Dữ liệu hiện tại được giữ nguyên.
          </div>
        )}

        {commitSuccess && (
          <div className="rounded-md border border-[#B8DEC9] bg-[#ECF7F2] p-3.5 text-[13px] text-[#084730] flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#0B5D3F]" />
            <span>{commitSuccess}</span>
          </div>
        )}

        {/* Strict Preview & Validation Result Panel */}
        {preview && (
          <div className="rounded-md border border-[#CBD2D9] bg-[#F8F9FA] p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E2E5E9] pb-3.5">
              <div>
                <div className="text-[15px] font-semibold text-[#1F2429]">
                  Xem trước kiểm tra tệp: {preview.fileName}
                </div>
                <div className="mt-1 text-xs text-[#4B5563] font-mono tabular-nums">
                  Tổng dòng: {preview.totalRows} · Hợp lệ: {preview.validRows.length} · Có tọa độ GPS:{' '}
                  {preview.validSpatialCount ?? 0} · Mã trùng: {preview.duplicateCodes.length} · Lỗi chặn:{' '}
                  {errorIssuesCount} · Cảnh báo: {warningIssuesCount}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {preview.canCommit ? (
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => void handleCommitImport()}
                    className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-md bg-[#0B5D3F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#084730] disabled:opacity-60 cursor-pointer"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    {actionBusy ? 'Đang lưu máy chủ...' : 'Xác nhận lưu phiên bản lên máy chủ'}
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-[#E8B8BC] bg-[#FDF2F3] px-3 py-2 text-[13px] font-semibold text-[#9D1D26]">
                    <AlertTriangle className="h-4 w-4" />
                    Bị chặn nhập do có sai lệch · Giữ nguyên dữ liệu gốc
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="banking-btn-secondary"
                >
                  Hủy xem trước
                </button>
              </div>
            </div>

            {preview.missingRequiredColumns.length > 0 && (
              <div className="rounded-md border border-[#E8B8BC] bg-[#FDF2F3] p-3.5 text-[13px] text-[#641016]">
                <strong>Thiếu cột bắt buộc:</strong> {preview.missingRequiredColumns.join(', ')}.
              </div>
            )}

            {preview.duplicateCodes.length > 0 && (
              <div className="rounded-md border border-[#E8B8BC] bg-[#FDF2F3] p-3.5 text-[13px] text-[#641016]">
                <strong>Phát hiện mã dữ liệu trùng lặp:</strong> {preview.duplicateCodes.slice(0, 10).join(', ')}
                {preview.duplicateCodes.length > 10 ? ` (+${preview.duplicateCodes.length - 10} mã khác)` : ''}.
              </div>
            )}

            {preview.issues.length > 0 && (
              <div className="max-h-52 overflow-y-auto rounded-md border border-[#E2E5E9] bg-white">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-[#E2E5E9] bg-[#F8F9FA] text-[#1F2429] font-semibold">
                      <th className="px-3 py-2">Dòng</th>
                      <th className="px-3 py-2">Mức độ</th>
                      <th className="px-3 py-2">Trường</th>
                      <th className="px-3 py-2">Mô tả sai lệch / lưu ý</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E5E9]">
                    {preview.issues.slice(0, 30).map((issue, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2 font-mono text-[#4B5563]">{issue.rowNumber}</td>
                        <td className="px-3 py-2 font-semibold">
                          {issue.severity === 'error' ? (
                            <span className="text-[#9D1D26]">Lỗi chặn</span>
                          ) : (
                            <span className="text-[#8A5300]">Cảnh báo</span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-medium text-[#1F2429]">{issue.field}</td>
                        <td
                          className={`px-3 py-2 ${
                            issue.severity === 'error' ? 'text-[#9D1D26]' : 'text-[#8A5300]'
                          }`}
                        >
                          {issue.message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {preview.validRows.length > 0 && (
              <div>
                <div className="text-[13px] font-semibold text-[#1F2429] mb-2">
                  Xem trước 5 dòng hợp lệ đầu tiên:
                </div>
                <div className="overflow-x-auto rounded-md border border-[#E2E5E9] bg-white">
                  <table className="w-full text-left text-[13px]">
                    <thead>
                      <tr className="border-b border-[#E2E5E9] bg-[#F8F9FA] text-[#1F2429] font-semibold">
                        <th className="px-3 py-2.5">Mã</th>
                        <th className="px-3 py-2.5">Nội dung chính</th>
                        <th className="px-3 py-2.5">Giá trị / Đơn giá</th>
                        <th className="px-3 py-2.5">Tọa độ GPS</th>
                        <th className="px-3 py-2.5">Nguồn / Trang</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E5E9]">
                      {preview.validRows.slice(0, 5).map((row) => {
                        const lat = 'latitude' in row ? row.latitude : null;
                        const lng = 'longitude' in row ? row.longitude : null;
                        const coordCell =
                          typeof lat === 'number' && typeof lng === 'number' ? (
                            <span className="inline-flex items-center gap-1 font-mono text-xs text-[#0B5D3F]">
                              <MapPin className="h-3.5 w-3.5" />
                              {lat.toFixed(5)}, {lng.toFixed(5)}
                            </span>
                          ) : (
                            <span className="text-[#6B7280]">Không có</span>
                          );

                        if ('unitPrice' in row) {
                          return (
                            <tr key={row.id}>
                              <td className="px-3 py-2.5 font-mono">{row.recordCode}</td>
                              <td className="px-3 py-2.5">
                                {row.streetName} · {row.wardCommune} · {row.position}
                              </td>
                              <td className="px-3 py-2.5 font-mono tabular-nums font-semibold">
                                {row.unitPrice.toLocaleString('vi-VN')} {row.unit}
                              </td>
                              <td className="px-3 py-2.5">{coordCell}</td>
                              <td className="px-3 py-2.5">{row.sourcePageOrAppendix}</td>
                            </tr>
                          );
                        }
                        if ('surveyUnitPrice' in row) {
                          return (
                            <tr key={row.id}>
                              <td className="px-3 py-2.5 font-mono">{row.recordCode}</td>
                              <td className="px-3 py-2.5">
                                {row.streetName} · {row.position}
                              </td>
                              <td className="px-3 py-2.5 font-mono tabular-nums font-semibold">
                                {row.surveyUnitPrice.toLocaleString('vi-VN')} {row.unit}
                              </td>
                              <td className="px-3 py-2.5">{coordCell}</td>
                              <td className="px-3 py-2.5">{row.appendixAndPage}</td>
                            </tr>
                          );
                        }
                        if ('factorValue' in row) {
                          return (
                            <tr key={row.id}>
                              <td className="px-3 py-2.5 font-mono">{row.ruleCode}</td>
                              <td className="px-3 py-2.5">{row.factorName}</td>
                              <td className="px-3 py-2.5 font-mono tabular-nums font-semibold">K = {row.factorValue}</td>
                              <td className="px-3 py-2.5 text-[#6B7280]">—</td>
                              <td className="px-3 py-2.5">{row.sourcePage}</td>
                            </tr>
                          );
                        }
                        return (
                          <tr key={row.id}>
                            <td className="px-3 py-2.5 font-mono">{row.listingCode}</td>
                            <td className="px-3 py-2.5">
                              {row.address} ({row.sourceName})
                            </td>
                            <td className="px-3 py-2.5 font-mono tabular-nums font-semibold">
                              {row.unitPricePerSqm?.toLocaleString('vi-VN')} VNĐ/m²
                            </td>
                            <td className="px-3 py-2.5">{coordCell}</td>
                            <td className="px-3 py-2.5">{row.postedDate || 'Chưa ghi ngày'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Section 2: PDF Reference Documents Archive */}
      <section className="banking-card p-5 sm:p-6 space-y-4">
        <div className="border-b border-[#E2E5E9] pb-3">
          <h3 className="banking-section-title">
            2. Lưu trữ hồ sơ tài liệu PDF gốc làm căn cứ đối chiếu
          </h3>
          <p className="mt-1 text-[13px] text-[#4B5563]">
            Lưu trữ siêu dữ liệu văn bản PDF (Nghị quyết 15/2025/NQ-HĐND, Báo cáo ECOVIS, Quy định hệ số K) lên máy chủ kèm số trang và ghi chú phụ lục để trích dẫn thống nhất trong báo cáo.
          </p>
        </div>

        <div className="rounded-md border border-[#EAD196] bg-[#FEF7E6] px-4 py-3 text-[13px] text-[#6E4200]">
          <strong>Trạng thái kỹ thuật OCR bảng biểu PDF:</strong>{' '}
          <span className="font-semibold">
            Chưa triển khai trích xuất bảng giá tự động từ PDF scan
          </span>{' '}
          (nhằm tránh sai lệch số liệu pháp lý). Cán bộ tải PDF vào đây để lưu làm nguồn đối chiếu gốc và sử dụng mục 1 (Excel/CSV/JSON) để nạp bảng số liệu đã kiểm chuẩn.
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <label className="banking-label">Tên tài liệu PDF</label>
            <input
              type="text"
              placeholder="VD: Nghị quyết 15/2025/NQ-HĐND tỉnh Khánh Hòa"
              value={pdfTitle}
              onChange={(e) => setPdfTitle(e.target.value)}
              className="banking-input"
            />
          </div>
          <div>
            <label className="banking-label">Phân loại</label>
            <select
              value={pdfCategory}
              onChange={(e) =>
                setPdfCategory(e.target.value as PdfReferenceDocument['documentCategory'])
              }
              className="banking-input"
            >
              <option value="bang_gia_nha_nuoc">Bảng giá đất Nhà nước</option>
              <option value="bao_cao_ecovis">Báo cáo ECOVIS</option>
              <option value="quy_dinh_he_so_k">Quy định Hệ số K</option>
              <option value="khac">Tài liệu tham chiếu khác</option>
            </select>
          </div>
          <div>
            <label className="banking-label">Tổng số trang</label>
            <input
              type="number"
              min="1"
              placeholder="VD: 120"
              value={pdfPageCount}
              onChange={(e) => setPdfPageCount(e.target.value)}
              className="banking-input font-mono tabular-nums"
            />
          </div>
          <div>
            <label className="banking-label">Ngày ban hành / hiệu lực</label>
            <input
              type="date"
              value={pdfEffectiveDate}
              onChange={(e) => setPdfEffectiveDate(e.target.value)}
              className="banking-input font-mono"
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            placeholder="Ghi chú phụ lục / phạm vi áp dụng..."
            value={pdfAppendixNote}
            onChange={(e) => setPdfAppendixNote(e.target.value)}
            className="banking-input flex-1"
          />
          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => handlePdfSelected(e.target.files?.[0] ?? null)}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => pdfInputRef.current?.click()}
            className="banking-btn-secondary whitespace-nowrap shrink-0"
          >
            <Upload className="h-4 w-4 text-[#9D1D26]" />
            Tải lên tài liệu PDF
          </button>
        </div>

        {pdfError && <div className="text-[13px] font-medium text-[#9D1D26]">{pdfError}</div>}

        {pdfDocuments.length > 0 && (
          <div className="divide-y divide-[#E2E5E9] border-t border-[#E2E5E9] pt-2">
            {pdfDocuments.map((doc) => (
              <div key={doc.id} className="py-3.5 flex flex-wrap items-center justify-between gap-3 text-[13px]">
                <div className="flex items-start gap-2.5">
                  <FileText className="mt-0.5 h-4 w-4 text-[#9D1D26] shrink-0" />
                  <div>
                    <div className="font-semibold text-[#1F2429]">{doc.documentTitle}</div>
                    <div className="text-xs text-[#6B7280] mt-0.5">
                      Tệp: {doc.fileName} · {formatBytes(doc.fileSizeBytes)}
                      {doc.pageCount ? ` · ${doc.pageCount} trang` : ''}
                      {doc.effectiveDate ? ` · Hiệu lực: ${doc.effectiveDate}` : ''}
                      {' · '}Tải lên: {formatDateTimeVi(doc.uploadedAt)}
                    </div>
                    {doc.appendixNote && (
                      <div className="text-[#4B5563] mt-0.5">Ghi chú: {doc.appendixNote}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {doc.sessionObjectUrl && (
                    <a
                      href={doc.sessionObjectUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-[#9D1D26] hover:underline"
                    >
                      Mở xem PDF <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleRemovePdf(doc.id)}
                    aria-label="Xóa tài liệu PDF"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#6B7280] hover:bg-[#FDF2F3] hover:text-[#9D1D26] cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Section 3: Server Version History (Never Silently Overwrites) */}
      <section className="banking-card overflow-hidden">
        <div className="border-b border-[#E2E5E9] bg-[#F8F9FA] px-5 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <History className="h-4 w-4 text-[#9D1D26] shrink-0" />
            <div>
              <h3 className="banking-section-title">
                3. Lịch sử phiên bản bộ dữ liệu trên máy chủ
              </h3>
              <p className="mt-0.5 text-[13px] text-[#4B5563]">
                Mỗi đợt nạp dữ liệu là một phiên bản bất biến. Quản trị viên có thể khôi phục bất kỳ phiên bản cũ nào hoặc xuất JSON để đối chiếu/sao lưu.
              </p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-[#E2E5E9] bg-[#F8F9FA] font-semibold text-[#1F2429]">
                <th className="px-5 py-3">Nhóm dữ liệu</th>
                <th className="px-4 py-3">Phiên bản & Tài liệu nguồn</th>
                <th className="px-4 py-3 text-right">Số dòng / GPS</th>
                <th className="px-4 py-3">Thời điểm nhập</th>
                <th className="px-4 py-3">Trạng thái</th>
                <th className="px-5 py-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E5E9]">
              {displayedVersions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-[#6B7280]">
                    Chưa có phiên bản dữ liệu thật nào được lưu trên máy chủ.
                  </td>
                </tr>
              ) : (
                displayedVersions.map((ver) => (
                  <tr key={ver.versionId} className="hover:bg-[#F9FAFB]">
                    <td className="px-5 py-3.5 font-medium text-[#1F2429]">
                      {DATASET_LABELS[ver.datasetKind]}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="font-semibold text-[#1F2429]">{ver.versionLabel}</div>
                      <div className="text-xs text-[#6B7280] mt-0.5">
                        {ver.sourceDocumentName} · Tệp: {ver.sourceFileName}
                        {ver.importedByEmail ? ` · Bởi: ${ver.importedByEmail}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono tabular-nums text-[#1F2429]">
                      <div className="font-semibold">{ver.rowCount.toLocaleString('vi-VN')}</div>
                      {(ver.spatialRecordsCount ?? 0) > 0 && (
                        <div className="text-xs text-[#0B5D3F]">
                          {ver.spatialRecordsCount} GPS
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3.5 font-mono tabular-nums text-[#4B5563]">
                      {formatDateTimeVi(ver.importedAt)}
                    </td>
                    <td className="px-4 py-3.5 font-semibold">
                      {ver.isActive ? (
                        <span className="text-[#0B5D3F]">Đang áp dụng</span>
                      ) : (
                        <span className="text-[#6B7280]">Bản lưu trữ</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="inline-flex items-center gap-3">
                        {!ver.isActive && (
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => void handleActivateVersion(ver.datasetKind, ver.versionId)}
                            className="font-semibold text-[#9D1D26] hover:text-[#7F151D] hover:underline disabled:opacity-50 cursor-pointer"
                          >
                            Khôi phục bản này
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleExportVersionJson(ver.datasetKind, ver.versionId)}
                          className="font-medium text-[#4B5563] hover:text-[#1F2429] hover:underline cursor-pointer"
                        >
                          Xuất JSON
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
