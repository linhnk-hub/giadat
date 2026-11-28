import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocFromCache,
  getDocFromServer,
  getDocs,
  getDocsFromCache,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type FieldValue,
  type Timestamp,
} from 'firebase/firestore';
import {
  auth,
  db,
  FIXED_ADMIN_EMAIL,
  firestoreDatabaseId,
  handleFirestoreError,
  OperationType,
} from '../firebase';
import type {
  DatasetKind,
  DatasetVersionMetadata,
  EcovisRecord,
  KFactorRuleRecord,
  MarketListingRecord,
  PdfReferenceDocument,
  StateLandPriceRecord,
} from '../types/valuation';
import { isValidCoordinatePair, normalizeVietnameseText } from '../utils/formatters';
import {
  computeSha256Hex,
  encodeGeohash,
  getGeohashNeighbors,
  normalizeAdminKey,
} from '../utils/geohash';

export const FIRESTORE_COLLECTIONS = {
  datasetCategories: 'dataset_categories',
  activeVersions: 'active_versions',
  datasetVersions: 'dataset_versions',
  datasetRecords: 'dataset_records',
  activationHistory: 'activation_history',
  pdfDocuments: 'pdf_documents',
} as const;

export const ALL_DATASET_KINDS: readonly DatasetKind[] = [
  'state_price',
  'ecovis',
  'k_factor_rules',
  'market_survey',
] as const;

export const MAX_RECORDS_PER_VERSION = 20000;
export const FIRESTORE_WRITE_BATCH_CHUNK_SIZE = 400; // Strict margin below Firestore's 500-op hard limit
export const PUBLIC_RECORDS_QUERY_LIMIT = 500;
export const PUBLIC_PDF_QUERY_LIMIT = 100;
export const ADMIN_LIST_QUERY_LIMIT = 200;

export type DatasetCommitState = 'staging' | 'committed' | 'aborted';

export interface ActiveVersionPointerDoc {
  datasetKind: DatasetKind;
  activeVersionId: string;
  versionLabel: string;
  sourceDocumentName: string;
  sourceFileName: string;
  effectiveDate: string;
  importedAt: string;
  rowCount: number;
  spatialRecordsCount: number;
  notes: string;
  lastEventId: string;
}

export interface FirestoreDatasetVersionSummary extends DatasetVersionMetadata {
  commitState: DatasetCommitState;
  expectedRowCount: number;
  verifiedRowCount: number;
  payloadChecksum: string;
  importedByUid: string;
  committedAt: string | null;
}

export interface ActivationHistoryRecord {
  eventId: string;
  datasetKind: DatasetKind;
  action: 'activate' | 'rollback';
  fromVersionId: string;
  toVersionId: string;
  reason: string;
  actorUid: string;
  actorEmail: string;
  createdAt: string;
}

export interface FirestoreDatasetRecordDoc {
  recordId: string;
  datasetKind: DatasetKind;
  versionId: string;
  recordCode: string;
  visibility: 'public';
  isDemo: false;
  districtKey: string;
  wardKey: string;
  streetKey: string;
  hasCoordinates: boolean;
  latitude: number | null;
  longitude: number | null;
  geohash5: string | null;
  geohash6: string | null;
  payload: Record<string, unknown>;
  createdAt?: FieldValue | Timestamp | string;
}

export type DatasetLoadSource = 'cache' | 'server' | 'empty';

export type CacheFallbackReason =
  | 'cache_empty'
  | 'cache_count_mismatch'
  | 'cache_validation_failed'
  | 'cache_query_error'
  | 'large_dataset_bounded';

export interface DatasetKindLoadDiagnostics {
  datasetKind: DatasetKind;
  versionId: string | null;
  expectedRowCount: number;
  loadedRowCount: number;
  source: DatasetLoadSource;
  fallbackReason?: CacheFallbackReason;
}

export interface FirestoreDocReadResult {
  exists: boolean;
  data: DocumentData | null;
  fromCache: boolean;
}

export interface FirestoreQueryReadResult {
  docs: DocumentData[];
  fromCache: boolean;
}

export interface FirestorePublicReadAdapter {
  getActivePointerFromServer: (kind: DatasetKind) => Promise<FirestoreDocReadResult>;
  getActivePointerFromCache: (kind: DatasetKind) => Promise<FirestoreDocReadResult>;
  getActiveRecordsFromCache: (
    kind: DatasetKind,
    versionId: string
  ) => Promise<FirestoreQueryReadResult>;
  getActiveRecordsFromServer: (
    kind: DatasetKind,
    versionId: string
  ) => Promise<FirestoreQueryReadResult>;
}

export interface PublicActiveDatasetsSnapshot {
  databaseId: string;
  activePointers: Record<DatasetKind, ActiveVersionPointerDoc | null>;
  statePriceRecords: StateLandPriceRecord[];
  ecovisRecords: EcovisRecord[];
  kFactorRules: KFactorRuleRecord[];
  marketListings: MarketListingRecord[];
  pdfDocuments: PdfReferenceDocument[];
  /** Indicates whether any active dataset has > 500 rows (requires targeted lookup queries) */
  hasLargeDatasetRequiringTargetedQuery: Record<DatasetKind, boolean>;
  /** Observability metadata describing cache vs. server resolution for each dataset */
  loadMeta?: {
    pointerSource: 'server' | 'offline_cache';
    byKind: Record<DatasetKind, DatasetKindLoadDiagnostics>;
  };
}

export interface AdminOverviewSnapshot {
  databaseId: string;
  activePointers: Record<DatasetKind, ActiveVersionPointerDoc | null>;
  versions: Record<DatasetKind, FirestoreDatasetVersionSummary[]>;
  activationHistory: ActivationHistoryRecord[];
  pdfDocuments: PdfReferenceDocument[];
}

export interface ImportProgressUpdate {
  stage:
    | 'validating'
    | 'creating_staging'
    | 'writing_batches'
    | 'verifying_count'
    | 'committing'
    | 'completed'
    | 'aborted';
  writtenRows: number;
  totalRows: number;
  batchIndex: number;
  totalBatches: number;
  message: string;
}

export interface ImportDatasetVersionParams {
  datasetKind: DatasetKind;
  versionId?: string;
  versionLabel: string;
  sourceDocumentName: string;
  sourceFileName: string;
  effectiveDate: string;
  notes?: string;
  records: Array<StateLandPriceRecord | EcovisRecord | KFactorRuleRecord | MarketListingRecord>;
  activate: boolean;
}

export interface LookupFirestoreQueryParams {
  latitude: number | null;
  longitude: number | null;
  districtCity: string;
  wardCommune: string;
  streetName: string;
  activePointers: Record<DatasetKind, ActiveVersionPointerDoc | null>;
}

const DEFAULT_CATEGORY_METADATA: Record<
  DatasetKind,
  { displayName: string; description: string }
> = {
  state_price: {
    displayName: 'Bảng giá đất Nhà nước (Khánh Hòa)',
    description: 'Dữ liệu Bảng giá đất chính thức theo Nghị quyết HĐND tỉnh Khánh Hòa.',
  },
  ecovis: {
    displayName: 'Dữ liệu khảo sát ECOVIS',
    description: 'Dữ liệu khảo sát giá đất độc lập theo báo cáo ECOVIS.',
  },
  k_factor_rules: {
    displayName: 'Bảng quy định Hệ số K',
    description: 'Các quy tắc áp dụng hệ số điều chỉnh giá đất có văn bản căn cứ.',
  },
  market_survey: {
    displayName: 'Khảo sát rao bán thị trường',
    description: 'Dữ liệu tin rao bán tham khảo (không phải giá giao dịch thành công).',
  },
};

const COMPLETED_TRANSACTION_KEYWORDS = [
  'giao dich thuc te',
  'giao dich thanh cong',
  'gia giao dich',
  'da ban',
  'chot giao dich',
  'cong chung',
  'hop dong mua ban',
];

function trimTo(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function nonEmptyOrFallback(val: unknown, fallback: string, maxLen: number): string {
  const cleaned = trimTo(val, maxLen);
  return cleaned.length > 0 ? cleaned : fallback.slice(0, maxLen);
}

function timestampToIso(ts: unknown): string {
  if (!ts) return '';
  if (typeof ts === 'string') return ts;
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as Timestamp).toDate === 'function') {
    return (ts as Timestamp).toDate().toISOString();
  }
  return '';
}

export function sanitizeIdToken(raw: string, fallbackPrefix: string, maxLen = 80): string {
  const normalized = raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLen);
  if (normalized.length >= 3) return normalized;
  return `${fallbackPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`.slice(0, maxLen);
}

export function generateVersionId(datasetKind: DatasetKind): string {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('');
  const rand = Math.random().toString(36).slice(2, 6);
  return `${datasetKind}_${stamp}_${rand}`.slice(0, 80);
}

export function generateEventId(action: 'activate' | 'rollback', datasetKind: DatasetKind): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `evt_${action}_${datasetKind}_${Date.now()}_${rand}`.slice(0, 128);
}

export function chunkArray<T>(items: readonly T[], chunkSize = FIRESTORE_WRITE_BATCH_CHUNK_SIZE): T[][] {
  const safeSize = Math.max(1, Math.min(450, Math.floor(chunkSize)));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += safeSize) {
    chunks.push(items.slice(i, i + safeSize));
  }
  return chunks;
}

