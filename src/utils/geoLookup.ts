import {
  EcovisRecord,
  FieldPhotoItem,
  LookupMatchTier,
  MarketListingRecord,
  StateLandPriceRecord,
} from '../types/valuation';
import { isValidCoordinatePair, normalizeVietnameseText } from './formatters';

export const KHANH_HOA_GEO_BOUNDS = {
  minLat: 11.7,
  maxLat: 13.1,
  minLng: 108.5,
  maxLng: 109.7,
} as const;

export const EXIF_OCR_CONSISTENT_MAX_M = 30;
export const EXIF_OCR_CONFLICT_THRESHOLD_M = 150;
export const EXACT_SPATIAL_RADIUS_M = 150;
export const EMPTY_MARKET_DATA_MESSAGE = 'Chưa có số liệu về giá trị thị trường vị trí đất.';

export interface CoordinateValidationReport {
  status: 'valid_khanh_hoa' | 'outside_khanh_hoa' | 'invalid' | 'missing';
  isValidWgs84: boolean;
  inKhanhHoa: boolean | null;
  message: string;
}

export interface ExifOcrConflictReport {
  status: 'no_gps' | 'single_source' | 'consistent' | 'minor_drift' | 'conflict';
  hasExif: boolean;
  hasOcr: boolean;
  distanceMeters: number | null;
  severity: 'none' | 'info' | 'warning' | 'error';
  message: string;
}

export interface MultiPhotoDispersionReport {
  photoCountWithGps: number;
  maxDistanceMeters: number | null;
  hasConflict: boolean;
  message: string | null;
}

export interface ParsedVietnameseAddress {
  streetName: string;
  wardCommune: string;
  districtCity: string;
  province: string;
}

export interface LookupQueryInput {
  latitude: number | null;
  longitude: number | null;
  streetName: string;
  wardCommune: string;
  districtCity: string;
  roadSegment?: string;
  landType?: string;
  radiusMeters: number;
}

export interface MatchedLookupItem<T> {
  record: T;
  tier: LookupMatchTier;
  matchType: 'gps_and_text' | 'gps_only' | 'text_only';
  distanceMeters: number | null;
  matchReason: string;
  score: number;
}

export interface PriceRangeStats {
  count: number;
  min: number | null;
  max: number | null;
  average: number | null;
}

export interface PillarLookupResult<T> {
  datasetTotalCount: number;
  datasetSpatialCount: number;
  exactMatches: MatchedLookupItem<T>[];
  nearbyMatches: MatchedLookupItem<T>[];
  exactStats: PriceRangeStats;
  nearbyStats: PriceRangeStats;
  missingDataReason: string | null;
}

export interface MarketPillarLookupResult extends PillarLookupResult<MarketListingRecord> {
  exactVerifiedStats: PriceRangeStats;
  exactUnverifiedStats: PriceRangeStats;
  nearbyVerifiedStats: PriceRangeStats;
  nearbyUnverifiedStats: PriceRangeStats;
}

export interface UnifiedLookupResult {
  hasQueryCoords: boolean;
  hasQueryLocationText: boolean;
  coordinateValidation: CoordinateValidationReport;
  radiusMeters: number;
  statePrice: PillarLookupResult<StateLandPriceRecord>;
  ecovis: PillarLookupResult<EcovisRecord>;
  market: MarketPillarLookupResult;
  missingDataNotices: string[];
}

/**
 * Great-circle Haversine distance in meters between two WGS84 coordinate pairs.
 */
export function calculateHaversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export function formatDistanceVi(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters) || meters < 0) {
    return 'Không có khoảng cách GPS';
  }
  if (meters < 1000) {
    return `${Math.round(meters).toLocaleString('vi-VN')} m`;
  }
  return `${(meters / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} km`;
}

