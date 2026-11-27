import {
  AppliedKFactorItem,
  AppraisalDossier,
  AttachOperationResult,
  ComponentOriginSummary,
  ContaminatedDemoItem,
  DossierIntegrityReport,
  EcovisRecord,
  KFactorRuleRecord,
  MarketListingRecord,
  PdfReferenceDocument,
  StateLandPriceRecord,
} from '../types/valuation';
import {
  detectExifOcrConflict,
  detectMultiPhotoDispersion,
  formatDistanceVi,
  validateCoordinateForKhanhHoa,
} from './geoLookup';

function hasDemoMarker(text?: string | null): boolean {
  if (!text) return false;
  const upper = text.toUpperCase();
  return upper.includes('[DEMO') || upper.startsWith('DEMO-');
}

export function isStateRecordDemo(record: StateLandPriceRecord): boolean {
  return (
    record.isDemo === true ||
    record.id.startsWith('demo-') ||
    record.versionId.startsWith('demo-') ||
    hasDemoMarker(record.recordCode) ||
    hasDemoMarker(record.legalDocumentName) ||
    hasDemoMarker(record.streetName)
  );
}

export function isEcovisRecordDemo(record: EcovisRecord): boolean {
  return (
    record.isDemo === true ||
    record.id.startsWith('demo-') ||
    record.versionId.startsWith('demo-') ||
    hasDemoMarker(record.recordCode) ||
    hasDemoMarker(record.sourceDocument) ||
    hasDemoMarker(record.streetName)
  );
}

export function isMarketListingDemo(record: MarketListingRecord): boolean {
  return (
    record.isDemo === true ||
    record.id.startsWith('demo-') ||
    hasDemoMarker(record.listingCode) ||
    hasDemoMarker(record.sourceName) ||
    hasDemoMarker(record.address)
  );
}

export function isKFactorRuleDemo(record: KFactorRuleRecord): boolean {
  return (
    record.isDemo === true ||
    record.id.startsWith('demo-') ||
    record.versionId.startsWith('demo-') ||
    hasDemoMarker(record.ruleCode) ||
    hasDemoMarker(record.sourceDocument) ||
    hasDemoMarker(record.factorName)
  );
}

export function isAppliedKFactorDemo(item: AppliedKFactorItem): boolean {
  return (
    item.isDemo === true ||
    item.ruleId.startsWith('demo-') ||
    hasDemoMarker(item.sourceDocument) ||
    hasDemoMarker(item.factorName) ||
    hasDemoMarker(item.sourcePage)
  );
}

/**
 * Kiểm tra tại tầng nghiệp vụ trước khi cho phép gắn bất kỳ bản ghi nào vào hồ sơ.
 * Tuyệt đối chặn gắn bản ghi DEMO vào hồ sơ thật.
 */
export function validateAttachToDossier(
  dossier: AppraisalDossier,
  recordIsDemo: boolean,
  recordLabel: string
): AttachOperationResult {
  const targetIsDemoDossier = dossier.isDemoDossier === true;
  if (!targetIsDemoDossier && recordIsDemo) {
    return {
      ok: false,
      error: `Bị chặn ở tầng nghiệp vụ: Không được phép gắn bản ghi dữ liệu DEMO ("${recordLabel}") vào hồ sơ nghiệp vụ thật (${dossier.parcel.dossierCode}).`,
    };
  }
  return { ok: true };
}

function buildOriginSummary(
  component: string,
  totalCount: number,
  demoCount: number,
  dossierIsDemo: boolean
): ComponentOriginSummary {
  const realCount = Math.max(0, totalCount - demoCount);
  let originStatus: ComponentOriginSummary['originStatus'] = 'chua_gan';
  if (totalCount === 0) {
    originStatus = 'chua_gan';
  } else if (demoCount === 0) {
    originStatus = 'du_lieu_that';
  } else if (dossierIsDemo) {
    originStatus = 'du_lieu_demo';
  } else {
    originStatus = 'nhiem_demo';
  }
  return {
    component,
    totalCount,
    realCount,
    demoCount,
    originStatus,
  };
}

/**
 * Kiểm tra tính toàn vẹn của một hồ sơ (kể cả hồ sơ cũ đã lưu trong localStorage từ phiên trước).
 * Không chỉ phụ thuộc vào công tắc isDemoMode.
 */