export function mapFirestoreErrorMessage(error: unknown, fallbackContext?: string): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const lower = raw.toLowerCase();

  if (lower.includes('permission-denied') || lower.includes('missing or insufficient permissions')) {
    return 'Firestore từ chối quyền truy cập (permission-denied). Kiểm tra tài khoản quản trị (linhnk2013@gmail.com) hoặc xác nhận Firestore Rules đã được phát hành trên database "giadat".';
  }
  if (lower.includes('failed-precondition') && lower.includes('index')) {
    return 'Truy vấn Firestore yêu cầu composite index chưa được triển khai từ firestore.indexes.json.';
  }
  if (lower.includes('resource-exhausted') || lower.includes('quota')) {
    return 'Đã chạm hạn mức đọc/ghi miễn phí trong ngày của gói Cloud Firestore Spark. Vui lòng thử lại sau.';
  }
  if (
    lower.includes('unavailable') ||
    lower.includes('the client is offline') ||
    lower.includes('failed to get document because the client is offline') ||
    lower.includes('network')
  ) {
    return 'Không thể kết nối máy chủ Cloud Firestore (database "giadat"). Vui lòng kiểm tra kết nối mạng hoặc thử lại.';
  }
  if (lower.includes('not-found') && lower.includes('database')) {
    return `Không tìm thấy Cloud Firestore database "${firestoreDatabaseId}". Vui lòng kiểm tra cấu hình Firebase.`;
  }
  return fallbackContext ? `${fallbackContext}: ${raw}` : raw || 'Lỗi không xác định khi thao tác với Cloud Firestore.';
}

/**
 * Pure deterministic builder converting a typed application record into a Firestore
 * `/dataset_records/{recordId}` document that conforms 100% to `firestore.rules` (Gate 2).
 */
export function buildFirestoreRecordDoc(
  datasetKind: DatasetKind,
  versionId: string,
  record: StateLandPriceRecord | EcovisRecord | KFactorRuleRecord | MarketListingRecord,
  index: number
): FirestoreDatasetRecordDoc {
  if ((record as { isDemo?: boolean }).isDemo === true) {
    throw new Error(`Bản ghi dòng #${index + 1} có cờ isDemo=true — bị chặn nạp vào kho dữ liệu thật.`);
  }

  const nowIso = new Date().toISOString();
  const safeVersionId = sanitizeIdToken(versionId, datasetKind, 80);
  const recordId = `${safeVersionId}_r${String(index + 1).padStart(5, '0')}`.slice(0, 128);

  if (datasetKind === 'state_price') {
    const r = record as StateLandPriceRecord;
    if (!Number.isFinite(r.unitPrice) || r.unitPrice <= 0) {
      throw new Error(`Dòng #${index + 1}: Đơn giá Nhà nước phải là số dương (> 0).`);
    }
    const lat = r.latitude ?? null;
    const lng = r.longitude ?? null;
    if ((lat !== null || lng !== null) && !isValidCoordinatePair(lat, lng)) {
      throw new Error(`Dòng #${index + 1}: Tọa độ GPS không hợp lệ (${lat}, ${lng}).`);
    }
    const hasCoords = isValidCoordinatePair(lat, lng);
    const geohash6 = hasCoords ? encodeGeohash(lat!, lng!, 6) : null;
    const geohash5 = geohash6 ? geohash6.slice(0, 5) : null;

    const payload: Record<string, unknown> = {
      legalDocumentName: nonEmptyOrFallback(r.legalDocumentName, 'Bảng giá đất tỉnh Khánh Hòa', 300),
      wardCommune: nonEmptyOrFallback(r.wardCommune, 'Toàn địa bàn', 160),
      districtCity: trimTo(r.districtCity, 160),
      streetName: nonEmptyOrFallback(r.streetName, '-', 240),
      roadSegment: trimTo(r.roadSegment, 300),
      startPoint: trimTo(r.startPoint, 200),
      endPoint: trimTo(r.endPoint, 200),
      landType: nonEmptyOrFallback(r.landType, 'Chưa phân loại', 160),
      position: nonEmptyOrFallback(r.position, 'Vị trí 1', 160),
      unitPrice: Number(r.unitPrice),
      unit: nonEmptyOrFallback(r.unit, 'đ/m²', 40),
      sourcePageOrAppendix: nonEmptyOrFallback(r.sourcePageOrAppendix, 'Đang đối chiếu nguồn', 200),
      effectiveDate: nonEmptyOrFallback(r.effectiveDate, 'Chưa ghi ngày hiệu lực', 64),
      importedAt: nonEmptyOrFallback(r.importedAt, nowIso, 64),
    };
    if (r.coordinateNote) {
      payload.coordinateNote = trimTo(r.coordinateNote, 240);
    }

    return {
      recordId,
      datasetKind: 'state_price',
      versionId: safeVersionId,
      recordCode: nonEmptyOrFallback(r.recordCode, `SP_${index + 1}`, 120),
      visibility: 'public',
      isDemo: false,
      districtKey: normalizeAdminKey(String(payload.districtCity), 80),
      wardKey: normalizeAdminKey(String(payload.wardCommune), 80),
      streetKey: normalizeAdminKey(String(payload.streetName), 160),
      hasCoordinates: hasCoords,
      latitude: hasCoords ? Number(lat) : null,
      longitude: hasCoords ? Number(lng) : null,
      geohash5,
      geohash6,
      payload,
    };
  }

  if (datasetKind === 'ecovis') {
    const r = record as EcovisRecord;
    if (!Number.isFinite(r.surveyUnitPrice) || r.surveyUnitPrice <= 0) {
      throw new Error(`Dòng #${index + 1}: Đơn giá khảo sát ECOVIS phải là số dương (> 0).`);
    }
    if (!trimTo(r.sourceDocument, 300)) {
      throw new Error(`Dòng #${index + 1}: Dữ liệu ECOVIS bắt buộc ghi rõ nguồn tài liệu.`);
    }
    const lat = r.latitude ?? null;
    const lng = r.longitude ?? null;
    if ((lat !== null || lng !== null) && !isValidCoordinatePair(lat, lng)) {
      throw new Error(`Dòng #${index + 1}: Tọa độ GPS ECOVIS không hợp lệ (${lat}, ${lng}).`);
    }
    const hasCoords = isValidCoordinatePair(lat, lng);
    const geohash6 = hasCoords ? encodeGeohash(lat!, lng!, 6) : null;
    const geohash5 = geohash6 ? geohash6.slice(0, 5) : null;

    const payload: Record<string, unknown> = {
      wardCommune: trimTo(r.wardCommune, 160),
      districtCity: trimTo(r.districtCity, 160),
      streetName: nonEmptyOrFallback(r.streetName, '-', 240),
      roadSegment: trimTo(r.roadSegment, 300),
      landType: nonEmptyOrFallback(r.landType, 'Chưa phân loại', 160),
      position: nonEmptyOrFallback(r.position, 'Chưa ghi vị trí', 160),
      surveyUnitPrice: Number(r.surveyUnitPrice),
      unit: nonEmptyOrFallback(r.unit, 'đ/m²', 40),
      sourceDocument: trimTo(r.sourceDocument, 300),
      appendixAndPage: nonEmptyOrFallback(r.appendixAndPage, 'Đang đối chiếu phụ lục', 200),
      surveyOrReportDate: nonEmptyOrFallback(r.surveyOrReportDate, 'Chưa ghi ngày khảo sát', 64),
      importedAt: nonEmptyOrFallback(r.importedAt, nowIso, 64),
    };
    if (r.coordinateNote) {
      payload.coordinateNote = trimTo(r.coordinateNote, 240);
    }

    return {
      recordId,
      datasetKind: 'ecovis',
      versionId: safeVersionId,
      recordCode: nonEmptyOrFallback(r.recordCode, `ECO_${index + 1}`, 120),
      visibility: 'public',
      isDemo: false,
      districtKey: normalizeAdminKey(String(payload.districtCity), 80),
      wardKey: normalizeAdminKey(String(payload.wardCommune), 80),
      streetKey: normalizeAdminKey(String(payload.streetName), 160),
      hasCoordinates: hasCoords,
      latitude: hasCoords ? Number(lat) : null,
      longitude: hasCoords ? Number(lng) : null,
      geohash5,
      geohash6,
      payload,
    };
  }

  if (datasetKind === 'k_factor_rules') {
    const r = record as KFactorRuleRecord;
    if (!Number.isFinite(r.factorValue) || r.factorValue <= 0) {
      throw new Error(`Dòng #${index + 1}: Giá trị Hệ số K phải là số dương (> 0).`);
    }
    const payload: Record<string, unknown> = {
      factorName: nonEmptyOrFallback(r.factorName, `Hệ số K #${index + 1}`, 240),
      factorValue: Number(r.factorValue),
      formula: nonEmptyOrFallback(r.formula, 'Đơn giá × Hệ số K', 300),
      applicableCondition: nonEmptyOrFallback(r.applicableCondition, 'Theo quy định hiện hành', 500),
      requiredInputFields: trimTo(r.requiredInputFields, 300),
      sourceDocument: nonEmptyOrFallback(r.sourceDocument, 'Văn bản quy định Hệ số K', 300),
      sourcePage: nonEmptyOrFallback(r.sourcePage, 'Đang đối chiếu trang', 200),
      effectiveDate: nonEmptyOrFallback(r.effectiveDate, 'Chưa ghi ngày hiệu lực', 64),
      importedAt: nonEmptyOrFallback(r.importedAt, nowIso, 64),
    };

    return {
      recordId,
      datasetKind: 'k_factor_rules',
      versionId: safeVersionId,
      recordCode: nonEmptyOrFallback(r.ruleCode, `K_${index + 1}`, 120),
      visibility: 'public',
      isDemo: false,
      districtKey: '',
      wardKey: '',
      streetKey: '',
      hasCoordinates: false,
      latitude: null,
      longitude: null,
      geohash5: null,
      geohash6: null,
      payload,
    };
  }

  // market_survey
  const r = record as MarketListingRecord;
  if (!trimTo(r.sourceName, 200) || !trimTo(r.postedDate, 64) || !trimTo(r.address, 360)) {
    throw new Error(`Dòng #${index + 1}: Tin rao thị trường bắt buộc có nguồn tin, ngày đăng và địa chỉ.`);
  }
  const normNote = normalizeVietnameseText(r.verificationNote || '');
  if (COMPLETED_TRANSACTION_KEYWORDS.some((kw) => normNote.includes(kw))) {
    throw new Error(
      `Dòng #${index + 1}: Không được gắn nhãn tin rao thị trường là giá giao dịch thành công.`
    );
  }
  const areaSqm = Number(r.areaSqm);
  const askingPriceVnd = Number(r.askingPriceVnd);
  const unitPricePerSqm =
    Number.isFinite(Number(r.unitPricePerSqm)) && Number(r.unitPricePerSqm) > 0
      ? Number(r.unitPricePerSqm)
      : areaSqm > 0 && askingPriceVnd > 0
      ? Math.round(askingPriceVnd / areaSqm)
      : 0;

  if (!(areaSqm > 0) || !(askingPriceVnd > 0) || !(unitPricePerSqm > 0)) {
    throw new Error(`Dòng #${index + 1}: Diện tích, giá rao bán và đơn giá/m² phải > 0.`);
  }

  const rawUrl = trimTo(r.url, 1000);
  if (rawUrl && !/^https?:\/\/.+$/i.test(rawUrl)) {
    throw new Error(`Dòng #${index + 1}: Đường dẫn tin rao chỉ chấp nhận http:// hoặc https://.`);
  }

  const lat = r.latitude ?? null;
  const lng = r.longitude ?? null;
  if ((lat !== null || lng !== null) && !isValidCoordinatePair(lat, lng)) {
    throw new Error(`Dòng #${index + 1}: Tọa độ GPS tin rao không hợp lệ (${lat}, ${lng}).`);
  }
  const hasCoords = isValidCoordinatePair(lat, lng);
  const geohash6 = hasCoords ? encodeGeohash(lat!, lng!, 6) : null;
  const geohash5 = geohash6 ? geohash6.slice(0, 5) : null;

  const verificationStatus =
    r.verificationStatus === 'da_xac_minh_so_bo' || r.verificationStatus === 'loai_tru'
      ? r.verificationStatus
      : 'chua_xac_minh';

  const payload: Record<string, unknown> = {
    sourceName: trimTo(r.sourceName, 200),
    url: rawUrl,
    postedDate: trimTo(r.postedDate, 64),
    address: trimTo(r.address, 360),
    wardCommune: trimTo(r.wardCommune, 160),
    areaSqm,
    askingPriceVnd,
    unitPricePerSqm,
    propertyType: nonEmptyOrFallback(r.propertyType, 'Đất ở / BĐS rao bán', 120),
    locationInfo: trimTo(r.locationInfo, 300),
    verificationStatus,
    verificationNote: nonEmptyOrFallback(
      r.verificationNote,
      'Giá rao bán tham khảo — chưa xác minh giao dịch thành công.',
      400
    ),
    isDuplicate: Boolean(r.isDuplicate),
    createdAtIso: nonEmptyOrFallback(r.createdAt, nowIso, 64),
  };
  if (r.coordinateNote) {
    payload.coordinateNote = trimTo(r.coordinateNote, 240);
  }

  return {
    recordId,
    datasetKind: 'market_survey',
    versionId: safeVersionId,
    recordCode: nonEmptyOrFallback(r.listingCode, `MKT_${index + 1}`, 120),
    visibility: 'public',
    isDemo: false,
    districtKey: normalizeAdminKey(String(r.address || ''), 80),
    wardKey: normalizeAdminKey(String(payload.wardCommune), 80),
    streetKey: normalizeAdminKey(String(payload.address), 160),
    hasCoordinates: hasCoords,
    latitude: hasCoords ? Number(lat) : null,
    longitude: hasCoords ? Number(lng) : null,
    geohash5,
    geohash6,
    payload,
  };
}