export function validateCoordinateForKhanhHoa(
  lat: number | null | undefined,
  lng: number | null | undefined
): CoordinateValidationReport {
  const latVal = lat ?? null;
  const lngVal = lng ?? null;

  if (latVal === null && lngVal === null) {
    return {
      status: 'missing',
      isValidWgs84: false,
      inKhanhHoa: null,
      message: 'Chưa có tọa độ GPS.',
    };
  }

  if (!isValidCoordinatePair(latVal, lngVal)) {
    return {
      status: 'invalid',
      isValidWgs84: false,
      inKhanhHoa: false,
      message:
        'Tọa độ GPS không hợp lệ (cần cả Vĩ độ [-90, 90] và Kinh độ [-180, 180], khác 0,0).',
    };
  }

  const inBounds =
    latVal! >= KHANH_HOA_GEO_BOUNDS.minLat &&
    latVal! <= KHANH_HOA_GEO_BOUNDS.maxLat &&
    lngVal! >= KHANH_HOA_GEO_BOUNDS.minLng &&
    lngVal! <= KHANH_HOA_GEO_BOUNDS.maxLng;

  if (!inBounds) {
    return {
      status: 'outside_khanh_hoa',
      isValidWgs84: true,
      inKhanhHoa: false,
      message: `Tọa độ (${latVal!.toFixed(6)}, ${lngVal!.toFixed(6)}) nằm ngoài khung địa lý thông thường của tỉnh Khánh Hòa (11.7°–13.1°N, 108.5°–109.7°E). Cán bộ cần đối chiếu lại trước khi tra cứu.`,
    };
  }

  return {
    status: 'valid_khanh_hoa',
    isValidWgs84: true,
    inKhanhHoa: true,
    message: 'Tọa độ hợp lệ theo chuẩn WGS84 và nằm trong phạm vi địa lý tỉnh Khánh Hòa.',
  };
}

export function detectExifOcrConflict(photo: Pick<
  FieldPhotoItem,
  'exifLatitude' | 'exifLongitude' | 'ocrLatitude' | 'ocrLongitude' | 'ocrHasGps'
>): ExifOcrConflictReport {
  const hasExif = isValidCoordinatePair(photo.exifLatitude, photo.exifLongitude);
  const hasOcr =
    Boolean(photo.ocrHasGps) && isValidCoordinatePair(photo.ocrLatitude, photo.ocrLongitude);

  if (!hasExif && !hasOcr) {
    return {
      status: 'no_gps',
      hasExif: false,
      hasOcr: false,
      distanceMeters: null,
      severity: 'warning',
      message:
        'Ảnh chưa có tọa độ GPS từ EXIF và chưa trích xuất được tọa độ in trên ảnh (OCR). Cần nhập tọa độ thủ công hoặc tra cứu theo địa chỉ.',
    };
  }

  if (hasExif && !hasOcr) {
    return {
      status: 'single_source',
      hasExif: true,
      hasOcr: false,
      distanceMeters: null,
      severity: 'info',
      message: 'Chỉ có tọa độ EXIF gốc của ảnh (chưa có tọa độ OCR để đối chiếu chéo).',
    };
  }

  if (!hasExif && hasOcr) {
    return {
      status: 'single_source',
      hasExif: false,
      hasOcr: true,
      distanceMeters: null,
      severity: 'info',
      message:
        'Tệp ảnh không có GPS EXIF (thường do ảnh bị nén qua ứng dụng nhắn tin); đang có tọa độ đọc từ chữ in trên ảnh (OCR).',
    };
  }

  const distanceMeters = calculateHaversineMeters(
    photo.exifLatitude!,
    photo.exifLongitude!,
    photo.ocrLatitude!,
    photo.ocrLongitude!
  );

  if (distanceMeters <= EXIF_OCR_CONSISTENT_MAX_M) {
    return {
      status: 'consistent',
      hasExif: true,
      hasOcr: true,
      distanceMeters,
      severity: 'none',
      message: `Tọa độ EXIF và tọa độ in trên ảnh (OCR) khớp nhau (chênh lệch ${formatDistanceVi(distanceMeters)}).`,
    };
  }

  if (distanceMeters <= EXIF_OCR_CONFLICT_THRESHOLD_M) {
    return {
      status: 'minor_drift',
      hasExif: true,
      hasOcr: true,
      distanceMeters,
      severity: 'warning',
      message: `Tọa độ EXIF và OCR chênh lệch nhẹ ${formatDistanceVi(distanceMeters)} (trong ngưỡng 30m–150m, thường do độ trễ chốt GPS khi chụp). Cán bộ nên kiểm tra trên Google Maps.`,
    };
  }

  return {
    status: 'conflict',
    hasExif: true,
    hasOcr: true,
    distanceMeters,
    severity: 'error',
    message: `PHÁT HIỆN XUNG ĐỘT TỌA ĐỘ: GPS EXIF và GPS in trên ảnh (OCR) lệch nhau ${formatDistanceVi(distanceMeters)} (> 150m). Cán bộ bắt buộc kiểm tra đối chiếu và chọn nguồn tọa độ chính xác.`,
  };
}

