import { normalizeVietnameseText } from './formatters';
import { stripAdminPrefix } from './geoLookup';

const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Pure TypeScript WGS84 Geohash encoder (base32 alphabet `0-9b-hjkmnp-z`).
 * Guarantees `encodeGeohash(lat, lng, 6).slice(0, 5) === encodeGeohash(lat, lng, 5)`.
 */
export function encodeGeohash(latitude: number, longitude: number, precision = 6): string {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('Tọa độ GPS không hợp lệ để mã hóa Geohash.');
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error('Tọa độ GPS nằm ngoài phạm vi WGS84 [-90..90, -180..180].');
  }
  const safePrecision = Math.max(1, Math.min(12, Math.floor(precision)));

  let idx = 0;
  let bit = 0;
  let evenBit = true;
  let geohash = '';

  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;

  while (geohash.length < safePrecision) {
    if (evenBit) {
      const lngMid = (lngMin + lngMax) / 2;
      if (longitude >= lngMid) {
        idx = (idx << 1) | 1;
        lngMin = lngMid;
      } else {
        idx = idx << 1;
        lngMax = lngMid;
      }
    } else {
      const latMid = (latMin + latMax) / 2;
      if (latitude >= latMid) {
        idx = (idx << 1) | 1;
        latMin = latMid;
      } else {
        idx = idx << 1;
        latMax = latMid;
      }
    }
    evenBit = !evenBit;
    bit += 1;
    if (bit === 5) {
      geohash += GEOHASH_BASE32.charAt(idx);
      bit = 0;
      idx = 0;
    }
  }

  return geohash;
}

export interface GeohashBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  centerLat: number;
  centerLng: number;
}

export function decodeGeohashBounds(geohash: string): GeohashBounds {
  const clean = geohash.trim().toLowerCase();
  let evenBit = true;
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean.charAt(i);
    const cd = GEOHASH_BASE32.indexOf(ch);
    if (cd === -1) {
      throw new Error(`Ký tự Geohash không hợp lệ: "${ch}"`);
    }
    for (let mask = 16; mask > 0; mask >>= 1) {
      if (evenBit) {
        const lngMid = (lngMin + lngMax) / 2;
        if (cd & mask) lngMin = lngMid;
        else lngMax = lngMid;
      } else {
        const latMid = (latMin + latMax) / 2;
        if (cd & mask) latMin = latMid;
        else latMax = latMid;
      }
      evenBit = !evenBit;
    }
  }

  return {
    minLat: latMin,
    maxLat: latMax,
    minLng: lngMin,
    maxLng: lngMax,
    centerLat: (latMin + latMax) / 2,
    centerLng: (lngMin + lngMax) / 2,
  };
}

/**
 * Returns the center Geohash cell plus its 8 adjacent neighbor cells (unique, max 9 items).
 * Compatible with Firestore `where('geohash5', 'in', neighbors)` (<= 10 values limit).
 */
export function getGeohashNeighbors(geohash: string): string[] {
  const clean = geohash.trim().toLowerCase();
  if (!clean) return [];
  const bounds = decodeGeohashBounds(clean);
  const latStep = bounds.maxLat - bounds.minLat;
  const lngStep = bounds.maxLng - bounds.minLng;
  const precision = clean.length;

  const offsets = [-1, 0, 1];
  const cells = new Set<string>();

  for (const dLat of offsets) {
    for (const dLng of offsets) {
      const sampleLat = Math.max(-89.999999, Math.min(89.999999, bounds.centerLat + dLat * latStep));
      let sampleLng = bounds.centerLng + dLng * lngStep;
      if (sampleLng > 180) sampleLng -= 360;
      if (sampleLng < -180) sampleLng += 360;
      cells.add(encodeGeohash(sampleLat, sampleLng, precision));
    }
  }

  return Array.from(cells);
}

/**
 * Normalizes a Vietnamese administrative or street label into a Firestore index key
 * strictly matching `^[a-z0-9_]*$` and length <= `maxLen` (as required by firestore.rules).
 * Example: "Huyện Khánh Sơn" -> "khanh_son", "Thị trấn Tô Hạp" -> "to_hap".
 */
export function normalizeAdminKey(raw: string | null | undefined, maxLen = 80): string {
  if (!raw || typeof raw !== 'string') return '';
  const stripped = stripAdminPrefix(raw) || normalizeVietnameseText(raw);
  const key = stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  if (!key || key === '_') return '';
  return key.slice(0, maxLen).replace(/_+$/, '');
}

/**
 * Computes a lowercase 64-character SHA-256 hex digest using Web Crypto API (browser & Node >= 18).
 */
export async function computeSha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const hashBuffer = await subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(hashBuffer);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  throw new Error('Trình duyệt không hỗ trợ Web Crypto API (SHA-256).');
}