/**
 * Pure deserializer converting a `/dataset_records/{recordId}` Firestore document
 * back into the typed domain record used by `geoLookup.ts` and UI components.
 */
export function deserializeFirestoreRecordDoc(
  data: DocumentData
): StateLandPriceRecord | EcovisRecord | KFactorRuleRecord | MarketListingRecord {
  const kind = data.datasetKind as DatasetKind;
  const p = (data.payload ?? {}) as Record<string, unknown>;
  const recordId = String(data.recordId ?? '');
  const recordCode = String(data.recordCode ?? '');
  const versionId = String(data.versionId ?? '');
  const latitude = typeof data.latitude === 'number' ? data.latitude : null;
  const longitude = typeof data.longitude === 'number' ? data.longitude : null;

  if (kind === 'state_price') {
    return {
      id: recordId,
      recordCode,
      legalDocumentName: String(p.legalDocumentName ?? ''),
      wardCommune: String(p.wardCommune ?? ''),
      districtCity: String(p.districtCity ?? ''),
      streetName: String(p.streetName ?? ''),
      roadSegment: String(p.roadSegment ?? ''),
      startPoint: String(p.startPoint ?? ''),
      endPoint: String(p.endPoint ?? ''),
      landType: String(p.landType ?? ''),
      position: String(p.position ?? ''),
      unitPrice: Number(p.unitPrice ?? 0),
      unit: String(p.unit ?? 'đ/m²'),
      sourcePageOrAppendix: String(p.sourcePageOrAppendix ?? ''),
      effectiveDate: String(p.effectiveDate ?? ''),
      importedAt: String(p.importedAt ?? ''),
      versionId,
      latitude,
      longitude,
      coordinateNote: typeof p.coordinateNote === 'string' ? p.coordinateNote : undefined,
      isDemo: false,
    } satisfies StateLandPriceRecord;
  }

  if (kind === 'ecovis') {
    return {
      id: recordId,
      recordCode,
      wardCommune: String(p.wardCommune ?? ''),
      districtCity: String(p.districtCity ?? ''),
      streetName: String(p.streetName ?? ''),
      roadSegment: String(p.roadSegment ?? ''),
      landType: String(p.landType ?? ''),
      position: String(p.position ?? ''),
      surveyUnitPrice: Number(p.surveyUnitPrice ?? 0),
      unit: String(p.unit ?? 'đ/m²'),
      sourceDocument: String(p.sourceDocument ?? ''),
      appendixAndPage: String(p.appendixAndPage ?? ''),
      surveyOrReportDate: String(p.surveyOrReportDate ?? ''),
      importedAt: String(p.importedAt ?? ''),
      versionId,
      latitude,
      longitude,
      coordinateNote: typeof p.coordinateNote === 'string' ? p.coordinateNote : undefined,
      isDemo: false,
    } satisfies EcovisRecord;
  }

  if (kind === 'k_factor_rules') {
    return {
      id: recordId,
      ruleCode: recordCode,
      factorName: String(p.factorName ?? ''),
      factorValue: Number(p.factorValue ?? 0),
      formula: String(p.formula ?? ''),
      applicableCondition: String(p.applicableCondition ?? ''),
      requiredInputFields: String(p.requiredInputFields ?? ''),
      sourceDocument: String(p.sourceDocument ?? ''),
      sourcePage: String(p.sourcePage ?? ''),
      effectiveDate: String(p.effectiveDate ?? ''),
      importedAt: String(p.importedAt ?? ''),
      versionId,
      isDemo: false,
    } satisfies KFactorRuleRecord;
  }

  return {
    id: recordId,
    listingCode: recordCode,
    sourceName: String(p.sourceName ?? ''),
    url: String(p.url ?? ''),
    postedDate: String(p.postedDate ?? ''),
    address: String(p.address ?? ''),
    wardCommune: String(p.wardCommune ?? ''),
    areaSqm: typeof p.areaSqm === 'number' ? p.areaSqm : null,
    askingPriceVnd: typeof p.askingPriceVnd === 'number' ? p.askingPriceVnd : null,
    unitPricePerSqm: typeof p.unitPricePerSqm === 'number' ? p.unitPricePerSqm : null,
    propertyType: String(p.propertyType ?? ''),
    locationInfo: String(p.locationInfo ?? ''),
    verificationStatus:
      p.verificationStatus === 'da_xac_minh_so_bo' || p.verificationStatus === 'loai_tru'
        ? p.verificationStatus
        : 'chua_xac_minh',
    verificationNote: String(p.verificationNote ?? ''),
    isDuplicate: Boolean(p.isDuplicate),
    duplicateOfId: null,
    createdAt: String(p.createdAtIso ?? ''),
    latitude,
    longitude,
    coordinateNote: typeof p.coordinateNote === 'string' ? p.coordinateNote : undefined,
    isDemo: false,
  } satisfies MarketListingRecord;
}

export async function buildVersionPayloadChecksum(
  datasetKind: DatasetKind,
  docs: readonly FirestoreDatasetRecordDoc[]
): Promise<string> {
  const canonical = JSON.stringify({
    datasetKind,
    count: docs.length,
    records: docs.map((d) => ({
      code: d.recordCode,
      dk: d.districtKey,
      wk: d.wardKey,
      sk: d.streetKey,
      hc: d.hasCoordinates,
      lat: d.latitude,
      lng: d.longitude,
      payload: d.payload,
    })),
  });
  return computeSha256Hex(canonical);
}

// =============================================================================
// PUBLIC READ OPERATIONS (Cache-Aware Cloud Firestore Web SDK, 0 PII, Bounded)
// =============================================================================

export function isFirestoreOfflineError(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '').toLowerCase()
      : '';
  const msg =
    error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase();
  if (
    code === 'permission-denied' ||
    msg.includes('permission-denied') ||
    msg.includes('missing or insufficient permissions') ||
    code === 'resource-exhausted' ||
    msg.includes('resource-exhausted') ||
    msg.includes('quota')
  ) {
    return false;
  }
  return (
    code === 'unavailable' ||
    msg.includes('client is offline') ||
    msg.includes('offline') ||
    msg.includes('unavailable') ||
    msg.includes('network')
  );
}

function parseActivePointerDoc(
  kind: DatasetKind,
  d: DocumentData | null
): ActiveVersionPointerDoc | null {
  if (!d || typeof d !== 'object') return null;
  const activeVersionId = String(d.activeVersionId ?? '').trim();
  const rowCount = Number(d.rowCount ?? 0);
  if (!activeVersionId || !Number.isInteger(rowCount) || rowCount < 0) {
    return null;
  }
  return {
    datasetKind: kind,
    activeVersionId,
    versionLabel: String(d.versionLabel ?? ''),
    sourceDocumentName: String(d.sourceDocumentName ?? ''),
    sourceFileName: String(d.sourceFileName ?? ''),
    effectiveDate: String(d.effectiveDate ?? ''),
    importedAt: String(d.importedAt ?? ''),
    rowCount,
    spatialRecordsCount: Number(d.spatialRecordsCount ?? 0),
    notes: String(d.notes ?? ''),
    lastEventId: String(d.lastEventId ?? ''),
  };
}

