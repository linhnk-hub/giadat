import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  AppliedKFactorItem,
  AppraisalDossier,
  AttachOperationResult,
  ContaminatedDemoItem,
  DatasetKind,
  DatasetVersionMetadata,
  DossierIntegrityReport,
  EcovisRecord,
  FieldPhotoItem,
  KFactorRuleRecord,
  LocationAnalysisState,
  LookupMatchTier,
  MarketListingRecord,
  ModuleId,
  ParcelInfo,
  PdfReferenceDocument,
  StateLandPriceRecord,
} from '../types/valuation';
import {
  inspectDossierIntegrity,
  isAppliedKFactorDemo,
  isEcovisRecordDemo,
  isMarketListingDemo,
  isStateRecordDemo,
  validateAttachToDossier,
} from '../utils/dossierIntegrity';
import { buildApiUrl } from '../utils/apiClient';
import { detectDuplicateMarketListings } from '../utils/formatters';

const STORAGE_KEY_DATASETS = 'khanh_hoa_land_real_datasets_v1';
const STORAGE_KEY_DOSSIERS = 'khanh_hoa_land_dossiers_v1';
const STORAGE_KEY_PDFS = 'khanh_hoa_land_pdfs_v1';

interface VersionedBucket<T> {
  activeVersionId: string | null;
  versions: Array<{
    meta: DatasetVersionMetadata;
    records: T[];
  }>;
}

interface RealDatasetsState {
  statePrice: VersionedBucket<StateLandPriceRecord>;
  ecovis: VersionedBucket<EcovisRecord>;
  kFactorRules: VersionedBucket<KFactorRuleRecord>;
  marketSurvey: VersionedBucket<MarketListingRecord>;
  manualMarketListings: MarketListingRecord[];
}