export function detectMultiPhotoDispersion(photos: FieldPhotoItem[]): MultiPhotoDispersionReport {
  const validPhotos = photos.filter((p) =>
    isValidCoordinatePair(p.activeLatitude, p.activeLongitude)
  );
  if (validPhotos.length < 2) {
    return {
      photoCountWithGps: validPhotos.length,
      maxDistanceMeters: null,
      hasConflict: false,
      message: null,
    };
  }

  let maxDistance = 0;
  for (let i = 0; i < validPhotos.length; i++) {
    for (let j = i + 1; j < validPhotos.length; j++) {
      const dist = calculateHaversineMeters(
        validPhotos[i].activeLatitude!,
        validPhotos[i].activeLongitude!,
        validPhotos[j].activeLatitude!,
        validPhotos[j].activeLongitude!
      );
      if (dist > maxDistance) maxDistance = dist;
    }
  }

  const hasConflict = maxDistance > EXIF_OCR_CONFLICT_THRESHOLD_M;
  return {
    photoCountWithGps: validPhotos.length,
    maxDistanceMeters: maxDistance,
    hasConflict,
    message: hasConflict
      ? `Các ảnh thực địa trong hồ sơ có khoảng cách GPS lên tới ${formatDistanceVi(maxDistance)} (> 150m). Cần kiểm tra xem ảnh có chụp cùng một thửa đất hay không.`
      : null,
  };
}

/**
 * Deterministically parse Vietnamese address components from OCR overlay text
 * or reverse-geocoding display text. Never invents fields absent from the text.
 */
export function parseVietnameseAddressText(rawText: string | null | undefined): ParsedVietnameseAddress {
  const empty: ParsedVietnameseAddress = {
    streetName: '',
    wardCommune: '',
    districtCity: '',
    province: '',
  };
  if (!rawText || typeof rawText !== 'string') return empty;

  const segments = rawText
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^\d{5,6}$/.test(s)); // skip postal codes

  let streetName = '';
  let wardCommune = '';
  let districtCity = '';
  let province = '';

  for (const seg of segments) {
    const norm = normalizeVietnameseText(seg);
    if (norm === 'viet nam' || norm === 'vietnam') continue;

    if (
      !province &&
      (norm.includes('khanh hoa') || norm.startsWith('tinh '))
    ) {
      province = seg;
      continue;
    }

    if (
      !wardCommune &&
      (norm.startsWith('phuong ') ||
        norm.startsWith('p.') ||
        norm.startsWith('xa ') ||
        norm.startsWith('thi tran ') ||
        norm.startsWith('tt.'))
    ) {
      wardCommune = seg;
      continue;
    }

    if (
      !districtCity &&
      (norm.startsWith('tp.') ||
        norm.startsWith('tp ') ||
        norm.startsWith('thanh pho ') ||
        norm.startsWith('thi xa ') ||
        norm.startsWith('tx.') ||
        norm.startsWith('huyen ') ||
        norm.startsWith('quan ') ||
        norm === 'nha trang' ||
        norm === 'cam ranh' ||
        norm === 'ninh hoa' ||
        norm === 'cam lam' ||
        norm === 'dien khanh' ||
        norm === 'van ninh' ||
        norm === 'khanh vinh' ||
        norm === 'khanh son')
    ) {
      districtCity = seg;
      continue;
    }

    if (
      !streetName &&
      (norm.includes('duong ') ||
        norm.includes('quoc lo') ||
        norm.includes('tinh lo') ||
        norm.includes('dai lo') ||
        norm.includes('pho ') ||
        norm.includes('hem ') ||
        norm.includes('ql') ||
        norm.includes('tl'))
    ) {
      streetName = seg;
    }
  }

  // Fallback: if first segment looks like a street/number and wasn't classified as ward/district/province
  if (!streetName && segments.length >= 2) {
    const first = segments[0];
    if (first !== wardCommune && first !== districtCity && first !== province) {
      const normFirst = normalizeVietnameseText(first);
      if (normFirst !== 'viet nam' && normFirst !== 'vietnam') {
        streetName = first;
      }
    }
  }

  return {
    streetName,
    wardCommune,
    districtCity,
    province,
  };
}

/**
 * Strip administrative prefixes ("Đường", "Phường", "Xã", "TP.", "Huyện"...)
 * and "[DEMO]" markers so user queries match official records cleanly.
 */