/**
 * Validates a single raw Firestore `/dataset_records` document against active datasetKind,
 * active versionId, public visibility, non-demo integrity, coordinate integrity, and kind schema.
 */
export function validateFirestoreRecordDoc(
  data: unknown,
  expectedKind: DatasetKind,
  expectedVersionId: string
): boolean {
  if (!data || typeof data !== 'object') return false;
  const d = data as DocumentData;

  if (d.datasetKind !== expectedKind) return false;
  if (d.versionId !== expectedVersionId) return false;
  if (d.visibility !== 'public') return false;
  if (d.isDemo !== false) return false;
  if (typeof d.recordId !== 'string' || d.recordId.trim().length === 0) return false;
  if (typeof d.recordCode !== 'string' || d.recordCode.trim().length === 0) return false;
  if (typeof d.hasCoordinates !== 'boolean') return false;

  if (d.hasCoordinates) {
    if (!isValidCoordinatePair(d.latitude, d.longitude)) return false;
  } else {
    if (d.latitude !== null || d.longitude !== null) return false;
  }

  if (!d.payload || typeof d.payload !== 'object') return false;
  const p = d.payload as Record<string, unknown>;

  if (expectedKind === 'state_price') {
    const unitPrice = Number(p.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return false;
    if (typeof p.wardCommune !== 'string' || p.wardCommune.trim().length === 0) return false;
    if (typeof p.streetName !== 'string' || p.streetName.trim().length === 0) return false;
    if (typeof p.legalDocumentName !== 'string' || p.legalDocumentName.trim().length === 0) {
      return false;
    }
    return true;
  }

  if (expectedKind === 'ecovis') {
    const surveyUnitPrice = Number(p.surveyUnitPrice);
    if (!Number.isFinite(surveyUnitPrice) || surveyUnitPrice <= 0) return false;
    if (typeof p.sourceDocument !== 'string' || p.sourceDocument.trim().length === 0) return false;
    if (typeof p.streetName !== 'string' || p.streetName.trim().length === 0) return false;
    return true;
  }

  if (expectedKind === 'k_factor_rules') {
    const factorValue = Number(p.factorValue);
    if (!Number.isFinite(factorValue) || factorValue <= 0) return false;
    if (typeof p.factorName !== 'string' || p.factorName.trim().length === 0) return false;
    if (typeof p.sourceDocument !== 'string' || p.sourceDocument.trim().length === 0) return false;
    return true;
  }

  // market_survey
  if (typeof p.sourceName !== 'string' || p.sourceName.trim().length === 0) return false;
  if (typeof p.postedDate !== 'string' || p.postedDate.trim().length === 0) return false;
  if (typeof p.address !== 'string' || p.address.trim().length === 0) return false;
  const areaSqm = Number(p.areaSqm);
  const askingPriceVnd = Number(p.askingPriceVnd);
  const unitPricePerSqm = Number(p.unitPricePerSqm);
  if (!(areaSqm > 0) || !(askingPriceVnd > 0) || !(unitPricePerSqm > 0)) return false;
  if (typeof p.url === 'string' && p.url.trim().length > 0 && !/^https?:\/\/.+$/i.test(p.url.trim())) {
    return false;
  }
  const normNote = normalizeVietnameseText(String(p.verificationNote ?? ''));
  if (COMPLETED_TRANSACTION_KEYWORDS.some((kw) => normNote.includes(kw))) return false;
  return true;
}

/**
 * Validates a full cached record set for a given `(kind, activeVersionId, expectedRowCount)`.
 * Cache is accepted ONLY if:
 * - count === expectedRowCount (exact match, neither missing nor extra),
 * - every record matches `kind` and `activeVersionId`,
 * - every record passes `validateFirestoreRecordDoc`,
 * - every `recordId` is unique.
 */
export function validateCachedRecordSet(
  docs: readonly DocumentData[],
  kind: DatasetKind,
  expectedVersionId: string,
  expectedRowCount: number
):
  | {
      ok: true;
      records: Array<
        StateLandPriceRecord | EcovisRecord | KFactorRuleRecord | MarketListingRecord
      >;
    }
  | {
      ok: false;
      reason: CacheFallbackReason;
      detail: string;
    } {
  if (expectedRowCount > PUBLIC_RECORDS_QUERY_LIMIT) {
    return {
      ok: false,
      reason: 'large_dataset_bounded',
      detail: `rowCount ${expectedRowCount} vượt giới hạn truy vấn công khai ${PUBLIC_RECORDS_QUERY_LIMIT}`,
    };
  }
  if (docs.length === 0) {
    return {
      ok: false,
      reason: 'cache_empty',
      detail: `0/${expectedRowCount} bản ghi trong bộ nhớ đệm`,
    };
  }
  if (docs.length !== expectedRowCount) {
    return {
      ok: false,
      reason: 'cache_count_mismatch',
      detail: `Số bản ghi cache (${docs.length}) không khớp rowCount xác minh (${expectedRowCount})`,
    };
  }

  const seenRecordIds = new Set<string>();
  const records: Array<
    StateLandPriceRecord | EcovisRecord | KFactorRuleRecord | MarketListingRecord
  > = [];

  for (let i = 0; i < docs.length; i += 1) {
    const raw = docs[i];
    if (!validateFirestoreRecordDoc(raw, kind, expectedVersionId)) {
      return {
        ok: false,
        reason: 'cache_validation_failed',
        detail: `Bản ghi cache #${i + 1} không vượt qua kiểm tra hợp lệ cho ${kind}@${expectedVersionId}`,
      };
    }
    const rid = String(raw.recordId);
    if (seenRecordIds.has(rid)) {
      return {
        ok: false,
        reason: 'cache_validation_failed',
        detail: `Phát hiện trùng recordId "${rid}" trong bộ nhớ đệm`,
      };
    }
    seenRecordIds.add(rid);
    records.push(deserializeFirestoreRecordDoc(raw));
  }

  return { ok: true, records };
}

function buildActiveRecordsQuery(kind: DatasetKind, activeVersionId: string) {
  return query(
    collection(db, FIRESTORE_COLLECTIONS.datasetRecords),
    where('datasetKind', '==', kind),
    where('versionId', '==', activeVersionId),
    where('visibility', '==', 'public'),
    where('isDemo', '==', false),
    limit(PUBLIC_RECORDS_QUERY_LIMIT)
  );
}

export const defaultFirestorePublicReadAdapter: FirestorePublicReadAdapter = {
  async getActivePointerFromServer(kind) {
    const ref = doc(db, FIRESTORE_COLLECTIONS.activeVersions, kind);
    const snap = await getDocFromServer(ref);
    return {
      exists: snap.exists(),
      data: snap.exists() ? snap.data() : null,
      fromCache: snap.metadata.fromCache,
    };
  },
  async getActivePointerFromCache(kind) {
    const ref = doc(db, FIRESTORE_COLLECTIONS.activeVersions, kind);
    const snap = await getDocFromCache(ref);
    return {
      exists: snap.exists(),
      data: snap.exists() ? snap.data() : null,
      fromCache: true,
    };
  },
  async getActiveRecordsFromCache(kind, versionId) {
    const snap = await getDocsFromCache(buildActiveRecordsQuery(kind, versionId));
    return {
      docs: snap.docs.map((docSnap) => docSnap.data()),
      fromCache: true,
    };
  },
  async getActiveRecordsFromServer(kind, versionId) {
    const snap = await getDocsFromServer(buildActiveRecordsQuery(kind, versionId));
    return {
      docs: snap.docs.map((docSnap) => docSnap.data()),
      fromCache: snap.metadata.fromCache,
    };
  },
};

async function fetchActiveVersionPointersWithMode(
  adapter: FirestorePublicReadAdapter
): Promise<{
  pointers: Record<DatasetKind, ActiveVersionPointerDoc | null>;
  pointerSource: 'server' | 'offline_cache';
}> {
  let serverSucceeded = false;
  let sawOfflineError = false;
  let cachedPointersFound = 0;

  const results = await Promise.all(
    ALL_DATASET_KINDS.map(async (kind) => {
      try {
        const res = await adapter.getActivePointerFromServer(kind);
        serverSucceeded = true;
        return [kind, res.exists ? parseActivePointerDoc(kind, res.data) : null] as const;
      } catch (err) {
        if (!isFirestoreOfflineError(err)) {
          throw err;
        }
        sawOfflineError = true;
        try {
          const cached = await adapter.getActivePointerFromCache(kind);
          const parsed = cached.exists ? parseActivePointerDoc(kind, cached.data) : null;
          if (parsed) {
            cachedPointersFound += 1;
          }
          return [kind, parsed] as const;
        } catch {
          return [kind, null] as const;
        }
      }
    })
  );

  if (sawOfflineError && serverSucceeded) {
    throw new Error(
      'Kết nối Cloud Firestore bị gián đoạn trong lúc xác minh phiên bản dữ liệu. Vui lòng thử lại khi mạng ổn định.'
    );
  }

  if (sawOfflineError && cachedPointersFound === 0) {
    throw new Error(
      'Đang ngoại tuyến và bộ nhớ đệm cục bộ chưa có dữ liệu giá đất để tra cứu. Vui lòng kết nối mạng để tải dữ liệu chính thức.'
    );
  }

  return {
    pointerSource: sawOfflineError ? 'offline_cache' : 'server',
    pointers: {
      state_price: results.find(([k]) => k === 'state_price')?.[1] ?? null,
      ecovis: results.find(([k]) => k === 'ecovis')?.[1] ?? null,
      k_factor_rules: results.find(([k]) => k === 'k_factor_rules')?.[1] ?? null,
      market_survey: results.find(([k]) => k === 'market_survey')?.[1] ?? null,
    },
  };
}

export async function fetchActiveVersionPointers(): Promise<
  Record<DatasetKind, ActiveVersionPointerDoc | null>
> {
  const results = await Promise.all(
    ALL_DATASET_KINDS.map(async (kind) => {
      const ref = doc(db, FIRESTORE_COLLECTIONS.activeVersions, kind);
      const snap = await getDoc(ref);
      if (!snap.exists()) return [kind, null] as const;
      return [kind, parseActivePointerDoc(kind, snap.data())] as const;
    })
  );

  return {
    state_price: results.find(([k]) => k === 'state_price')?.[1] ?? null,
    ecovis: results.find(([k]) => k === 'ecovis')?.[1] ?? null,
    k_factor_rules: results.find(([k]) => k === 'k_factor_rules')?.[1] ?? null,
    market_survey: results.find(([k]) => k === 'market_survey')?.[1] ?? null,
  };
}

export async function fetchPublicPdfDocuments(): Promise<PdfReferenceDocument[]> {
  try {
    const q = query(
      collection(db, FIRESTORE_COLLECTIONS.pdfDocuments),
      where('visibility', '==', 'public'),
      orderBy('createdAt', 'desc'),
      limit(PUBLIC_PDF_QUERY_LIMIT)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => mapPdfDoc(d.data()));
  } catch (err) {
    // Fallback without orderBy if composite index is not yet deployed
    const msg = err instanceof Error ? err.message.toLowerCase() : '';
    if (msg.includes('index') || msg.includes('failed-precondition')) {
      const fallbackQ = query(
        collection(db, FIRESTORE_COLLECTIONS.pdfDocuments),
        where('visibility', '==', 'public'),
        limit(PUBLIC_PDF_QUERY_LIMIT)
      );
      const snap = await getDocs(fallbackQ);
      return snap.docs
        .map((d) => mapPdfDoc(d.data()))
        .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    }
    throw err;
  }
}

function mapPdfDoc(d: DocumentData): PdfReferenceDocument {
  return {
    id: String(d.id ?? ''),
    fileName: String(d.fileName ?? ''),
    documentTitle: String(d.documentTitle ?? ''),
    documentCategory:
      d.documentCategory === 'bang_gia_nha_nuoc' ||
      d.documentCategory === 'bao_cao_ecovis' ||
      d.documentCategory === 'quy_dinh_he_so_k'
        ? d.documentCategory
        : 'khac',
    pageCount: typeof d.pageCount === 'number' ? d.pageCount : null,
    effectiveDate: String(d.effectiveDate ?? ''),
    appendixNote: String(d.appendixNote ?? ''),
    fileSizeBytes: Number(d.fileSizeBytes ?? 0),
    uploadedAt: String(d.uploadedAt ?? ''),
  };
}

/**
 * Cache-aware loader for a single active dataset version:
 * 1. Checks Firestore IndexedDB cache for `(datasetKind, activeVersionId)`.
 * 2. Reuses cache ONLY when `docs.length === pointer.rowCount`, `versionId` matches,
 *    and every record passes `validateFirestoreRecordDoc`.
 * 3. On cache miss / count mismatch / validation error / cache query error:
 *    - When offline: fails closed with an explicit error (never returns incomplete data).
 *    - When online: executes ONE server query (`getDocsFromServer`), which also refreshes
 *      the SDK's IndexedDB cache for subsequent visits.
 */
export async function fetchCacheAwareActiveRecordsForKind(
  kind: DatasetKind,
  pointer: ActiveVersionPointerDoc | null,
  pointerSource: 'server' | 'offline_cache' = 'server',
  adapter: FirestorePublicReadAdapter = defaultFirestorePublicReadAdapter
): Promise<{
  records: Array<StateLandPriceRecord | EcovisRecord | KFactorRuleRecord | MarketListingRecord>;
  diagnostics: DatasetKindLoadDiagnostics;
}> {
  if (!pointer || !pointer.activeVersionId || pointer.rowCount <= 0) {
    return {
      records: [],
      diagnostics: {
        datasetKind: kind,
        versionId: pointer?.activeVersionId ?? null,
        expectedRowCount: pointer?.rowCount ?? 0,
        loadedRowCount: 0,
        source: 'empty',
      },
    };
  }

  const versionId = pointer.activeVersionId;
  const expectedRowCount = pointer.rowCount;
  const kindLabel = DEFAULT_CATEGORY_METADATA[kind].displayName;

  let fallbackReason: CacheFallbackReason | undefined;
  let cachedCountFound = 0;

  if (expectedRowCount > PUBLIC_RECORDS_QUERY_LIMIT) {
    fallbackReason = 'large_dataset_bounded';
  } else {
    try {
      const cacheSnap = await adapter.getActiveRecordsFromCache(kind, versionId);
      cachedCountFound = cacheSnap.docs.length;
      const cacheCheck = validateCachedRecordSet(cacheSnap.docs, kind, versionId, expectedRowCount);
      if (cacheCheck.ok) {
        return {
          records: cacheCheck.records,
          diagnostics: {
            datasetKind: kind,
            versionId,
            expectedRowCount,
            loadedRowCount: cacheCheck.records.length,
            source: 'cache',
          },
        };
      }
      fallbackReason = cacheCheck.reason;
    } catch {
      fallbackReason = 'cache_query_error';
    }
  }

  // Offline fail-closed guard: never serve partial/unverified cache as an accurate result
  if (pointerSource === 'offline_cache') {
    if (expectedRowCount > PUBLIC_RECORDS_QUERY_LIMIT) {
      throw new Error(
        `Đang ngoại tuyến: Bộ dữ liệu "${kindLabel}" có ${expectedRowCount.toLocaleString('vi-VN')} bản ghi (vượt ngưỡng bộ nhớ đệm đầy đủ ${PUBLIC_RECORDS_QUERY_LIMIT}). Không thể tra cứu đầy đủ và chính xác khi ngoại tuyến.`
      );
    }
    throw new Error(
      `Đang ngoại tuyến và bộ nhớ đệm cục bộ không đầy đủ hoặc không hợp lệ cho "${kindLabel}" (${cachedCountFound}/${expectedRowCount} bản ghi, phiên bản ${versionId}). Không thể tra cứu đầy đủ và chính xác khi chưa kết nối lại máy chủ.`
    );
  }

  // Online single-query server fallback (Firestore SDK automatically persists result to IndexedDB)
  let serverSnap: FirestoreQueryReadResult;
  try {
    serverSnap = await adapter.getActiveRecordsFromServer(kind, versionId);
  } catch (err) {
    if (isFirestoreOfflineError(err)) {
      throw new Error(
        `Mất kết nối máy chủ Cloud Firestore khi tải "${kindLabel}" và bộ nhớ đệm cục bộ không đầy đủ (${cachedCountFound}/${expectedRowCount} bản ghi). Không thể tra cứu đầy đủ và chính xác khi chưa kết nối lại máy chủ.`
      );
    }
    throw err;
  }

  const seenIds = new Set<string>();
  const validRecords: Array<
    StateLandPriceRecord | EcovisRecord | KFactorRuleRecord | MarketListingRecord
  > = [];

  for (const rawDoc of serverSnap.docs) {
    if (!validateFirestoreRecordDoc(rawDoc, kind, versionId)) {
      continue;
    }
    const rid = String(rawDoc.recordId);
    if (seenIds.has(rid)) continue;
    seenIds.add(rid);
    validRecords.push(deserializeFirestoreRecordDoc(rawDoc));
  }

  if (expectedRowCount <= PUBLIC_RECORDS_QUERY_LIMIT && validRecords.length !== expectedRowCount) {
    throw new Error(
      `Dữ liệu máy chủ cho "${kindLabel}" không khớp số bản ghi đã xác minh (${validRecords.length}/${expectedRowCount}, phiên bản ${versionId}). Không thể dùng tập dữ liệu thiếu để tra cứu.`
    );
  }

  return {
    records: validRecords,
    diagnostics: {
      datasetKind: kind,
      versionId,
      expectedRowCount,
      loadedRowCount: validRecords.length,
      source: 'server',
      fallbackReason,
    },
  };
}

/**
 * Loads active version pointers + cache-aware active records (up to 500 per kind).
 * Only ever reads versions referenced by `/active_versions/{kind}` (staging versions are NEVER exposed).
 * Reuses Firestore IndexedDB cache when versionId, rowCount, and record validation all pass.
 */
export async function fetchPublicActiveDatasetsSnapshot(options?: {
  adapter?: FirestorePublicReadAdapter;
  includePdfDocuments?: boolean;
}): Promise<PublicActiveDatasetsSnapshot> {
  const adapter = options?.adapter ?? defaultFirestorePublicReadAdapter;
  const includePdfDocuments = options?.includePdfDocuments === true;

  try {
    const { pointers: activePointers, pointerSource } =
      await fetchActiveVersionPointersWithMode(adapter);

    const pdfPromise =
      includePdfDocuments && pointerSource === 'server'
        ? fetchPublicPdfDocuments().catch(() => [])
        : Promise.resolve<PdfReferenceDocument[]>([]);

    const [stateRes, ecovisRes, kFactorRes, marketRes, pdfDocuments] = await Promise.all([
      fetchCacheAwareActiveRecordsForKind(
        'state_price',
        activePointers.state_price,
        pointerSource,
        adapter
      ),
      fetchCacheAwareActiveRecordsForKind(
        'ecovis',
        activePointers.ecovis,
        pointerSource,
        adapter
      ),
      fetchCacheAwareActiveRecordsForKind(
        'k_factor_rules',
        activePointers.k_factor_rules,
        pointerSource,
        adapter
      ),
      fetchCacheAwareActiveRecordsForKind(
        'market_survey',
        activePointers.market_survey,
        pointerSource,
        adapter
      ),
      pdfPromise,
    ]);

    return {
      databaseId: firestoreDatabaseId,
      activePointers,
      statePriceRecords: stateRes.records as StateLandPriceRecord[],
      ecovisRecords: ecovisRes.records as EcovisRecord[],
      kFactorRules: kFactorRes.records as KFactorRuleRecord[],
      marketListings: marketRes.records as MarketListingRecord[],
      pdfDocuments,
      hasLargeDatasetRequiringTargetedQuery: {
        state_price: (activePointers.state_price?.rowCount ?? 0) > PUBLIC_RECORDS_QUERY_LIMIT,
        ecovis: (activePointers.ecovis?.rowCount ?? 0) > PUBLIC_RECORDS_QUERY_LIMIT,
        k_factor_rules: (activePointers.k_factor_rules?.rowCount ?? 0) > PUBLIC_RECORDS_QUERY_LIMIT,
        market_survey: (activePointers.market_survey?.rowCount ?? 0) > PUBLIC_RECORDS_QUERY_LIMIT,
      },
      loadMeta: {
        pointerSource,
        byKind: {
          state_price: stateRes.diagnostics,
          ecovis: ecovisRes.diagnostics,
          k_factor_rules: kFactorRes.diagnostics,
          market_survey: marketRes.diagnostics,
        },
      },
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('Đang ngoại tuyến') ||
        error.message.includes('Mất kết nối máy chủ') ||
        error.message.includes('Kết nối Cloud Firestore bị gián đoạn') ||
        error.message.includes('không khớp số bản ghi đã xác minh'))
    ) {
      throw error;
    }
    throw new Error(mapFirestoreErrorMessage(error, 'Không thể tải dữ liệu giá đất từ Cloud Firestore'));
  }
}