export function inspectDossierIntegrity(
  dossier: AppraisalDossier,
  knownMarketListings: MarketListingRecord[],
  isDemoMode: boolean
): DossierIntegrityReport {
  const dossierIsDemo = dossier.isDemoDossier === true;
  const contaminatedItems: ContaminatedDemoItem[] = [];

  // 1. State Land Price refs
  let stateDemoCount = 0;
  for (const ref of dossier.attachedStateRefs) {
    if (isStateRecordDemo(ref.record)) {
      stateDemoCount++;
      if (!dossierIsDemo) {
        contaminatedItems.push({
          category: 'state_price',
          categoryLabel: 'Bảng giá đất Nhà nước',
          id: ref.record.id,
          label: `${ref.record.recordCode} – ${ref.record.streetName}`,
          reason: 'Bản ghi có cờ isDemo hoặc mã/văn bản nguồn DEMO đang gắn trong hồ sơ thật.',
        });
      }
    }
  }

  // 2. ECOVIS refs
  let ecovisDemoCount = 0;
  for (const ref of dossier.attachedEcovisRefs) {
    if (isEcovisRecordDemo(ref.record)) {
      ecovisDemoCount++;
      if (!dossierIsDemo) {
        contaminatedItems.push({
          category: 'ecovis',
          categoryLabel: 'Khảo sát ECOVIS',
          id: ref.record.id,
          label: `${ref.record.recordCode} – ${ref.record.streetName}`,
          reason: 'Bản ghi khảo sát ECOVIS mang nhãn DEMO đang gắn trong hồ sơ thật.',
        });
      }
    }
  }

  // 3. Market listings attached to dossier
  const listingById = new Map(knownMarketListings.map((m) => [m.id, m]));
  let marketDemoCount = 0;
  for (const mid of dossier.attachedMarketIds) {
    const found = listingById.get(mid);
    const isDemoListing =
      mid.startsWith('demo-') || (found ? isMarketListingDemo(found) : false);
    if (isDemoListing) {
      marketDemoCount++;
      if (!dossierIsDemo) {
        contaminatedItems.push({
          category: 'market_listing',
          categoryLabel: 'Tin rao giá thị trường',
          id: mid,
          label: found ? `${found.listingCode} – ${found.address}` : `Mã tin DEMO (${mid})`,
          reason: 'Tin rao thị trường thuộc nguồn DEMO đang gắn trong hồ sơ thật.',
        });
      }
    }
  }

  // 4. Applied K-factors
  let kDemoCount = 0;
  for (const k of dossier.locationAnalysis.appliedKFactors) {
    if (isAppliedKFactorDemo(k)) {
      kDemoCount++;
      if (!dossierIsDemo) {
        contaminatedItems.push({
          category: 'k_factor',
          categoryLabel: 'Hệ số K',
          id: k.id,
          label: k.factorName,
          reason: 'Quy định hệ số K thuộc nguồn DEMO đang áp dụng trong hồ sơ thật.',
        });
      }
    }
  }

  const totalDemoAttached = stateDemoCount + ecovisDemoCount + marketDemoCount + kDemoCount;
  const isContaminatedRealDossier = !dossierIsDemo && contaminatedItems.length > 0;
  const hasAnyDemoData = dossierIsDemo || totalDemoAttached > 0 || isDemoMode;

  let status: DossierIntegrityReport['status'] = 'clean_real';
  if (isContaminatedRealDossier) {
    status = 'contaminated_real';
  } else if (dossierIsDemo) {
    status = 'isolated_demo';
  }

  const integrityWarnings: string[] = [];
  if (isContaminatedRealDossier) {
    integrityWarnings.push(
      `CẢNH BÁO NGHIÊM TRỌNG: Hồ sơ thật "${dossier.parcel.dossierCode}" đang chứa ${contaminatedItems.length} bản ghi dữ liệu DEMO (có thể lưu từ phiên trước). Hệ thống CHẶN xuất báo cáo với nhãn dữ liệu thật cho đến khi cán bộ kiểm tra và gỡ bỏ các bản ghi DEMO này.`
    );
  } else if (dossierIsDemo || isDemoMode) {
    integrityWarnings.push(
      'Hồ sơ đang sử dụng dữ liệu MINH HỌA (DEMO) tách biệt. Tuyệt đối không sử dụng làm căn cứ thẩm định thực tế.'
    );
  }

  const componentOrigins: ComponentOriginSummary[] = [
    buildOriginSummary(
      'Bảng giá đất Nhà nước',
      dossier.attachedStateRefs.length,
      stateDemoCount,
      dossierIsDemo
    ),
    buildOriginSummary(
      'Dữ liệu khảo sát ECOVIS',
      dossier.attachedEcovisRefs.length,
      ecovisDemoCount,
      dossierIsDemo
    ),
    buildOriginSummary(
      'Tin rao giá thị trường',
      dossier.attachedMarketIds.length,
      marketDemoCount,
      dossierIsDemo
    ),
    buildOriginSummary(
      'Hệ số điều chỉnh K',
      dossier.locationAnalysis.appliedKFactors.length,
      kDemoCount,
      dossierIsDemo
    ),
  ];

  return {
    status,
    isDemoDossier: dossierIsDemo,
    hasAnyDemoData,
    isContaminatedRealDossier,
    canExportAsOfficialRealReport:
      status === 'clean_real' && !isDemoMode && !hasAnyDemoData,
    canExportDemoReport: status === 'isolated_demo',
    contaminatedItems,
    componentOrigins,
    integrityWarnings,
  };
}

