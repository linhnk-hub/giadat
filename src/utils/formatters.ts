import { CoordinateSourceType, ConfidenceLevel, MarketListingRecord } from '../types/valuation';

export function formatCurrencyVnd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'Chưa có thông tin';
  }
  return new Intl.NumberFormat('vi-VN', {
    maximumFractionDigits: 0,
  }).format(Math.round(value)) + ' VNĐ';
}

export function formatNumberVi(value: number | null | undefined, maxDecimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'Chưa có thông tin';
  }
  return new Intl.NumberFormat('vi-VN', {
    maximumFractionDigits: maxDecimals,
  }).format(value);
}

export function formatDateTimeVi(isoString: string | null | undefined): string {
  if (!isoString) return 'Chưa có thông tin';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatCoordinate(lat: number | null, lng: number | null): string {
  if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return 'Không có tọa độ GPS';
  }
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

export function isValidCoordinatePair(lat: number | null, lng: number | null): boolean {
  if (lat === null || lng === null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

export function buildGoogleMapsUrl(lat: number | null, lng: number | null): string | null {
  if (!isValidCoordinatePair(lat, lng)) return null;
  return `https://www.google.com/maps?q=${encodeURIComponent(`${lat!.toFixed(6)},${lng!.toFixed(6)}`)}`;
}

export function sanitizeExternalUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function getCoordinateSourceLabel(source: CoordinateSourceType): string {
  switch (source) {
    case 'exif':
      return '1. EXIF của ảnh';
    case 'image_overlay':
      return '2. GPS hiển thị trên ảnh (OCR)';
    case 'user_input':
      return '3. Người dùng nhập';
    case 'geocoding':
      return '4. Kết quả định vị địa lý';
    case 'ai_inferred':
      return '5. AI suy luận (chưa xác nhận)';
    case 'none':
    default:
      return 'Không có tọa độ';
  }
}

export function getConfidenceLabel(level: ConfidenceLevel): string {
  switch (level) {
    case 'cao':
      return 'Cao';
    case 'trung_binh':
      return 'Trung bình';
    case 'thap':
      return 'Thấp';
    case 'khong_xac_dinh':
    default:
      return 'Không xác định';
  }
}

export function normalizeVietnameseText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

export function detectDuplicateMarketListings(
  listings: MarketListingRecord[]
): MarketListingRecord[] {
  const seenUrl = new Map<string, string>();
  const seenSignature = new Map<string, string>();

  return listings.map((item) => {
    const normalizedUrl = item.url.trim().toLowerCase().replace(/\/+$/, '');
    const normalizedAddr = normalizeVietnameseText(item.address);
    const sig =
      normalizedAddr && item.areaSqm && item.askingPriceVnd
        ? `${normalizedAddr}|${Math.round(item.areaSqm)}|${Math.round(item.askingPriceVnd)}`
        : '';

    let duplicateOfId: string | null = null;

    if (normalizedUrl && seenUrl.has(normalizedUrl)) {
      duplicateOfId = seenUrl.get(normalizedUrl)!;
    } else if (sig && seenSignature.has(sig)) {
      duplicateOfId = seenSignature.get(sig)!;
    }

    if (!duplicateOfId) {
      if (normalizedUrl) seenUrl.set(normalizedUrl, item.id);
      if (sig) seenSignature.set(sig, item.id);
    }

    return {
      ...item,
      isDuplicate: Boolean(duplicateOfId),
      duplicateOfId,
    };
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
