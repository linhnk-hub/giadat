export type ModuleId =
  | 'home'
  | 'quick-lookup'
  | 'parcel'
  | 'photos'
  | 'state-price'
  | 'ecovis'
  | 'market'
  | 'location-k'
  | 'data-management'
  | 'report';

export type DataSourceCategory =
  | 'official_state'
  | 'ecovis_survey'
  | 'market_reference'
  | 'user_input'
  | 'ai_suggested';

export type CoordinateSourceType =
  | 'exif'
  | 'image_overlay'
  | 'user_input'
  | 'geocoding'
  | 'ai_inferred'
  | 'none';

export type ConfidenceLevel = 'cao' | 'trung_binh' | 'thap' | 'khong_xac_dinh';

export type DatasetKind = 'state_price' | 'ecovis' | 'k_factor_rules' | 'market_survey';

export interface ParcelInfo {
  dossierCode: string;
  collateralName: string;
  officerName: string;
  createdAt: string;
  updatedAt: string;
  address: string;
  wardCommune: string;
  districtCity: string;
  streetName: string;
  roadSegmentRef: string;
  parcelNumber: string;
  mapSheetNumber: string;
  landTypeCertificate: string;
  areaSqm: number | null;
  frontageWidthM: number | null;
  depthM: number | null;
  distanceToMainRoadM: number | null;
  adjacentRoadName: string;
  roadAlleyWidthM: number | null;
  frontageCount: number | null;
  roadCondition: string;
  additionalNotes: string;
  officerConfirmedParcelInfo: boolean;
}

export interface FieldPhotoItem {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  previewDataUrl: string;
  uploadedAt: string;
  // EXIF extracted data
  exifLatitude: number | null;
  exifLongitude: number | null;
  exifCapturedAt: string | null;
  cameraModel: string | null;
  // Overlay OCR (Gemini server-side)
  ocrAttempted: boolean;
  ocrHasGps: boolean;
  ocrLatitude: number | null;
  ocrLongitude: number | null;
  ocrCapturedAt: string | null;
  ocrAddress: string | null;
  ocrRawText: string | null;
  ocrConfidence: ConfidenceLevel;
  ocrNotes: string | null;
  // Active chosen/edited coordinate
  activeLatitude: number | null;
  activeLongitude: number | null;
  coordinateSource: CoordinateSourceType;
  confidence: ConfidenceLevel;
  capturedAt: string | null;
  // Officer verification (NEVER auto-confirmed)
  officerConfirmedCoordinates: boolean;
  officerConfirmedAtParcel: boolean;
  officerNote: string;
  // M2 optional server-side reverse geocoding result for location identification
  reverseGeocode?: ReverseGeocodeResult | null;
}

export interface ReverseGeocodeResult {
  available: boolean;
  source: 'nominatim_osm' | 'none';
  resolvedAt: string;
  displayName: string;
  streetName: string;
  wardCommune: string;
  districtCity: string;
  province: string;
  country: string;
  inKhanhHoa: boolean | null;
  note: string;
}

export type LookupMatchTier = 'exact_location' | 'nearby_comparable';

export interface StateLandPriceRecord {
  id: string;
  recordCode: string;
  legalDocumentName: string;
  wardCommune: string;
  districtCity: string;
  streetName: string;
  roadSegment: string;
  startPoint: string;
  endPoint: string;
  landType: string;
  position: string;
  unitPrice: number;
  unit: string;
  sourcePageOrAppendix: string;
  effectiveDate: string;
  importedAt: string;
  versionId: string;
  latitude?: number | null;
  longitude?: number | null;
  coordinateNote?: string;
  isDemo?: boolean;
}

export interface EcovisRecord {
  id: string;
  recordCode: string;
  wardCommune: string;
  districtCity: string;
  streetName: string;
  roadSegment: string;
  landType: string;
  position: string;
  surveyUnitPrice: number;
  unit: string;
  sourceDocument: string;
  appendixAndPage: string;
  surveyOrReportDate: string;
  importedAt: string;
  versionId: string;
  latitude?: number | null;
  longitude?: number | null;
  coordinateNote?: string;
  isDemo?: boolean;
}

export interface MarketListingRecord {
  id: string;
  listingCode: string;
  sourceName: string;
  url: string;
  postedDate: string;
  address: string;
  wardCommune: string;
  areaSqm: number | null;
  askingPriceVnd: number | null;
  unitPricePerSqm: number | null;
  propertyType: string;
  locationInfo: string;
  verificationStatus: 'chua_xac_minh' | 'da_xac_minh_so_bo' | 'loai_tru';
  verificationNote: string;
  isDuplicate: boolean;
  duplicateOfId?: string | null;
  createdAt: string;
  latitude?: number | null;
  longitude?: number | null;
  coordinateNote?: string;
  isDemo?: boolean;
}