export interface ReportReferenceSourceItem {
  category: string;
  title: string;
  detail: string;
  originLabel: string;
  verified: boolean;
}

export function buildAutoWarnings(
  dossier: AppraisalDossier,
  attachedMarketListings: MarketListingRecord[],
  integrity: DossierIntegrityReport
): string[] {
  const list: string[] = [...integrity.integrityWarnings];
  const { parcel, photos, attachedStateRefs, attachedEcovisRefs, locationAnalysis } = dossier;

  if (!parcel.officerConfirmedParcelInfo) {
    list.push(
      'Thông tin thửa đất (Mục 1) chưa được cán bộ tích xác nhận đối chiếu Giấy chứng nhận.'
    );
  }

  const missingRequired: string[] = [];
  if (!parcel.address.trim()) missingRequired.push('Địa chỉ');
  if (!parcel.wardCommune.trim()) missingRequired.push('Xã/Phường');
  if (!parcel.streetName.trim()) missingRequired.push('Tuyến đường');
  if (!parcel.parcelNumber.trim() || !parcel.mapSheetNumber.trim()) {
    missingRequired.push('Số thửa/Tờ bản đồ');
  }
  if (!parcel.landTypeCertificate.trim()) missingRequired.push('Loại đất theo GCN');
  if (!parcel.areaSqm) missingRequired.push('Diện tích');
  if (missingRequired.length > 0) {
    list.push(`Còn thiếu thông tin bắt buộc của thửa đất: ${missingRequired.join(', ')}.`);
  }

  if (photos.length === 0) {
    list.push('Chưa có hình ảnh khảo sát thực địa.');
  } else {
    const unconfirmedPhotos = photos.filter(
      (p) => !p.officerConfirmedCoordinates || !p.officerConfirmedAtParcel
    );
    if (unconfirmedPhotos.length > 0) {
      list.push(
        `Có ${unconfirmedPhotos.length}/${photos.length} ảnh thực địa chưa được cán bộ xác nhận tọa độ GPS hoặc xác nhận chụp tại thửa đất.`
      );
    }

    photos.forEach((p, idx) => {
      const conflict = detectExifOcrConflict(p);
      if (conflict.status === 'conflict') {
        list.push(
          `Ảnh #${idx + 1} (${p.fileName}): XUNG ĐỘT TỌA ĐỘ GPS giữa EXIF và OCR (lệch ${formatDistanceVi(conflict.distanceMeters)} > 150m). Cán bộ cần đối chiếu và xác nhận nguồn tọa độ đúng.`
        );
      }
      const bounds = validateCoordinateForKhanhHoa(p.activeLatitude, p.activeLongitude);
      if (bounds.status === 'outside_khanh_hoa') {
        list.push(
          `Ảnh #${idx + 1} (${p.fileName}): Tọa độ GPS nằm ngoài phạm vi địa lý thông thường của tỉnh Khánh Hòa.`
        );
      }
    });

    const multiDisp = detectMultiPhotoDispersion(photos);
    if (multiDisp.hasConflict && multiDisp.message) {
      list.push(multiDisp.message);
    }
  }

  if (attachedStateRefs.some((r) => !r.officerConfirmedMatch)) {
    list.push(
      'Có bản ghi Bảng giá đất Nhà nước gắn kèm nhưng chưa được cán bộ xác nhận khớp tuyến/đoạn đường.'
    );
  }
  const nearbyStateCount = attachedStateRefs.filter((r) => r.matchTier === 'nearby_comparable').length;
  if (nearbyStateCount > 0) {
    list.push(
      `Có ${nearbyStateCount} bản ghi Bảng giá đất Nhà nước được gắn theo diện THAM CHIẾU LÂN CẬN (không phải khớp đúng tuyến/vị trí) — cán bộ cần ghi rõ căn cứ áp dụng.`
    );
  }

  if (attachedEcovisRefs.some((r) => !r.officerConfirmedMatch)) {
    list.push(
      'Có bản ghi ECOVIS gắn kèm nhưng chưa được cán bộ xác nhận phù hợp khu vực đối chiếu.'
    );
  }
  const nearbyEcovisCount = attachedEcovisRefs.filter((r) => r.matchTier === 'nearby_comparable').length;
  if (nearbyEcovisCount > 0) {
    list.push(
      `Có ${nearbyEcovisCount} bản ghi ECOVIS được gắn theo diện THAM CHIẾU LÂN CẬN — không mặc định áp dụng trực tiếp cho vị trí thửa đất.`
    );
  }

  const unverifiedMarketCount = attachedMarketListings.filter(
    (m) => m.verificationStatus === 'chua_xac_minh'
  ).length;
  if (unverifiedMarketCount > 0) {
    list.push(
      `Có ${unverifiedMarketCount} tin rao bán thị trường đang ở trạng thái CHƯA XÁC MINH. Lưu ý: giá rao bán không phải giá giao dịch thực tế.`
    );
  }

  const validVerifiedK = locationAnalysis.appliedKFactors.filter(
    (k) => k.hasSufficientBasis && k.verificationStatus === 'da_xac_minh'
  );
  if (validVerifiedK.length === 0) {
    list.push(
      'Hệ số K đang ở trạng thái “CHƯA ĐỦ CƠ SỞ TÍNH TOÁN” hoặc chưa được xác minh đầy đủ.'
    );
  }

  return list;
}