export function stripAdminPrefix(input: string): string {
  return normalizeVietnameseText(input)
    .replace(/\[demo[^\]]*\]/g, ' ')
    .replace(
      /\b(duong|pho|dai lo|phuong|xa|thi tran|thanh pho|thi xa|huyen|quan|tinh|tp|tx|tt|p)\b\.?/g,
      ' '
    )
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchNormalizedAdmin(query: string, candidate: string): 'exact' | 'partial' | 'none' {
  const q = stripAdminPrefix(query);
  const c = stripAdminPrefix(candidate);
  if (!q || !c) return 'none';
  if (q === c) return 'exact';
  if (q.length >= 3 && (c.includes(q) || q.includes(c))) return 'partial';
  return 'none';
}

function computePriceRangeStats(prices: number[]): PriceRangeStats {
  const valid = prices.filter((p) => Number.isFinite(p) && p > 0);
  if (valid.length === 0) {
    return { count: 0, min: null, max: null, average: null };
  }
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const average = Math.round(valid.reduce((s, v) => s + v, 0) / valid.length);
  return { count: valid.length, min, max, average };
}

function sortMatchedItems<T>(items: MatchedLookupItem<T>[]): MatchedLookupItem<T>[] {
  return [...items].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.distanceMeters !== null && b.distanceMeters !== null) {
      return a.distanceMeters - b.distanceMeters;
    }
    if (a.distanceMeters !== null) return -1;
    if (b.distanceMeters !== null) return 1;
    return 0;
  });
}

function isDistrictWideWardLabel(ward: string): boolean {
  const norm = normalizeVietnameseText(ward).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return (
    norm === 'toan huyen' ||
    norm === 'toan thi xa' ||
    norm === 'toan thanh pho' ||
    norm === 'toan tinh' ||
    norm === 'toan dia ban'
  );
}

function isSubAreaDistrictDescriptor(recDistrict: string, recWard: string): boolean {
  const normDist = normalizeVietnameseText(recDistrict).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normDist) return true;
  if (
    normDist.startsWith('dia ban ') ||
    normDist.startsWith('doan qua ') ||
    normDist.startsWith('duong lien xa') ||
    normDist.startsWith('dat o ven truc') ||
    normDist.startsWith('truc chinh')
  ) {
    return true;
  }
  if (recWard && matchNormalizedAdmin(recWard, recDistrict) !== 'none') {
    return true;
  }
  return false;
}

function classifyBroadLandGroup(landType: string): 'agricultural' | 'residential' | 'other' {
  const norm = normalizeVietnameseText(landType);
  if (!norm) return 'other';
  if (
    norm.includes('dat o') ||
    norm.includes('odt') ||
    norm.includes('ont') ||
    norm.includes('thuong mai') ||
    norm.includes('san xuat kinh doanh')
  ) {
    return 'residential';
  }
  if (
    norm.includes('nong nghiep') ||
    norm.includes('trong cay') ||
    norm.includes('rung') ||
    norm.includes('thuy san') ||
    norm.includes('lam muoi') ||
    norm.includes('lua')
  ) {
    return 'agricultural';
  }
  return 'other';
}

