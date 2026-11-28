import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import readXlsxFile from 'read-excel-file/node';
import type { DocumentData } from 'firebase/firestore';
import {
  buildFirestoreRecordDoc,
  fetchPublicActiveDatasetsSnapshot,
  type ActiveVersionPointerDoc,
  type FirestoreDatasetRecordDoc,
  type FirestorePublicReadAdapter,
} from '../src/services/firestoreDatasetStore';
import { shouldLoadPublicDatasetsForPath } from '../src/context/AppDataContext';
import type {
  DatasetKind,
  EcovisRecord,
  StateLandPriceRecord,
} from '../src/types/valuation';
import {
  EMPTY_MARKET_DATA_MESSAGE,
  runUnifiedLandPriceLookup,
} from '../src/utils/geoLookup';
import {
  selectWorkbookSheetForDataset,
  validateAndPreviewImport,
  type WorkbookSheetInput,
} from '../src/utils/importExport';

function normalizeCell(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).trim();
}

interface SimulatedFirestoreStats {
  serverPointerReads: number;
  serverRecordQueries: number;
  serverRecordDocReads: number;
  cachePointerReads: number;
  cacheRecordQueries: number;
}

/**
 * Faithful in-memory simulation of Cloud Firestore Server + IndexedDB persistentLocalCache
 * to verify exact read counts, cache-hit reuse, version invalidation, fallback, and offline behavior.
 */
class SimulatedFirestoreHarness {
  public online = true;
  public throwOnCacheRecordQuery = false;
  public serverPointers = new Map<DatasetKind, ActiveVersionPointerDoc>();
  public cachePointers = new Map<DatasetKind, ActiveVersionPointerDoc>();
  public serverRecords = new Map<string, FirestoreDatasetRecordDoc[]>(); // key: `${kind}:${versionId}`
  public cacheRecords = new Map<string, DocumentData[]>(); // key: `${kind}:${versionId}`

  public stats: SimulatedFirestoreStats = {
    serverPointerReads: 0,
    serverRecordQueries: 0,
    serverRecordDocReads: 0,
    cachePointerReads: 0,
    cacheRecordQueries: 0,
  };

  resetStats() {
    this.stats = {
      serverPointerReads: 0,
      serverRecordQueries: 0,
      serverRecordDocReads: 0,
      cachePointerReads: 0,
      cacheRecordQueries: 0,
    };
  }

  seedServerVersion(
    kind: DatasetKind,
    versionId: string,
    docs: FirestoreDatasetRecordDoc[],
    label: string
  ) {
    const pointer: ActiveVersionPointerDoc = {
      datasetKind: kind,
      activeVersionId: versionId,
      versionLabel: label,
      sourceDocumentName:
        kind === 'state_price'
          ? 'Nghị quyết 15/2025/NQ-HĐND tỉnh Khánh Hòa'
          : 'Báo cáo 187/2025/39/BC-E.AFA',
      sourceFileName: 'Bang_Gia_Dat_Khanh_Son_Chuan_Hoa_PROMPT04.xlsx',
      effectiveDate: '01/01/2026',
      importedAt: '2026-01-01T00:00:00.000Z',
      rowCount: docs.length,
      spatialRecordsCount: docs.filter((d) => d.hasCoordinates).length,
      notes: 'Huyện Khánh Sơn',
      lastEventId: `evt_${versionId}`,
    };
    this.serverPointers.set(kind, pointer);
    this.serverRecords.set(`${kind}:${versionId}`, docs);
  }

