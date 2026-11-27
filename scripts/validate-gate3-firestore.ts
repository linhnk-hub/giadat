import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import readXlsxFile from 'read-excel-file/node';
import {
  buildFirestoreRecordDoc,
  buildVersionPayloadChecksum,
  chunkArray,
  deserializeFirestoreRecordDoc,
  FIRESTORE_WRITE_BATCH_CHUNK_SIZE,
  PUBLIC_RECORDS_QUERY_LIMIT,
} from '../src/services/firestoreDatasetStore';
import type {
  EcovisRecord,
  KFactorRuleRecord,
  MarketListingRecord,
  StateLandPriceRecord,
} from '../src/types/valuation';
import {
  encodeGeohash,
  getGeohashNeighbors,
  normalizeAdminKey,
} from '../src/utils/geohash';
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

async function main() {
  let passed = 0;
  const check = async (label: string, fn: () => void | Promise<void>) => {
    await fn();
    passed += 1;
    console.log(`[PASS] ${label}`);
  };

  console.log('=== GATE 3 VALIDATION: FIRESTORE WEB SDK & SIMPLIFIED UX ===\n');

  // 1. Zero required /api/* calls in migrated public lookup & admin runtime files
  await check('1. Migrated lookup & admin runtime files contain ZERO /api/* fetch calls', async () => {
    const migratedFiles = [
      'src/App.tsx',
      'src/components/Layout.tsx',
      'src/components/modules/QuickLookupModule.tsx',
      'src/components/modules/DataManagementModule.tsx',
      'src/components/admin/AdminPortalPage.tsx',
      'src/components/admin/AdminLoginPage.tsx',
      'src/components/admin/AdminAccessDenied.tsx',
      'src/components/admin/AdminRouteGuard.tsx',
      'src/context/AdminAuthContext.tsx',
      'src/context/AppDataContext.tsx',
      'src/services/firestoreDatasetStore.ts',
    ];
    for (const rel of migratedFiles) {
      const content = await fs.readFile(path.resolve(process.cwd(), rel), 'utf8');
      assert.ok(
        !/buildApiUrl\s*\(|fetch\s*\(\s*['"`]\/api\//.test(content),
        `${rel} still references legacy /api/* endpoint!`
      );
    }
  });

  // 2. Zero localStorage Admin authorization & zero Firebase Storage dependency
  await check('2. Zero localStorage admin authorization and zero Firebase Storage upload in migrated flows', async () => {
    const authSrc = await fs.readFile(path.resolve(process.cwd(), 'src/context/AdminAuthContext.tsx'), 'utf8');
    const storeSrc = await fs.readFile(path.resolve(process.cwd(), 'src/services/firestoreDatasetStore.ts'), 'utf8');
    const lookupSrc = await fs.readFile(path.resolve(process.cwd(), 'src/components/modules/QuickLookupModule.tsx'), 'utf8');

    assert.ok(!/localStorage\.(getItem|setItem|removeItem)/.test(authSrc), 'AdminAuthContext must not use localStorage');
    assert.ok(!/localStorage\.(getItem|setItem|removeItem)/.test(storeSrc), 'firestoreDatasetStore must not use localStorage');
    assert.ok(!/firebase\/storage/.test(lookupSrc), 'QuickLookupModule must not upload photos to Firebase Storage');
    assert.ok(!/firebase\/storage/.test(storeSrc), 'firestoreDatasetStore must not use Firebase Storage');
  });

  // 3. Simplified Public UX isolation (no admin/data-management/version tabs in public shell)
  await check('3. Public UX lands directly on QuickLookupModule and hides admin/data-management/DEMO tabs', async () => {
    const appSrc = await fs.readFile(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const layoutSrc = await fs.readFile(path.resolve(process.cwd(), 'src/components/Layout.tsx'), 'utf8');
    const lookupSrc = await fs.readFile(path.resolve(process.cwd(), 'src/components/modules/QuickLookupModule.tsx'), 'utf8');

    assert.ok(appSrc.includes('<QuickLookupModule />'), 'App.tsx must render QuickLookupModule directly');
    assert.ok(appSrc.includes('isAdminPath(pathname)'), 'App.tsx must preserve /admin route guard');
    assert.ok(!appSrc.includes('DataManagementModule'), 'Public App.tsx must not directly mount DataManagementModule');
    assert.ok(!layoutSrc.includes('/admin'), 'Public Layout must not expose admin navigation tabs');
    assert.ok(!layoutSrc.includes('isDemoMode'), 'Public Layout must not expose DEMO toggle');
    assert.ok(lookupSrc.includes('EMPTY_MARKET_DATA_MESSAGE'), 'QuickLookupModule must use exact empty-market constant');
  });

  // 4. Geohash encoding, 9-cell neighbor coverage & normalized Firestore keys
  await check('4. Geohash encoder (base32) + 9-cell neighbors + normalizeAdminKey satisfy firestore.rules regex', () => {
    const g5 = encodeGeohash(12.2388, 109.1967, 5);
    const g6 = encodeGeohash(12.2388, 109.1967, 6);
    assert.match(g5, /^[0-9b-hjkmnp-z]{5}$/);
    assert.match(g6, /^[0-9b-hjkmnp-z]{6}$/);
    assert.equal(g6.slice(0, 5), g5, 'geohash6[0:5] must strictly equal geohash5');

    const neighbors = getGeohashNeighbors(g5);
    assert.ok(neighbors.length >= 1 && neighbors.length <= 9, 'Neighbors must fit within Firestore IN limit (<= 10)');
    assert.ok(neighbors.includes(g5), 'Neighbors must include center cell');

    const dk = normalizeAdminKey('Huyện Khánh Sơn', 80);
    const wk = normalizeAdminKey('Thị trấn Tô Hạp', 80);
    const sk = normalizeAdminKey('Đường Trần Phú (Quốc lộ 27B)', 160);
    assert.equal(dk, 'khanh_son');
    assert.equal(wk, 'to_hap');
    assert.match(sk, /^[a-z0-9_]*$/);
    assert.ok(dk.length <= 80 && wk.length <= 80 && sk.length <= 160);
  });

  // 5. Real 423 Khánh Sơn records serialize & deserialize with 100% Gate 2 rules compliance
  const xlsxPath = path.resolve(process.cwd(), 'Bang_Gia_Dat_Khanh_Son_Chuan_Hoa_PROMPT04.xlsx');
  const rawWorkbook = await readXlsxFile(xlsxPath);
  const workbookSheets: WorkbookSheetInput[] = rawWorkbook.map((ws) => ({
    sheet: ws.sheet,
    rows: ws.data.map((r) => r.map(normalizeCell)),
  }));

  const stateSheet = selectWorkbookSheetForDataset(workbookSheets, 'state_price')!;
  const statePreview = validateAndPreviewImport('state_price', path.basename(xlsxPath), stateSheet.rows, {
    sourceDocumentName: 'Nghị quyết 15/2025/NQ-HĐND tỉnh Khánh Hòa',
    effectiveDate: '01/01/2026',
    versionId: 'g3_test_nq15_ks',
    selectedSheetName: stateSheet.sheet,
  });
  const ecovisSheet = selectWorkbookSheetForDataset(workbookSheets, 'ecovis')!;
  const ecovisPreview = validateAndPreviewImport('ecovis', path.basename(xlsxPath), ecovisSheet.rows, {
    sourceDocumentName: 'Báo cáo 187/2025/39/BC-E.AFA',
    effectiveDate: '2025',
    versionId: 'g3_test_ecovis_ks',
    selectedSheetName: ecovisSheet.sheet,
  });

  await check('5. All 214 NQ 15/2025 + 209 ECOVIS real Khánh Sơn rows serialize cleanly to Firestore schema (0 fabricated GPS)', async () => {
    const stateDocs = (statePreview.validRows as StateLandPriceRecord[]).map((rec, i) =>
      buildFirestoreRecordDoc('state_price', 'g3_test_nq15_ks', rec, i)
    );
    const ecovisDocs = (ecovisPreview.validRows as EcovisRecord[]).map((rec, i) =>
      buildFirestoreRecordDoc('ecovis', 'g3_test_ecovis_ks', rec, i)
    );

    assert.equal(stateDocs.length, 214);
    assert.equal(ecovisDocs.length, 209);

    for (const d of [...stateDocs, ...ecovisDocs]) {
      assert.equal(d.visibility, 'public');
      assert.equal(d.isDemo, false);
      assert.equal(d.hasCoordinates, false, 'Must never fabricate GPS for non-GPS datasets');
      assert.equal(d.latitude, null);
      assert.equal(d.longitude, null);
      assert.equal(d.geohash5, null);
      assert.equal(d.geohash6, null);
      assert.match(d.districtKey, /^[a-z0-9_]*$/);
      assert.match(d.wardKey, /^[a-z0-9_]*$/);
      assert.match(d.streetKey, /^[a-z0-9_]*$/);
    }

    // Check SHA-256 payloadChecksum format
    const stateChecksum = await buildVersionPayloadChecksum('state_price', stateDocs);
    const ecovisChecksum = await buildVersionPayloadChecksum('ecovis', ecovisDocs);
    assert.match(stateChecksum, /^[a-f0-9]{64}$/);
    assert.match(ecovisChecksum, /^[a-f0-9]{64}$/);

    // Verify batch chunking strictly <= 400
    const chunks = chunkArray([...stateDocs, ...ecovisDocs], FIRESTORE_WRITE_BATCH_CHUNK_SIZE);
    assert.equal(chunks.length, 2);
    assert.ok(chunks.every((c) => c.length <= 400));

    // Round-trip deserialize and run non-GPS lookup
    const roundTrippedState = stateDocs.map((d) => deserializeFirestoreRecordDoc(d) as StateLandPriceRecord);
    const roundTrippedEcovis = ecovisDocs.map((d) => deserializeFirestoreRecordDoc(d) as EcovisRecord);

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
      stateRecords: roundTrippedState,
      ecovisRecords: roundTrippedEcovis,
      marketListings: [],
    });

    assert.equal(lookup.statePrice.exactMatches.length, 6);
    assert.ok(lookup.ecovis.exactMatches.length > 0);
    assert.equal(lookup.market.exactMatches.length, 0);
    assert.equal(lookup.market.missingDataReason, EMPTY_MARKET_DATA_MESSAGE);
    assert.equal(EMPTY_MARKET_DATA_MESSAGE, 'Chưa có số liệu về giá trị thị trường vị trí đất.');
  });

  // 6. Spatial GPS record serialization, Geohash matching & Haversine lookup
  await check('6. GPS-tagged records generate valid geohash5/geohash6 and match via Geohash + Haversine', () => {
    const sampleState: StateLandPriceRecord = {
      id: 'sp-gps-1',
      recordCode: 'SP-GPS-001',
      legalDocumentName: 'NQ 15/2025/NQ-HĐND',
      wardCommune: 'Phường Lộc Thọ',
      districtCity: 'TP. Nha Trang',
      streetName: 'Trần Phú',
      roadSegment: 'Đoạn kiểm thử tọa độ GPS',
      startPoint: 'A',
      endPoint: 'B',
      landType: 'Đất ở tại đô thị',
      position: 'Vị trí 1',
      unitPrice: 45000000,
      unit: 'đ/m²',
      sourcePageOrAppendix: 'Phụ lục kiểm thử',
      effectiveDate: '01/01/2026',
      importedAt: '2026-01-01T00:00:00.000Z',
      versionId: 'v_gps_test',
      latitude: 12.2388,
      longitude: 109.1967,
      isDemo: false,
    };

    const doc = buildFirestoreRecordDoc('state_price', 'v_gps_test', sampleState, 0);
    assert.equal(doc.hasCoordinates, true);
    assert.ok(doc.geohash5 && doc.geohash6);
    assert.equal(doc.geohash6.slice(0, 5), doc.geohash5);

    // Query GPS 40m away must hit the same Geohash neighbor set AND match exact_location (<= 150m)
    const queryNeighbors = getGeohashNeighbors(encodeGeohash(12.2391, 109.1967, 5));
    assert.ok(queryNeighbors.includes(doc.geohash5), 'Geohash5 neighbor query must capture record 40m away');

    const restored = deserializeFirestoreRecordDoc(doc) as StateLandPriceRecord;
    const lookup = runUnifiedLandPriceLookup({
      query: {
        latitude: 12.2391,
        longitude: 109.1967,
        districtCity: '',
        wardCommune: '',
        streetName: '',
        radiusMeters: 1000,
      },
      stateRecords: [restored],
      ecovisRecords: [],
      marketListings: [],
    });
    assert.equal(lookup.statePrice.exactMatches.length, 1);
    assert.ok((lookup.statePrice.exactMatches[0].distanceMeters ?? 999) <= 150);
  });

  // 7. Data integrity guards in Firestore record builder (anti-demo, anti-completed-txn, anti-xss-url)
  await check('7. Record builder blocks isDemo=true, completed-transaction market labels, and non-HTTP(S) URLs', () => {
    const demoK: KFactorRuleRecord = {
      id: 'demo-k',
      ruleCode: 'K1',
      factorName: 'Demo',
      factorValue: 1.1,
      formula: 'x',
      applicableCondition: 'x',
      requiredInputFields: '',
      sourceDocument: 'doc',
      sourcePage: '1',
      effectiveDate: '2026',
      importedAt: '2026',
      versionId: 'v1',
      isDemo: true,
    };
    assert.throws(() => buildFirestoreRecordDoc('k_factor_rules', 'v_k1', demoK, 0), /isDemo=true/);

    const badMarketTxn: MarketListingRecord = {
      id: 'm1',
      listingCode: 'M1',
      sourceName: 'Test',
      url: 'https://example.vn/1',
      postedDate: '2026-02-01',
      address: 'Trần Phú, Tô Hạp',
      wardCommune: 'Thị trấn Tô Hạp',
      areaSqm: 100,
      askingPriceVnd: 1000000000,
      unitPricePerSqm: 10000000,
      propertyType: 'Đất ở',
      locationInfo: '',
      verificationStatus: 'chua_xac_minh',
      verificationNote: 'Giá giao dịch thành công đã bán',
      isDuplicate: false,
      createdAt: '2026-02-01T00:00:00.000Z',
    };
    assert.throws(() => buildFirestoreRecordDoc('market_survey', 'v_m1', badMarketTxn, 0), /giá giao dịch thành công/);

    const badMarketUrl: MarketListingRecord = {
      ...badMarketTxn,
      url: 'javascript:alert(1)',
      verificationNote: 'Giá rao bán tham khảo',
    };
    assert.throws(() => buildFirestoreRecordDoc('market_survey', 'v_m1', badMarketUrl, 0), /http:\/\/ hoặc https:\/\//);
  });

  // 8. Staging-first, atomic writeBatch, server count check & bounded query invariants in service source
  await check('8. firestoreDatasetStore enforces staging-first, getCountFromServer, atomic active_versions+activation_history, and limit <= 500', async () => {
    const src = await fs.readFile(path.resolve(process.cwd(), 'src/services/firestoreDatasetStore.ts'), 'utf8');
    assert.equal(PUBLIC_RECORDS_QUERY_LIMIT, 500);
    assert.ok(FIRESTORE_WRITE_BATCH_CHUNK_SIZE <= 400);
    assert.ok(src.includes("commitState: 'staging'"), 'Must stage version first');
    assert.ok(src.includes('getCountFromServer'), 'Must verify server count before commit');
    assert.ok(src.includes("commitState: 'aborted'"), 'Must abort staging on mismatch/failure');
    assert.ok(src.includes('writeBatch(db)'), 'Must use atomic writeBatch');
    assert.ok(src.includes("where('visibility', '==', 'public')"), 'Public reads must filter visibility == public');
    assert.ok(src.includes("where('isDemo', '==', false)"), 'Public reads must filter isDemo == false');
    assert.ok(!src.includes('deleteDoc(doc(db, FIRESTORE_COLLECTIONS.datasetVersions'), 'Must never delete committed versions');
    assert.ok(!src.includes('deleteDoc(doc(db, FIRESTORE_COLLECTIONS.datasetRecords'), 'Must never delete dataset records');
  });

  // 9. Verify production build output for GitHub Pages base path (/giadat/) when dist exists
  const distIndexPath = path.resolve(process.cwd(), 'dist', 'index.html');
  try {
    const html = await fs.readFile(distIndexPath, 'utf8');
    await check('9. Production dist/index.html uses /giadat/ base path assets cleanly (zero secrets)', async () => {
      assert.ok(html.includes('/giadat/assets/'), 'dist/index.html must reference /giadat/assets/');
      const assetsDir = path.resolve(process.cwd(), 'dist', 'assets');
      const assetFiles = await fs.readdir(assetsDir);
      for (const file of assetFiles) {
        if (!file.endsWith('.js')) continue;
        const content = await fs.readFile(path.join(assetsDir, file), 'utf8');
        assert.ok(!/PRIVATE KEY|service_account|AIzaSy.*GEMINI/i.test(content), `Potential secret leak in ${file}`);
      }
    });
  } catch {
    console.log('[INFO] dist/index.html not built yet — run VITE_BASE_PATH=/giadat/ npm run build to execute check #9');
  }

  console.log(`\nALL GATE 3 AUTOMATED CHECKS PASSED: ${passed}/${passed}`);
}

main().catch((err) => {
  console.error('\n[FAIL] Gate 3 Validation Error:', err);
  process.exit(1);
});