export interface ServerActiveDatasetsSnapshot {
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

export interface LocalMigrationPayload {
  versions: Array<{
    kind: DatasetKind;
    meta: DatasetVersionMetadata;
    records: StateLandPriceRecord[] | EcovisRecord[] | KFactorRuleRecord[] | MarketListingRecord[];
    wasActive: boolean;
  }>;
  pdfDocuments: Omit<PdfReferenceDocument, 'sessionObjectUrl'>[];
}

function createEmptyBucket<T>(): VersionedBucket<T> {
  return {
    activeVersionId: null,
    versions: [],
  };
}

function createInitialRealDatasets(): RealDatasetsState {
  return {
    statePrice: createEmptyBucket<StateLandPriceRecord>(),
    ecovis: createEmptyBucket<EcovisRecord>(),
    kFactorRules: createEmptyBucket<KFactorRuleRecord>(),
    marketSurvey: createEmptyBucket<MarketListingRecord>(),
    manualMarketListings: [],
  };
}

export function createEmptyParcel(codeNumber = 1, isDemo = false): ParcelInfo {
  const now = new Date().toISOString();
  const padded = String(codeNumber).padStart(3, '0');
  const prefix = isDemo ? 'HS-DEMO-KH' : 'HS-KH';
  return {
    dossierCode: `${prefix}-${new Date().getFullYear()}-${padded}`,
    collateralName: isDemo ? '[DEMO] Tài sản minh họa quy trình' : '',
    officerName: '',
    createdAt: now,
    updatedAt: now,
    address: '',
    wardCommune: '',
    districtCity: '',
    streetName: '',
    roadSegmentRef: '',
    parcelNumber: '',
    mapSheetNumber: '',
    landTypeCertificate: '',
    areaSqm: null,
    frontageWidthM: null,
    depthM: null,
    distanceToMainRoadM: null,
    adjacentRoadName: '',
    roadAlleyWidthM: null,
    frontageCount: null,
    roadCondition: '',
    additionalNotes: '',
    officerConfirmedParcelInfo: false,
  };
}

export function createEmptyDossier(index = 1, isDemoDossier = false): AppraisalDossier {
  return {
    id: `${isDemoDossier ? 'demo-dossier' : 'dossier'}-${Date.now()}-${index}`,
    isDemoDossier,
    parcel: createEmptyParcel(index, isDemoDossier),
    photos: [],
    attachedStateRefs: [],
    attachedEcovisRefs: [],
    attachedMarketIds: [],
    locationAnalysis: {
      selectedStatePosition: '',
      statePositionBasis: '',
      statePositionVerified: false,
      otherDocumentedFactors: '',
      appliedKFactors: [],
      officerSummaryNotes: '',
    },
    reportNotes: '',
  };
}

interface AppDataContextValue {
  activeModule: ModuleId;
  setActiveModule: (module: ModuleId) => void;
  // Separate DEMO mode flag (NEVER mixed into real datasets or real dossiers)
  isDemoMode: boolean;
  setIsDemoMode: (value: boolean) => void;
  // Active records exposed to lookup modules (automatically reflects Real vs Demo)
  activeStateRecords: StateLandPriceRecord[];
  activeEcovisRecords: EcovisRecord[];
  activeKFactorRules: KFactorRuleRecord[];
  activeMarketListings: MarketListingRecord[];
  // Full known market listings (real + demo) for integrity inspection of legacy dossiers
  allKnownMarketListings: MarketListingRecord[];
  // Real dataset metadata & versions (for Data Management & Home Status)
  realStateCount: number;
  realEcovisCount: number;
  realKRulesCount: number;
  realMarketCount: number;
  allVersionHistory: DatasetVersionMetadata[];
  activeStateMeta: DatasetVersionMetadata | null;
  activeEcovisMeta: DatasetVersionMetadata | null;
  activeKRulesMeta: DatasetVersionMetadata | null;
  activeMarketMeta: DatasetVersionMetadata | null;
  // Import & Version operations
  commitDatasetVersion: (
    kind: DatasetKind,
    meta: Omit<DatasetVersionMetadata, 'isActive'>,
    records: StateLandPriceRecord[] | EcovisRecord[] | KFactorRuleRecord[] | MarketListingRecord[]
  ) => void;
  activateDatasetVersion: (kind: DatasetKind, versionId: string) => void;
  // M1.2 Server Dataset Synchronization (public read + admin write sync)
  serverDatasetStatus: 'loading' | 'synced' | 'offline';
  serverUpdatedAt: string | null;
  applyServerActiveSnapshot: (snapshot: ServerActiveDatasetsSnapshot) => void;
  refreshServerDatasets: () => Promise<void>;
  localVersionsCount: number;
  exportLocalDatasetsForMigration: () => LocalMigrationPayload;
  // PDF reference archive
  pdfDocuments: PdfReferenceDocument[];
  addPdfDocument: (doc: PdfReferenceDocument) => void;
  removePdfDocument: (id: string) => void;
  // Market listing CRUD (operates on real manual listings when not demo, or isolated session demo list when demo)
  addManualMarketListing: (listing: Omit<MarketListingRecord, 'id' | 'createdAt' | 'isDuplicate' | 'duplicateOfId'>) => void;
  updateMarketListingStatus: (
    id: string,
    status: MarketListingRecord['verificationStatus'],
    note?: string
  ) => void;
  removeMarketListing: (id: string) => void;
  removeDuplicateMarketListings: () => number;
  // Dossier operations (Real dossiers persisted in localStorage; Demo dossiers isolated in memory)
  dossiers: AppraisalDossier[];
  activeDossier: AppraisalDossier;
  activeDossierIntegrity: DossierIntegrityReport;
  selectDossier: (id: string) => void;
  createNewDossier: () => void;
  updateParcelInfo: (patch: Partial<ParcelInfo>) => void;
  addFieldPhotos: (photos: FieldPhotoItem[]) => void;
  updateFieldPhoto: (id: string, patch: Partial<FieldPhotoItem>) => void;
  removeFieldPhoto: (id: string) => void;
  attachStateReference: (
    record: StateLandPriceRecord,
    matchContext?: { matchTier?: LookupMatchTier; matchReason?: string; distanceMeters?: number | null }
  ) => AttachOperationResult;
  updateAttachedStateRef: (recordId: string, patch: { officerConfirmedMatch?: boolean; officerNote?: string }) => void;
  removeAttachedStateRef: (recordId: string) => void;
  attachEcovisReference: (
    record: EcovisRecord,
    matchContext?: { matchTier?: LookupMatchTier; matchReason?: string; distanceMeters?: number | null }
  ) => AttachOperationResult;
  updateAttachedEcovisRef: (recordId: string, patch: { officerConfirmedMatch?: boolean; officerNote?: string }) => void;
  removeAttachedEcovisRef: (recordId: string) => void;
  toggleAttachMarketListing: (listingId: string) => AttachOperationResult;
  updateLocationAnalysis: (patch: Partial<LocationAnalysisState>) => void;
  addAppliedKFactor: (item: AppliedKFactorItem) => AttachOperationResult;
  updateAppliedKFactor: (id: string, patch: Partial<AppliedKFactorItem>) => void;
  removeAppliedKFactor: (id: string) => void;
  removeContaminatedItem: (item: ContaminatedDemoItem) => void;
  updateReportNotes: (notes: string) => void;
  storageWarning: string | null;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const AppDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeModule, setActiveModule] = useState<ModuleId>('home');
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);

  const [realDatasets, setRealDatasets] = useState<RealDatasetsState>(() =>
    loadFromStorage<RealDatasetsState>(STORAGE_KEY_DATASETS, createInitialRealDatasets())
  );

  // M1.2 Server-persisted active datasets (public read-only sync via /api/datasets/active)
  const [serverSnapshot, setServerSnapshot] = useState<ServerActiveDatasetsSnapshot | null>(null);
  const [serverDatasetStatus, setServerDatasetStatus] = useState<'loading' | 'synced' | 'offline'>('loading');

  // Isolated in-memory demo market listings (empty after demoData.ts removal)
  const [demoMarketListings, setDemoMarketListings] = useState<MarketListingRecord[]>(() =>
    detectDuplicateMarketListings([])
  );

  const [pdfDocuments, setPdfDocuments] = useState<PdfReferenceDocument[]>(() =>
    loadFromStorage<PdfReferenceDocument[]>(STORAGE_KEY_PDFS, [])
  );

  const applyServerActiveSnapshot = useCallback((snapshot: ServerActiveDatasetsSnapshot) => {
    setServerSnapshot(snapshot);
    setServerDatasetStatus('synced');
  }, []);

  const refreshServerDatasets = useCallback(async () => {
    try {
      const response = await fetch(buildApiUrl('/api/datasets/active'), { cache: 'no-store' });
      if (!response.ok) {
        setServerDatasetStatus('offline');
        return;
      }
      const data = (await response.json()) as ServerActiveDatasetsSnapshot;
      if (data && data.active) {
        setServerSnapshot(data);
        setServerDatasetStatus('synced');
      } else {
        setServerDatasetStatus('offline');
      }
    } catch {
      setServerDatasetStatus('offline');
    }
  }, []);

  useEffect(() => {
    void refreshServerDatasets();
  }, [refreshServerDatasets]);

  // Real operational dossiers persisted in localStorage (legacy dossiers loaded intact without silent deletion)
  const [realDossiers, setRealDossiers] = useState<AppraisalDossier[]>(() => {
    const loaded = loadFromStorage<AppraisalDossier[]>(STORAGE_KEY_DOSSIERS, []);
    const onlyReal = loaded.filter((d) => d.isDemoDossier !== true);
    return onlyReal.length > 0 ? onlyReal : [createEmptyDossier(1, false)];
  });

  // Isolated in-memory DEMO dossiers (NEVER saved to real localStorage)
  const [demoDossiers, setDemoDossiers] = useState<AppraisalDossier[]>(() => [
    createEmptyDossier(1, true),
  ]);

  const [activeRealDossierId, setActiveRealDossierId] = useState<string>(() => realDossiers[0].id);
  const [activeDemoDossierId, setActiveDemoDossierId] = useState<string>(() => demoDossiers[0].id);

  // Persist real datasets
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_DATASETS, JSON.stringify(realDatasets));
      setStorageWarning(null);
    } catch {
      setStorageWarning(
        'Dung lượng lưu trữ trình duyệt đã gần đầy. Một số dữ liệu lớn có thể chỉ được lưu tạm trong phiên hiện tại.'
      );
    }
  }, [realDatasets]);

  // Persist PDF metadata (strip transient blob URLs)
  useEffect(() => {
    try {
      const serializable = pdfDocuments.map(({ sessionObjectUrl: _omit, ...rest }) => rest);
      localStorage.setItem(STORAGE_KEY_PDFS, JSON.stringify(serializable));
    } catch {
      // ignore
    }
  }, [pdfDocuments]);

  // Persist ONLY real dossiers (gracefully strip heavy photo data URLs only if quota exceeded)
  useEffect(() => {
    try {
      const safeRealOnly = realDossiers.filter((d) => d.isDemoDossier !== true);
      localStorage.setItem(STORAGE_KEY_DOSSIERS, JSON.stringify(safeRealOnly));
    } catch {
      try {
        const lightweight = realDossiers
          .filter((d) => d.isDemoDossier !== true)
          .map((d) => ({
            ...d,
            photos: d.photos.map((p) => ({ ...p, previewDataUrl: '' })),
          }));
        localStorage.setItem(STORAGE_KEY_DOSSIERS, JSON.stringify(lightweight));
        setStorageWarning(
          'Ảnh thực địa có dung lượng lớn nên chỉ giữ hình xem trước trong phiên làm việc hiện tại (tọa độ GPS và xác nhận vẫn được lưu).'
        );
      } catch {
        setStorageWarning('Không thể lưu thêm vào bộ nhớ trình duyệt do vượt quá hạn mức.');
      }
    }
  }, [realDossiers]);

  const dossiers = isDemoMode ? demoDossiers : realDossiers;

  const activeDossier = useMemo(() => {
    if (isDemoMode) {
      return demoDossiers.find((d) => d.id === activeDemoDossierId) ?? demoDossiers[0];
    }
    return realDossiers.find((d) => d.id === activeRealDossierId) ?? realDossiers[0];
  }, [isDemoMode, demoDossiers, activeDemoDossierId, realDossiers, activeRealDossierId]);

  const getActiveBucketData = <T,>(bucket: VersionedBucket<T>): { meta: DatasetVersionMetadata | null; records: T[] } => {
    if (!bucket.activeVersionId) return { meta: null, records: [] };
    const found = bucket.versions.find((v) => v.meta.versionId === bucket.activeVersionId);
    if (!found) return { meta: null, records: [] };
    return { meta: found.meta, records: found.records };
  };

  const activeLocalState = useMemo(() => getActiveBucketData(realDatasets.statePrice), [realDatasets.statePrice]);
  const activeLocalEcovis = useMemo(() => getActiveBucketData(realDatasets.ecovis), [realDatasets.ecovis]);
  const activeLocalKRules = useMemo(() => getActiveBucketData(realDatasets.kFactorRules), [realDatasets.kFactorRules]);
  const activeLocalMarketImport = useMemo(() => getActiveBucketData(realDatasets.marketSurvey), [realDatasets.marketSurvey]);

  // Prefer server-published official dataset when available; seamlessly fall back to localStorage so existing local data is never lost
  const activeRealState = useMemo(
    () => (serverSnapshot?.active.statePrice.meta ? serverSnapshot.active.statePrice : activeLocalState),
    [serverSnapshot, activeLocalState]
  );
  const activeRealEcovis = useMemo(
    () => (serverSnapshot?.active.ecovis.meta ? serverSnapshot.active.ecovis : activeLocalEcovis),
    [serverSnapshot, activeLocalEcovis]
  );
  const activeRealKRules = useMemo(
    () => (serverSnapshot?.active.kFactorRules.meta ? serverSnapshot.active.kFactorRules : activeLocalKRules),
    [serverSnapshot, activeLocalKRules]
  );
  const activeRealMarketImport = useMemo(
    () => (serverSnapshot?.active.marketSurvey.meta ? serverSnapshot.active.marketSurvey : activeLocalMarketImport),
    [serverSnapshot, activeLocalMarketImport]
  );

  // Merge server PDF archive with any local session PDFs (preserving transient sessionObjectUrl when matching id)
  const effectivePdfDocuments = useMemo(() => {
    const localById = new Map(pdfDocuments.map((d) => [d.id, d]));
    const serverList = serverSnapshot?.pdfDocuments ?? [];
    if (serverList.length === 0) return pdfDocuments;
    const merged: PdfReferenceDocument[] = serverList.map((srvDoc) => {
      const localMatch = localById.get(srvDoc.id);
      return localMatch?.sessionObjectUrl
        ? { ...srvDoc, sessionObjectUrl: localMatch.sessionObjectUrl }
        : srvDoc;
    });
    const serverIds = new Set(serverList.map((d) => d.id));
    for (const localDoc of pdfDocuments) {
      if (!serverIds.has(localDoc.id)) {
        merged.push(localDoc);
      }
    }
    return merged;
  }, [pdfDocuments, serverSnapshot]);

  const combinedRealMarket = useMemo(() => {
    return detectDuplicateMarketListings([
      ...realDatasets.manualMarketListings,
      ...activeRealMarketImport.records,
    ]);
  }, [realDatasets.manualMarketListings, activeRealMarketImport.records]);

  const localVersionsCount = useMemo(
    () =>
      realDatasets.statePrice.versions.length +
      realDatasets.ecovis.versions.length +
      realDatasets.kFactorRules.versions.length +
      realDatasets.marketSurvey.versions.length,
    [realDatasets]
  );

  const exportLocalDatasetsForMigration = useCallback((): LocalMigrationPayload => {
    const versions: LocalMigrationPayload['versions'] = [
      ...realDatasets.statePrice.versions.map((v) => ({
        kind: 'state_price' as const,
        meta: v.meta,
        records: v.records,
        wasActive: v.meta.versionId === realDatasets.statePrice.activeVersionId,
      })),
      ...realDatasets.ecovis.versions.map((v) => ({
        kind: 'ecovis' as const,
        meta: v.meta,
        records: v.records,
        wasActive: v.meta.versionId === realDatasets.ecovis.activeVersionId,
      })),
      ...realDatasets.kFactorRules.versions.map((v) => ({
        kind: 'k_factor_rules' as const,
        meta: v.meta,
        records: v.records,
        wasActive: v.meta.versionId === realDatasets.kFactorRules.activeVersionId,
      })),
      ...realDatasets.marketSurvey.versions.map((v) => ({
        kind: 'market_survey' as const,
        meta: v.meta,
        records: v.records,
        wasActive: v.meta.versionId === realDatasets.marketSurvey.activeVersionId,
      })),
    ];

    const serializablePdfs = pdfDocuments.map(({ sessionObjectUrl: _omit, ...rest }) => rest);
    return { versions, pdfDocuments: serializablePdfs };
  }, [realDatasets, pdfDocuments]);

  const activeStateRecords: StateLandPriceRecord[] = isDemoMode ? [] : activeRealState.records;
  const activeEcovisRecords: EcovisRecord[] = isDemoMode ? [] : activeRealEcovis.records;
  const activeKFactorRules: KFactorRuleRecord[] = isDemoMode ? [] : activeRealKRules.records;
  const activeMarketListings = isDemoMode ? demoMarketListings : combinedRealMarket;

  const allKnownMarketListings = useMemo(
    () => [...combinedRealMarket, ...demoMarketListings],
    [combinedRealMarket, demoMarketListings]
  );

  const activeDossierIntegrity = useMemo(
    () => inspectDossierIntegrity(activeDossier, allKnownMarketListings, isDemoMode),
    [activeDossier, allKnownMarketListings, isDemoMode]
  );

  const allVersionHistory = useMemo(() => {
    const list: DatasetVersionMetadata[] = [
      ...realDatasets.statePrice.versions.map((v) => ({
        ...v.meta,
        isActive: v.meta.versionId === realDatasets.statePrice.activeVersionId,
      })),
      ...realDatasets.ecovis.versions.map((v) => ({
        ...v.meta,
        isActive: v.meta.versionId === realDatasets.ecovis.activeVersionId,
      })),
      ...realDatasets.kFactorRules.versions.map((v) => ({
        ...v.meta,
        isActive: v.meta.versionId === realDatasets.kFactorRules.activeVersionId,
      })),
      ...realDatasets.marketSurvey.versions.map((v) => ({
        ...v.meta,
        isActive: v.meta.versionId === realDatasets.marketSurvey.activeVersionId,
      })),
    ];
    return list.sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime());
  }, [realDatasets]);

  const commitDatasetVersion = (
    kind: DatasetKind,
    meta: Omit<DatasetVersionMetadata, 'isActive'>,
    records: StateLandPriceRecord[] | EcovisRecord[] | KFactorRuleRecord[] | MarketListingRecord[]
  ) => {
    setRealDatasets((prev) => {
      const fullMeta: DatasetVersionMetadata = { ...meta, isActive: true };
      if (kind === 'state_price') {
        return {
          ...prev,
          statePrice: {
            activeVersionId: fullMeta.versionId,
            versions: [
              { meta: fullMeta, records: records as StateLandPriceRecord[] },
              ...prev.statePrice.versions,
            ],
          },
        };
      }
      if (kind === 'ecovis') {
        return {
          ...prev,
          ecovis: {
            activeVersionId: fullMeta.versionId,
            versions: [
              { meta: fullMeta, records: records as EcovisRecord[] },
              ...prev.ecovis.versions,
            ],
          },
        };
      }
      if (kind === 'k_factor_rules') {
        return {
          ...prev,
          kFactorRules: {
            activeVersionId: fullMeta.versionId,
            versions: [
              { meta: fullMeta, records: records as KFactorRuleRecord[] },
              ...prev.kFactorRules.versions,
            ],
          },
        };
      }
      return {
        ...prev,
        marketSurvey: {
          activeVersionId: fullMeta.versionId,
          versions: [
            { meta: fullMeta, records: records as MarketListingRecord[] },
            ...prev.marketSurvey.versions,
          ],
        },
      };
    });
  };

  const activateDatasetVersion = (kind: DatasetKind, versionId: string) => {
    setRealDatasets((prev) => {
      if (kind === 'state_price') {
        return { ...prev, statePrice: { ...prev.statePrice, activeVersionId: versionId } };
      }
      if (kind === 'ecovis') {
        return { ...prev, ecovis: { ...prev.ecovis, activeVersionId: versionId } };
      }
      if (kind === 'k_factor_rules') {
        return { ...prev, kFactorRules: { ...prev.kFactorRules, activeVersionId: versionId } };
      }
      return { ...prev, marketSurvey: { ...prev.marketSurvey, activeVersionId: versionId } };
    });
  };

  const addPdfDocument = (doc: PdfReferenceDocument) => {
    setPdfDocuments((prev) => [doc, ...prev]);
  };

  const removePdfDocument = (id: string) => {
    setPdfDocuments((prev) => prev.filter((d) => d.id !== id));
  };

  const addManualMarketListing = (
    listing: Omit<MarketListingRecord, 'id' | 'createdAt' | 'isDuplicate' | 'duplicateOfId'>
  ) => {
    const idPrefix = isDemoMode ? 'demo-mkt-manual' : 'mkt-manual';
    const newItem: MarketListingRecord = {
      ...listing,
      id: `${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
      isDuplicate: false,
      duplicateOfId: null,
      isDemo: isDemoMode,
    };

    if (isDemoMode) {
      setDemoMarketListings((prev) => detectDuplicateMarketListings([newItem, ...prev]));
    } else {
      setRealDatasets((prev) => ({
        ...prev,
        manualMarketListings: [newItem, ...prev.manualMarketListings],
      }));
    }
  };

  const updateMarketListingStatus = (
    id: string,
    status: MarketListingRecord['verificationStatus'],
    note?: string
  ) => {
    const updater = (item: MarketListingRecord) =>
      item.id === id
        ? {
            ...item,
            verificationStatus: status,
            verificationNote: note !== undefined ? note : item.verificationNote,
          }
        : item;

    if (isDemoMode) {
      setDemoMarketListings((prev) => prev.map(updater));
    } else {
      setRealDatasets((prev) => ({
        ...prev,
        manualMarketListings: prev.manualMarketListings.map(updater),
        marketSurvey: {
          ...prev.marketSurvey,
          versions: prev.marketSurvey.versions.map((v) => ({
            ...v,
            records: v.records.map(updater),
          })),
        },
      }));
    }
  };

  const removeMarketListing = (id: string) => {
    if (isDemoMode) {
      setDemoMarketListings((prev) => detectDuplicateMarketListings(prev.filter((m) => m.id !== id)));
      setDemoDossiers((prev) =>
        prev.map((d) => ({
          ...d,
          attachedMarketIds: d.attachedMarketIds.filter((mid) => mid !== id),
        }))
      );
    } else {
      setRealDatasets((prev) => ({
        ...prev,
        manualMarketListings: prev.manualMarketListings.filter((m) => m.id !== id),
        marketSurvey: {
          ...prev.marketSurvey,
          versions: prev.marketSurvey.versions.map((v) => ({
            ...v,
            records: v.records.filter((m) => m.id !== id),
          })),
        },
      }));
      setRealDossiers((prev) =>
        prev.map((d) => ({
          ...d,
          attachedMarketIds: d.attachedMarketIds.filter((mid) => mid !== id),
        }))
      );
    }
  };

  const removeDuplicateMarketListings = (): number => {
    const dupIds = new Set(activeMarketListings.filter((m) => m.isDuplicate).map((m) => m.id));
    if (dupIds.size === 0) return 0;

    if (isDemoMode) {
      setDemoMarketListings((prev) =>
        detectDuplicateMarketListings(prev.filter((m) => !dupIds.has(m.id)))
      );
    } else {
      setRealDatasets((prev) => ({
        ...prev,
        manualMarketListings: prev.manualMarketListings.filter((m) => !dupIds.has(m.id)),
        marketSurvey: {
          ...prev.marketSurvey,
          versions: prev.marketSurvey.versions.map((v) => ({
            ...v,
            records: v.records.filter((m) => !dupIds.has(m.id)),
          })),
        },
      }));
    }
    return dupIds.size;
  };

  // Dossier helpers (strictly isolated between realDossiers and demoDossiers)
  const mutateActiveDossier = (updater: (d: AppraisalDossier) => AppraisalDossier) => {
    if (isDemoMode) {
      setDemoDossiers((prev) => prev.map((d) => (d.id === activeDossier.id ? updater(d) : d)));
    } else {
      setRealDossiers((prev) => prev.map((d) => (d.id === activeDossier.id ? updater(d) : d)));
    }
  };

  const selectDossier = (id: string) => {
    if (isDemoMode) {
      setActiveDemoDossierId(id);
    } else {
      setActiveRealDossierId(id);
    }
  };

  const createNewDossier = () => {
    if (isDemoMode) {
      const created = createEmptyDossier(demoDossiers.length + 1, true);
      setDemoDossiers((prev) => [created, ...prev]);
      setActiveDemoDossierId(created.id);
    } else {
      const created = createEmptyDossier(realDossiers.length + 1, false);
      setRealDossiers((prev) => [created, ...prev]);
      setActiveRealDossierId(created.id);
    }
  };

  const updateParcelInfo = (patch: Partial<ParcelInfo>) => {
    mutateActiveDossier((d) => ({
      ...d,
      parcel: {
        ...d.parcel,
        ...patch,
        updatedAt: new Date().toISOString(),
      },
    }));
  };

  const addFieldPhotos = (photos: FieldPhotoItem[]) => {
    mutateActiveDossier((d) => ({
      ...d,
      photos: [...photos, ...d.photos],
    }));
  };

  const updateFieldPhoto = (id: string, patch: Partial<FieldPhotoItem>) => {
    mutateActiveDossier((d) => ({
      ...d,
      photos: d.photos.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  };

  const removeFieldPhoto = (id: string) => {
    mutateActiveDossier((d) => ({
      ...d,
      photos: d.photos.filter((p) => p.id !== id),
    }));
  };

  const attachStateReference = (
    record: StateLandPriceRecord,
    matchContext?: { matchTier?: LookupMatchTier; matchReason?: string; distanceMeters?: number | null }
  ): AttachOperationResult => {
    const guard = validateAttachToDossier(
      activeDossier,
      isStateRecordDemo(record),
      `${record.recordCode} – ${record.streetName}`
    );
    if (!guard.ok) return guard;

    mutateActiveDossier((d) => {
      if (d.attachedStateRefs.some((r) => r.record.id === record.id)) return d;
      return {
        ...d,
        attachedStateRefs: [
          ...d.attachedStateRefs,
          {
            record,
            attachedAt: new Date().toISOString(),
            officerConfirmedMatch: false,
            officerNote: '',
            matchTier: matchContext?.matchTier,
            matchReason: matchContext?.matchReason,
            distanceMeters: matchContext?.distanceMeters ?? null,
          },
        ],
      };
    });
    return { ok: true };
  };

  const updateAttachedStateRef = (
    recordId: string,
    patch: { officerConfirmedMatch?: boolean; officerNote?: string }
  ) => {
    mutateActiveDossier((d) => ({
      ...d,
      attachedStateRefs: d.attachedStateRefs.map((ref) =>
        ref.record.id === recordId ? { ...ref, ...patch } : ref
      ),
    }));
  };

  const removeAttachedStateRef = (recordId: string) => {
    mutateActiveDossier((d) => ({
      ...d,
      attachedStateRefs: d.attachedStateRefs.filter((ref) => ref.record.id !== recordId),
    }));
  };

  const attachEcovisReference = (
    record: EcovisRecord,
    matchContext?: { matchTier?: LookupMatchTier; matchReason?: string; distanceMeters?: number | null }
  ): AttachOperationResult => {
    const guard = validateAttachToDossier(
      activeDossier,
      isEcovisRecordDemo(record),
      `${record.recordCode} – ${record.streetName}`
    );
    if (!guard.ok) return guard;

    mutateActiveDossier((d) => {
      if (d.attachedEcovisRefs.some((r) => r.record.id === record.id)) return d;
      return {
        ...d,
        attachedEcovisRefs: [
          ...d.attachedEcovisRefs,
          {
            record,
            attachedAt: new Date().toISOString(),
            officerConfirmedMatch: false,
            officerNote: '',
            matchTier: matchContext?.matchTier,
            matchReason: matchContext?.matchReason,
            distanceMeters: matchContext?.distanceMeters ?? null,
          },
        ],
      };
    });
    return { ok: true };
  };

  const updateAttachedEcovisRef = (
    recordId: string,
    patch: { officerConfirmedMatch?: boolean; officerNote?: string }
  ) => {
    mutateActiveDossier((d) => ({
      ...d,
      attachedEcovisRefs: d.attachedEcovisRefs.map((ref) =>
        ref.record.id === recordId ? { ...ref, ...patch } : ref
      ),
    }));
  };

  const removeAttachedEcovisRef = (recordId: string) => {
    mutateActiveDossier((d) => ({
      ...d,
      attachedEcovisRefs: d.attachedEcovisRefs.filter((ref) => ref.record.id !== recordId),
    }));
  };

  const toggleAttachMarketListing = (listingId: string): AttachOperationResult => {
    const alreadyAttached = activeDossier.attachedMarketIds.includes(listingId);
    if (!alreadyAttached) {
      const found = allKnownMarketListings.find((m) => m.id === listingId);
      const listingIsDemo =
        listingId.startsWith('demo-') || (found ? isMarketListingDemo(found) : false);
      const guard = validateAttachToDossier(
        activeDossier,
        listingIsDemo,
        found ? `${found.listingCode} – ${found.address}` : listingId
      );
      if (!guard.ok) return guard;
    }

    mutateActiveDossier((d) => {
      const exists = d.attachedMarketIds.includes(listingId);
      return {
        ...d,
        attachedMarketIds: exists
          ? d.attachedMarketIds.filter((id) => id !== listingId)
          : [...d.attachedMarketIds, listingId],
      };
    });
    return { ok: true };
  };

  const updateLocationAnalysis = (patch: Partial<LocationAnalysisState>) => {
    mutateActiveDossier((d) => ({
      ...d,
      locationAnalysis: {
        ...d.locationAnalysis,
        ...patch,
      },
    }));
  };

  const addAppliedKFactor = (item: AppliedKFactorItem): AttachOperationResult => {
    const guard = validateAttachToDossier(
      activeDossier,
      isAppliedKFactorDemo(item),
      item.factorName
    );
    if (!guard.ok) return guard;

    mutateActiveDossier((d) => ({
      ...d,
      locationAnalysis: {
        ...d.locationAnalysis,
        appliedKFactors: [...d.locationAnalysis.appliedKFactors, item],
      },
    }));
    return { ok: true };
  };

  const updateAppliedKFactor = (id: string, patch: Partial<AppliedKFactorItem>) => {
    mutateActiveDossier((d) => ({
      ...d,
      locationAnalysis: {
        ...d.locationAnalysis,
        appliedKFactors: d.locationAnalysis.appliedKFactors.map((k) =>
          k.id === id ? { ...k, ...patch } : k
        ),
      },
    }));
  };

  const removeAppliedKFactor = (id: string) => {
    mutateActiveDossier((d) => ({
      ...d,
      locationAnalysis: {
        ...d.locationAnalysis,
        appliedKFactors: d.locationAnalysis.appliedKFactors.filter((k) => k.id !== id),
      },
    }));
  };

  // Manual officer-triggered removal of a detected contaminated DEMO record (never silent/automatic)
  const removeContaminatedItem = (item: ContaminatedDemoItem) => {
    if (item.category === 'state_price') {
      removeAttachedStateRef(item.id);
    } else if (item.category === 'ecovis') {
      removeAttachedEcovisRef(item.id);
    } else if (item.category === 'market_listing') {
      mutateActiveDossier((d) => ({
        ...d,
        attachedMarketIds: d.attachedMarketIds.filter((mid) => mid !== item.id),
      }));
    } else if (item.category === 'k_factor') {
      removeAppliedKFactor(item.id);
    }
  };

  const updateReportNotes = (notes: string) => {
    mutateActiveDossier((d) => ({
      ...d,
      reportNotes: notes,
    }));
  };

  return (
    <AppDataContext.Provider
      value={{
        activeModule,
        setActiveModule,
        isDemoMode,
        setIsDemoMode,
        activeStateRecords,
        activeEcovisRecords,
        activeKFactorRules,
        activeMarketListings,
        allKnownMarketListings,
        realStateCount: activeRealState.records.length,
        realEcovisCount: activeRealEcovis.records.length,
        realKRulesCount: activeRealKRules.records.length,
        realMarketCount: combinedRealMarket.length,
        allVersionHistory,
        activeStateMeta: activeRealState.meta,
        activeEcovisMeta: activeRealEcovis.meta,
        activeKRulesMeta: activeRealKRules.meta,
        activeMarketMeta: activeRealMarketImport.meta,
        commitDatasetVersion,
        activateDatasetVersion,
        serverDatasetStatus,
        serverUpdatedAt: serverSnapshot?.updatedAt ?? null,
        applyServerActiveSnapshot,
        refreshServerDatasets,
        localVersionsCount,
        exportLocalDatasetsForMigration,
        pdfDocuments: effectivePdfDocuments,
        addPdfDocument,
        removePdfDocument,
        addManualMarketListing,
        updateMarketListingStatus,
        removeMarketListing,
        removeDuplicateMarketListings,
        dossiers,
        activeDossier,
        activeDossierIntegrity,
        selectDossier,
        createNewDossier,
        updateParcelInfo,
        addFieldPhotos,
        updateFieldPhoto,
        removeFieldPhoto,
        attachStateReference,
        updateAttachedStateRef,
        removeAttachedStateRef,
        attachEcovisReference,
        updateAttachedEcovisRef,
        removeAttachedEcovisRef,
        toggleAttachMarketListing,
        updateLocationAnalysis,
        addAppliedKFactor,
        updateAppliedKFactor,
        removeAppliedKFactor,
        removeContaminatedItem,
        updateReportNotes,
        storageWarning,
      }}
    >
      {children}
    </AppDataContext.Provider>
  );
};

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) {
    throw new Error('useAppData must be used inside AppDataProvider');
  }
  return ctx;
}
