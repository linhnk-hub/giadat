import type { ReverseGeocodeResult } from '../types/valuation';
import { isValidCoordinatePair, normalizeVietnameseText } from './formatters';
import { validateCoordinateForKhanhHoa } from './geoLookup';

/**
 * Direct browser reverse geocoding via OpenStreetMap Nominatim.
 * Requires zero custom backend and zero paid API keys.
 * Gracefully degrades to a non-throwing fallback if offline or rate-limited.
 */
export async function reverseGeocodeInBrowser(
  latitude: number,
  longitude: number
): Promise<ReverseGeocodeResult> {
  const resolvedAt = new Date().toISOString();

  if (!isValidCoordinatePair(latitude, longitude)) {
    return {
      available: false,
      source: 'none',
      resolvedAt,
      displayName: '',
      streetName: '',
      wardCommune: '',
      districtCity: '',
      province: '',
      country: '',
      inKhanhHoa: null,
      note: 'Tọa độ GPS không hợp lệ để định danh địa chỉ.',
    };
  }

  const geoCheck = validateCoordinateForKhanhHoa(latitude, longitude);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${encodeURIComponent(String(latitude))}` +
      `&lon=${encodeURIComponent(String(longitude))}` +
      `&zoom=18&addressdetails=1&accept-language=vi`;

    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!resp.ok) {
      return {
        available: false,
        source: 'none',
        resolvedAt,
        displayName: '',
        streetName: '',
        wardCommune: '',
        districtCity: '',
        province: '',
        country: '',
        inKhanhHoa: geoCheck.inKhanhHoa,
        note: `Không thể định danh tự động từ OpenStreetMap (mã HTTP ${resp.status}). Vui lòng chọn hoặc nhập Xã/Phường và Tuyến đường để đối chiếu chính xác.`,
      };
    }

    const data = (await resp.json()) as {
      display_name?: string;
      address?: Record<string, string | undefined>;
    };
    const addr = data.address ?? {};

    const streetName =
      addr.road ||
      addr.pedestrian ||
      addr.residential ||
      addr.highway ||
      addr.neighbourhood ||
      '';
    const wardCommune =
      addr.quarter ||
      addr.suburb ||
      addr.village ||
      addr.town ||
      addr.hamlet ||
      addr.city_district ||
      '';
    const districtCity =
      addr.county ||
      addr.city ||
      addr.district ||
      addr.municipality ||
      addr.state_district ||
      '';
    const province = addr.state || addr.province || addr.region || '';
    const country = addr.country || '';
    const displayName = data.display_name || '';

    const combinedNorm = normalizeVietnameseText(`${displayName} ${province} ${districtCity}`);
    const inKhanhHoa = combinedNorm.includes('khanh hoa') ? true : geoCheck.inKhanhHoa;

    return {
      available: Boolean(displayName || streetName || wardCommune || districtCity),
      source: 'nominatim_osm',
      resolvedAt,
      displayName,
      streetName,
      wardCommune,
      districtCity,
      province,
      country,
      inKhanhHoa,
      note:
        'Địa chỉ gợi ý từ OpenStreetMap theo tọa độ GPS. Vui lòng kiểm tra lại tên tuyến đường / Xã, Phường trước khi đối chiếu hồ sơ.',
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      available: false,
      source: 'none',
      resolvedAt,
      displayName: '',
      streetName: '',
      wardCommune: '',
      districtCity: '',
      province: '',
      country: '',
      inKhanhHoa: geoCheck.inKhanhHoa,
      note: isAbort
        ? 'Hết thời gian định danh địa chỉ từ OpenStreetMap. Vui lòng chọn Huyện/Xã hoặc nhập tên tuyến đường thủ công.'
        : 'Không thể kết nối OpenStreetMap để gợi ý địa chỉ từ GPS. Hệ thống vẫn giữ tọa độ GPS để tra cứu hoặc bạn có thể nhập Huyện/Xã/Tuyến đường.',
    };
  } finally {
    clearTimeout(timeout);
  }
}
