import { constants as fsConstants } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  DatasetKind,
  DatasetVersionMetadata,
  EcovisRecord,
  KFactorRuleRecord,
  MarketListingRecord,
  PdfReferenceDocument,
  StateLandPriceRecord,
} from '../src/types/valuation.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ALLOWED_DATASET_KINDS: readonly DatasetKind[] = [
  'state_price',
  'ecovis',
  'k_factor_rules',
  'market_survey',
] as const;

export const MAX_RECORDS_PER_VERSION = 20000;
const VERSION_ID_REGEX = /^[a-zA-Z0-9_-]{3,80}$/;
const DOC_ID_REGEX = /^[a-zA-Z0-9_-]{3,80}$/;

const ALLOWED_PDF_CATEGORIES: readonly PdfReferenceDocument['documentCategory'][] = [
  'bang_gia_nha_nuoc',
  'bao_cao_ecovis',
  'quy_dinh_he_so_k',
  'khac',
] as const;

export interface StoredDatasetVersion<T> {
  meta: DatasetVersionMetadata;
  records: T[];
}

export interface StoredVersionBucket<T> {
  activeVersionId: string | null;
  versions: StoredDatasetVersion<T>[];
}

export interface PersistedDatasetsStore {
  schemaVersion: 1;
  updatedAt: string;
  statePrice: StoredVersionBucket<StateLandPriceRecord>;
  ecovis: StoredVersionBucket<EcovisRecord>;
  kFactorRules: StoredVersionBucket<KFactorRuleRecord>;
  marketSurvey: StoredVersionBucket<MarketListingRecord>;
  pdfDocuments: Omit<PdfReferenceDocument, 'sessionObjectUrl'>[];
}

export interface ActiveDatasetsPublicResponse {
  storageBackend: 'server_json_file';
  updatedAt: string;
  active: {
    statePrice: { meta: DatasetVersionMetadata | null; records: StateLandPriceRecord[] };
    ecovis: { meta: DatasetVersionMetadata | null; records: EcovisRecord[] };
    kFactorRules: { meta: DatasetVersionMetadata | null; records: KFactorRuleRecord[] };
    marketSurvey: { meta: DatasetVersionMetadata | null; records: MarketListingRecord[] };
  };
  pdfDocuments: Omit<PdfReferenceDocument, 'sessionObjectUrl'>[];
}

export interface AdminDatasetsOverviewResponse {
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

export function isValidDatasetKind(value: unknown): value is DatasetKind {
  return typeof value === 'string' && (ALLOWED_DATASET_KINDS as readonly string[]).includes(value);
}

function createEmptyBucket<T>(): StoredVersionBucket<T> {
  return {
    activeVersionId: null,
    versions: [],
  };
}

export function createEmptyDatasetsStore(): PersistedDatasetsStore {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    statePrice: createEmptyBucket<StateLandPriceRecord>(),
    ecovis: createEmptyBucket<EcovisRecord>(),
    kFactorRules: createEmptyBucket<KFactorRuleRecord>(),
    marketSurvey: createEmptyBucket<MarketListingRecord>(),
    pdfDocuments: [],
  };
}

function cleanString(value: unknown, maxLen = 500): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function sanitizeSafeUrl(value: unknown): string {
  const raw = cleanString(value, 1000);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return '';
  } catch {
    return '';
  }
}

function hasDemoMarkerText(value: string): boolean {
  const upper = value.toUpperCase();
  return upper.includes('[DEMO') || upper.startsWith('DEMO-');
}

function normalizeAsciiVi(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

function claimsCompletedTransactionPrice(text: string): boolean {
  const norm = normalizeAsciiVi(text);
  if (!norm) return false;
  if (
    norm.includes('khong phai gia giao dich') ||
    norm.includes('khong phai giao dich') ||
    norm.includes('not transaction') ||
    norm.includes('not a completed transaction')
  ) {
    return false;
  }
  return /\b(gia giao dich|da giao dich|giao dich thanh cong|da ban|gia chot|chot giao dich|completed transaction|sold price)\b/.test(
    norm
  );
}

function validateOptionalCoordinates(
  rawLat: unknown,
  rawLng: unknown,
  rowIndex: number
): { latitude: number | null; longitude: number | null; error?: string } {
  const latEmpty = rawLat === undefined || rawLat === null || rawLat === '';
  const lngEmpty = rawLng === undefined || rawLng === null || rawLng === '';

  if (latEmpty && lngEmpty) {
    return { latitude: null, longitude: null };
  }
  if (latEmpty !== lngEmpty) {
    return {
      latitude: null,
      longitude: null,
      error: `Dòng ${rowIndex + 1}: Tọa độ không gian phải có đủ cả Vĩ độ (latitude) và Kinh độ (longitude), hoặc cùng để trống.`,
    };
  }

  const lat = typeof rawLat === 'number' ? rawLat : Number(rawLat);
  const lng = typeof rawLng === 'number' ? rawLng : Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return {
      latitude: null,
      longitude: null,
      error: `Dòng ${rowIndex + 1}: Giá trị tọa độ GPS không phải là số hợp lệ.`,
    };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return {
      latitude: null,
      longitude: null,
      error: `Dòng ${rowIndex + 1}: Tọa độ GPS vượt phạm vi hợp lệ WGS84 (vĩ độ [-90, 90], kinh độ [-180, 180]).`,
    };
  }
  return {
    latitude: Number(lat.toFixed(7)),
    longitude: Number(lng.toFixed(7)),
  };
}