export function buildReferenceSources(
  dossier: AppraisalDossier,
  attachedMarketListings: MarketListingRecord[],
  pdfDocuments: PdfReferenceDocument[]
): ReportReferenceSourceItem[] {
  const sources: ReportReferenceSourceItem[] = [];

  dossier.attachedStateRefs.forEach((r) => {
    sources.push({
      category: 'Bảng giá đất Nhà nước',
      title: r.record.legalDocumentName,
      detail: `${r.record.sourcePageOrAppendix}${r.record.effectiveDate ? ` · Hiệu lực: ${r.record.effectiveDate}` : ''}`,
      originLabel: isStateRecordDemo(r.record) ? 'DEMO (Minh họa)' : 'Dữ liệu thật',
      verified: r.officerConfirmedMatch,
    });
  });

  dossier.attachedEcovisRefs.forEach((r) => {
    sources.push({
      category: 'Khảo sát ECOVIS',
      title: r.record.sourceDocument,
      detail: `${r.record.appendixAndPage}${r.record.surveyOrReportDate ? ` · Thời điểm: ${r.record.surveyOrReportDate}` : ''}`,
      originLabel: isEcovisRecordDemo(r.record) ? 'DEMO (Minh họa)' : 'Dữ liệu thật',
      verified: r.officerConfirmedMatch,
    });
  });

  dossier.locationAnalysis.appliedKFactors.forEach((k) => {
    sources.push({
      category: 'Quy định Hệ số K',
      title: k.sourceDocument,
      detail: `${k.factorName} · ${k.sourcePage}`,
      originLabel: isAppliedKFactorDemo(k) ? 'DEMO (Minh họa)' : 'Dữ liệu thật',
      verified: k.hasSufficientBasis && k.verificationStatus === 'da_xac_minh',
    });
  });

  attachedMarketListings.forEach((m) => {
    sources.push({
      category: 'Tin rao thị trường tham khảo',
      title: `${m.sourceName} (${m.listingCode})`,
      detail: `${m.address}${m.postedDate ? ` · Đăng: ${m.postedDate}` : ''}${m.url ? ` · URL: ${m.url}` : ' · Nhập thủ công'}`,
      originLabel: isMarketListingDemo(m) ? 'DEMO (Minh họa)' : 'Dữ liệu thật',
      verified: m.verificationStatus === 'da_xac_minh_so_bo',
    });
  });

  pdfDocuments.forEach((pdf) => {
    sources.push({
      category: 'Tài liệu PDF lưu trữ',
      title: pdf.documentTitle,
      detail: `Tệp: ${pdf.fileName}${pdf.pageCount ? ` · ${pdf.pageCount} trang` : ''}${pdf.effectiveDate ? ` · Hiệu lực: ${pdf.effectiveDate}` : ''}${pdf.appendixNote ? ` · ${pdf.appendixNote}` : ''}`,
      originLabel: 'Tài liệu đối chiếu gốc',
      verified: true,
    });
  });

  return sources;
}
