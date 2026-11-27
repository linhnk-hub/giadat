import exifr from 'exifr';

export interface ParsedExifResult {
  latitude: number | null;
  longitude: number | null;
  capturedAt: string | null;
  cameraModel: string | null;
}

export async function parseImageExif(file: File): Promise<ParsedExifResult> {
  try {
    const data = await exifr.parse(file, {
      gps: true,
      exif: true,
      tiff: true,
    });

    if (!data) {
      return {
        latitude: null,
        longitude: null,
        capturedAt: null,
        cameraModel: null,
      };
    }

    const lat =
      typeof data.latitude === 'number' &&
      Number.isFinite(data.latitude) &&
      Math.abs(data.latitude) <= 90
        ? data.latitude
        : null;
    const lng =
      typeof data.longitude === 'number' &&
      Number.isFinite(data.longitude) &&
      Math.abs(data.longitude) <= 180
        ? data.longitude
        : null;

    const hasValidPair =
      lat !== null && lng !== null && !(lat === 0 && lng === 0);

    let capturedAt: string | null = null;
    const rawDate = data.DateTimeOriginal || data.CreateDate || data.ModifyDate;
    if (rawDate instanceof Date && !Number.isNaN(rawDate.getTime())) {
      capturedAt = rawDate.toISOString();
    } else if (typeof rawDate === 'string' && rawDate.trim()) {
      capturedAt = rawDate.trim();
    }

    const make = typeof data.Make === 'string' ? data.Make.trim() : '';
    const model = typeof data.Model === 'string' ? data.Model.trim() : '';
    const cameraModel = [make, model].filter(Boolean).join(' ') || null;

    return {
      latitude: hasValidPair ? lat : null,
      longitude: hasValidPair ? lng : null,
      capturedAt,
      cameraModel,
    };
  } catch {
    return {
      latitude: null,
      longitude: null,
      capturedAt: null,
      cameraModel: null,
    };
  }
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Không đọc được dữ liệu ảnh.'));
      }
    };
    reader.onerror = () => reject(new Error('Lỗi đọc tệp ảnh từ thiết bị.'));
    reader.readAsDataURL(file);
  });
}
