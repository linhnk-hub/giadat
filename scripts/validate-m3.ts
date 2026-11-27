import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readXlsxFile from 'read-excel-file/node';
import {
  ServerDatasetStore,
  validateIncomingDatasetVersion,
} from '../server/datasetStore';
import type {
  AppraisalDossier,
  DatasetKind,
  EcovisRecord,
  MarketListingRecord,
  StateLandPriceRecord,
} from '../src/types/valuation';
import {
  buildAutoWarnings,
  buildReferenceSources,
  inspectDossierIntegrity,
  validateAttachToDossier,
} from '../src/utils/dossierIntegrity';
import {
  detectExifOcrConflict,
  runUnifiedLandPriceLookup,
  validateCoordinateForKhanhHoa,
} from '../src/utils/geoLookup';
import {
  buildReportExcelRows,
  getDatasetTemplateSpec,
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
  let passedChecks = 0;
  const check = (label: string, fn: () => void) => {
    fn();
    passedChecks += 1;
    console.log(`[PASS] ${label}`);
  };

  console.log('=== M3 LAND PRICE DATA READINESS & REAL-WORLD VALIDATION ===\n');

  // ---------------------------------------------------------------------------
  // 1. Validate all 4 import templates against validateAndPreviewImport
  // ---------------------------------------------------------------------------
  const allKinds: DatasetKind[] = ['state_price', 'ecovis', 'k_factor_rules', 'market_survey'];
  for (const kind of allKinds) {
    check(`1.${kind}: Import template passes schema & row validation`, () => {
      const tpl = getDatasetTemplateSpec(kind);
      const rows: string[][] = [
        tpl.headers,
        tpl.sampleNoteRow.map((v) => String(v)),
      ];
      const preview = validateAndPreviewImport(kind, tpl.excelFileName, rows, {
        sourceDocumentName: 'Tài liệu kiểm tra mẫu',
        effectiveDate: '2026-01-01',
        versionId: `tpl-${kind}`,
      });
      assert.equal(preview.missingRequiredColumns.length, 0, `Missing cols: ${preview.missingRequiredColumns.join(', ')}`);
      assert.equal(preview.canCommit, true, `Template ${kind} blocked: ${JSON.stringify(preview.issues)}`);
      assert.equal(preview.validRows.length, 1);
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Real Khánh Hòa Official Land Price Import (Khánh Sơn — NQ 15/2025/NQ-HĐND)
  // ---------------------------------------------------------------------------
  const xlsxPath = path.resolve(process.cwd(), 'Bang_Gia_Dat_Khanh_Son_Chuan_Hoa_PROMPT04.xlsx');
  const rawWorkbook = await readXlsxFile(xlsxPath);
  const workbookSheets: WorkbookSheetInput[] = rawWorkbook.map((ws) => ({
    sheet: ws.sheet,
    rows: ws.data.map((r) => r.map(normalizeCell)),
  }));

  let khanhSonStateRecords: StateLandPriceRecord[] = [];
  check('2.1: Multi-sheet selector picks official NQ 15-2025 sheet automatically', () => {
    const selected = selectWorkbookSheetForDataset(workbookSheets, 'state_price');
    assert.ok(selected, 'Expected a sheet to be selected');
    assert.equal(selected.sheet, 'NQ 15-2025');
  });

  check('2.2: Official Khánh Sơn NQ 15/2025 import (214 real rows, banner skipped, 0 fabricated GPS)', () => {
    const selected = selectWorkbookSheetForDataset(workbookSheets, 'state_price')!;
    const preview = validateAndPreviewImport('state_price', path.basename(xlsxPath), selected.rows, {
      sourceDocumentName: 'Nghị quyết 15/2025/NQ-HĐND tỉnh Khánh Hòa',
      effectiveDate: '01/01/2026',
      versionId: 'm3-test-nq15-ks',
      selectedSheetName: selected.sheet,
    });
    assert.equal(preview.detectedHeaderRowNumber, 2, 'Should skip row 1 banner and detect header at row 2');
    assert.equal(preview.missingRequiredColumns.length, 0);
    assert.equal(preview.duplicateCodes.length, 0);
    assert.equal(preview.totalRows, 214);
    assert.equal(preview.validRows.length, 214);
    assert.equal(preview.validSpatialCount, 0, 'Must never fabricate GPS coordinates');
    assert.equal(preview.canCommit, true);
    assert.equal(preview.issues.filter((i) => i.severity === 'error').length, 0);

    khanhSonStateRecords = preview.validRows as StateLandPriceRecord[];
    // Verify legal provenance preserved on real row (Trần Phú VT1)
    const tranPhuVt1 = khanhSonStateRecords.find((r) => r.recordCode === 'NQ15_P236_S16_88_VT1');
    assert.ok(tranPhuVt1, 'Expected NQ15_P236_S16_88_VT1');
    assert.equal(tranPhuVt1.unitPrice, 1029600);
    assert.equal(tranPhuVt1.wardCommune, 'Thị trấn Tô Hạp');
    assert.equal(tranPhuVt1.streetName, 'Trần Phú');
    assert.ok(tranPhuVt1.legalDocumentName.includes('15/2025/NQ-HĐND'));
    assert.ok(tranPhuVt1.sourcePageOrAppendix.includes('Trang 236'));
    assert.equal(tranPhuVt1.latitude, null);
    assert.equal(tranPhuVt1.longitude, null);

    // Server-side validation must also accept all 214 rows
    const serverCheck = validateIncomingDatasetVersion(
      'state_price',
      {
        versionId: 'm3-test-nq15-ks',
        versionLabel: 'NQ 15/2025 Khánh Sơn (Validation Test)',
        sourceDocumentName: 'Nghị quyết 15/2025/NQ-HĐND tỉnh Khánh Hòa',
        sourceFileName: path.basename(xlsxPath),
        effectiveDate: '01/01/2026',
      },
      khanhSonStateRecords,
      'linhnk2013@gmail.com'
    );
    assert.equal(serverCheck.ok, true, serverCheck.ok ? '' : serverCheck.error);
  });

  // ---------------------------------------------------------------------------
  // 3. Real ECOVIS Dataset Validation & Source Attribution (Khánh Sơn — 209 rows)
  // ---------------------------------------------------------------------------
  let khanhSonEcovisRecords: EcovisRecord[] = [];
  check('3.1: Multi-sheet selector picks ECOVIS 2025 sheet automatically', () => {
    const selected = selectWorkbookSheetForDataset(workbookSheets, 'ecovis');
    assert.ok(selected);
    assert.equal(selected.sheet, 'ECOVIS 2025');
  });

  check('3.2: Real ECOVIS Khánh Sơn import (209 rows, source attribution & appendix/page preserved)', () => {
    const selected = selectWorkbookSheetForDataset(workbookSheets, 'ecovis')!;
    const preview = validateAndPreviewImport('ecovis', path.basename(xlsxPath), selected.rows, {
      sourceDocumentName: '',
      effectiveDate: '',
      versionId: 'm3-test-ecovis-ks',
      selectedSheetName: selected.sheet,
    });
    assert.equal(preview.detectedHeaderRowNumber, 2);
    assert.equal(preview.missingRequiredColumns.length, 0);
    assert.equal(preview.duplicateCodes.length, 0);
    assert.equal(preview.totalRows, 209);
    assert.equal(preview.validRows.length, 209);
    assert.equal(preview.validSpatialCount, 0);
    assert.equal(preview.canCommit, true);

    khanhSonEcovisRecords = preview.validRows as EcovisRecord[];
    const auCoVt1 = khanhSonEcovisRecords.find((r) => r.recordCode === 'ECO_Phụ lục 8.1_S1_0_VT1');
    assert.ok(auCoVt1);
    assert.equal(auCoVt1.surveyUnitPrice, 14000000);
    assert.ok(auCoVt1.sourceDocument.includes('187/2025/39/BC-E.AFA'));
    assert.ok(auCoVt1.appendixAndPage.includes('Phụ lục 8.1'));
    assert.ok(auCoVt1.surveyOrReportDate.includes('2025'));
    assert.ok(auCoVt1.roadSegment.includes('Ngã tư Âu Cơ'));

    const serverCheck = validateIncomingDatasetVersion(
      'ecovis',
      {
        versionId: 'm3-test-ecovis-ks',
        versionLabel: 'ECOVIS 2025 Khánh Sơn (Validation Test)',
        sourceDocumentName: 'Báo cáo 187/2025/39/BC-E.AFA',
        sourceFileName: path.basename(xlsxPath),
        effectiveDate: '2025',
      },
      khanhSonEcovisRecords,
      'linhnk2013@gmail.com'
    );
    assert.equal(serverCheck.ok, true, serverCheck.ok ? '' : serverCheck.error);
  });

  check('3.3: ECOVIS validation blocks missing source attribution (client & server)', () => {
    const badEcovisRows = [
      ['ma_du_lieu', 'xa_phuong', 'tuyen_duong', 'loai_dat', 'don_gia_khao_sat', 'nguon_tai_lieu', 'phu_luc_trang'],
      ['ECO-BAD-1', 'Thị trấn Tô Hạp', 'Trần Phú', 'Đất ở tại đô thị', '5000000', '', 'Phụ lục 8.1 - Trang 1'],
    ];
    const preview = validateAndPreviewImport('ecovis', 'bad_ecovis.csv', badEcovisRows, {
      sourceDocumentName: '',
      effectiveDate: '',
      versionId: 'bad-eco',
    });
    assert.equal(preview.canCommit, false);
    assert.ok(preview.issues.some((i) => i.severity === 'error' && i.field.includes('Nguồn tài liệu')));

    const serverBad = validateIncomingDatasetVersion(
      'ecovis',
      { versionId: 'bad-eco', sourceDocumentName: '' },
      [
        {
          recordCode: 'ECO-BAD-1',
          streetName: 'Trần Phú',
          landType: 'Đất ở tại đô thị',
          surveyUnitPrice: 5000000,
          sourceDocument: '',
          appendixAndPage: 'Phụ lục 8.1',
        },
      ],
      'linhnk2013@gmail.com'
    );
    assert.equal(serverBad.ok, false);
  });

  // ---------------------------------------------------------------------------
  // 4. Market Survey Validation (Source, Date, Location, Asking-Price Status)
  // ---------------------------------------------------------------------------
  check('4.1: Market survey blocks missing date, invalid date, and completed-transaction mislabeling', () => {
    const badMarketRows = [
      ['ma_tin', 'nguon_tin', 'ngay_dang', 'xa_phuong', 'dia_chi', 'dien_tich', 'gia_rao_ban', 'trang_thai_gia'],
      ['MKT-1', 'Batdongsan.com.vn', '', 'Thị trấn Tô Hạp', 'Đường Trần Phú, Tô Hạp', '100', '1500000000', 'Giá rao bán'],
      ['MKT-2', 'Batdongsan.com.vn', 'ngay-khong-hop-le', 'Thị trấn Tô Hạp', 'Đường Âu Cơ, Tô Hạp', '100', '1800000000', 'Giá rao bán'],
      ['MKT-3', 'Môi giới địa phương', '2026-02-10', 'Thị trấn Tô Hạp', 'Đường Võ Thị Sáu, Tô Hạp', '120', '2000000000', 'Giá giao dịch thực tế đã bán'],
    ];
    const preview = validateAndPreviewImport('market_survey', 'bad_market.csv', badMarketRows, {
      sourceDocumentName: 'Khảo sát rao bán',
      effectiveDate: '2026-02-10',
      versionId: 'bad-mkt',
    });
    assert.equal(preview.canCommit, false);
    assert.equal(preview.validRows.length, 0);
    assert.ok(preview.issues.some((i) => i.rowNumber === 2 && i.field === 'Ngày đăng'));
    assert.ok(preview.issues.some((i) => i.rowNumber === 3 && i.field === 'Ngày đăng'));
    assert.ok(preview.issues.some((i) => i.rowNumber === 4 && i.field === 'Trạng thái giá'));

    const serverBadTxn = validateIncomingDatasetVersion(
      'market_survey',
      { versionId: 'bad-mkt-srv', sourceDocumentName: 'Test' },
      [
        {
          listingCode: 'MKT-3',
          sourceName: 'Môi giới',
          postedDate: '2026-02-10',
          address: 'Trần Phú, Tô Hạp',
          areaSqm: 100,
          askingPriceVnd: 1500000000,
          verificationNote: 'Giá giao dịch đã bán',
        },
      ],
      'linhnk2013@gmail.com'
    );
    assert.equal(serverBadTxn.ok, false);
  });

  check('4.2: Market survey accepts valid asking-price records, enforces chua_xac_minh, and flags duplicates', () => {
    const validMarketRows = [
      ['ma_tin', 'nguon_tin', 'duong_dan', 'ngay_dang', 'xa_phuong', 'dia_chi', 'dien_tich', 'gia_rao_ban', 'trang_thai_gia'],
      ['MKT-OK-1', 'Nguồn kiểm thử định dạng', 'https://example.vn/tin-1', '2026-02-15', 'Thị trấn Tô Hạp', 'Đường Trần Phú, Thị trấn Tô Hạp', '100', '1200000000', 'Giá rao bán tham khảo (không phải giá giao dịch)'],
      ['MKT-OK-2', 'Nguồn kiểm thử định dạng', 'https://example.vn/tin-1', '2026-02-15', 'Thị trấn Tô Hạp', 'Đường Trần Phú, Thị trấn Tô Hạp', '100', '1200000000', 'Giá rao bán tham khảo'],
    ];
    const preview = validateAndPreviewImport('market_survey', 'valid_market.csv', validMarketRows, {
      sourceDocumentName: 'Kiểm thử định dạng rao bán',
      effectiveDate: '2026-02-15',
      versionId: 'ok-mkt',
    });
    assert.equal(preview.canCommit, true);
    assert.equal(preview.validRows.length, 2);
    const rows = preview.validRows as MarketListingRecord[];
    assert.equal(rows[0].verificationStatus, 'chua_xac_minh');
    assert.equal(rows[0].unitPricePerSqm, 12000000);
    assert.equal(rows[1].isDuplicate, true);
    assert.ok(preview.issues.some((i) => i.severity === 'warning' && i.field === 'Trùng lặp tin rao'));
  });

  // ---------------------------------------------------------------------------
  // 5. Exact-Location vs Nearby-Comparable Matching (Real Khánh Sơn Data)
  // ---------------------------------------------------------------------------
  check('5.1: Exact street + ward in Khánh Sơn (Trần Phú, Thị trấn Tô Hạp) separates exact vs nearby cleanly', () => {
    const res = runUnifiedLandPriceLookup({
      query: {
        latitude: null,
        longitude: null,
        districtCity: 'Huyện Khánh Sơn',
        wardCommune: 'Thị trấn Tô Hạp',
        streetName: 'Trần Phú',
        landType: 'Đất ở tại đô thị',
        radiusMeters: 1000,
      },
      stateRecords: khanhSonStateRecords,
      ecovisRecords: khanhSonEcovisRecords,
      marketListings: [],
    });

    assert.equal(res.statePrice.exactMatches.length, 6, 'Trần Phú Tô Hạp has 2 segments x 3 positions = 6 official NQ15 rows');
    assert.ok(res.statePrice.nearbyMatches.length > 0, 'Other streets in Thị trấn Tô Hạp should appear as nearby comparables');
    assert.ok(
      res.statePrice.nearbyMatches.every((m) => m.record.streetName !== 'Trần Phú'),
      'Exact street should not be duplicated in nearbyMatches'
    );
    assert.ok(res.ecovis.exactMatches.length > 0, 'Trần Phú Tô Hạp should have exact ECOVIS matches');
    assert.ok(res.ecovis.nearbyMatches.length > 0, 'Other Tô Hạp streets should be nearby ECOVIS comparables');
    assert.equal(res.market.exactMatches.length, 0);
    assert.ok(res.market.missingDataReason, 'Missing market dataset must report honest missing reason');
  });

  check('5.2: Unlisted street in Thị trấn Tô Hạp returns 0 exact matches + nearby comparables only', () => {
    const res = runUnifiedLandPriceLookup({
      query: {
        latitude: null,
        longitude: null,
        districtCity: 'Huyện Khánh Sơn',
        wardCommune: 'Thị trấn Tô Hạp',
        streetName: 'Đường Nhánh Nội Bộ Không Có Trong Bảng Giá',
        landType: 'Đất ở tại đô thị',
        radiusMeters: 1000,
      },
      stateRecords: khanhSonStateRecords,
      ecovisRecords: khanhSonEcovisRecords,
      marketListings: [],
    });

    assert.equal(res.statePrice.exactMatches.length, 0);
    assert.ok(res.statePrice.nearbyMatches.length > 0);
    assert.ok(res.statePrice.missingDataReason?.includes('tham chiếu lân cận'));
    assert.equal(res.ecovis.exactMatches.length, 0);
    assert.ok(res.ecovis.nearbyMatches.length > 0);
  });

  check('5.3: District-wide agricultural land (Đất trồng cây lâu năm, Huyện Khánh Sơn) matches Toan huyen tariffs', () => {
    const res = runUnifiedLandPriceLookup({
      query: {
        latitude: null,
        longitude: null,
        districtCity: 'Huyện Khánh Sơn',
        wardCommune: 'Xã Sơn Bình',
        streetName: '',
        landType: 'Đất trồng cây lâu năm',
        radiusMeters: 1000,
      },
      stateRecords: khanhSonStateRecords,
      ecovisRecords: khanhSonEcovisRecords,
      marketListings: [],
    });

    assert.equal(res.statePrice.exactMatches.length, 2, 'Expected VT1 (32,400) & VT2 (21,600) for Đất trồng cây lâu năm');
    assert.equal(res.statePrice.exactMatches[0].record.wardCommune, 'Toàn huyện');
    assert.equal(res.ecovis.exactMatches.length, 2, 'Expected VT1 (57,000) & VT2 (37,000) in ECOVIS PL8.4');
  });

  // ---------------------------------------------------------------------------
  // 6. Honest Missing-Data & Cross-District Isolation Verification
  // ---------------------------------------------------------------------------
  check('6.1: Out-of-coverage Khánh Hòa district (TP. Nha Trang, Trần Phú) NEVER leaks Khánh Sơn Trần Phú', () => {
    const res = runUnifiedLandPriceLookup({
      query: {
        latitude: 12.2388,
        longitude: 109.1967,
        districtCity: 'TP. Nha Trang',
        wardCommune: 'Phường Lộc Thọ',
        streetName: 'Trần Phú',
        landType: 'Đất ở tại đô thị',
        radiusMeters: 1000,
      },
      stateRecords: khanhSonStateRecords,
      ecovisRecords: khanhSonEcovisRecords,
      marketListings: [],
    });

    assert.equal(res.statePrice.exactMatches.length, 0, 'Must NOT match Khánh Sơn Trần Phú for TP. Nha Trang');
    assert.equal(res.statePrice.nearbyMatches.length, 0, 'Must NOT return Khánh Sơn nearby comparables for TP. Nha Trang');
    assert.equal(res.ecovis.exactMatches.length, 0);
    assert.equal(res.ecovis.nearbyMatches.length, 0);
    assert.ok(res.statePrice.missingDataReason);
    assert.ok(res.ecovis.missingDataReason);
  });

  check('6.2: GPS-only lookup without address text reports honest lack of GPS coordinates in dataset', () => {
    const res = runUnifiedLandPriceLookup({
      query: {
        latitude: 12.025,
        longitude: 108.918,
        districtCity: '',
        wardCommune: '',
        streetName: '',
        landType: '',
        radiusMeters: 1000,
      },
      stateRecords: khanhSonStateRecords,
      ecovisRecords: khanhSonEcovisRecords,
      marketListings: [],
    });

    assert.equal(res.statePrice.exactMatches.length, 0);
    assert.equal(res.statePrice.nearbyMatches.length, 0);
    assert.ok(res.statePrice.missingDataReason?.includes('chưa có cột tọa độ GPS'));
    assert.ok(res.missingDataNotices.some((n) => n.includes('chưa có cột tọa độ GPS')));
  });

  check('6.3: Coordinate bounds & EXIF/OCR conflict detection regression check', () => {
    assert.equal(validateCoordinateForKhanhHoa(12.025, 108.918).status, 'valid_khanh_hoa');
    assert.equal(validateCoordinateForKhanhHoa(21.0285, 105.8542).status, 'outside_khanh_hoa');
    assert.equal(
      detectExifOcrConflict({
        exifLatitude: 12.025,
        exifLongitude: 108.918,
        ocrLatitude: 12.04,
        ocrLongitude: 108.918,
        ocrHasGps: true,
      }).status,
      'conflict'
    );
  });

  // ---------------------------------------------------------------------------
  // 7. Final Appraisal Report, Data Provenance & Server Store Round-Trip
  // ---------------------------------------------------------------------------
  check('7.1: Final real Khánh Sơn appraisal dossier & Excel report preserve full provenance & block DEMO contamination', () => {
    const realStateRec = khanhSonStateRecords.find((r) => r.recordCode === 'NQ15_P236_S16_88_VT1')!;
    const realEcovisRec = khanhSonEcovisRecords.find(
      (r) => r.streetName === 'Trần Phú' && r.position === 'Vị trí 1'
    )!;
    assert.ok(realEcovisRec, 'Expected real ECOVIS Trần Phú VT1 record');

    const dossier: AppraisalDossier = {
      id: 'dossier-m3-ks-001',
      isDemoDossier: false,
      parcel: {
        dossierCode: 'HS-KHANHSON-2026-001',
        collateralName: 'QSDĐ thửa đất kiểm thử thực tế Thị trấn Tô Hạp',
        officerName: 'Cán bộ Thẩm định Kiểm thử',
        createdAt: '2026-02-20T08:00:00.000Z',
        updatedAt: '2026-02-20T08:30:00.000Z',
        address: 'Đường Trần Phú, Thị trấn Tô Hạp, Huyện Khánh Sơn, Khánh Hòa',
        wardCommune: 'Thị trấn Tô Hạp',
        districtCity: 'Huyện Khánh Sơn',
        streetName: 'Trần Phú',
        roadSegmentRef: 'Ngã ba Trần Phú - Lạc Long Quân đến Ngã tư Trần Phú - Lê Duẩn',
        parcelNumber: '12',
        mapSheetNumber: '05',
        landTypeCertificate: 'Đất ở tại đô thị',
        areaSqm: 150,
        frontageWidthM: 6,
        depthM: 25,
        distanceToMainRoadM: 0,
        adjacentRoadName: 'Đường Trần Phú',
        roadAlleyWidthM: 12,
        frontageCount: 1,
        roadCondition: 'Đường nhựa',
        additionalNotes: 'Hồ sơ kiểm thử đối chiếu dữ liệu thật Khánh Sơn (không tạo giá thị trường ảo).',
        officerConfirmedParcelInfo: true,
      },
      photos: [],
      attachedStateRefs: [
        {
          record: realStateRec,
          attachedAt: '2026-02-20T08:15:00.000Z',
          officerConfirmedMatch: true,
          officerNote: 'Khớp đúng đoạn đường Trần Phú VT1',
          matchTier: 'exact_location',
          matchReason: 'Khớp tuyến đường & Xã/Phường',
          distanceMeters: null,
        },
      ],
      attachedEcovisRefs: [
        {
          record: realEcovisRec,
          attachedAt: '2026-02-20T08:16:00.000Z',
          officerConfirmedMatch: true,
          officerNote: 'Nguồn khảo sát độc lập ECOVIS 2025',
          matchTier: 'exact_location',
          matchReason: 'Khớp tuyến đường & Xã/Phường',
          distanceMeters: null,
        },
      ],
      attachedMarketIds: [],
      locationAnalysis: {
        selectedStatePosition: 'Vị trí 1',
        statePositionBasis: 'Mặt tiền đường Trần Phú, Thị trấn Tô Hạp (NQ 15/2025/NQ-HĐND)',
        statePositionVerified: true,
        otherDocumentedFactors: '',
        appliedKFactors: [],
        officerSummaryNotes: 'Chưa áp dụng Hệ số K do chưa có bảng quy định Hệ số K chính thức.',
      },
      reportNotes: 'Báo cáo kiểm thử M3 với dữ liệu thật NQ 15/2025 & ECOVIS Khánh Sơn.',
    };

    const integrity = inspectDossierIntegrity(dossier, [], false);
    assert.equal(integrity.status, 'clean_real');
    assert.equal(integrity.canExportAsOfficialRealReport, true);
    assert.equal(integrity.contaminatedItems.length, 0);

    const sources = buildReferenceSources(dossier, [], []);
    assert.equal(sources.length, 2);
    assert.ok(sources.some((s) => s.category === 'Bảng giá đất Nhà nước' && s.detail.includes('Trang 236')));
    assert.ok(sources.some((s) => s.category === 'Khảo sát ECOVIS' && s.title.includes('187/2025/39/BC-E.AFA')));

    const warnings = buildAutoWarnings(dossier, [], integrity);
    assert.ok(
      warnings.some((w) => w.includes('CHƯA ĐỦ CƠ SỞ TÍNH TOÁN')),
      'Missing K-factor rules must produce explicit warning'
    );

    const excel = buildReportExcelRows(dossier, [], [], false);
    assert.equal(excel.isDemoReport, false);
    assert.ok(excel.fileName.startsWith('BaoCao_TraCuuGiaDat_'));
    const allText = excel.rows.flat().map((c) => String(c.value)).join('\n');
    assert.ok(allText.includes('15/2025/NQ-HĐND'));
    assert.ok(allText.includes('187/2025/39/BC-E.AFA'));
    assert.ok(allText.includes('CHƯA ĐỦ CƠ SỞ TÍNH TOÁN'));

    // DEMO contamination must be blocked at attach gate AND Excel export gate
    assert.equal(validateAttachToDossier(dossier, true, 'DEMO Record').ok, false);
    const contaminated: AppraisalDossier = {
      ...dossier,
      attachedStateRefs: [
        ...dossier.attachedStateRefs,
        {
          ...dossier.attachedStateRefs[0],
          record: { ...realStateRec, id: 'demo-injected', recordCode: 'DEMO-001', isDemo: true },
        },
      ],
    };
    assert.throws(() => buildReportExcelRows(contaminated, [], [], false), /Bị chặn xuất báo cáo/);
  });

  // 7.2 ServerDatasetStore isolated temp-file persistence & rollback check (does NOT touch data/datasets-store.json)
  const tmpStorePath = path.join(os.tmpdir(), `m3-dataset-store-test-${Date.now()}.json`);
  try {
    const tempStore = new ServerDatasetStore(tmpStorePath);
    const validatedState = validateIncomingDatasetVersion(
      'state_price',
      {
        versionId: 'nq15-khanh-son-v1',
        versionLabel: 'NQ 15/2025 Khánh Sơn v1',
        sourceDocumentName: 'Nghị quyết 15/2025/NQ-HĐND tỉnh Khánh Hòa',
        sourceFileName: 'Bang_Gia_Dat_Khanh_Son_Chuan_Hoa_PROMPT04.xlsx',
        effectiveDate: '01/01/2026',
      },
      khanhSonStateRecords,
      'linhnk2013@gmail.com'
    );
    assert.equal(validatedState.ok, true);
    if (validatedState.ok) {
      await tempStore.commitVersion('state_price', validatedState.data, true);
    }

    const validatedEcovis = validateIncomingDatasetVersion(
      'ecovis',
      {
        versionId: 'ecovis-khanh-son-v1',
        versionLabel: 'ECOVIS 2025 Khánh Sơn v1',
        sourceDocumentName: 'Báo cáo 187/2025/39/BC-E.AFA',
        sourceFileName: 'Bang_Gia_Dat_Khanh_Son_Chuan_Hoa_PROMPT04.xlsx',
        effectiveDate: '2025',
      },
      khanhSonEcovisRecords,
      'linhnk2013@gmail.com'
    );
    assert.equal(validatedEcovis.ok, true);
    if (validatedEcovis.ok) {
      await tempStore.commitVersion('ecovis', validatedEcovis.data, true);
    }

    // Reload from disk using a fresh ServerDatasetStore instance to verify file round-trip
    const reloadedStore = new ServerDatasetStore(tmpStorePath);
    const pub = await reloadedStore.getPublicActiveDatasets();
    assert.equal(pub.active.statePrice.records.length, 214);
    assert.equal(pub.active.ecovis.records.length, 209);
    assert.equal(pub.active.kFactorRules.records.length, 0);
    assert.equal(pub.active.marketSurvey.records.length, 0);
    passedChecks += 1;
    console.log('[PASS] 7.2: ServerDatasetStore isolated disk round-trip (214 NQ15 + 209 ECOVIS, 0 fabricated K/Market)');
  } finally {
    await fs.rm(tmpStorePath, { force: true });
  }

  console.log(`\nALL M3 VALIDATION CHECKS PASSED: ${passedChecks}/${passedChecks}`);
}

main().catch((err) => {
  console.error('\n[FAIL] M3 Validation Error:', err);
  process.exit(1);
});