function evaluateRecordMatch(params: {
  query: LookupQueryInput;
  hasQueryCoords: boolean;
  recLat?: number | null;
  recLng?: number | null;
  recStreet: string;
  recSegment?: string;
  recWard: string;
  recDistrict?: string;
  recLandType?: string;
  recFullAddress?: string;
}): {
  tier: LookupMatchTier;
  matchType: 'gps_and_text' | 'gps_only' | 'text_only';
  distanceMeters: number | null;
  matchReason: string;
  score: number;
} | null {
  const {
    query,
    hasQueryCoords,
    recLat,
    recLng,
    recStreet,
    recSegment = '',
    recWard,
    recDistrict = '',
    recLandType = '',
    recFullAddress = '',
  } = params;

  const hasRecCoords = isValidCoordinatePair(recLat ?? null, recLng ?? null);
  const distanceMeters =
    hasQueryCoords && hasRecCoords
      ? calculateHaversineMeters(query.latitude!, query.longitude!, recLat!, recLng!)
      : null;

  const streetCandidate = recStreet || recFullAddress;
  const streetMatch = matchNormalizedAdmin(query.streetName, streetCandidate);
  const fullAddrStreetMatch =
    streetMatch !== 'none'
      ? streetMatch
      : recFullAddress
      ? matchNormalizedAdmin(query.streetName, recFullAddress)
      : 'none';
  const effectiveStreetMatch = streetMatch !== 'none' ? streetMatch : fullAddrStreetMatch;

  const wardMatch = matchNormalizedAdmin(query.wardCommune, `${recWard} ${recFullAddress}`);
  const districtMatch = matchNormalizedAdmin(
    query.districtCity,
    `${recDistrict} ${recFullAddress}`
  );
  const segmentMatch =
    query.roadSegment && recSegment
      ? matchNormalizedAdmin(query.roadSegment, recSegment)
      : 'none';
  const landTypeMatch =
    query.landType && recLandType
      ? matchNormalizedAdmin(query.landType, recLandType)
      : 'none';

  const queryBroadGroup = classifyBroadLandGroup(query.landType || '');
  const recBroadGroup = classifyBroadLandGroup(recLandType);
  const hasBroadLandTypeConflict =
    queryBroadGroup !== 'other' &&
    recBroadGroup !== 'other' &&
    queryBroadGroup !== recBroadGroup;

  const recIsDistrictWide =
    isDistrictWideWardLabel(recWard) && stripAdminPrefix(recStreet).length === 0;

  // If user explicitly provided a ward/commune AND record has a ward/commune AND they clearly conflict
  // (district-wide agricultural tariffs like "Toàn huyện" do not conflict with wards in that district)
  const hasWardConflict =
    !recIsDistrictWide &&
    stripAdminPrefix(query.wardCommune).length >= 3 &&
    stripAdminPrefix(recWard).length >= 3 &&
    wardMatch === 'none';

  // Only treat recDistrict as a true district conflict when it is NOT a sub-area/ward descriptor
  // accompanying an already-matched ward (e.g. "Địa bàn Tô Hạp (cũ)" when ward is "Thị trấn Tô Hạp").
  // When ward does NOT match (e.g. querying TP. Nha Trang against Tô Hạp), conflict stays TRUE so
  // different districts never leak across each other!
  const districtIsSubAreaForMatchedWard =
    wardMatch !== 'none' && isSubAreaDistrictDescriptor(recDistrict, recWard);

  const hasDistrictConflict =
    !districtIsSubAreaForMatchedWard &&
    stripAdminPrefix(query.districtCity).length >= 3 &&
    stripAdminPrefix(recDistrict).length >= 3 &&
    districtMatch === 'none';

  const reasons: string[] = [];
  let tier: LookupMatchTier | null = null;
  let score = 0;

  // 1. Spatial proximity match (when both query & record have real WGS84 GPS)
  if (distanceMeters !== null) {
    if (distanceMeters <= EXACT_SPATIAL_RADIUS_M) {
      tier = 'exact_location';
      score += 100 - Math.min(40, Math.round(distanceMeters / 4));
      reasons.push(`Khớp vị trí GPS (cách ${formatDistanceVi(distanceMeters)})`);
    } else if (distanceMeters <= query.radiusMeters) {
      tier = 'nearby_comparable';
      score += 45 - Math.min(30, Math.round((distanceMeters / Math.max(query.radiusMeters, 1)) * 30));
      reasons.push(`Trong bán kính lân cận (${formatDistanceVi(distanceMeters)})`);
    }
  }

  // 2. Structured text location match (street + ward/commune + district)
  const textExactStreet =
    effectiveStreetMatch !== 'none' &&
    !hasWardConflict &&
    !hasDistrictConflict &&
    (wardMatch !== 'none' || !stripAdminPrefix(query.wardCommune));

  const textSameWardNearby =
    wardMatch !== 'none' && !hasDistrictConflict;

  const textSameStreetDifferentWard =
    effectiveStreetMatch !== 'none' && hasWardConflict && !hasDistrictConflict;

  // 3. District-wide tariff match (e.g. NQ 15/2025 agricultural land "Toàn huyện", Ten_Duong = "-")
  const textDistrictWideExact =
    recIsDistrictWide &&
    districtMatch !== 'none' &&
    landTypeMatch !== 'none' &&
    !hasBroadLandTypeConflict;

  const textDistrictWideNearby =
    recIsDistrictWide &&
    districtMatch !== 'none' &&
    !textDistrictWideExact &&
    !hasBroadLandTypeConflict &&
    !stripAdminPrefix(query.streetName);

  if (textExactStreet) {
    if (tier !== 'exact_location') {
      tier = 'exact_location';
    }
    score += effectiveStreetMatch === 'exact' ? 80 : 65;
    if (wardMatch !== 'none') {
      score += 20;
      reasons.push('Khớp tuyến đường & Xã/Phường');
    } else {
      reasons.push('Khớp tuyến đường');
    }
    if (segmentMatch !== 'none') {
      score += 15;
      reasons.push('Khớp đoạn đường');
    }
  } else if (textDistrictWideExact) {
    if (tier !== 'exact_location') {
      tier = 'exact_location';
    }
    score += landTypeMatch === 'exact' ? 85 : 72;
    reasons.push('Áp dụng toàn huyện theo loại đất & địa bàn hành chính');
  } else if (textSameWardNearby) {
    if (!tier) {
      tier = 'nearby_comparable';
    }
    score += 30;
    reasons.push('Cùng Xã/Phường (tuyến lân cận)');
  } else if (textSameStreetDifferentWard) {
    if (!tier) {
      tier = 'nearby_comparable';
    }
    score += 22;
    reasons.push('Cùng tên tuyến đường (khác Xã/Phường – tham chiếu lân cận)');
  } else if (textDistrictWideNearby) {
    if (!tier) {
      tier = 'nearby_comparable';
    }
    score += 20;
    reasons.push('Bảng giá áp dụng toàn huyện (cần đối chiếu đúng loại đất)');
  }

  if (!tier) return null;

  if (landTypeMatch !== 'none') {
    score += 8;
    reasons.push('Cùng nhóm loại đất');
  }

  const hasGpsBasis = distanceMeters !== null && distanceMeters <= query.radiusMeters;
  const hasTextBasis =
    textExactStreet ||
    textDistrictWideExact ||
    textSameWardNearby ||
    textSameStreetDifferentWard ||
    textDistrictWideNearby;
  const matchType: 'gps_and_text' | 'gps_only' | 'text_only' =
    hasGpsBasis && hasTextBasis ? 'gps_and_text' : hasGpsBasis ? 'gps_only' : 'text_only';

  return {
    tier,
    matchType,
    distanceMeters,
    matchReason: reasons.join(' · '),
    score,
  };
}