export interface KFactorRuleRecord {
  id: string;
  ruleCode: string;
  factorName: string;
  factorValue: number;
  formula: string;
  applicableCondition: string;
  requiredInputFields: string;
  sourceDocument: string;
  sourcePage: string;
  effectiveDate: string;
  importedAt: string;
  versionId: string;
  isDemo?: boolean;
}

export interface AppliedKFactorItem {
  id: string;
  ruleId: string;
  factorName: string;
  value: number | null;
  formula: string;
  applicableCondition: string;
  sourceDocument: string;
  sourcePage: string;
  inputDataSummary: string;
  hasSufficientBasis: boolean;
  missingBasisReasons: string[];
  verificationStatus: 'chua_xac_minh' | 'da_xac_minh';
  officerNote: string;
  isDemo?: boolean;
}

export interface LocationAnalysisState {
  selectedStatePosition: string;
  statePositionBasis: string;
  statePositionVerified: boolean;
  otherDocumentedFactors: string;
  appliedKFactors: AppliedKFactorItem[];
  officerSummaryNotes: string;
}

export interface AttachedStateReference {
  record: StateLandPriceRecord;
  attachedAt: string;
  officerConfirmedMatch: boolean;
  officerNote: string;
  matchTier?: LookupMatchTier;
  matchReason?: string;
  distanceMeters?: number | null;
}

export interface AttachedEcovisReference {
  record: EcovisRecord;
  attachedAt: string;
  officerConfirmedMatch: boolean;
  officerNote: string;
  matchTier?: LookupMatchTier;
  matchReason?: string;
  distanceMeters?: number | null;
}

export interface PdfReferenceDocument {
  id: string;
  fileName: string;
  documentTitle: string;
  documentCategory: 'bang_gia_nha_nuoc' | 'bao_cao_ecovis' | 'quy_dinh_he_so_k' | 'khac';
  pageCount: number | null;
  effectiveDate: string;
  appendixNote: string;
  fileSizeBytes: number;
  uploadedAt: string;
  sessionObjectUrl?: string;
}

export interface DatasetVersionMetadata {
  versionId: string;
  datasetKind: DatasetKind;
  versionLabel: string;
  sourceDocumentName: string;
  sourceFileName: string;
  effectiveDate: string;
  importedAt: string;
  rowCount: number;
  spatialRecordsCount?: number;
  notes: string;
  isActive: boolean;
  importedByEmail?: string;
}

export interface ValidationRowIssue {
  rowNumber: number;
  severity: 'error' | 'warning';
  field: string;
  message: string;
}

export interface ImportPreviewResult<T> {
  datasetKind: DatasetKind;
  fileName: string;
  totalRows: number;
  validRows: T[];
  validSpatialCount?: number;
  missingRequiredColumns: string[];
  duplicateCodes: string[];
  issues: ValidationRowIssue[];
  canCommit: boolean;
}

export interface AppraisalDossier {
  id: string;
  isDemoDossier?: boolean;
  parcel: ParcelInfo;
  photos: FieldPhotoItem[];
  attachedStateRefs: AttachedStateReference[];
  attachedEcovisRefs: AttachedEcovisReference[];
  attachedMarketIds: string[];
  locationAnalysis: LocationAnalysisState;
  reportNotes: string;
}

export interface AttachOperationResult {
  ok: boolean;
  error?: string;
}

export interface ContaminatedDemoItem {
  category: 'state_price' | 'ecovis' | 'market_listing' | 'k_factor';
  categoryLabel: string;
  id: string;
  label: string;
  reason: string;
}

export interface ComponentOriginSummary {
  component: string;
  totalCount: number;
  realCount: number;
  demoCount: number;
  originStatus: 'chua_gan' | 'du_lieu_that' | 'du_lieu_demo' | 'nhiem_demo';
}

export interface DossierIntegrityReport {
  status: 'clean_real' | 'isolated_demo' | 'contaminated_real';
  isDemoDossier: boolean;
  hasAnyDemoData: boolean;
  isContaminatedRealDossier: boolean;
  canExportAsOfficialRealReport: boolean;
  canExportDemoReport: boolean;
  contaminatedItems: ContaminatedDemoItem[];
  componentOrigins: ComponentOriginSummary[];
  integrityWarnings: string[];
}
