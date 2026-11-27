import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  Loader2,
  MapPin,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAppData } from '../../context/AppDataContext';
import { firestoreDatabaseId } from '../../firebase';
import {
  activateOrRollbackDatasetVersion,
  ALL_DATASET_KINDS,
  createPdfReferenceDocument,
  deletePdfReferenceDocument,
  exportDatasetVersionBackupJson,
  fetchAdminOverview,
  importAndStageDatasetVersion,
  type AdminOverviewSnapshot,
  type FirestoreDatasetVersionSummary,
  type ImportProgressUpdate,
} from '../../services/firestoreDatasetStore';
import type {
  DatasetKind,
  EcovisRecord,
  ImportPreviewResult,
  KFactorRuleRecord,
  MarketListingRecord,
  PdfReferenceDocument,
  StateLandPriceRecord,
} from '../../types/valuation';
import { formatDateTimeVi } from '../../utils/formatters';
import {
  downloadExcelTemplate,
  downloadJsonPayload,
  downloadJsonTemplate,
  getDatasetTemplateSpec,
  parseSpreadsheetFileWithMeta,
  validateAndPreviewImport,
} from '../../utils/importExport';

const DATASET_KIND_OPTIONS: Array<{
  kind: DatasetKind;
  label: string;
  shortLabel: string;
  defaultSourceDoc: string;
}> = [
  {
    kind: 'state_price',
    label: 'Bảng giá đất Nhà nước (Khánh Hòa)',
    shortLabel: 'Giá Nhà nước',
    defaultSourceDoc: 'Nghị quyết 15/2025/NQ-HĐND tỉnh Khánh Hòa',
  },
  {
    kind: 'ecovis',
    label: 'Dữ liệu khảo sát ECOVIS',
    shortLabel: 'ECOVIS',
    defaultSourceDoc: 'Báo cáo khảo sát giá đất ECOVIS (187/2025/39/BC-E.AFA)',
  },
  {
    kind: 'market_survey',
    label: 'Khảo sát rao bán thị trường',
    shortLabel: 'Thị trường',
    defaultSourceDoc: 'Khảo sát tin rao bán tham khảo (không phải giá giao dịch)',
  },
  {
    kind: 'k_factor_rules',
    label: 'Bảng quy định Hệ số K',
    shortLabel: 'Hệ số K',
    defaultSourceDoc: 'Quy định hệ số điều chỉnh giá đất',
  },
];

function getKindLabel(kind: DatasetKind): string {
  return DATASET_KIND_OPTIONS.find((d) => d.kind === kind)?.shortLabel ?? kind;
}