export interface ValidatedVersionPayload {
  meta: DatasetVersionMetadata;
  records: StateLandPriceRecord[] | EcovisRecord[] | KFactorRuleRecord[] | MarketListingRecord[];
}

export function validateIncomingDatasetVersion(
  kind: DatasetKind,
  rawMeta: unknown,
  rawRecords: unknown,
  adminEmail: string
): { ok: true; data: ValidatedVersionPayload } | { ok: false; error: string } {
  if (!rawMeta || typeof rawMeta !== 'object') {
    return { ok: false, error: 'Thiếu thông tin siêu dữ liệu phiên bản (meta).' };
  }
  if (!Array.isArray(rawRecords) || rawRecords.length === 0) {
    return { ok: false, error: 'Danh sách bản ghi (records) không được rỗng.' };
  }
  if (rawRecords.length > MAX_RECORDS_PER_VERSION) {
    return {
      ok: false,
      error: `Số lượng bản ghi vượt giới hạn tối đa ${MAX_RECORDS_PER_VERSION.toLocaleString('vi-VN')} dòng mỗi phiên bản.`,
    };
  }

  const metaObj = rawMeta as Record<string, unknown>;
  const requestedVersionId = cleanString(metaObj.versionId, 80);
  const versionId =
    requestedVersionId && VERSION_ID_REGEX.test(requestedVersionId)
      ? requestedVersionId
      : `ver-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const nowIso = new Date().toISOString();
  const importedAt = cleanString(metaObj.importedAt, 64) || nowIso;
  const sourceDocumentName = cleanString(metaObj.sourceDocumentName, 300) || kind;
  const sourceFileName = cleanString(metaObj.sourceFileName, 260) || 'dataset.json';
  const versionLabel =
    cleanString(metaObj.versionLabel, 240) ||
    `Phiên bản ${nowIso.slice(0, 10)} (${rawRecords.length} dòng)`;
  const effectiveDate = cleanString(metaObj.effectiveDate, 64) || 'Chưa ghi ngày hiệu lực';
  const notes = cleanString(metaObj.notes, 600);

  const seenCodes = new Set<string>();
  let spatialRecordsCount = 0;

  if (kind === 'state_price') {
    const validated: StateLandPriceRecord[] = [];
    for (let i = 0; i < rawRecords.length; i++) {
      const item = rawRecords[i] as Record<string, unknown> | null;
      if (!item || typeof item !== 'object') {
        return { ok: false, error: `Dòng ${i + 1}: Cấu trúc bản ghi không hợp lệ.` };
      }
      if (item.isDemo === true) {
        return { ok: false, error: `Dòng ${i + 1}: Không được phép nạp bản ghi gắn cờ DEMO vào dữ liệu thật.` };
      }
      const recordCode = cleanString(item.recordCode, 120);
      const wardCommune = cleanString(item.wardCommune, 160);
      const streetName = cleanString(item.streetName, 240);
      const landType = cleanString(item.landType, 160);
      const position = cleanString(item.position, 160);
      const sourcePageOrAppendix = cleanString(item.sourcePageOrAppendix, 200);
      const legalDocumentName = cleanString(item.legalDocumentName, 300) || sourceDocumentName;
      const unitPrice = Number(item.unitPrice);

      if (!recordCode || !wardCommune || !streetName || !landType || !position || !sourcePageOrAppendix) {
        return {
          ok: false,
          error: `Dòng ${i + 1}: Thiếu trường bắt buộc của Bảng giá đất Nhà nước (mã, xã/phường, tuyến đường, loại đất, vị trí, trang/phụ lục).`,
        };
      }
      if (hasDemoMarkerText(recordCode) || hasDemoMarkerText(legalDocumentName) || hasDemoMarkerText(streetName)) {
        return { ok: false, error: `Dòng ${i + 1}: Bản ghi chứa dấu hiệu [DEMO] không được phép nạp vào kho dữ liệu thật.` };
      }
      if (seenCodes.has(recordCode)) {
        return { ok: false, error: `Dòng ${i + 1}: Trùng mã dữ liệu "${recordCode}".` };
      }
      seenCodes.add(recordCode);

      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        return { ok: false, error: `Dòng ${i + 1}: Đơn giá (${String(item.unitPrice)}) không hợp lệ hoặc <= 0.` };
      }

      const coords = validateOptionalCoordinates(item.latitude, item.longitude, i);
      if (coords.error) return { ok: false, error: coords.error };
      if (coords.latitude !== null && coords.longitude !== null) spatialRecordsCount += 1;

      validated.push({
        id: `state-${versionId}-${i + 1}`,
        recordCode,
        legalDocumentName,
        wardCommune,
        districtCity: cleanString(item.districtCity, 160),
        streetName,
        roadSegment: cleanString(item.roadSegment, 300),
        startPoint: cleanString(item.startPoint, 200),
        endPoint: cleanString(item.endPoint, 200),
        landType,
        position,
        unitPrice,
        unit: cleanString(item.unit, 40) || 'VNĐ/m²',
        sourcePageOrAppendix,
        effectiveDate: cleanString(item.effectiveDate, 64) || effectiveDate,
        importedAt,
        versionId,
        latitude: coords.latitude,
        longitude: coords.longitude,
        coordinateNote: cleanString(item.coordinateNote, 240) || undefined,
        isDemo: false,
      });
    }

    return {
      ok: true,
      data: {
        meta: {
          versionId,
          datasetKind: kind,
          versionLabel,
          sourceDocumentName,
          sourceFileName,
          effectiveDate,
          importedAt,
          rowCount: validated.length,
          spatialRecordsCount,
          notes,
          isActive: true,
          importedByEmail: adminEmail,
        },
        records: validated,
      },
    };
  }

  if (kind === 'ecovis') {
    const validated: EcovisRecord[] = [];
    for (let i = 0; i < rawRecords.length; i++) {
      const item = rawRecords[i] as Record<string, unknown> | null;
      if (!item || typeof item !== 'object') {
        return { ok: false, error: `Dòng ${i + 1}: Cấu trúc bản ghi ECOVIS không hợp lệ.` };
      }
      if (item.isDemo === true) {
        return { ok: false, error: `Dòng ${i + 1}: Không được phép nạp bản ghi gắn cờ DEMO vào dữ liệu thật.` };
      }
      const recordCode = cleanString(item.recordCode, 120);
      const streetName = cleanString(item.streetName, 240);
      const landType = cleanString(item.landType, 160);
      const appendixAndPage = cleanString(item.appendixAndPage, 200);
      const sourceDocument =
        cleanString(item.sourceDocument, 300) ||
        (cleanString(metaObj.sourceDocumentName, 300) || '');
      const surveyUnitPrice = Number(item.surveyUnitPrice);

      if (!recordCode || !streetName || !landType || !appendixAndPage || !sourceDocument) {
        return {
          ok: false,
          error: `Dòng ${i + 1}: Thiếu trường bắt buộc của dữ liệu ECOVIS (mã, tuyến đường, loại đất, nguồn tài liệu, phụ lục & trang).`,
        };
      }
      if (hasDemoMarkerText(recordCode) || hasDemoMarkerText(sourceDocument) || hasDemoMarkerText(streetName)) {
        return { ok: false, error: `Dòng ${i + 1}: Bản ghi chứa dấu hiệu [DEMO] không được phép nạp vào kho dữ liệu thật.` };
      }
      if (seenCodes.has(recordCode)) {
        return { ok: false, error: `Dòng ${i + 1}: Trùng mã dữ liệu ECOVIS "${recordCode}".` };
      }
      seenCodes.add(recordCode);

      if (!Number.isFinite(surveyUnitPrice) || surveyUnitPrice <= 0) {
        return { ok: false, error: `Dòng ${i + 1}: Đơn giá khảo sát ECOVIS không hợp lệ hoặc <= 0.` };
      }

      const coords = validateOptionalCoordinates(item.latitude, item.longitude, i);
      if (coords.error) return { ok: false, error: coords.error };
      if (coords.latitude !== null && coords.longitude !== null) spatialRecordsCount += 1;

      validated.push({
        id: `eco-${versionId}-${i + 1}`,
        recordCode,
        wardCommune: cleanString(item.wardCommune, 160),
        districtCity: cleanString(item.districtCity, 160),
        streetName,
        roadSegment: cleanString(item.roadSegment, 300),
        landType,
        position: cleanString(item.position, 160) || 'Chưa ghi rõ',
        surveyUnitPrice,
        unit: cleanString(item.unit, 40) || 'VNĐ/m²',
        sourceDocument,
        appendixAndPage,
        surveyOrReportDate: cleanString(item.surveyOrReportDate, 64) || effectiveDate,
        importedAt,
        versionId,
        latitude: coords.latitude,
        longitude: coords.longitude,
        coordinateNote: cleanString(item.coordinateNote, 240) || undefined,
        isDemo: false,
      });
    }

    return {
      ok: true,
      data: {
        meta: {
          versionId,
          datasetKind: kind,
          versionLabel,
          sourceDocumentName,
          sourceFileName,
          effectiveDate,
          importedAt,
          rowCount: validated.length,
          spatialRecordsCount,
          notes,
          isActive: true,
          importedByEmail: adminEmail,
        },
        records: validated,
      },
    };
  }

  if (kind === 'k_factor_rules') {
    const validated: KFactorRuleRecord[] = [];
    for (let i = 0; i < rawRecords.length; i++) {
      const item = rawRecords[i] as Record<string, unknown> | null;
      if (!item || typeof item !== 'object') {
        return { ok: false, error: `Dòng ${i + 1}: Cấu trúc bản ghi Hệ số K không hợp lệ.` };
      }
      if (item.isDemo === true) {
        return { ok: false, error: `Dòng ${i + 1}: Không được phép nạp bản ghi gắn cờ DEMO vào dữ liệu thật.` };
      }
      const ruleCode = cleanString(item.ruleCode, 120);
      const factorName = cleanString(item.factorName, 240);
      const formula = cleanString(item.formula, 300);
      const applicableCondition = cleanString(item.applicableCondition, 500);
      const sourcePage = cleanString(item.sourcePage, 200);
      const sourceDocument = cleanString(item.sourceDocument, 300) || sourceDocumentName;
      const factorValue = Number(item.factorValue);

      if (!ruleCode || !factorName || !formula || !applicableCondition || !sourcePage) {
        return {
          ok: false,
          error: `Dòng ${i + 1}: Thiếu trường bắt buộc của quy định Hệ số K (mã, tên, công thức, điều kiện, trang).`,
        };
      }
      if (hasDemoMarkerText(ruleCode) || hasDemoMarkerText(sourceDocument) || hasDemoMarkerText(factorName)) {
        return { ok: false, error: `Dòng ${i + 1}: Bản ghi chứa dấu hiệu [DEMO] không được phép nạp vào kho dữ liệu thật.` };
      }
      if (seenCodes.has(ruleCode)) {
        return { ok: false, error: `Dòng ${i + 1}: Trùng mã quy định Hệ số K "${ruleCode}".` };
      }
      seenCodes.add(ruleCode);

      if (!Number.isFinite(factorValue) || factorValue <= 0) {
        return { ok: false, error: `Dòng ${i + 1}: Giá trị Hệ số K phải là số dương hợp lệ.` };
      }

      validated.push({
        id: `krule-${versionId}-${i + 1}`,
        ruleCode,
        factorName,
        factorValue,
        formula,
        applicableCondition,
        requiredInputFields: cleanString(item.requiredInputFields, 300),
        sourceDocument,
        sourcePage,
        effectiveDate: cleanString(item.effectiveDate, 64) || effectiveDate,
        importedAt,
        versionId,
        isDemo: false,
      });
    }

    return {
      ok: true,
      data: {
        meta: {
          versionId,
          datasetKind: kind,
          versionLabel,
          sourceDocumentName,
          sourceFileName,
          effectiveDate,
          importedAt,
          rowCount: validated.length,
          spatialRecordsCount: 0,
          notes,
          isActive: true,
          importedByEmail: adminEmail,
        },
        records: validated,
      },
    };
  }

  // market_survey
  const validated: MarketListingRecord[] = [];
  for (let i = 0; i < rawRecords.length; i++) {
    const item = rawRecords[i] as Record<string, unknown> | null;
    if (!item || typeof item !== 'object') {
      return { ok: false, error: `Dòng ${i + 1}: Cấu trúc tin khảo sát thị trường không hợp lệ.` };
    }
    if (item.isDemo === true) {
      return { ok: false, error: `Dòng ${i + 1}: Không được phép nạp bản ghi gắn cờ DEMO vào dữ liệu thật.` };
    }
    const listingCode = cleanString(item.listingCode, 120);
    const sourceName = cleanString(item.sourceName, 200);
    const postedDate = cleanString(item.postedDate, 64);
    const address = cleanString(item.address, 360);
    const areaSqm = Number(item.areaSqm);
    const askingPriceVnd = Number(item.askingPriceVnd);

    if (!listingCode || !sourceName || !postedDate || !address) {
      return {
        ok: false,
        error: `Dòng ${i + 1}: Thiếu trường bắt buộc của tin khảo sát thị trường (mã tin, nguồn tin, ngày đăng, địa chỉ).`,
      };
    }
    if (hasDemoMarkerText(listingCode) || hasDemoMarkerText(sourceName) || hasDemoMarkerText(address)) {
      return { ok: false, error: `Dòng ${i + 1}: Bản ghi chứa dấu hiệu [DEMO] không được phép nạp vào kho dữ liệu thật.` };
    }
    const verificationNoteRaw = cleanString(item.verificationNote, 400);
    if (claimsCompletedTransactionPrice(verificationNoteRaw)) {
      return {
        ok: false,
        error: `Dòng ${i + 1}: Không được gán nhãn tin rao bán thị trường là giá giao dịch thực tế / đã bán.`,
      };
    }
    if (seenCodes.has(listingCode)) {
      return { ok: false, error: `Dòng ${i + 1}: Trùng mã tin khảo sát "${listingCode}".` };
    }
    seenCodes.add(listingCode);

    if (!Number.isFinite(areaSqm) || areaSqm <= 0) {
      return { ok: false, error: `Dòng ${i + 1}: Diện tích (m²) không hợp lệ hoặc <= 0.` };
    }
    if (!Number.isFinite(askingPriceVnd) || askingPriceVnd <= 0) {
      return { ok: false, error: `Dòng ${i + 1}: Giá rao bán (VNĐ) không hợp lệ hoặc <= 0.` };
    }

    const coords = validateOptionalCoordinates(item.latitude, item.longitude, i);
    if (coords.error) return { ok: false, error: coords.error };
    if (coords.latitude !== null && coords.longitude !== null) spatialRecordsCount += 1;

    const rawStatus = cleanString(item.verificationStatus, 40);
    const verificationStatus: MarketListingRecord['verificationStatus'] =
      rawStatus === 'da_xac_minh_so_bo' || rawStatus === 'loai_tru'
        ? rawStatus
        : 'chua_xac_minh';

    validated.push({
      id: `mkt-${versionId}-${i + 1}`,
      listingCode,
      sourceName,
      url: sanitizeSafeUrl(item.url),
      postedDate,
      address,
      wardCommune: cleanString(item.wardCommune, 160),
      areaSqm,
      askingPriceVnd,
      unitPricePerSqm: Math.round(askingPriceVnd / areaSqm),
      propertyType: cleanString(item.propertyType, 120) || 'Chưa phân loại',
      locationInfo: cleanString(item.locationInfo, 300),
      verificationStatus,
      verificationNote:
        verificationNoteRaw || 'Giá rao bán tham khảo (chưa xác minh – không phải giá giao dịch thực tế).',
      isDuplicate: false,
      duplicateOfId: null,
      createdAt: cleanString(item.createdAt, 64) || importedAt,
      latitude: coords.latitude,
      longitude: coords.longitude,
      coordinateNote: cleanString(item.coordinateNote, 240) || undefined,
      isDemo: false,
    });
  }

  return {
    ok: true,
    data: {
      meta: {
        versionId,
        datasetKind: kind,
        versionLabel,
        sourceDocumentName,
        sourceFileName,
        effectiveDate,
        importedAt,
        rowCount: validated.length,
        spatialRecordsCount,
        notes,
        isActive: true,
        importedByEmail: adminEmail,
      },
      records: validated,
    },
  };
}

export function validateIncomingPdfMetadata(
  raw: unknown
): { ok: true; data: Omit<PdfReferenceDocument, 'sessionObjectUrl'> } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Thông tin tài liệu PDF không hợp lệ.' };
  }
  const obj = raw as Record<string, unknown>;
  const fileName = cleanString(obj.fileName, 260);
  const documentTitle = cleanString(obj.documentTitle, 300);
  const category = cleanString(obj.documentCategory, 60) as PdfReferenceDocument['documentCategory'];
  const fileSizeBytes = Number(obj.fileSizeBytes);
  const rawId = cleanString(obj.id, 80);
  const id = rawId && DOC_ID_REGEX.test(rawId) ? rawId : `pdf-${Date.now()}`;

  if (!fileName || !documentTitle) {
    return { ok: false, error: 'Thiếu tên tệp hoặc tiêu đề tài liệu PDF.' };
  }
  if (!(ALLOWED_PDF_CATEGORIES as readonly string[]).includes(category)) {
    return { ok: false, error: 'Phân loại tài liệu PDF không hợp lệ.' };
  }
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes < 0) {
    return { ok: false, error: 'Kích thước tệp PDF không hợp lệ.' };
  }

  let pageCount: number | null = null;
  if (obj.pageCount !== null && obj.pageCount !== undefined && obj.pageCount !== '') {
    const parsedPages = Number(obj.pageCount);
    if (!Number.isInteger(parsedPages) || parsedPages <= 0 || parsedPages > 50000) {
      return { ok: false, error: 'Tổng số trang PDF không hợp lệ.' };
    }
    pageCount = parsedPages;
  }

  return {
    ok: true,
    data: {
      id,
      fileName,
      documentTitle,
      documentCategory: category,
      pageCount,
      effectiveDate: cleanString(obj.effectiveDate, 64),
      appendixNote: cleanString(obj.appendixNote, 500),
      fileSizeBytes,
      uploadedAt: cleanString(obj.uploadedAt, 64) || new Date().toISOString(),
    },
  };
}

function getBucketForKind(
  store: PersistedDatasetsStore,
  kind: DatasetKind
): StoredVersionBucket<StateLandPriceRecord | EcovisRecord | KFactorRuleRecord | MarketListingRecord> {
  if (kind === 'state_price') return store.statePrice as StoredVersionBucket<StateLandPriceRecord | EcovisRecord | KFactorRuleRecord | MarketListingRecord>;
  if (kind === 'ecovis') return store.ecovis as StoredVersionBucket<StateLandPriceRecord | EcovisRecord | KFactorRuleRecord | MarketListingRecord>;
  if (kind === 'k_factor_rules') return store.kFactorRules as StoredVersionBucket<StateLandPriceRecord | EcovisRecord | KFactorRuleRecord | MarketListingRecord>;
  return store.marketSurvey as StoredVersionBucket<StateLandPriceRecord | EcovisRecord | KFactorRuleRecord | MarketListingRecord>;
}

function resolveActiveBucket<T>(bucket: StoredVersionBucket<T>): {
  meta: DatasetVersionMetadata | null;
  records: T[];
} {
  if (!bucket.activeVersionId) return { meta: null, records: [] };
  const found = bucket.versions.find((v) => v.meta.versionId === bucket.activeVersionId);
  if (!found) return { meta: null, records: [] };
  return {
    meta: { ...found.meta, isActive: true },
    records: found.records,
  };
}

export function resolveDatasetStorePath(
  customFilePath?: string,
  envFilePath?: string
): string {
  const customTrimmed = customFilePath?.trim();
  if (customTrimmed) {
    return path.resolve(customTrimmed);
  }
  const envTrimmed = envFilePath?.trim();
  if (envTrimmed) {
    return path.resolve(envTrimmed);
  }
  return path.resolve(__dirname, '../data/datasets-store.json');
}

function createCodedError(code: string, message: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

/**
 * Server-side durable versioned Dataset Store (M1.2 / M4.1).
 * Reads path from DATA_STORE_PATH (e.g. Render Persistent Disk /var/data/datasets-store.json)
 * with fallback to project-local data/datasets-store.json for development.
 * Uses atomic temp-file write + rename inside the same directory with sequential
 * single-instance write queueing. Never silently overwrites corrupt/unreadable files.
 */
export class ServerDatasetStore {
  private readonly filePath: string;
  private cache: PersistedDatasetsStore | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private storageReady = false;

  constructor(customFilePath?: string) {
    this.filePath = resolveDatasetStorePath(customFilePath, process.env.DATA_STORE_PATH);
  }

  getStorageFilePath(): string {
    return this.filePath;
  }

  isStorageReady(): boolean {
    return this.storageReady;
  }

  /**
   * Startup check verifying parent directory creation/write permissions and, if the
   * store file already exists, read+write permissions plus valid JSON integrity
   * without mutating or overwriting any existing file.
   */
  async verifyStorageAccess(): Promise<{ ready: boolean; errorCode?: string }> {
    const dir = path.dirname(this.filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.access(dir, fsConstants.R_OK | fsConstants.W_OK);

      let fileExists = false;
      try {
        await fs.stat(this.filePath);
        fileExists = true;
      } catch (statErr) {
        const code = (statErr as NodeJS.ErrnoException | null)?.code;
        if (code !== 'ENOENT') {
          throw statErr;
        }
      }

      if (fileExists) {
        await fs.access(this.filePath, fsConstants.R_OK | fsConstants.W_OK);
        await this.loadInternal();
      }

      this.storageReady = true;
      return { ready: true };
    } catch (err) {
      this.storageReady = false;
      const errorCode = (err as NodeJS.ErrnoException | null)?.code || 'STORAGE_ACCESS_ERROR';
      console.error(
        `[DatasetStore] Startup storage verification failed (${errorCode}). Existing data will not be overwritten.`
      );
      return { ready: false, errorCode };
    }
  }

  private async loadInternal(): Promise<PersistedDatasetsStore> {
    if (this.cache) return this.cache;

    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf-8');
    } catch (readErr) {
      const code = (readErr as NodeJS.ErrnoException | null)?.code;
      if (code === 'ENOENT') {
        this.cache = createEmptyDatasetsStore();
        return this.cache;
      }
      this.storageReady = false;
      console.error(
        `[DatasetStore] Failed to read dataset store file (${code || 'READ_ERROR'}). Refusing to fall back to empty store.`
      );
      throw createCodedError(
        code || 'DATASET_STORE_READ_ERROR',
        'Không thể đọc tệp dữ liệu nguồn trên máy chủ (lỗi truy cập hoặc phân quyền tệp).'
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.storageReady = false;
      console.error(
        '[DatasetStore] Dataset store file contains invalid/corrupted JSON. Refusing to overwrite with empty store.'
      );
      throw createCodedError(
        'DATASET_STORE_CORRUPT_JSON',
        'Tệp dữ liệu nguồn bị hỏng định dạng JSON. Hệ thống từ chối khởi tạo rỗng để bảo toàn dữ liệu.'
      );
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.storageReady = false;
      console.error(
        '[DatasetStore] Dataset store root value is not a valid JSON object. Refusing to overwrite.'
      );
      throw createCodedError(
        'DATASET_STORE_CORRUPT_JSON',
        'Cấu trúc tệp dữ liệu nguồn không hợp lệ. Hệ thống từ chối ghi đè tự động.'
      );
    }

    const parsedObj = parsed as Partial<PersistedDatasetsStore>;
    const empty = createEmptyDatasetsStore();
    this.cache = {
      schemaVersion: 1,
      updatedAt: typeof parsedObj.updatedAt === 'string' ? parsedObj.updatedAt : empty.updatedAt,
      statePrice: parsedObj.statePrice ?? empty.statePrice,
      ecovis: parsedObj.ecovis ?? empty.ecovis,
      kFactorRules: parsedObj.kFactorRules ?? empty.kFactorRules,
      marketSurvey: parsedObj.marketSurvey ?? empty.marketSurvey,
      pdfDocuments: Array.isArray(parsedObj.pdfDocuments) ? parsedObj.pdfDocuments : [],
    };
    this.storageReady = true;
    return this.cache;
  }

  private async saveInternal(store: PersistedDatasetsStore): Promise<void> {
    const nextStore: PersistedDatasetsStore = {
      ...store,
      updatedAt: new Date().toISOString(),
    };
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2, 8)}.tmp`;

    try {
      await fs.writeFile(tmpPath, JSON.stringify(nextStore, null, 2), 'utf-8');
      await fs.rename(tmpPath, this.filePath);
      this.cache = nextStore;
      this.storageReady = true;
    } catch (writeErr) {
      await fs.unlink(tmpPath).catch(() => undefined);
      throw writeErr;
    }
  }

  private enqueueWrite<T>(task: (store: PersistedDatasetsStore) => Promise<T> | T): Promise<T> {
    const run = this.writeChain.then(async () => {
      const current = await this.loadInternal();
      const workingCopy = structuredClone(current);
      const result = await task(workingCopy);
      await this.saveInternal(workingCopy);
      return result;
    });
    this.writeChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async getPublicActiveDatasets(): Promise<ActiveDatasetsPublicResponse> {
    const store = await this.loadInternal();
    return {
      storageBackend: 'server_json_file',
      updatedAt: store.updatedAt,
      active: {
        statePrice: resolveActiveBucket(store.statePrice),
        ecovis: resolveActiveBucket(store.ecovis),
        kFactorRules: resolveActiveBucket(store.kFactorRules),
        marketSurvey: resolveActiveBucket(store.marketSurvey),
      },
      pdfDocuments: store.pdfDocuments,
    };
  }

  async getAdminOverview(): Promise<AdminDatasetsOverviewResponse> {
    const store = await this.loadInternal();
    const activeState = resolveActiveBucket(store.statePrice);
    const activeEcovis = resolveActiveBucket(store.ecovis);
    const activeK = resolveActiveBucket(store.kFactorRules);
    const activeMarket = resolveActiveBucket(store.marketSurvey);

    const versions: DatasetVersionMetadata[] = [
      ...store.statePrice.versions.map((v) => ({
        ...v.meta,
        isActive: v.meta.versionId === store.statePrice.activeVersionId,
      })),
      ...store.ecovis.versions.map((v) => ({
        ...v.meta,
        isActive: v.meta.versionId === store.ecovis.activeVersionId,
      })),
      ...store.kFactorRules.versions.map((v) => ({
        ...v.meta,
        isActive: v.meta.versionId === store.kFactorRules.activeVersionId,
      })),
      ...store.marketSurvey.versions.map((v) => ({
        ...v.meta,
        isActive: v.meta.versionId === store.marketSurvey.activeVersionId,
      })),
    ].sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime());

    return {
      storageBackend: 'server_json_file',
      updatedAt: store.updatedAt,
      counts: {
        statePrice: activeState.records.length,
        ecovis: activeEcovis.records.length,
        kFactorRules: activeK.records.length,
        marketSurvey: activeMarket.records.length,
        totalVersions: versions.length,
        pdfDocuments: store.pdfDocuments.length,
      },
      activeVersionIds: {
        state_price: store.statePrice.activeVersionId,
        ecovis: store.ecovis.activeVersionId,
        k_factor_rules: store.kFactorRules.activeVersionId,
        market_survey: store.marketSurvey.activeVersionId,
      },
      versions,
      pdfDocuments: store.pdfDocuments,
    };
  }

  async commitVersion(
    kind: DatasetKind,
    payload: ValidatedVersionPayload,
    activate = true
  ): Promise<DatasetVersionMetadata> {
    return this.enqueueWrite((store) => {
      const bucket = getBucketForKind(store, kind);
      const duplicate = bucket.versions.find((v) => v.meta.versionId === payload.meta.versionId);
      if (duplicate) {
        throw new Error(`DUPLICATE_VERSION_ID:${payload.meta.versionId}`);
      }
      bucket.versions.unshift({
        meta: { ...payload.meta, isActive: activate },
        records: payload.records,
      });
      if (activate || !bucket.activeVersionId) {
        bucket.activeVersionId = payload.meta.versionId;
      }
      return {
        ...payload.meta,
        isActive: bucket.activeVersionId === payload.meta.versionId,
      };
    });
  }

  async activateVersion(kind: DatasetKind, versionId: string): Promise<DatasetVersionMetadata | null> {
    if (!VERSION_ID_REGEX.test(versionId)) return null;
    return this.enqueueWrite((store) => {
      const bucket = getBucketForKind(store, kind);
      const target = bucket.versions.find((v) => v.meta.versionId === versionId);
      if (!target) return null;
      bucket.activeVersionId = versionId;
      bucket.versions.forEach((v) => {
        v.meta.isActive = v.meta.versionId === versionId;
      });
      return { ...target.meta, isActive: true };
    });
  }

  async getVersionForExport(
    kind: DatasetKind,
    versionId: string
  ): Promise<StoredDatasetVersion<StateLandPriceRecord | EcovisRecord | KFactorRuleRecord | MarketListingRecord> | null> {
    if (!VERSION_ID_REGEX.test(versionId)) return null;
    const store = await this.loadInternal();
    const bucket = getBucketForKind(store, kind);
    const found = bucket.versions.find((v) => v.meta.versionId === versionId);
    if (!found) return null;
    return {
      meta: {
        ...found.meta,
        isActive: found.meta.versionId === bucket.activeVersionId,
      },
      records: found.records,
    };
  }

  async migrateLocalVersions(
    entries: Array<{
      kind: DatasetKind;
      payload: ValidatedVersionPayload;
      wasActive: boolean;
    }>,
    pdfDocs: Omit<PdfReferenceDocument, 'sessionObjectUrl'>[]
  ): Promise<{ importedVersions: number; skippedVersions: number; importedPdfs: number }> {
    return this.enqueueWrite((store) => {
      let importedVersions = 0;
      let skippedVersions = 0;
      let importedPdfs = 0;

      for (const entry of entries) {
        const bucket = getBucketForKind(store, entry.kind);
        const exists = bucket.versions.some(
          (v) => v.meta.versionId === entry.payload.meta.versionId
        );
        if (exists) {
          skippedVersions += 1;
          continue;
        }
        bucket.versions.push({
          meta: { ...entry.payload.meta, isActive: false },
          records: entry.payload.records,
        });
        if (!bucket.activeVersionId && entry.wasActive) {
          bucket.activeVersionId = entry.payload.meta.versionId;
        }
        importedVersions += 1;
      }

      // Ensure any bucket with versions has an active version without overriding existing active selection
      for (const kind of ALLOWED_DATASET_KINDS) {
        const bucket = getBucketForKind(store, kind);
        if (!bucket.activeVersionId && bucket.versions.length > 0) {
          bucket.activeVersionId = bucket.versions[0].meta.versionId;
        }
        bucket.versions.forEach((v) => {
          v.meta.isActive = v.meta.versionId === bucket.activeVersionId;
        });
      }

      for (const doc of pdfDocs) {
        if (!store.pdfDocuments.some((d) => d.id === doc.id)) {
          store.pdfDocuments.unshift(doc);
          importedPdfs += 1;
        }
      }

      return { importedVersions, skippedVersions, importedPdfs };
    });
  }

  async addPdfDocument(
    doc: Omit<PdfReferenceDocument, 'sessionObjectUrl'>
  ): Promise<Omit<PdfReferenceDocument, 'sessionObjectUrl'>> {
    return this.enqueueWrite((store) => {
      const filtered = store.pdfDocuments.filter((d) => d.id !== doc.id);
      store.pdfDocuments = [doc, ...filtered];
      return doc;
    });
  }

  async removePdfDocument(id: string): Promise<boolean> {
    if (!DOC_ID_REGEX.test(id)) return false;
    return this.enqueueWrite((store) => {
      const before = store.pdfDocuments.length;
      store.pdfDocuments = store.pdfDocuments.filter((d) => d.id !== id);
      return store.pdfDocuments.length < before;
    });
  }
}

export const defaultDatasetStore = new ServerDatasetStore();