/**
 * Targeted Firestore lookup for large datasets (> 500 rows) supporting BOTH:
 * 1) GPS Spatial lookup via `geohash5 in [center + 8 neighbors]`
 * 2) Non-GPS Administrative lookup via `districtKey` / `wardKey`
 */
export async function queryTargetedRecordsFromFirestore(params: LookupFirestoreQueryParams): Promise<{
  statePriceRecords: StateLandPriceRecord[];
  ecovisRecords: EcovisRecord[];
  marketListings: MarketListingRecord[];
}> {
  const { latitude, longitude, districtCity, wardCommune, activePointers } = params;
  const hasCoords = isValidCoordinatePair(latitude, longitude);
  const geohashNeighbors = hasCoords ? getGeohashNeighbors(encodeGeohash(latitude!, longitude!, 5)) : [];
  const districtKey = normalizeAdminKey(districtCity, 80);
  const wardKey = normalizeAdminKey(wardCommune, 80);

  const queryKind = async (kind: 'state_price' | 'ecovis' | 'market_survey') => {
    const pointer = activePointers[kind];
    if (!pointer?.activeVersionId) return [];

    // Fast path: if active version fits within a single bounded query (<= 500 rows),
    // reuse cache-aware loader so both street-level and "Toàn huyện" rows match accurately.
    if (pointer.rowCount <= PUBLIC_RECORDS_QUERY_LIMIT) {
      const loaded = await fetchCacheAwareActiveRecordsForKind(
        kind,
        pointer,
        'server',
        defaultFirestorePublicReadAdapter
      );
      return loaded.records;
    }

    const dedupMap = new Map<string, DocumentData>();
    const queriesToRun: Promise<void>[] = [];

    // Branch A: Spatial Geohash query when dataset has GPS records and user provided GPS
    if (hasCoords && pointer.spatialRecordsCount > 0 && geohashNeighbors.length > 0) {
      const spatialQ = query(
        collection(db, FIRESTORE_COLLECTIONS.datasetRecords),
        where('datasetKind', '==', kind),
        where('versionId', '==', pointer.activeVersionId),
        where('visibility', '==', 'public'),
        where('isDemo', '==', false),
        where('geohash5', 'in', geohashNeighbors),
        limit(PUBLIC_RECORDS_QUERY_LIMIT)
      );
      queriesToRun.push(
        getDocs(spatialQ).then((snap) => {
          snap.docs.forEach((d) => dedupMap.set(d.id, d.data()));
        })
      );
    }

    // Branch B: Non-GPS normalized administrative key query (wardKey / districtKey)
    if (wardKey) {
      const wardQ = query(
        collection(db, FIRESTORE_COLLECTIONS.datasetRecords),
        where('datasetKind', '==', kind),
        where('versionId', '==', pointer.activeVersionId),
        where('visibility', '==', 'public'),
        where('isDemo', '==', false),
        where('wardKey', '==', wardKey),
        limit(PUBLIC_RECORDS_QUERY_LIMIT)
      );
      queriesToRun.push(
        getDocs(wardQ).then((snap) => {
          snap.docs.forEach((d) => dedupMap.set(d.id, d.data()));
        })
      );
    } else if (districtKey) {
      const distQ = query(
        collection(db, FIRESTORE_COLLECTIONS.datasetRecords),
        where('datasetKind', '==', kind),
        where('versionId', '==', pointer.activeVersionId),
        where('visibility', '==', 'public'),
        where('isDemo', '==', false),
        where('districtKey', '==', districtKey),
        limit(PUBLIC_RECORDS_QUERY_LIMIT)
      );
      queriesToRun.push(
        getDocs(distQ).then((snap) => {
          snap.docs.forEach((d) => dedupMap.set(d.id, d.data()));
        })
      );
    }

    if (queriesToRun.length === 0) {
      const loaded = await fetchCacheAwareActiveRecordsForKind(
        kind,
        pointer,
        'server',
        defaultFirestorePublicReadAdapter
      );
      return loaded.records;
    }

    await Promise.all(queriesToRun);
    return Array.from(dedupMap.values()).map((d) => deserializeFirestoreRecordDoc(d));
  };

  const [stateRaw, ecovisRaw, marketRaw] = await Promise.all([
    queryKind('state_price'),
    queryKind('ecovis'),
    queryKind('market_survey'),
  ]);

  return {
    statePriceRecords: stateRaw as StateLandPriceRecord[],
    ecovisRecords: ecovisRaw as EcovisRecord[],
    marketListings: marketRaw as MarketListingRecord[],
  };
}