/**
 * Unified 3-Pillar Land Price Lookup Engine (M2).
 * Strictly separates:
 * - Official State Price vs ECOVIS Survey vs Market Reference (never merged)
 * - Exact-location records vs Nearby comparable references
 * - Honest missing-data diagnostics (never fabricates prices, GPS, or K-factors)
 */
export function runUnifiedLandPriceLookup(params: {
  query: LookupQueryInput;
  stateRecords: StateLandPriceRecord[];
  ecovisRecords: EcovisRecord[];
  marketListings: MarketListingRecord[];
}): UnifiedLookupResult {
  const { query, stateRecords, ecovisRecords, marketListings } = params;
  const coordinateValidation = validateCoordinateForKhanhHoa(query.latitude, query.longitude);
  const hasQueryCoords = coordinateValidation.isValidWgs84;
  const hasQueryLocationText = Boolean(
    stripAdminPrefix(query.streetName) ||
      stripAdminPrefix(query.wardCommune) ||
      stripAdminPrefix(query.districtCity)
  );

  const missingDataNotices: string[] = [];

  if (!hasQueryCoords && !hasQueryLocationText) {
    missingDataNotices.push(
      'Chưa có tọa độ GPS hoặc thông tin tuyến đường / Xã, Phường để thực hiện đối chiếu.'
    );
  }
  if (coordinateValidation.status === 'outside_khanh_hoa') {
    missingDataNotices.push(coordinateValidation.message);
  }
  if (coordinateValidation.status === 'invalid') {
    missingDataNotices.push(coordinateValidation.message);
  }

  // --- 1. Official State Land Price ---
  const stateSpatialCount = stateRecords.filter((r) =>
    isValidCoordinatePair(r.latitude ?? null, r.longitude ?? null)
  ).length;
  const stateExact: MatchedLookupItem<StateLandPriceRecord>[] = [];
  const stateNearby: MatchedLookupItem<StateLandPriceRecord>[] = [];

  if (hasQueryCoords || hasQueryLocationText) {
    for (const rec of stateRecords) {
      const m = evaluateRecordMatch({
        query,
        hasQueryCoords,
        recLat: rec.latitude,
        recLng: rec.longitude,
        recStreet: rec.streetName,
        recSegment: rec.roadSegment,
        recWard: rec.wardCommune,
        recDistrict: rec.districtCity,
        recLandType: rec.landType,
      });
      if (!m) continue;
      const item: MatchedLookupItem<StateLandPriceRecord> = { record: rec, ...m };
      if (m.tier === 'exact_location') stateExact.push(item);
      else stateNearby.push(item);
    }
  }

  let stateMissingReason: string | null = null;
  if (stateRecords.length === 0) {
    stateMissingReason =
      'Kho dữ liệu Bảng giá đất Nhà nước chưa được nạp bản ghi chính thức. Vui lòng nạp tại Cổng Quản trị (/admin) hoặc bật chế độ DEMO để kiểm thử.';
    missingDataNotices.push('Chưa có bộ dữ liệu Bảng giá đất Nhà nước (NQ 15/2025/NQ-HĐND).');
  } else if (stateExact.length === 0 && stateNearby.length === 0 && (hasQueryCoords || hasQueryLocationText)) {
    stateMissingReason =
      stateSpatialCount === 0 && hasQueryCoords && !hasQueryLocationText
        ? 'Bộ Bảng giá đất Nhà nước hiện tại chưa có cột tọa độ GPS — vui lòng chạy định danh vị trí hoặc nhập Tên đường / Xã, Phường để đối chiếu.'
        : `Không tìm thấy bản ghi Bảng giá đất Nhà nước khớp vị trí hoặc trong bán kính ${formatDistanceVi(query.radiusMeters)}.`;
  } else if (stateExact.length === 0 && stateNearby.length > 0) {
    stateMissingReason = `Không có bản ghi Bảng giá đất Nhà nước khớp đúng tuyến đường/vị trí; chỉ tìm thấy ${stateNearby.length} bản ghi tham chiếu lân cận.`;
  }

  // --- 2. ECOVIS Independent Survey ---
  const ecovisSpatialCount = ecovisRecords.filter((r) =>
    isValidCoordinatePair(r.latitude ?? null, r.longitude ?? null)
  ).length;
  const ecovisExact: MatchedLookupItem<EcovisRecord>[] = [];
  const ecovisNearby: MatchedLookupItem<EcovisRecord>[] = [];

  if (hasQueryCoords || hasQueryLocationText) {
    for (const rec of ecovisRecords) {
      const m = evaluateRecordMatch({
        query,
        hasQueryCoords,
        recLat: rec.latitude,
        recLng: rec.longitude,
        recStreet: rec.streetName,
        recSegment: rec.roadSegment,
        recWard: rec.wardCommune,
        recDistrict: rec.districtCity,
        recLandType: rec.landType,
      });
      if (!m) continue;
      const item: MatchedLookupItem<EcovisRecord> = { record: rec, ...m };
      if (m.tier === 'exact_location') ecovisExact.push(item);
      else ecovisNearby.push(item);
    }
  }

  let ecovisMissingReason: string | null = null;
  if (ecovisRecords.length === 0) {
    ecovisMissingReason =
      'Kho dữ liệu khảo sát ECOVIS chưa được nạp bản ghi chính thức. Vui lòng nạp tại Cổng Quản trị (/admin).';
    missingDataNotices.push('Chưa có bộ dữ liệu khảo sát giá đất ECOVIS.');
  } else if (ecovisExact.length === 0 && ecovisNearby.length === 0 && (hasQueryCoords || hasQueryLocationText)) {
    ecovisMissingReason =
      ecovisSpatialCount === 0 && hasQueryCoords && !hasQueryLocationText
        ? 'Bộ dữ liệu ECOVIS hiện tại chưa có tọa độ GPS — cần có Tên đường hoặc Xã/Phường để đối chiếu.'
        : `Không tìm thấy bản ghi khảo sát ECOVIS khớp vị trí hoặc lân cận trong phạm vi tra cứu.`;
  } else if (ecovisExact.length === 0 && ecovisNearby.length > 0) {
    ecovisMissingReason = `Không có bản ghi ECOVIS khớp đúng vị trí; chỉ có ${ecovisNearby.length} bản ghi tham chiếu lân cận.`;
  }

  // --- 3. Market Reference Listings (exclude loai_tru & duplicates from summary stats) ---
  const activeMarketNonExcluded = marketListings.filter(
    (m) => !m.isDuplicate && m.verificationStatus !== 'loai_tru'
  );
  const marketSpatialCount = activeMarketNonExcluded.filter((r) =>
    isValidCoordinatePair(r.latitude ?? null, r.longitude ?? null)
  ).length;
  const marketExact: MatchedLookupItem<MarketListingRecord>[] = [];
  const marketNearby: MatchedLookupItem<MarketListingRecord>[] = [];

  if (hasQueryCoords || hasQueryLocationText) {
    for (const rec of activeMarketNonExcluded) {
      const m = evaluateRecordMatch({
        query,
        hasQueryCoords,
        recLat: rec.latitude,
        recLng: rec.longitude,
        recStreet: '',
        recWard: rec.wardCommune,
        recDistrict: '',
        recLandType: rec.propertyType,
        recFullAddress: `${rec.address} ${rec.locationInfo}`,
      });
      if (!m) continue;
      const item: MatchedLookupItem<MarketListingRecord> = { record: rec, ...m };
      if (m.tier === 'exact_location') marketExact.push(item);
      else marketNearby.push(item);
    }
  }

  let marketMissingReason: string | null = null;
  if (activeMarketNonExcluded.length === 0) {
    marketMissingReason = EMPTY_MARKET_DATA_MESSAGE;
    missingDataNotices.push(EMPTY_MARKET_DATA_MESSAGE);
  } else if (marketExact.length === 0 && marketNearby.length === 0 && (hasQueryCoords || hasQueryLocationText)) {
    marketMissingReason = EMPTY_MARKET_DATA_MESSAGE;
  } else if (marketExact.length === 0 && marketNearby.length > 0) {
    marketMissingReason = `${EMPTY_MARKET_DATA_MESSAGE} Chỉ có ${marketNearby.length} tin rao bán tham chiếu khu vực lân cận (không phải giá giao dịch thành công).`;
  }

  if (
    hasQueryCoords &&
    stateRecords.length + ecovisRecords.length + activeMarketNonExcluded.length > 0 &&
    stateSpatialCount + ecovisSpatialCount + marketSpatialCount === 0
  ) {
    missingDataNotices.push(
      'Các bộ dữ liệu hiện hành chưa có cột tọa độ GPS (vi_do, kinh_do) — hệ thống đang đối chiếu bằng tên tuyến đường & Xã/Phường đã định danh.'
    );
  }

  const sortedStateExact = sortMatchedItems(stateExact);
  const sortedStateNearby = sortMatchedItems(stateNearby);
  const sortedEcovisExact = sortMatchedItems(ecovisExact);
  const sortedEcovisNearby = sortMatchedItems(ecovisNearby);
  const sortedMarketExact = sortMatchedItems(marketExact);
  const sortedMarketNearby = sortMatchedItems(marketNearby);

  const marketPrices = (
    items: MatchedLookupItem<MarketListingRecord>[],
    statusFilter?: MarketListingRecord['verificationStatus']
  ) =>
    items
      .filter((i) => !statusFilter || i.record.verificationStatus === statusFilter)
      .map((i) => i.record.unitPricePerSqm ?? 0)
      .filter((n) => n > 0);

  return {
    hasQueryCoords,
    hasQueryLocationText,
    coordinateValidation,
    radiusMeters: query.radiusMeters,
    statePrice: {
      datasetTotalCount: stateRecords.length,
      datasetSpatialCount: stateSpatialCount,
      exactMatches: sortedStateExact,
      nearbyMatches: sortedStateNearby,
      exactStats: computePriceRangeStats(sortedStateExact.map((i) => i.record.unitPrice)),
      nearbyStats: computePriceRangeStats(sortedStateNearby.map((i) => i.record.unitPrice)),
      missingDataReason: stateMissingReason,
    },
    ecovis: {
      datasetTotalCount: ecovisRecords.length,
      datasetSpatialCount: ecovisSpatialCount,
      exactMatches: sortedEcovisExact,
      nearbyMatches: sortedEcovisNearby,
      exactStats: computePriceRangeStats(sortedEcovisExact.map((i) => i.record.surveyUnitPrice)),
      nearbyStats: computePriceRangeStats(sortedEcovisNearby.map((i) => i.record.surveyUnitPrice)),
      missingDataReason: ecovisMissingReason,
    },
    market: {
      datasetTotalCount: activeMarketNonExcluded.length,
      datasetSpatialCount: marketSpatialCount,
      exactMatches: sortedMarketExact,
      nearbyMatches: sortedMarketNearby,
      exactStats: computePriceRangeStats(marketPrices(sortedMarketExact)),
      nearbyStats: computePriceRangeStats(marketPrices(sortedMarketNearby)),
      exactVerifiedStats: computePriceRangeStats(
        marketPrices(sortedMarketExact, 'da_xac_minh_so_bo')
      ),
      exactUnverifiedStats: computePriceRangeStats(
        marketPrices(sortedMarketExact, 'chua_xac_minh')
      ),
      nearbyVerifiedStats: computePriceRangeStats(
        marketPrices(sortedMarketNearby, 'da_xac_minh_so_bo')
      ),
      nearbyUnverifiedStats: computePriceRangeStats(
        marketPrices(sortedMarketNearby, 'chua_xac_minh')
      ),
      missingDataReason: marketMissingReason,
    },
    missingDataNotices,
  };
}