  createAdapter(): FirestorePublicReadAdapter {
    return {
      getActivePointerFromServer: async (kind) => {
        if (!this.online) {
          const err = new Error('Failed to get document because the client is offline.') as Error & {
            code: string;
          };
          err.code = 'unavailable';
          throw err;
        }
        this.stats.serverPointerReads += 1;
        const ptr = this.serverPointers.get(kind) ?? null;
        if (ptr) {
          // Firestore SDK automatically caches existing docs returned from server
          this.cachePointers.set(kind, { ...ptr });
        }
        return {
          exists: ptr !== null,
          data: ptr ? ({ ...ptr } as DocumentData) : null,
          fromCache: false,
        };
      },
      getActivePointerFromCache: async (kind) => {
        this.stats.cachePointerReads += 1;
        const ptr = this.cachePointers.get(kind) ?? null;
        if (!ptr) {
          const err = new Error('Failed to get document from cache.') as Error & { code: string };
          err.code = 'unavailable';
          throw err;
        }
        return {
          exists: true,
          data: { ...ptr } as DocumentData,
          fromCache: true,
        };
      },
      getActiveRecordsFromCache: async (kind, versionId) => {
        this.stats.cacheRecordQueries += 1;
        if (this.throwOnCacheRecordQuery) {
          throw new Error('IndexedDB cache query failed (simulated browser storage error)');
        }
        const docs = this.cacheRecords.get(`${kind}:${versionId}`) ?? [];
        return {
          docs: docs.map((d) => ({ ...d })),
          fromCache: true,
        };
      },
      getActiveRecordsFromServer: async (kind, versionId) => {
        if (!this.online) {
          const err = new Error('Failed to get documents from server: client is offline.') as Error & {
            code: string;
          };
          err.code = 'unavailable';
          throw err;
        }
        this.stats.serverRecordQueries += 1;
        const docs = this.serverRecords.get(`${kind}:${versionId}`) ?? [];
        this.stats.serverRecordDocReads += docs.length;
        // Firestore SDK automatically persists server query results to IndexedDB cache
        this.cacheRecords.set(
          `${kind}:${versionId}`,
          docs.map((d) => ({ ...d }))
        );
        return {
          docs: docs.map((d) => ({ ...d })),
          fromCache: false,
        };
      },
    };
  }
}