// =============================================================================
// ADMIN AUTH VERIFICATION & MANAGEMENT OPERATIONS (A1 + FIRESTORE RULES)
// =============================================================================

function assertAuthenticatedAdmin(): { uid: string; email: string } {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Phiên đăng nhập quản trị chưa sẵn sàng. Vui lòng đăng nhập bằng Google.');
  }
  const email = (user.email ?? '').trim().toLowerCase();
  if (email !== FIXED_ADMIN_EMAIL || user.emailVerified !== true) {
    throw new Error(
      `Quyền quản trị bị từ chối. Chỉ tài khoản Google đã xác minh email ${FIXED_ADMIN_EMAIL} được phép thao tác.`
    );
  }
  return { uid: user.uid, email: FIXED_ADMIN_EMAIL };
}

/**
 * Verifies live Firestore Security Rules authorization for the signed-in Admin user
 * by performing a bounded read against the Admin-only `/activation_history` collection.
 * Fails closed on permission-denied or offline errors.
 */
export async function verifyAdminFirestoreAccess(): Promise<{
  ok: boolean;
  reason?: 'permission_denied' | 'offline' | 'error';
  message?: string;
}> {
  try {
    assertAuthenticatedAdmin();
    const probeQ = query(collection(db, FIRESTORE_COLLECTIONS.activationHistory), limit(1));
    await getDocs(probeQ);
    return { ok: true };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const lower = raw.toLowerCase();
    if (lower.includes('permission-denied') || lower.includes('missing or insufficient permissions')) {
      return {
        ok: false,
        reason: 'permission_denied',
        message:
          'Cloud Firestore Security Rules từ chối quyền quản trị (kiểm tra email quản trị hoặc xác nhận firestore.rules đã được triển khai trên database "giadat").',
      };
    }
    if (lower.includes('offline') || lower.includes('unavailable')) {
      return {
        ok: false,
        reason: 'offline',
        message: 'Không thể kết nối Cloud Firestore (database "giadat") để xác thực quyền quản trị.',
      };
    }
    return {
      ok: false,
      reason: 'error',
      message: mapFirestoreErrorMessage(error, 'Lỗi xác thực quyền quản trị Firestore'),
    };
  }
}