export const DataManagementModule: React.FC = () => {
  const { refreshServerDatasets } = useAppData();

  // Firestore Admin Overview State
  const [overview, setOverview] = useState<AdminOverviewSnapshot | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Import Form State
  const [selectedKind, setSelectedKind] = useState<DatasetKind>('state_price');
  const [versionLabel, setVersionLabel] = useState('');
  const [sourceDocumentName, setSourceDocumentName] = useState(
    DATASET_KIND_OPTIONS[0].defaultSourceDoc
  );
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [activateImmediately, setActivateImmediately] = useState(true);

  const [parsingFile, setParsingFile] = useState(false);
  const [preview, setPreview] = useState<
    ImportPreviewResult<
      StateLandPriceRecord | EcovisRecord | KFactorRuleRecord | MarketListingRecord
    > | null
  >(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // Staging Upload / Progress State
  const [committing, setCommitting] = useState(false);
  const [progress, setProgress] = useState<ImportProgressUpdate | null>(null);
  const [actionBanner, setActionBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Version action busy tracking
  const [busyVersionId, setBusyVersionId] = useState<string | null>(null);

  // PDF Archive Form State
  const [pdfTitle, setPdfTitle] = useState('');
  const [pdfFileName, setPdfFileName] = useState('');
  const [pdfCategory, setPdfCategory] =
    useState<PdfReferenceDocument['documentCategory']>('bang_gia_nha_nuoc');
  const [pdfEffectiveDate, setPdfEffectiveDate] = useState('');
  const [pdfPageCount, setPdfPageCount] = useState('');
  const [pdfAppendixNote, setPdfAppendixNote] = useState('');
  const [pdfFileSizeBytes, setPdfFileSizeBytes] = useState(0);
  const [savingPdf, setSavingPdf] = useState(false);

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    setOverviewError(null);
    try {
      const data = await fetchAdminOverview();
      setOverview(data);
    } catch (err) {
      setOverviewError(
        err instanceof Error
          ? err.message
          : 'Không thể tải danh sách phiên bản từ Cloud Firestore.'
      );
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const handleKindChange = (kind: DatasetKind) => {
    setSelectedKind(kind);
    const cfg = DATASET_KIND_OPTIONS.find((d) => d.kind === kind);
    if (cfg) setSourceDocumentName(cfg.defaultSourceDoc);
    setPreview(null);
    setParseError(null);
    setProgress(null);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setParsingFile(true);
    setParseError(null);
    setPreview(null);
    setProgress(null);
    setActionBanner(null);

    try {
      const tempVersionId = `${selectedKind}_${Date.now()}`;
      const tabular = await parseSpreadsheetFileWithMeta(file, selectedKind);
      const parsed = validateAndPreviewImport(selectedKind, file.name, tabular.rows, {
        sourceDocumentName,
        effectiveDate,
        versionId: tempVersionId,
        selectedSheetName: tabular.selectedSheetName,
      });

      setPreview(parsed);
      if (!versionLabel.trim()) {
        setVersionLabel(`${getKindLabel(selectedKind)} · ${file.name.replace(/\.[^.]+$/, '')}`);
      }
    } catch (err) {
      setParseError(
        err instanceof Error
          ? err.message
          : 'Không thể đọc tệp dữ liệu. Vui lòng kiểm tra định dạng Excel (.xlsx), CSV hoặc JSON.'
      );
    } finally {
      setParsingFile(false);
    }
  };

  const handleCommitToFirestore = async () => {
    if (!preview || !preview.canCommit || preview.validRows.length === 0) return;

    setCommitting(true);
    setActionBanner(null);
    setProgress(null);

    try {
      const result = await importAndStageDatasetVersion(
        {
          datasetKind: selectedKind,
          versionLabel:
            versionLabel.trim() || `${getKindLabel(selectedKind)} (${effectiveDate})`,
          sourceDocumentName:
            sourceDocumentName.trim() || getKindLabel(selectedKind),
          sourceFileName: preview.fileName,
          effectiveDate: effectiveDate.trim() || new Date().toISOString().slice(0, 10),
          notes: notes.trim(),
          records: preview.validRows,
          activate: activateImmediately,
        },
        (update) => setProgress(update)
      );

      setActionBanner({
        type: 'success',
        message: result.activated
          ? `Đã nạp và kích hoạt nguyên tử phiên bản ${result.versionId} (${result.rowCount.toLocaleString('vi-VN')} bản ghi, ${result.spatialRecordsCount} có GPS, SHA-256: ${result.payloadChecksum.slice(0, 12)}…).`
          : `Đã lưu phiên bản ${result.versionId} (${result.rowCount.toLocaleString('vi-VN')} bản ghi, chưa kích hoạt).`,
      });
      setPreview(null);
      setVersionLabel('');
      setNotes('');
      await Promise.all([loadOverview(), refreshServerDatasets()]);
    } catch (err) {
      setActionBanner({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Nạp dữ liệu vào Cloud Firestore thất bại.',
      });
    } finally {
      setCommitting(false);
    }
  };

  const handleActivateOrRollback = async (
    ver: FirestoreDatasetVersionSummary,
    action: 'activate' | 'rollback'
  ) => {
    setBusyVersionId(ver.versionId);
    setActionBanner(null);
    try {
      const res = await activateOrRollbackDatasetVersion({
        datasetKind: ver.datasetKind,
        targetVersionId: ver.versionId,
        action,
      });
      setActionBanner({
        type: 'success',
        message:
          action === 'rollback'
            ? `Đã khôi phục phiên bản ${res.toVersionId} cho nhóm ${getKindLabel(ver.datasetKind)} (mã kiểm toán ${res.eventId}).`
            : `Đã kích hoạt phiên bản ${res.toVersionId} cho nhóm ${getKindLabel(ver.datasetKind)}.`,
      });
      await Promise.all([loadOverview(), refreshServerDatasets()]);
    } catch (err) {
      setActionBanner({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Chuyển đổi phiên bản dữ liệu thất bại.',
      });
    } finally {
      setBusyVersionId(null);
    }
  };

  const handleExportJsonBackup = async (ver: FirestoreDatasetVersionSummary) => {
    setBusyVersionId(ver.versionId);
    setActionBanner(null);
    try {
      const backup = await exportDatasetVersionBackupJson(ver.datasetKind, ver.versionId);
      downloadJsonPayload(`backup_${ver.datasetKind}_${ver.versionId}.json`, backup);
      setActionBanner({
        type: 'success',
        message: `Đã xuất bản sao lưu JSON (${backup.records.length.toLocaleString('vi-VN')} bản ghi) cho phiên bản ${ver.versionId}.`,
      });
    } catch (err) {
      setActionBanner({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Xuất bản sao lưu JSON thất bại.',
      });
    } finally {
      setBusyVersionId(null);
    }
  };

  const handlePdfFilePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPdfFileName(file.name);
    setPdfFileSizeBytes(file.size);
    if (!pdfTitle.trim()) {
      setPdfTitle(file.name.replace(/\.pdf$/i, ''));
    }
  };

  const handleSavePdfMetadata = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pdfTitle.trim() || !pdfFileName.trim()) return;
    setSavingPdf(true);
    setActionBanner(null);
    try {
      const parsedPages = pdfPageCount.trim() ? Number(pdfPageCount.trim()) : null;
      await createPdfReferenceDocument({
        fileName: pdfFileName.trim(),
        documentTitle: pdfTitle.trim(),
        documentCategory: pdfCategory,
        pageCount:
          parsedPages !== null && Number.isInteger(parsedPages) && parsedPages > 0
            ? parsedPages
            : null,
        effectiveDate: pdfEffectiveDate.trim(),
        appendixNote: pdfAppendixNote.trim(),
        fileSizeBytes: pdfFileSizeBytes,
      });
      setPdfTitle('');
      setPdfFileName('');
      setPdfEffectiveDate('');
      setPdfPageCount('');
      setPdfAppendixNote('');
      setPdfFileSizeBytes(0);
      setActionBanner({
        type: 'success',
        message: 'Đã lưu thông tin tài liệu PDF nguồn vào Cloud Firestore.',
      });
      await Promise.all([loadOverview(), refreshServerDatasets()]);
    } catch (err) {
      setActionBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Lưu tài liệu PDF thất bại.',
      });
    } finally {
      setSavingPdf(false);
    }
  };

  const handleDeletePdf = async (docId: string) => {
    setActionBanner(null);
    try {
      await deletePdfReferenceDocument(docId);
      setActionBanner({
        type: 'success',
        message: `Đã xóa mục tài liệu PDF (${docId}) khỏi danh mục.`,
      });
      await Promise.all([loadOverview(), refreshServerDatasets()]);
    } catch (err) {
      setActionBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Xóa tài liệu PDF thất bại.',
      });
    }
  };

  const templateSpec = getDatasetTemplateSpec(selectedKind);

  return (
    <div className="space-y-6">
      {/* Status Banner */}
      {actionBanner && (
        <div
          role="status"
          className={`rounded-md border px-4 py-3 text-sm flex items-start gap-2.5 ${
            actionBanner.type === 'success'
              ? 'border-[#B8DEC9] bg-[#ECF7F2] text-[#0B5D3F]'
              : 'border-[#E8B8BC] bg-[#FDF2F3] text-[#641016]'
          }`}
        >
          {actionBanner.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-[#9D1D26]" />
          )}
          <span className="leading-relaxed">{actionBanner.message}</span>
        </div>
      )}

      {overviewError && (
        <div
          role="alert"
          className="rounded-md border border-[#E8B8BC] bg-[#FDF2F3] px-4 py-3 text-sm text-[#641016] flex items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-[#9D1D26]" />
            <span>{overviewError}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadOverview()}
            className="banking-btn-secondary !min-h-[34px] !px-3 !text-xs shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Tải lại
          </button>
        </div>
      )}

      {/* 1. Active Datasets Overview on Cloud Firestore */}
      <section className="banking-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="banking-section-title flex items-center gap-2">
              <Database className="h-4 w-4 text-[#9D1D26]" />
              Trạng thái Kho dữ liệu Cloud Firestore ({firestoreDatabaseId})
            </h2>
            <p className="text-xs text-[#6B7280] mt-0.5">
              Dữ liệu đang kích hoạt tại collection <code className="font-mono">/active_versions</code> được hiển thị công khai trên trang tra cứu.
            </p>
          </div>
          <button
            type="button"
            disabled={loadingOverview}
            onClick={() => void loadOverview()}
            className="banking-btn-secondary !min-h-[36px] !px-3 !text-[13px]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingOverview ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {ALL_DATASET_KINDS.map((kind) => {
            const ptr = overview?.activePointers[kind] ?? null;
            const totalVersions = overview?.versions[kind]?.length ?? 0;
            return (
              <div
                key={kind}
                className="rounded-md border border-[#E2E5E9] bg-[#F8F9FA] p-3.5 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#1F2429]">
                    {getKindLabel(kind)}
                  </span>
                  <span className="text-[11px] font-mono text-[#6B7280]">
                    {totalVersions} phiên bản
                  </span>
                </div>
                {ptr ? (
                  <>
                    <div className="banking-figure text-xl font-bold text-[#0B5D3F]">
                      {ptr.rowCount.toLocaleString('vi-VN')} dòng
                    </div>
                    <div className="text-xs text-[#4B5563] truncate" title={ptr.versionLabel}>
                      {ptr.versionLabel}
                    </div>
                    <div className="text-[11px] text-[#6B7280] flex items-center gap-2">
                      <span className="inline-flex items-center gap-0.5">
                        <MapPin className="h-3 w-3" />
                        {ptr.spatialRecordsCount} GPS
                      </span>
                      <span>· {ptr.effectiveDate}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="banking-figure text-lg font-semibold text-[#6B7280]">
                      Chưa kích hoạt
                    </div>
                    <div className="text-xs text-[#6B7280]">
                      Chưa có phiên bản chính thức
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 2. Staging-First Import Panel */}
      <section className="banking-card p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E2E5E9] pb-4">
          <div>
            <h2 className="banking-section-title flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-[#9D1D26]" />
              Nạp bộ dữ liệu mới (Staging-First &amp; Xác minh nguyên tử)
            </h2>
            <p className="text-xs text-[#6B7280] mt-0.5">
              Dữ liệu được kiểm lỗi trước khi nạp, ghi theo lô ≤ 400 bản ghi vào trạng thái staging, đối chiếu đủ số dòng trên máy chủ rồi mới kích hoạt.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void downloadExcelTemplate(selectedKind)}
              className="banking-btn-secondary !min-h-[36px] !px-3 !text-xs"
            >
              <Download className="h-3.5 w-3.5" />
              Tải mẫu Excel
            </button>
            <button
              type="button"
              onClick={() => downloadJsonTemplate(selectedKind)}
              className="banking-btn-secondary !min-h-[36px] !px-3 !text-xs"
            >
              <Download className="h-3.5 w-3.5" />
              Tải mẫu JSON
            </button>
          </div>
        </div>

        {/* Dataset Kind Tabs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {DATASET_KIND_OPTIONS.map((opt) => (
            <button
              key={opt.kind}
              type="button"
              disabled={committing}
              onClick={() => handleKindChange(opt.kind)}
              className={`px-3 py-2.5 rounded-md border text-xs font-semibold text-left transition-colors cursor-pointer ${
                selectedKind === opt.kind
                  ? 'border-[#9D1D26] bg-[#FDF2F3] text-[#9D1D26]'
                  : 'border-[#E2E5E9] bg-white text-[#4B5563] hover:bg-[#F8F9FA]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Provenance Metadata Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label htmlFor="adm-ver-label" className="banking-label">
              Nhãn phiên bản
            </label>
            <input
              id="adm-ver-label"
              value={versionLabel}
              onChange={(e) => setVersionLabel(e.target.value)}
              placeholder={`VD: ${getKindLabel(selectedKind)} 2026 v1`}
              className="banking-input"
            />
          </div>
          <div>
            <label htmlFor="adm-source-doc" className="banking-label">
              Văn bản / Nguồn dữ liệu *
            </label>
            <input
              id="adm-source-doc"
              value={sourceDocumentName}
              onChange={(e) => setSourceDocumentName(e.target.value)}
              placeholder="Tên Nghị quyết / Báo cáo nguồn"
              className="banking-input"
            />
          </div>
          <div>
            <label htmlFor="adm-eff-date" className="banking-label">
              Ngày hiệu lực / Khảo sát *
            </label>
            <input
              id="adm-eff-date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              placeholder="01/01/2026"
              className="banking-input"
            />
          </div>
          <div>
            <label htmlFor="adm-notes" className="banking-label">
              Ghi chú phiên bản
            </label>
            <input
              id="adm-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="VD: Phạm vi Huyện Khánh Sơn"
              className="banking-input"
            />
          </div>
        </div>

        {/* File Picker */}
        <div className="rounded-md border border-dashed border-[#CBD2D9] bg-[#F8F9FA] p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-xs text-[#4B5563] space-y-1">
            <div className="font-semibold text-[#1F2429]">
              Chọn tệp Excel (.xlsx), CSV hoặc JSON cho nhóm {getKindLabel(selectedKind)}
            </div>
            <div>
              Cột chuẩn gợi ý: <span className="font-mono">{templateSpec.headers.slice(0, 6).join(', ')}…</span>
            </div>
          </div>
          <label className="banking-btn-primary cursor-pointer shrink-0 !min-h-[40px]">
            {parsingFile ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            <span>{parsingFile ? 'Đang phân tích tệp...' : 'Chọn tệp để kiểm lỗi'}</span>
            <input
              type="file"
              accept=".xlsx,.csv,.json"
              disabled={parsingFile || committing}
              onChange={(e) => void handleFileUpload(e)}
              className="hidden"
            />
          </label>
        </div>

        {parseError && (
          <div className="rounded-md border border-[#E8B8BC] bg-[#FDF2F3] px-3.5 py-2.5 text-[13px] text-[#641016]">
            {parseError}
          </div>
        )}

        {/* Import Preview & Validation Result */}
        {preview && (
          <div className="rounded-md border border-[#E2E5E9] bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-[#1F2429]">
                Kết quả kiểm lỗi: {preview.fileName}
                {preview.selectedSheetName ? ` (Sheet: ${preview.selectedSheetName})` : ''}
              </div>
              <span
                className={`text-xs font-semibold ${
                  preview.canCommit ? 'text-[#0B5D3F]' : 'text-[#9D1D26]'
                }`}
              >
                {preview.canCommit ? 'Đạt điều kiện nạp Firestore' : 'Cần xử lý lỗi trước khi nạp'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              <div className="rounded border border-[#E2E5E9] bg-[#F8F9FA] p-2.5">
                <div className="text-[#6B7280]">Tổng dòng đọc</div>
                <div className="mt-0.5 font-mono text-sm font-bold text-[#1F2429]">
                  {preview.totalRows.toLocaleString('vi-VN')}
                </div>
              </div>
              <div className="rounded border border-[#E2E5E9] bg-[#F8F9FA] p-2.5">
                <div className="text-[#6B7280]">Bản ghi hợp lệ</div>
                <div className="mt-0.5 font-mono text-sm font-bold text-[#0B5D3F]">
                  {preview.validRows.length.toLocaleString('vi-VN')}
                </div>
              </div>
              <div className="rounded border border-[#E2E5E9] bg-[#F8F9FA] p-2.5">
                <div className="text-[#6B7280]">Có tọa độ GPS</div>
                <div className="mt-0.5 font-mono text-sm font-bold text-[#1F2429]">
                  {(preview.validSpatialCount ?? 0).toLocaleString('vi-VN')}
                </div>
              </div>
              <div className="rounded border border-[#E2E5E9] bg-[#F8F9FA] p-2.5">
                <div className="text-[#6B7280]">Lỗi / Cảnh báo</div>
                <div className="mt-0.5 font-mono text-sm font-bold text-[#9D1D26]">
                  {preview.issues.filter((i) => i.severity === 'error').length} /{' '}
                  {preview.issues.filter((i) => i.severity === 'warning').length}
                </div>
              </div>
            </div>

            {preview.missingRequiredColumns.length > 0 && (
              <div className="text-xs text-[#9D1D26]">
                Thiếu cột bắt buộc: {preview.missingRequiredColumns.join(', ')}
              </div>
            )}

            {preview.issues.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded border border-[#E2E5E9] bg-[#F8F9FA] p-2.5 space-y-1 text-xs">
                {preview.issues.slice(0, 25).map((issue, idx) => (
                  <div
                    key={`${issue.rowNumber}-${idx}`}
                    className={
                      issue.severity === 'error' ? 'text-[#9D1D26]' : 'text-[#784A0A]'
                    }
                  >
                    Dòng {issue.rowNumber} [{issue.field}]: {issue.message}
                  </div>
                ))}
                {preview.issues.length > 25 && (
                  <div className="text-[#6B7280]">
                    … và {preview.issues.length - 25} cảnh báo/lỗi khác.
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-[#E2E5E9]">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-[#1F2429] cursor-pointer">
                <input
                  type="checkbox"
                  checked={activateImmediately}
                  onChange={(e) => setActivateImmediately(e.target.checked)}
                  className="h-4 w-4 accent-[#0B5D3F]"
                />
                Kích hoạt công khai ngay sau khi xác minh đủ 100% số dòng trên Cloud Firestore
              </label>

              <button
                type="button"
                disabled={!preview.canCommit || committing}
                onClick={() => void handleCommitToFirestore()}
                className="banking-btn-primary shrink-0"
              >
                {committing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Database className="h-4 w-4" />
                )}
                <span>
                  {committing
                    ? 'Đang nạp lên Cloud Firestore...'
                    : `Nạp ${preview.validRows.length.toLocaleString('vi-VN')} bản ghi vào Firestore`}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Batch Upload Progress Indicator */}
        {progress && (
          <div className="rounded-md border border-[#D4E4DC] bg-[#F2F8F5] p-3.5 space-y-2 text-xs text-[#174632]">
            <div className="flex items-center justify-between gap-2 font-medium">
              <span>{progress.message}</span>
              <span className="font-mono">
                {progress.writtenRows}/{progress.totalRows}
              </span>
            </div>
            <div className="h-2 w-full rounded bg-white overflow-hidden border border-[#D4E4DC]">
              <div
                className="h-full bg-[#0B5D3F] transition-all duration-200"
                style={{
                  width: `${
                    progress.totalRows > 0
                      ? Math.min(100, Math.round((progress.writtenRows / progress.totalRows) * 100))
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        )}
      </section>

      {/* 3. Version History, Rollback & JSON Backup */}
      <section className="banking-card p-5 space-y-4">
        <div>
          <h2 className="banking-section-title flex items-center gap-2">
            <History className="h-4 w-4 text-[#9D1D26]" />
            Lịch sử phiên bản, Khôi phục (Rollback) &amp; Sao lưu JSON
          </h2>
          <p className="text-xs text-[#6B7280] mt-0.5">
            Các phiên bản đã xác nhận (committed) là bất biến và không bị xóa vĩnh viễn để bảo toàn dấu vết kiểm toán.
          </p>
        </div>

        <div className="space-y-4">
          {ALL_DATASET_KINDS.map((kind) => {
            const list = overview?.versions[kind] ?? [];
            return (
              <div key={kind} className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
                  {getKindLabel(kind)} ({list.length})
                </div>
                {list.length === 0 ? (
                  <div className="rounded-md border border-[#E2E5E9] bg-[#F8F9FA] px-3.5 py-2.5 text-xs text-[#6B7280]">
                    Chưa có phiên bản nào được lưu trên Cloud Firestore cho nhóm này.
                  </div>
                ) : (
                  <div className="divide-y divide-[#E2E5E9] rounded-md border border-[#E2E5E9] overflow-hidden">
                    {list.map((ver) => {
                      const isBusyRow = busyVersionId === ver.versionId;
                      const canSwitch = ver.commitState === 'committed' && !ver.isActive;
                      return (
                        <div
                          key={ver.versionId}
                          className="p-3.5 bg-white flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-[#1F2429]">
                                {ver.versionLabel}
                              </span>
                              {ver.isActive && (
                                <span className="text-[11px] font-semibold text-[#0B5D3F] bg-[#ECF7F2] border border-[#B8DEC9] px-2 py-0.5 rounded">
                                  Đang kích hoạt
                                </span>
                              )}
                              {ver.commitState !== 'committed' && (
                                <span className="text-[11px] font-semibold text-[#9D1D26] bg-[#FDF2F3] border border-[#E8B8BC] px-2 py-0.5 rounded">
                                  {ver.commitState === 'staging' ? 'Staging (chưa xác nhận)' : 'Aborted (đã hủy)'}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-[#4B5563] flex flex-wrap gap-x-3 gap-y-0.5">
                              <span className="font-mono">{ver.versionId}</span>
                              <span>
                                {ver.verifiedRowCount.toLocaleString('vi-VN')}/
                                {ver.expectedRowCount.toLocaleString('vi-VN')} dòng ({ver.spatialRecordsCount} GPS)
                              </span>
                              <span>Hiệu lực: {ver.effectiveDate}</span>
                              <span>Nạp lúc: {formatDateTimeVi(ver.importedAt)}</span>
                            </div>
                            <div className="text-[11px] text-[#6B7280] flex flex-wrap gap-x-3 gap-y-0.5">
                              <span>Nguồn: {ver.sourceDocumentName}</span>
                              {ver.payloadChecksum && (
                                <span className="font-mono">
                                  SHA-256: {ver.payloadChecksum.slice(0, 12)}…
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {canSwitch && (
                              <button
                                type="button"
                                disabled={isBusyRow}
                                onClick={() =>
                                  void handleActivateOrRollback(
                                    ver,
                                    overview?.activePointers[kind] ? 'rollback' : 'activate'
                                  )
                                }
                                className="banking-btn-secondary !min-h-[34px] !px-3 !text-xs"
                              >
                                {isBusyRow ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-3.5 w-3.5" />
                                )}
                                {overview?.activePointers[kind] ? 'Khôi phục phiên bản này' : 'Kích hoạt'}
                              </button>
                            )}
                            {ver.commitState === 'committed' && (
                              <button
                                type="button"
                                disabled={isBusyRow}
                                onClick={() => void handleExportJsonBackup(ver)}
                                className="banking-btn-secondary !min-h-[34px] !px-3 !text-xs"
                              >
                                <Download className="h-3.5 w-3.5" />
                                Xuất JSON
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 4. Immutable Activation & Rollback Audit Log */}
      <section className="banking-card p-5 space-y-3">
        <div>
          <h2 className="banking-section-title">
            Nhật ký kích hoạt &amp; khôi phục (/activation_history)
          </h2>
          <p className="text-xs text-[#6B7280] mt-0.5">
            Ghi nhận nguyên tử mọi sự kiện chuyển phiên bản đang hoạt động (chỉ ghi nối tiếp, không sửa/xóa).
          </p>
        </div>

        {(overview?.activationHistory.length ?? 0) === 0 ? (
          <div className="rounded-md border border-[#E2E5E9] bg-[#F8F9FA] px-3.5 py-3 text-xs text-[#6B7280]">
            Chưa có sự kiện kích hoạt hoặc khôi phục nào.
          </div>
        ) : (
          <div className="divide-y divide-[#E2E5E9] rounded-md border border-[#E2E5E9] max-h-64 overflow-y-auto">
            {overview!.activationHistory.slice(0, 30).map((evt) => (
              <div
                key={evt.eventId}
                className="p-3 bg-white text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5"
              >
                <div className="space-y-0.5">
                  <div className="font-semibold text-[#1F2429]">
                    [{evt.action === 'rollback' ? 'KHÔI PHỤC' : 'KÍCH HOẠT'}]{' '}
                    {getKindLabel(evt.datasetKind)}:{' '}
                    <span className="font-mono text-[#6B7280]">
                      {evt.fromVersionId || '(chưa có)'}
                    </span>{' '}
                    → <span className="font-mono text-[#0B5D3F]">{evt.toVersionId}</span>
                  </div>
                  {evt.reason && <div className="text-[#4B5563]">{evt.reason}</div>}
                </div>
                <div className="text-[11px] text-[#6B7280] sm:text-right shrink-0">
                  <div>{evt.actorEmail}</div>
                  <div className="font-mono">{formatDateTimeVi(evt.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 5. PDF Source Metadata Catalog (/pdf_documents) */}
      <section className="banking-card p-5 space-y-4">
        <div>
          <h2 className="banking-section-title flex items-center gap-2">
            <FileText className="h-4 w-4 text-[#9D1D26]" />
            Danh mục tài liệu PDF nguồn (/pdf_documents)
          </h2>
          <p className="text-xs text-[#6B7280] mt-0.5">
            Chỉ lưu siêu dữ liệu văn bản pháp lý &amp; phụ lục trên Cloud Firestore (không dùng Firebase Storage).
          </p>
        </div>

        <form onSubmit={(e) => void handleSavePdfMetadata(e)} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="pdf-title" className="banking-label">
              Tên văn bản / Báo cáo *
            </label>
            <input
              id="pdf-title"
              required
              value={pdfTitle}
              onChange={(e) => setPdfTitle(e.target.value)}
              placeholder="VD: Nghị quyết 15/2025/NQ-HĐND"
              className="banking-input"
            />
          </div>
          <div>
            <label htmlFor="pdf-filename" className="banking-label">
              Tên tệp PDF *
            </label>
            <div className="flex gap-1.5">
              <input
                id="pdf-filename"
                required
                value={pdfFileName}
                onChange={(e) => setPdfFileName(e.target.value)}
                placeholder="NQ15_2025_KhanhHoa.pdf"
                className="banking-input flex-1"
              />
              <label className="banking-btn-secondary !min-h-[40px] !px-2.5 cursor-pointer shrink-0">
                <Upload className="h-3.5 w-3.5" />
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handlePdfFilePick}
                  className="hidden"
                />
              </label>
            </div>
          </div>
          <div>
            <label htmlFor="pdf-cat" className="banking-label">
              Phân loại tài liệu
            </label>
            <select
              id="pdf-cat"
              value={pdfCategory}
              onChange={(e) =>
                setPdfCategory(e.target.value as PdfReferenceDocument['documentCategory'])
              }
              className="banking-input"
            >
              <option value="bang_gia_nha_nuoc">Bảng giá đất Nhà nước</option>
              <option value="bao_cao_ecovis">Báo cáo ECOVIS</option>
              <option value="quy_dinh_he_so_k">Quy định Hệ số K</option>
              <option value="khac">Tài liệu tham khảo khác</option>
            </select>
          </div>
          <div>
            <label htmlFor="pdf-eff" className="banking-label">
              Ngày hiệu lực / Ban hành
            </label>
            <input
              id="pdf-eff"
              value={pdfEffectiveDate}
              onChange={(e) => setPdfEffectiveDate(e.target.value)}
              placeholder="01/01/2026"
              className="banking-input"
            />
          </div>
          <div>
            <label htmlFor="pdf-pages" className="banking-label">
              Số trang
            </label>
            <input
              id="pdf-pages"
              type="number"
              min={1}
              max={50000}
              value={pdfPageCount}
              onChange={(e) => setPdfPageCount(e.target.value)}
              placeholder="VD: 248"
              className="banking-input font-mono"
            />
          </div>
          <div>
            <label htmlFor="pdf-note" className="banking-label">
              Ghi chú phụ lục
            </label>
            <input
              id="pdf-note"
              value={pdfAppendixNote}
              onChange={(e) => setPdfAppendixNote(e.target.value)}
              placeholder="VD: Trang 235–241 Khánh Sơn"
              className="banking-input"
            />
          </div>
          <div className="sm:col-span-3 flex justify-end">
            <button type="submit" disabled={savingPdf} className="banking-btn-primary">
              {savingPdf && <Loader2 className="h-4 w-4 animate-spin" />}
              Lưu danh mục tài liệu PDF
            </button>
          </div>
        </form>

        {(overview?.pdfDocuments.length ?? 0) > 0 && (
          <div className="divide-y divide-[#E2E5E9] rounded-md border border-[#E2E5E9]">
            {overview!.pdfDocuments.map((pdf) => (
              <div
                key={pdf.id}
                className="p-3 bg-white flex items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="font-semibold text-[#1F2429] truncate">{pdf.documentTitle}</div>
                  <div className="text-[#6B7280] flex flex-wrap gap-x-3">
                    <span className="font-mono">{pdf.fileName}</span>
                    {pdf.effectiveDate && <span>Hiệu lực: {pdf.effectiveDate}</span>}
                    {pdf.pageCount && <span>{pdf.pageCount} trang</span>}
                    {pdf.appendixNote && <span>{pdf.appendixNote}</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDeletePdf(pdf.id)}
                  className="text-[#9D1D26] hover:bg-[#FDF2F3] p-2 rounded cursor-pointer shrink-0"
                  title="Xóa mục tài liệu"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