async function main() {
  let passed = 0;
  const check = async (label: string, fn: () => void | Promise<void>) => {
    await fn();
    passed += 1;
    console.log(`[PASS] ${label}`);
  };

  console.log('=== GATE 4.0.1 VALIDATION: FIRESTORE READ OPTIMIZATION (PRE-01) ===\n');

  // Load REAL 423 Khánh Sơn records (214 state_price + 209 ecovis)
  const xlsxPath = path.resolve(process.cwd(), 'Bang_Gia_Dat_Khanh_Son_Chuan_Hoa_PROMPT04.xlsx');
  const rawWorkbook = await readXlsxFile(xlsxPath);
  const workbookSheets: WorkbookSheetInput[] = rawWorkbook.map((ws) => ({
    sheet: ws.sheet,
    rows: ws.data.map((r) => r.map(normalizeCell)),
  }));

  const stateSheet = selectWorkbookSheetForDataset(workbookSheets, 'state_price')!;
  const statePreview = validateAndPreviewImport(
    'state_price',
    path.basename(xlsxPath),
    stateSheet.rows,
    {
      sourceDocumentName: 'Nghị quyết 15/2025/NQ-HĐND tỉnh Khánh Hòa',
      effectiveDate: '01/01/2026',
      versionId: 'v1_state_ks',
      selectedSheetName: stateSheet.sheet,
    }
  );
  const ecovisSheet = selectWorkbookSheetForDataset(workbookSheets, 'ecovis')!;
  const ecovisPreview = validateAndPreviewImport(
    'ecovis',
    path.basename(xlsxPath),
    ecovisSheet.rows,
    {
      sourceDocumentName: 'Báo cáo 187/2025/39/BC-E.AFA',
      effectiveDate: '2025',
      versionId: 'v1_ecovis_ks',
      selectedSheetName: ecovisSheet.sheet,
    }
  );

  const stateDocsV1 = (statePreview.validRows as StateLandPriceRecord[]).map((rec, i) =>
    buildFirestoreRecordDoc('state_price', 'v1_state_ks', rec, i)
  );
  const ecovisDocsV1 = (ecovisPreview.validRows as EcovisRecord[]).map((rec, i) =>
    buildFirestoreRecordDoc('ecovis', 'v1_ecovis_ks', rec, i)
  );
  assert.equal(stateDocsV1.length, 214);
  assert.equal(ecovisDocsV1.length, 209);

  // Build a v2 state_price version (e.g., updated prices / new versionId)
  const stateDocsV2 = (statePreview.validRows as StateLandPriceRecord[]).map((rec, i) =>
    buildFirestoreRecordDoc(
      'state_price',
      'v2_state_ks',
      { ...rec, versionId: 'v2_state_ks', unitPrice: rec.unitPrice + 10000 },
      i
    )
  );

  const harness = new SimulatedFirestoreHarness();
  harness.seedServerVersion('state_price', 'v1_state_ks', stateDocsV1, 'Khánh Sơn NQ15 v1');
  harness.seedServerVersion('ecovis', 'v1_ecovis_ks', ecovisDocsV1, 'Khánh Sơn ECOVIS v1');
  const adapter = harness.createAdapter();

  // TEST 1: First visit, empty cache -> full server fetch
  await check('1. First visit (empty cache) -> full server fetch (4 pointer reads + 423 record reads, no duplicate queries)', async () => {
    harness.resetStats();
    const snap = await fetchPublicActiveDatasetsSnapshot({ adapter });

    assert.equal(snap.statePriceRecords.length, 214);
    assert.equal(snap.ecovisRecords.length, 209);
    assert.equal(snap.kFactorRules.length, 0);
    assert.equal(snap.marketListings.length, 0);
    assert.equal(snap.loadMeta?.pointerSource, 'server');
    assert.equal(snap.loadMeta?.byKind.state_price.source, 'server');
    assert.equal(snap.loadMeta?.byKind.state_price.fallbackReason, 'cache_empty');
    assert.equal(snap.loadMeta?.byKind.ecovis.source, 'server');
    assert.equal(snap.loadMeta?.byKind.ecovis.fallbackReason, 'cache_empty');
    assert.equal(harness.stats.serverPointerReads, 4);
    assert.equal(harness.stats.serverRecordQueries, 2);
    assert.equal(harness.stats.serverRecordDocReads, 423);
  });

  // TEST 2: Repeat visit, full valid cache & unchanged version -> reuse cache (0 server record reads)
  await check('2. Repeat visit (warm valid cache, same versionId) -> uses IndexedDB cache (4 pointer reads + 0 record reads)', async () => {
    harness.resetStats();
    const snap = await fetchPublicActiveDatasetsSnapshot({ adapter });

    assert.equal(snap.statePriceRecords.length, 214);
    assert.equal(snap.ecovisRecords.length, 209);
    assert.equal(snap.loadMeta?.pointerSource, 'server');
    assert.equal(snap.loadMeta?.byKind.state_price.source, 'cache');
    assert.equal(snap.loadMeta?.byKind.ecovis.source, 'cache');
    assert.equal(harness.stats.serverPointerReads, 4);
    assert.equal(harness.stats.serverRecordQueries, 0, 'Must perform ZERO server record queries on valid cache hit');
    assert.equal(harness.stats.serverRecordDocReads, 0, 'Must incur ZERO server record doc reads on valid cache hit');
  });

  // TEST 3: activeVersionId changes -> never uses stale v1 records, only fetches updated kind
  await check('3. activeVersionId changes (state_price v1 -> v2) -> rejects v1 cache, fetches v2 from server, keeps ecovis v1 from cache', async () => {
    harness.seedServerVersion('state_price', 'v2_state_ks', stateDocsV2, 'Khánh Sơn NQ15 v2');
    // Even if a stale v1 record somehow leaked into cache under v2 key, validation must reject it too
    harness.cacheRecords.set('state_price:v2_state_ks', stateDocsV1);

    harness.resetStats();
    const snap = await fetchPublicActiveDatasetsSnapshot({ adapter });

    assert.equal(snap.statePriceRecords.length, 214);
    assert.ok(
      snap.statePriceRecords.every((r) => r.versionId === 'v2_state_ks'),
      'Every returned state_price record must belong strictly to v2_state_ks'
    );
    assert.equal(snap.loadMeta?.byKind.state_price.source, 'server');
    assert.equal(snap.loadMeta?.byKind.state_price.fallbackReason, 'cache_validation_failed');
    assert.equal(snap.loadMeta?.byKind.ecovis.source, 'cache', 'Unchanged ecovis v1 must still hit cache');
    assert.equal(harness.stats.serverPointerReads, 4);
    assert.equal(harness.stats.serverRecordQueries, 1, 'Only updated state_price v2 should query server');
    assert.equal(harness.stats.serverRecordDocReads, 214);

    // Restore v1 on server & warm cache for subsequent tests
    harness.seedServerVersion('state_price', 'v1_state_ks', stateDocsV1, 'Khánh Sơn NQ15 v1');
    await fetchPublicActiveDatasetsSnapshot({ adapter });
  });

  // TEST 4: Cache missing records -> server fallback
  await check('4. Cache missing records (150/214) -> falls back to server with single query and refreshes cache', async () => {
    harness.cacheRecords.set('state_price:v1_state_ks', stateDocsV1.slice(0, 150));
    harness.resetStats();

    const snap = await fetchPublicActiveDatasetsSnapshot({ adapter });
    assert.equal(snap.statePriceRecords.length, 214);
    assert.equal(snap.loadMeta?.byKind.state_price.source, 'server');
    assert.equal(snap.loadMeta?.byKind.state_price.fallbackReason, 'cache_count_mismatch');
    assert.equal(snap.loadMeta?.byKind.ecovis.source, 'cache');
    assert.equal(harness.stats.serverRecordQueries, 1);
    assert.equal(harness.stats.serverRecordDocReads, 214);

    // Verify next reload is now a clean cache hit again
    harness.resetStats();
    const snap2 = await fetchPublicActiveDatasetsSnapshot({ adapter });
    assert.equal(snap2.loadMeta?.byKind.state_price.source, 'cache');
    assert.equal(harness.stats.serverRecordDocReads, 0);
  });

  // TEST 5: Cache query throws error -> server fallback
  await check('5. Cache query throws error -> cleanly falls back to server without crashing', async () => {
    harness.throwOnCacheRecordQuery = true;
    harness.resetStats();

    try {
      const snap = await fetchPublicActiveDatasetsSnapshot({ adapter });
      assert.equal(snap.statePriceRecords.length, 214);
      assert.equal(snap.ecovisRecords.length, 209);
      assert.equal(snap.loadMeta?.byKind.state_price.source, 'server');
      assert.equal(snap.loadMeta?.byKind.state_price.fallbackReason, 'cache_query_error');
      assert.equal(snap.loadMeta?.byKind.ecovis.source, 'server');
      assert.equal(snap.loadMeta?.byKind.ecovis.fallbackReason, 'cache_query_error');
      assert.equal(harness.stats.serverRecordQueries, 2);
      assert.equal(harness.stats.serverRecordDocReads, 423);
    } finally {
      harness.throwOnCacheRecordQuery = false;
    }
  });

  // TEST 6: Cache count mismatch (extra docs) & corrupted/demo record in cache -> server fallback
  await check('6. Cache count > rowCount (215 vs 214) AND corrupted/demo record (214 with 1 invalid) -> both trigger server fallback', async () => {
    // 6a: Extra doc in cache (215 vs 214)
    harness.cacheRecords.set('state_price:v1_state_ks', [
      ...stateDocsV1,
      { ...stateDocsV1[0], recordId: 'extra_record_id' },
    ]);
    harness.resetStats();
    const snapExtra = await fetchPublicActiveDatasetsSnapshot({ adapter });
    assert.equal(snapExtra.statePriceRecords.length, 214);
    assert.equal(snapExtra.loadMeta?.byKind.state_price.source, 'server');
    assert.equal(snapExtra.loadMeta?.byKind.state_price.fallbackReason, 'cache_count_mismatch');
    assert.equal(harness.stats.serverRecordQueries, 1);

    // 6b: Exact count 214, but 1 cached record corrupted (isDemo: true)
    const tamperedDocs: DocumentData[] = stateDocsV1.map((d, idx) =>
      idx === 10 ? { ...d, isDemo: true } : { ...d }
    );
    harness.cacheRecords.set('state_price:v1_state_ks', tamperedDocs);
    harness.resetStats();
    const snapCorrupt = await fetchPublicActiveDatasetsSnapshot({ adapter });
    assert.equal(snapCorrupt.statePriceRecords.length, 214);
    assert.equal(snapCorrupt.loadMeta?.byKind.state_price.source, 'server');
    assert.equal(snapCorrupt.loadMeta?.byKind.state_price.fallbackReason, 'cache_validation_failed');
    assert.equal(harness.stats.serverRecordQueries, 1);
  });

  // TEST 7: Offline with full valid cache -> lookup succeeds accurately
  await check('7. Offline with complete valid cache -> loads from offline cache and produces identical Khánh Sơn lookup results', async () => {
    // Ensure cache is warmed from Test 6b
    harness.online = false;
    harness.resetStats();

    try {
      const snap = await fetchPublicActiveDatasetsSnapshot({ adapter });
      assert.equal(snap.loadMeta?.pointerSource, 'offline_cache');
      assert.equal(snap.loadMeta?.byKind.state_price.source, 'cache');
      assert.equal(snap.loadMeta?.byKind.ecovis.source, 'cache');
      assert.equal(snap.statePriceRecords.length, 214);
      assert.equal(snap.ecovisRecords.length, 209);
      assert.equal(harness.stats.serverRecordDocReads, 0);

      // Run unified land-price lookup offline to verify 100% data integrity preservation
      const lookup = runUnifiedLandPriceLookup({
        query: {
          latitude: null,
          longitude: null,
          districtCity: 'Huyện Khánh Sơn',
          wardCommune: 'Thị trấn Tô Hạp',
          streetName: 'Trần Phú',
          landType: 'Đất ở tại đô thị',
          radiusMeters: 1000,
        },
        stateRecords: snap.statePriceRecords,
        ecovisRecords: snap.ecovisRecords,
        marketListings: snap.marketListings,
      });

      assert.equal(lookup.statePrice.exactMatches.length, 6);
      assert.ok(lookup.ecovis.exactMatches.length > 0);
      assert.equal(lookup.market.exactMatches.length, 0);
      assert.equal(lookup.market.missingDataReason, EMPTY_MARKET_DATA_MESSAGE);
      assert.equal(EMPTY_MARKET_DATA_MESSAGE, 'Chưa có số liệu về giá trị thị trường vị trí đất.');
    } finally {
      harness.online = true;
    }
  });

  // TEST 8: Offline with incomplete cache -> throws clear explicit error, NEVER returns partial/fake results
  await check('8. Offline with incomplete cache (100/214) or empty cache -> fails closed with clear Vietnamese error', async () => {
    harness.online = false;

    try {
      // 8a: Incomplete records in cache (100/214)
      harness.cacheRecords.set('state_price:v1_state_ks', stateDocsV1.slice(0, 100));
      await assert.rejects(
        () => fetchPublicActiveDatasetsSnapshot({ adapter }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes('Đang ngoại tuyến'), `Expected offline wording, got: ${err.message}`);
          assert.ok(err.message.includes('100/214'), `Expected 100/214 count detail, got: ${err.message}`);
          assert.ok(err.message.includes('Không thể tra cứu đầy đủ'), `Expected explicit warning, got: ${err.message}`);
          return true;
        }
      );

      // 8b: Empty pointer cache offline (never synced before)
      harness.cachePointers.clear();
      harness.cacheRecords.clear();
      await assert.rejects(
        () => fetchPublicActiveDatasetsSnapshot({ adapter }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes('Đang ngoại tuyến'), `Expected offline wording, got: ${err.message}`);
          assert.ok(err.message.includes('chưa có dữ liệu'), `Expected empty-cache wording, got: ${err.message}`);
          return true;
        }
      );
    } finally {
      harness.online = true;
    }
  });

  // TEST 9: Opening /admin does NOT trigger public dataset loading
  await check('9. Opening /admin (and /giadat/admin) skips public dataset loading; public routes still load; zero localStorage version truth', async () => {
    assert.equal(shouldLoadPublicDatasetsForPath('/admin'), false);
    assert.equal(shouldLoadPublicDatasetsForPath('/admin/'), false);
    assert.equal(shouldLoadPublicDatasetsForPath('/admin/data'), false);
    assert.equal(shouldLoadPublicDatasetsForPath('/giadat/admin', '/giadat/'), false);
    assert.equal(shouldLoadPublicDatasetsForPath('/giadat/admin/', '/giadat/'), false);

    assert.equal(shouldLoadPublicDatasetsForPath('/'), true);
    assert.equal(shouldLoadPublicDatasetsForPath('/giadat/', '/giadat/'), true);
    assert.equal(shouldLoadPublicDatasetsForPath('/giadat', '/giadat/'), true);

    const appDataSrc = await fs.readFile(
      path.resolve(process.cwd(), 'src/context/AppDataContext.tsx'),
      'utf8'
    );
    const dataMgmtSrc = await fs.readFile(
      path.resolve(process.cwd(), 'src/components/modules/DataManagementModule.tsx'),
      'utf8'
    );
    const storeSrc = await fs.readFile(
      path.resolve(process.cwd(), 'src/services/firestoreDatasetStore.ts'),
      'utf8'
    );

    assert.ok(
      appDataSrc.includes('if (!isPublicRoute) return;'),
      'AppDataProvider must skip refreshServerDatasets when on /admin'
    );
    assert.ok(
      appDataSrc.includes('setServerSnapshot(null);'),
      'AppDataProvider must clear stale snapshot when offline/incomplete error occurs'
    );
    assert.ok(
      !dataMgmtSrc.includes('refreshServerDatasets'),
      'DataManagementModule on /admin must not trigger public dataset_records reads'
    );
    assert.ok(
      !/localStorage\.(getItem|setItem|removeItem)/.test(storeSrc),
      'firestoreDatasetStore must NOT use localStorage as version source of truth'
    );
    assert.ok(
      storeSrc.includes('getDocsFromCache') &&
        storeSrc.includes('getDocsFromServer') &&
        storeSrc.includes('getDocFromServer') &&
        storeSrc.includes('getDocFromCache'),
      'firestoreDatasetStore must use official Firestore SDK cache/server APIs'
    );
  });

  console.log(`\nALL GATE 4.0.1 CACHE-AWARE READ TESTS PASSED: ${passed}/${passed}`);
}

main().catch((err) => {
  console.error('\n[FAIL] Gate 4.0.1 Validation Error:', err);
  process.exit(1);
});