export async function ensureDatasetCategoriesSeeded(): Promise<void> {
  assertAuthenticatedAdmin();
  for (const kind of ALL_DATASET_KINDS) {
    const ref = doc(db, FIRESTORE_COLLECTIONS.datasetCategories, kind);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const meta = DEFAULT_CATEGORY_METADATA[kind];
      await setDoc(ref, {
        datasetKind: kind,
        displayName: meta.displayName,
        description: meta.description,
        enabled: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }
}

export async function fetchAdminOverview(): Promise<AdminOverviewSnapshot> {
  assertAuthenticatedAdmin();
  try {
    const [activePointers, versionsSnap, historySnap, pdfDocuments] = await Promise.all([
      fetchActiveVersionPointers(),
      getDocs(
        query(collection(db, FIRESTORE_COLLECTIONS.datasetVersions), limit(ADMIN_LIST_QUERY_LIMIT))
      ),
      getDocs(
        query(
          collection(db, FIRESTORE_COLLECTIONS.activationHistory),
          limit(ADMIN_LIST_QUERY_LIMIT)
        )
      ),
      fetchPublicPdfDocuments(),
    ]);

    const versions: Record<DatasetKind, FirestoreDatasetVersionSummary[]> = {
      state_price: [],
      ecovis: [],
      k_factor_rules: [],
      market_survey: [],
    };

    versionsSnap.docs.forEach((docSnap) => {
      const d = docSnap.data();
      const kind = d.datasetKind as DatasetKind;
      if (!ALL_DATASET_KINDS.includes(kind)) return;
      const versionId = String(d.versionId ?? docSnap.id);
      const isActive = activePointers[kind]?.activeVersionId === versionId;
      const commitState: DatasetCommitState =
        d.commitState === 'committed' || d.commitState === 'aborted' ? d.commitState : 'staging';

      versions[kind].push({
        versionId,
        datasetKind: kind,
        versionLabel: String(d.versionLabel ?? versionId),
        sourceDocumentName: String(d.sourceDocumentName ?? ''),
        sourceFileName: String(d.sourceFileName ?? ''),
        effectiveDate: String(d.effectiveDate ?? ''),
        importedAt: String(d.importedAt ?? timestampToIso(d.createdAt)),
        rowCount: Number(d.verifiedRowCount ?? d.expectedRowCount ?? 0),
        expectedRowCount: Number(d.expectedRowCount ?? 0),
        verifiedRowCount: Number(d.verifiedRowCount ?? 0),
        spatialRecordsCount: Number(d.spatialRecordsCount ?? 0),
        notes: String(d.notes ?? ''),
        isActive,
        importedByEmail: String(d.importedByEmail ?? FIXED_ADMIN_EMAIL),
        importedByUid: String(d.importedByUid ?? ''),
        commitState,
        payloadChecksum: String(d.payloadChecksum ?? ''),
        committedAt: d.committedAt ? timestampToIso(d.committedAt) : null,
      });
    });

    for (const kind of ALL_DATASET_KINDS) {
      versions[kind].sort((a, b) => b.importedAt.localeCompare(a.importedAt));
    }

    const activationHistory: ActivationHistoryRecord[] = historySnap.docs
      .map((docSnap) => {
        const d = docSnap.data();
        return {
          eventId: String(d.eventId ?? docSnap.id),
          datasetKind: (d.datasetKind as DatasetKind) ?? 'state_price',
          action: d.action === 'rollback' ? ('rollback' as const) : ('activate' as const),
          fromVersionId: String(d.fromVersionId ?? ''),
          toVersionId: String(d.toVersionId ?? ''),
          reason: String(d.reason ?? ''),
          actorUid: String(d.actorUid ?? ''),
          actorEmail: String(d.actorEmail ?? ''),
          createdAt: timestampToIso(d.createdAt),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return {
      databaseId: firestoreDatabaseId,
      activePointers,
      versions,
      activationHistory,
      pdfDocuments,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'admin_overview');
  }
}

/**
 * Staging-First Versioned Import directly into Cloud Firestore:
 * 1. Validate all records & compute SHA-256 payloadChecksum
 * 2. Create `/dataset_versions/{versionId}` in `commitState: 'staging'`
 * 3. Write `/dataset_records/{recordId}` in sequential batches <= 400 docs
 * 4. Verify persisted count via `getCountFromServer()` === `expectedRowCount`
 *    (if mismatch -> mark `aborted` and throw; never activate partial staging!)
 * 5. Commit version (`commitState: 'committed'`); if `activate === true`, atomically
 *    update `/active_versions/{datasetKind}` + append `/activation_history/{eventId}` in ONE batch.
 */
export async function importAndStageDatasetVersion(
  params: ImportDatasetVersionParams,
  onProgress?: (update: ImportProgressUpdate) => void
): Promise<{
  versionId: string;
  rowCount: number;
  spatialRecordsCount: number;
  payloadChecksum: string;
  activated: boolean;
}> {
  const admin = assertAuthenticatedAdmin();
  const { datasetKind, records, activate } = params;

  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('Danh sách bản ghi nạp vào không được rỗng.');
  }
  if (records.length > MAX_RECORDS_PER_VERSION) {
    throw new Error(
      `Số bản ghi (${records.length}) vượt giới hạn tối đa ${MAX_RECORDS_PER_VERSION.toLocaleString('vi-VN')} bản ghi/phiên bản.`
    );
  }

  const versionId = params.versionId
    ? sanitizeIdToken(params.versionId, datasetKind, 80)
    : generateVersionId(datasetKind);
  const importedAt = new Date().toISOString();
  const versionLabel = nonEmptyOrFallback(
    params.versionLabel,
    `${DEFAULT_CATEGORY_METADATA[datasetKind].displayName} (${importedAt.slice(0, 10)})`,
    240
  );
  const sourceDocumentName = nonEmptyOrFallback(
    params.sourceDocumentName,
    DEFAULT_CATEGORY_METADATA[datasetKind].displayName,
    300
  );
  const sourceFileName = nonEmptyOrFallback(params.sourceFileName, `${versionId}.xlsx`, 260);
  const effectiveDate = nonEmptyOrFallback(params.effectiveDate, importedAt.slice(0, 10), 64);
  const notes = trimTo(params.notes ?? '', 600);

  onProgress?.({
    stage: 'validating',
    writtenRows: 0,
    totalRows: records.length,
    batchIndex: 0,
    totalBatches: Math.ceil(records.length / FIRESTORE_WRITE_BATCH_CHUNK_SIZE),
    message: `Đang kiểm tra tính toàn vẹn ${records.length} bản ghi và tính mã kiểm SHA-256...`,
  });

  // 1. Validate & serialize every record against Gate 2 firestore.rules schema
  const builtDocs = records.map((rec, idx) =>
    buildFirestoreRecordDoc(datasetKind, versionId, rec, idx)
  );
  const spatialRecordsCount = builtDocs.filter((d) => d.hasCoordinates).length;
  const payloadChecksum = await buildVersionPayloadChecksum(datasetKind, builtDocs);
  const chunks = chunkArray(builtDocs, FIRESTORE_WRITE_BATCH_CHUNK_SIZE);

  // Ensure parent category doc exists
  await ensureDatasetCategoriesSeeded();

  // 2. Create staging version ledger doc (NO committedAt field allowed on create)
  const versionRef = doc(db, FIRESTORE_COLLECTIONS.datasetVersions, versionId);
  onProgress?.({
    stage: 'creating_staging',
    writtenRows: 0,
    totalRows: builtDocs.length,
    batchIndex: 0,
    totalBatches: chunks.length,
    message: `Đang khởi tạo phiên bản staging "${versionId}" trên Cloud Firestore...`,
  });

  await setDoc(versionRef, {
    versionId,
    datasetKind,
    commitState: 'staging',
    versionLabel,
    sourceDocumentName,
    sourceFileName,
    effectiveDate,
    importedAt,
    expectedRowCount: builtDocs.length,
    verifiedRowCount: 0,
    spatialRecordsCount,
    payloadChecksum,
    notes,
    importedByUid: admin.uid,
    importedByEmail: admin.email,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // 3. Write dataset_records in bounded sequential batches (<= 400 docs/batch)
  let writtenRows = 0;
  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const batch = writeBatch(db);
      for (const item of chunk) {
        const recRef = doc(db, FIRESTORE_COLLECTIONS.datasetRecords, item.recordId);
        batch.set(recRef, {
          ...item,
          createdAt: serverTimestamp(),
        });
      }
      await batch.commit();
      writtenRows += chunk.length;
      onProgress?.({
        stage: 'writing_batches',
        writtenRows,
        totalRows: builtDocs.length,
        batchIndex: i + 1,
        totalBatches: chunks.length,
        message: `Đã ghi ${writtenRows}/${builtDocs.length} bản ghi (lô ${i + 1}/${chunks.length})...`,
      });
    }

    // 4. Verify exact persisted count on Firestore server before committing
    onProgress?.({
      stage: 'verifying_count',
      writtenRows,
      totalRows: builtDocs.length,
      batchIndex: chunks.length,
      totalBatches: chunks.length,
      message: 'Đang đối chiếu số lượng bản ghi thực tế trên Cloud Firestore...',
    });

    const countQuery = query(
      collection(db, FIRESTORE_COLLECTIONS.datasetRecords),
      where('datasetKind', '==', datasetKind),
      where('versionId', '==', versionId)
    );
    const countSnap = await getCountFromServer(countQuery);
    const serverCount = countSnap.data().count;

    if (serverCount !== builtDocs.length) {
      await updateDoc(versionRef, {
        commitState: 'aborted',
        updatedAt: serverTimestamp(),
      });
      onProgress?.({
        stage: 'aborted',
        writtenRows: serverCount,
        totalRows: builtDocs.length,
        batchIndex: chunks.length,
        totalBatches: chunks.length,
        message: `Đối chiếu thất bại: kỳ vọng ${builtDocs.length} bản ghi nhưng máy chủ ghi nhận ${serverCount}. Đã đánh dấu phiên bản là aborted và KHÔNG kích hoạt.`,
      });
      throw new Error(
        `Sai lệch số lượng bản ghi sau khi tải lên (${serverCount}/${builtDocs.length}). Phiên bản staging đã được hủy (aborted) để bảo vệ dữ liệu đang hoạt động.`
      );
    }

    // 5. Commit version (and atomically activate if requested)
    onProgress?.({
      stage: 'committing',
      writtenRows: builtDocs.length,
      totalRows: builtDocs.length,
      batchIndex: chunks.length,
      totalBatches: chunks.length,
      message: activate
        ? 'Đang xác nhận phiên bản và kích hoạt nguyên tử (kèm nhật ký kiểm toán)...'
        : 'Đang xác nhận lưu phiên bản (chưa kích hoạt)...',
    });

    if (!activate) {
      await updateDoc(versionRef, {
        commitState: 'committed',
        verifiedRowCount: builtDocs.length,
        committedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const activeRef = doc(db, FIRESTORE_COLLECTIONS.activeVersions, datasetKind);
      const existingActiveSnap = await getDoc(activeRef);
      const fromVersionId = existingActiveSnap.exists()
        ? String(existingActiveSnap.data().activeVersionId ?? '')
        : '';
      const eventId = generateEventId('activate', datasetKind);
      const historyRef = doc(db, FIRESTORE_COLLECTIONS.activationHistory, eventId);

      const finalBatch = writeBatch(db);
      // 5a. Commit staging -> committed
      finalBatch.update(versionRef, {
        commitState: 'committed',
        verifiedRowCount: builtDocs.length,
        committedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 5b. Create or update active_versions/{datasetKind} strictly obeying affectedKeys rules
      if (!existingActiveSnap.exists()) {
        finalBatch.set(activeRef, {
          datasetKind,
          activeVersionId: versionId,
          versionLabel,
          sourceDocumentName,
          sourceFileName,
          effectiveDate,
          importedAt,
          rowCount: builtDocs.length,
          spatialRecordsCount,
          notes,
          lastEventId: eventId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        finalBatch.update(activeRef, {
          activeVersionId: versionId,
          versionLabel,
          sourceDocumentName,
          sourceFileName,
          effectiveDate,
          importedAt,
          rowCount: builtDocs.length,
          spatialRecordsCount,
          notes,
          lastEventId: eventId,
          updatedAt: serverTimestamp(),
        });
      }

      // 5c. Append immutable audit log in /activation_history/{eventId}
      finalBatch.set(historyRef, {
        eventId,
        datasetKind,
        action: 'activate',
        fromVersionId,
        toVersionId: versionId,
        reason: notes || `Nạp và kích hoạt phiên bản ${versionLabel}`,
        actorUid: admin.uid,
        actorEmail: admin.email,
        createdAt: serverTimestamp(),
      });

      await finalBatch.commit();
    }

    onProgress?.({
      stage: 'completed',
      writtenRows: builtDocs.length,
      totalRows: builtDocs.length,
      batchIndex: chunks.length,
      totalBatches: chunks.length,
      message: activate
        ? `Hoàn tất nạp và kích hoạt ${builtDocs.length} bản ghi cho phiên bản "${versionLabel}".`
        : `Hoàn tất lưu phiên bản "${versionLabel}" (${builtDocs.length} bản ghi, chưa kích hoạt).`,
    });

    return {
      versionId,
      rowCount: builtDocs.length,
      spatialRecordsCount,
      payloadChecksum,
      activated: activate,
    };
  } catch (error) {
    // Best-effort abort staging doc if failure happened before commit
    try {
      const snap = await getDoc(versionRef);
      if (snap.exists() && snap.data().commitState === 'staging') {
        await updateDoc(versionRef, {
          commitState: 'aborted',
          updatedAt: serverTimestamp(),
        });
      }
    } catch {
      // Ignore secondary cleanup error so primary error surfaces cleanly
    }
    throw new Error(mapFirestoreErrorMessage(error, 'Nạp dữ liệu vào Cloud Firestore thất bại'));
  }
}

/**
 * Atomically switches `/active_versions/{datasetKind}` to a previously committed version
 * (activation or rollback) paired with an immutable `/activation_history/{eventId}` entry.
 */
export async function activateOrRollbackDatasetVersion(params: {
  datasetKind: DatasetKind;
  targetVersionId: string;
  action: 'activate' | 'rollback';
  reason?: string;
}): Promise<{ eventId: string; fromVersionId: string; toVersionId: string }> {
  const admin = assertAuthenticatedAdmin();
  const { datasetKind, targetVersionId, action, reason } = params;

  try {
    const targetRef = doc(db, FIRESTORE_COLLECTIONS.datasetVersions, targetVersionId);
    const targetSnap = await getDoc(targetRef);
    if (!targetSnap.exists()) {
      throw new Error(`Không tìm thấy phiên bản "${targetVersionId}" trong hệ thống.`);
    }
    const target = targetSnap.data();
    if (target.datasetKind !== datasetKind) {
      throw new Error(`Phiên bản "${targetVersionId}" không thuộc nhóm dữ liệu "${datasetKind}".`);
    }
    if (target.commitState !== 'committed') {
      throw new Error(
        `Không thể kích hoạt phiên bản đang ở trạng thái "${String(target.commitState)}" (chỉ cho phép phiên bản đã commit đầy đủ).`
      );
    }

    const activeRef = doc(db, FIRESTORE_COLLECTIONS.activeVersions, datasetKind);
    const activeSnap = await getDoc(activeRef);
    const fromVersionId = activeSnap.exists()
      ? String(activeSnap.data().activeVersionId ?? '')
      : '';

    if (fromVersionId === targetVersionId) {
      throw new Error(`Phiên bản "${targetVersionId}" hiện đã là phiên bản đang hoạt động.`);
    }
    if (action === 'rollback' && !fromVersionId) {
      throw new Error('Chưa có phiên bản đang hoạt động để thực hiện khôi phục (rollback).');
    }

    const effectiveAction: 'activate' | 'rollback' =
      action === 'rollback' && fromVersionId ? 'rollback' : 'activate';
    const eventId = generateEventId(effectiveAction, datasetKind);
    const historyRef = doc(db, FIRESTORE_COLLECTIONS.activationHistory, eventId);

    const batch = writeBatch(db);
    if (!activeSnap.exists()) {
      batch.set(activeRef, {
        datasetKind,
        activeVersionId: targetVersionId,
        versionLabel: String(target.versionLabel ?? targetVersionId),
        sourceDocumentName: String(target.sourceDocumentName ?? ''),
        sourceFileName: String(target.sourceFileName ?? ''),
        effectiveDate: String(target.effectiveDate ?? ''),
        importedAt: String(target.importedAt ?? ''),
        rowCount: Number(target.verifiedRowCount ?? 0),
        spatialRecordsCount: Number(target.spatialRecordsCount ?? 0),
        notes: String(target.notes ?? ''),
        lastEventId: eventId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(activeRef, {
        activeVersionId: targetVersionId,
        versionLabel: String(target.versionLabel ?? targetVersionId),
        sourceDocumentName: String(target.sourceDocumentName ?? ''),
        sourceFileName: String(target.sourceFileName ?? ''),
        effectiveDate: String(target.effectiveDate ?? ''),
        importedAt: String(target.importedAt ?? ''),
        rowCount: Number(target.verifiedRowCount ?? 0),
        spatialRecordsCount: Number(target.spatialRecordsCount ?? 0),
        notes: String(target.notes ?? ''),
        lastEventId: eventId,
        updatedAt: serverTimestamp(),
      });
    }

    batch.set(historyRef, {
      eventId,
      datasetKind,
      action: effectiveAction,
      fromVersionId,
      toVersionId: targetVersionId,
      reason: trimTo(
        reason ||
          (effectiveAction === 'rollback'
            ? `Khôi phục phiên bản ${String(target.versionLabel ?? targetVersionId)}`
            : `Kích hoạt phiên bản ${String(target.versionLabel ?? targetVersionId)}`),
        400
      ),
      actorUid: admin.uid,
      actorEmail: admin.email,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    return { eventId, fromVersionId, toVersionId: targetVersionId };
  } catch (error) {
    throw new Error(mapFirestoreErrorMessage(error, 'Chuyển đổi phiên bản dữ liệu thất bại'));
  }
}

export async function exportDatasetVersionBackupJson(
  datasetKind: DatasetKind,
  versionId: string
): Promise<{
  exportedAt: string;
  databaseId: string;
  datasetKind: DatasetKind;
  version: Record<string, unknown>;
  records: Array<StateLandPriceRecord | EcovisRecord | KFactorRuleRecord | MarketListingRecord>;
}> {
  assertAuthenticatedAdmin();
  try {
    const [versionSnap, recordsSnap] = await Promise.all([
      getDoc(doc(db, FIRESTORE_COLLECTIONS.datasetVersions, versionId)),
      getDocs(
        query(
          collection(db, FIRESTORE_COLLECTIONS.datasetRecords),
          where('datasetKind', '==', datasetKind),
          where('versionId', '==', versionId)
        )
      ),
    ]);

    if (!versionSnap.exists()) {
      throw new Error(`Không tìm thấy phiên bản "${versionId}" để xuất sao lưu.`);
    }

    const vData = versionSnap.data();
    return {
      exportedAt: new Date().toISOString(),
      databaseId: firestoreDatabaseId,
      datasetKind,
      version: {
        versionId: String(vData.versionId ?? versionId),
        versionLabel: String(vData.versionLabel ?? ''),
        commitState: String(vData.commitState ?? ''),
        sourceDocumentName: String(vData.sourceDocumentName ?? ''),
        sourceFileName: String(vData.sourceFileName ?? ''),
        effectiveDate: String(vData.effectiveDate ?? ''),
        importedAt: String(vData.importedAt ?? ''),
        expectedRowCount: Number(vData.expectedRowCount ?? 0),
        verifiedRowCount: Number(vData.verifiedRowCount ?? 0),
        spatialRecordsCount: Number(vData.spatialRecordsCount ?? 0),
        payloadChecksum: String(vData.payloadChecksum ?? ''),
        notes: String(vData.notes ?? ''),
        importedByEmail: String(vData.importedByEmail ?? ''),
      },
      records: recordsSnap.docs.map((d) => deserializeFirestoreRecordDoc(d.data())),
    };
  } catch (error) {
    throw new Error(mapFirestoreErrorMessage(error, 'Xuất bản sao lưu JSON thất bại'));
  }
}

export async function createPdfReferenceDocument(
  pdf: Omit<PdfReferenceDocument, 'id' | 'uploadedAt'> & { id?: string }
): Promise<PdfReferenceDocument> {
  assertAuthenticatedAdmin();
  const id = sanitizeIdToken(pdf.id || `pdf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, 'pdf', 80);
  const uploadedAt = new Date().toISOString();
  const fileName = nonEmptyOrFallback(pdf.fileName, `${id}.pdf`, 260);
  const documentTitle = nonEmptyOrFallback(pdf.documentTitle, fileName, 300);
  const effectiveDate = trimTo(pdf.effectiveDate, 64);
  const appendixNote = trimTo(pdf.appendixNote, 500);
  const fileSizeBytes = Math.max(0, Math.min(524288000, Math.floor(Number(pdf.fileSizeBytes) || 0)));
  const pageCount =
    pdf.pageCount !== null && Number.isInteger(pdf.pageCount) && pdf.pageCount >= 1 && pdf.pageCount <= 50000
      ? pdf.pageCount
      : null;

  try {
    await setDoc(doc(db, FIRESTORE_COLLECTIONS.pdfDocuments, id), {
      id,
      fileName,
      documentTitle,
      documentCategory: pdf.documentCategory,
      pageCount,
      effectiveDate,
      appendixNote,
      fileSizeBytes,
      uploadedAt,
      visibility: 'public',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return {
      id,
      fileName,
      documentTitle,
      documentCategory: pdf.documentCategory,
      pageCount,
      effectiveDate,
      appendixNote,
      fileSizeBytes,
      uploadedAt,
    };
  } catch (error) {
    throw new Error(mapFirestoreErrorMessage(error, 'Lưu danh mục tài liệu PDF thất bại'));
  }
}

export async function deletePdfReferenceDocument(docId: string): Promise<void> {
  assertAuthenticatedAdmin();
  try {
    await deleteDoc(doc(db, FIRESTORE_COLLECTIONS.pdfDocuments, docId));
  } catch (error) {
    throw new Error(mapFirestoreErrorMessage(error, 'Xóa tài liệu PDF thất bại'));
  }
}
