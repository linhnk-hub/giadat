import { readSheet } from 'read-excel-file/browser';
import writeXlsxFile from 'write-excel-file/browser';
import {
  AppraisalDossier,
  DatasetKind,
  EcovisRecord,
  ImportPreviewResult,
  KFactorRuleRecord,
  MarketListingRecord,
  PdfReferenceDocument,
  StateLandPriceRecord,
  ValidationRowIssue,
} from '../types/valuation';
import {
  buildAutoWarnings,
  buildReferenceSources,
  inspectDossierIntegrity,
  isAppliedKFactorDemo,
  isEcovisRecordDemo,
  isMarketListingDemo,
  isStateRecordDemo,
} from './dossierIntegrity';
import {
  buildGoogleMapsUrl,
  formatCoordinate,
  formatCurrencyVnd,
  formatDateTimeVi,
  formatNumberVi,
  getCoordinateSourceLabel,
  normalizeVietnameseText,
} from './formatters';

function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

const FORBIDDEN_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function parseJsonTextToRows(jsonText: string): string[][] {
  const cleaned = jsonText.replace(/^\uFEFF/, '').trim();
  if (!cleaned) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Tệp JSON sai cú pháp. Vui lòng kiểm tra lại định dạng JSON hợp lệ.');
  }

  let items: unknown[] | null = null;
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.records)) items = obj.records;
    else if (Array.isArray(obj.rows)) items = obj.rows;
    else if (Array.isArray(obj.data)) items = obj.data;
  }

  if (!items || items.length === 0) {
    throw new Error(
      'Tệp JSON phải là một mảng đối tượng ([...]) hoặc đối tượng chứa thuộc tính "records" / "rows" không rỗng.'
    );
  }

  const headerSet = new Set<string>();
  const objectRows: Record<string, unknown>[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Dòng JSON #${i + 1} không phải là đối tượng khóa-giá trị hợp lệ.`);
    }
    const rec = item as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      if (!FORBIDDEN_JSON_KEYS.has(key)) {
        headerSet.add(key);
      }
    }
    objectRows.push(rec);
  }

  const headers = Array.from(headerSet);
  const rows: string[][] = [headers];
  for (const rec of objectRows) {
    rows.push(
      headers.map((h) => {
        const val = rec[h];
        if (val === null || val === undefined) return '';
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val).trim();
      })
    );
  }
  return rows;
}

export async function parseSpreadsheetFile(file: File): Promise<string[][]> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xlsx')) {
    const rows = await readSheet(file);
    return rows.map((row) =>
      row.map((cell) => {
        if (cell === null || cell === undefined) return '';
        if (cell instanceof Date) {
          return cell.toISOString().slice(0, 10);
        }
        return String(cell).trim();
      })
    );
  }

  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const text = await file.text();
    const cleaned = text.replace(/^\uFEFF/, '');
    const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return [];
    const firstLine = lines[0];
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semiCount = (firstLine.match(/;/g) || []).length;
    const delimiter = semiCount > commaCount ? ';' : ',';
    return lines.map((line) => parseCsvLine(line, delimiter));
  }

  if (lower.endsWith('.json')) {
    const text = await file.text();
    return parseJsonTextToRows(text);
  }

  throw new Error('Định dạng tệp không được hỗ trợ. Vui lòng sử dụng tệp .xlsx, .csv hoặc .json.');
}

export type NumericFieldKind = 'currency_integer' | 'decimal_measurement';

export interface ParsedNumberResult {
  value: number | null;
  error?: string;
}

/**
 * Chuẩn hóa phân tích số có phân biệt rõ trường tiền tệ nguyên (currency_integer)
 * và trường số thập phân / đo lường (decimal_measurement).
 * Không thay thế mù quáng dấu chấm/dấu phẩy; từ chối mọi định dạng mơ hồ.
 */
export function parseVietnameseNumber(
  raw: string,
  kind: NumericFieldKind
): ParsedNumberResult {
  if (raw === null || raw === undefined) {
    return { value: null, error: 'Giá trị trống.' };
  }

  let cleaned = String(raw).trim();
  if (!cleaned) {
    return { value: null, error: 'Giá trị trống.' };
  }

  // Only strip currency unit suffixes at the end for currency fields
  if (kind === 'currency_integer') {
    cleaned = cleaned.replace(/\s*(vnđ|vnd|đồng|đ)\s*$/i, '').trim();
  } else {
    cleaned = cleaned.replace(/\s*(m²|m2)\s*$/i, '').trim();
  }

  if (!cleaned) {
    return { value: null, error: 'Giá trị không chứa chữ số.' };
  }

  // Allow space thousands grouping ONLY when strictly formatted as "1 000 000"
  if (/\s/.test(cleaned)) {
    if (/^-?\d{1,3}( \d{3})+([.,]\d+)?$/.test(cleaned)) {
      cleaned = cleaned.replace(/ /g, '');
    } else {
      return {
        value: null,
        error: `Giá trị "${raw}" chứa khoảng trắng không hợp lệ.`,
      };
    }
  }

  // Strict charset check: optional leading minus + digits + dot/comma only
  if (!/^-?[\d.,]+$/.test(cleaned)) {
    return {
      value: null,
      error: `Giá trị "${raw}" không phải là số hợp lệ.`,
    };
  }

  // Pure integer digits (e.g. "0", "100", "4200000000")
  if (/^-?\d+$/.test(cleaned)) {
    const num = Number(cleaned);
    return Number.isFinite(num)
      ? { value: num }
      : { value: null, error: `Giá trị "${raw}" vượt phạm vi số hợp lệ.` };
  }

  const dotCount = (cleaned.match(/\./g) || []).length;
  const commaCount = (cleaned.match(/,/g) || []).length;

  // Reject consecutive or leading/trailing separators (e.g. "1..5", ".5", "5.", "1.,2")
  if (
    /[.,]{2,}/.test(cleaned) ||
    /^-?[.,]/.test(cleaned) ||
    /[.,]$/.test(cleaned)
  ) {
    return {
      value: null,
      error: `Định dạng dấu ngăn cách không hợp lệ trong "${raw}".`,
    };
  }

  // Case 1: Both dot and comma present — check strict thousands + decimal patterns
  if (dotCount >= 1 && commaCount >= 1) {
    // Vietnamese format: 1.125.000,5 or 1.250,25
    if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(cleaned)) {
      const normalized = cleaned.replace(/\./g, '').replace(',', '.');
      const num = Number(normalized);
      if (kind === 'currency_integer' && !Number.isInteger(num)) {
        return {
          value: null,
          error: `Giá trị tiền tệ "${raw}" có phần thập phân; vui lòng nhập số nguyên VNĐ.`,
        };
      }
      return Number.isFinite(num)
        ? { value: num }
        : { value: null, error: `Giá trị "${raw}" không hợp lệ.` };
    }
    // English/US format: 1,125,000.5 or 1,250.25
    if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(cleaned)) {
      const normalized = cleaned.replace(/,/g, '');
      const num = Number(normalized);
      if (kind === 'currency_integer' && !Number.isInteger(num)) {
        return {
          value: null,
          error: `Giá trị tiền tệ "${raw}" có phần thập phân; vui lòng nhập số nguyên VNĐ.`,
        };
      }
      return Number.isFinite(num)
        ? { value: num }
        : { value: null, error: `Giá trị "${raw}" không hợp lệ.` };
    }
    return {
      value: null,
      error: `Không thể xác định chắc chắn định dạng dấu chấm và dấu phẩy trong "${raw}".`,
    };
  }

  // Case 2: Multiple dots, zero commas (e.g. "1.125.000", "4.200.000.000")
  if (dotCount > 1 && commaCount === 0) {
    if (/^-?\d{1,3}(\.\d{3})+$/.test(cleaned)) {
      const num = Number(cleaned.replace(/\./g, ''));
      return Number.isFinite(num)
        ? { value: num }
        : { value: null, error: `Giá trị "${raw}" không hợp lệ.` };
    }
    return {
      value: null,
      error: `Định dạng nhiều dấu chấm không hợp lệ trong "${raw}".`,
    };
  }

  // Case 3: Multiple commas, zero dots (e.g. "4,200,000,000")
  if (commaCount > 1 && dotCount === 0) {
    if (/^-?\d{1,3}(,\d{3})+$/.test(cleaned)) {
      const num = Number(cleaned.replace(/,/g, ''));
      return Number.isFinite(num)
        ? { value: num }
        : { value: null, error: `Giá trị "${raw}" không hợp lệ.` };
    }
    return {
      value: null,
      error: `Định dạng nhiều dấu phẩy không hợp lệ trong "${raw}".`,
    };
  }

  // Case 4: Single dot, zero commas (e.g. "1.125", "0.855", "100.125", "500.000")
  if (dotCount === 1 && commaCount === 0) {
    const [intPart, fracPart] = cleaned.split('.');
    const absInt = intPart.replace(/^-/, '');

    if (kind === 'decimal_measurement') {
      // NEVER assume a single dot + 3 digits is thousands for K-factor or measurements!
      const num = Number(cleaned);
      return Number.isFinite(num)
        ? { value: num }
        : { value: null, error: `Giá trị thập phân "${raw}" không hợp lệ.` };
    }

    // currency_integer mode with single dot
    if (fracPart.length === 3 && absInt !== '0' && absInt.length <= 3) {
      // Unambiguous VND thousands: >= 10.000 (e.g. 500.000, 45.500) or exact thousands (e.g. 5.000)
      if (absInt.length >= 2 || fracPart === '000') {
        const num = Number(`${intPart}${fracPart}`);
        return Number.isFinite(num)
          ? { value: num }
          : { value: null, error: `Giá trị tiền tệ "${raw}" không hợp lệ.` };
      }
      // Ambiguous currency like "1.125" (could be 1.125 billion typed wrong or 1,125 VND)
      return {
        value: null,
        error: `Giá trị tiền tệ "${raw}" không xác định chắc chắn (dễ nhầm giữa số thập phân và hàng nghìn). Vui lòng nhập đầy đủ số nguyên VNĐ không dấu ngăn cách hoặc đúng nhóm hàng nghìn.`,
      };
    }

    return {
      value: null,
      error: `Giá trị tiền tệ "${raw}" có dấu chấm thập phân chưa rõ đơn vị. Vui lòng nhập đầy đủ số nguyên VNĐ.`,
    };
  }

  // Case 5: Single comma, zero dots (e.g. "1,125", "100,5", "500,000")
  if (commaCount === 1 && dotCount === 0) {
    const [intPart, fracPart] = cleaned.split(',');
    const absInt = intPart.replace(/^-/, '');

    if (kind === 'decimal_measurement') {
      // Decimal measurement with Vietnamese comma: "1,125" -> 1.125, "100,5" -> 100.5
      // Guard against obviously large US-thousands formatted numbers like "12,500" only if ambiguous?
      // Wait: if absInt.length <= 3 and fracPart === '000' and Number(absInt) >= 10 (e.g. "500,000" m²), flag ambiguity!
      if (fracPart === '000' && absInt.length >= 2 && absInt.length <= 3 && absInt !== '0') {
        return {
          value: null,
          error: `Giá trị đo lường "${raw}" không xác định chắc chắn là số nguyên hàng nghìn hay số thập phân. Vui lòng dùng dấu chấm thập phân hoặc bỏ dấu phẩy.`,
        };
      }
      const num = Number(`${intPart}.${fracPart}`);
      return Number.isFinite(num)
        ? { value: num }
        : { value: null, error: `Giá trị thập phân "${raw}" không hợp lệ.` };
    }

    // currency_integer mode with single comma
    if (fracPart.length === 3 && absInt !== '0' && absInt.length <= 3) {
      if (absInt.length >= 2 || fracPart === '000') {
        const num = Number(`${intPart}${fracPart}`);
        return Number.isFinite(num)
          ? { value: num }
          : { value: null, error: `Giá trị tiền tệ "${raw}" không hợp lệ.` };
      }
      return {
        value: null,
        error: `Giá trị tiền tệ "${raw}" không xác định chắc chắn (dễ nhầm giữa số thập phân và hàng nghìn). Vui lòng nhập đầy đủ số nguyên VNĐ.`,
      };
    }

    return {
      value: null,
      error: `Giá trị tiền tệ "${raw}" có dấu phẩy thập phân chưa rõ đơn vị. Vui lòng nhập đầy đủ số nguyên VNĐ.`,
    };
  }

  return {
    value: null,
    error: `Không thể phân tích giá trị số "${raw}".`,
  };
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  const normHeaders = headers.map((h) => normalizeVietnameseText(h));
  for (const cand of candidates) {
    const normCand = normalizeVietnameseText(cand);
    const exact = normHeaders.findIndex((h) => h === normCand);
    if (exact !== -1) return exact;
  }
  for (const cand of candidates) {
    const normCand = normalizeVietnameseText(cand);
    const partial = normHeaders.findIndex((h) => h.includes(normCand));
    if (partial !== -1) return partial;
  }
  return -1;
}

const KHANH_HOA_BOUNDS = {
  minLat: 11.7,
  maxLat: 13.1,
  minLng: 108.5,
  maxLng: 109.7,
};

function parseOptionalSpatialCoordinates(
  rawLat: string,
  rawLng: string,
  rowNumber: number,
  issues: ValidationRowIssue[]
): { latitude: number | null; longitude: number | null; hasError: boolean } {
  const latStr = rawLat.trim();
  const lngStr = rawLng.trim();

  if (!latStr && !lngStr) {
    return { latitude: null, longitude: null, hasError: false };
  }
  if (!latStr || !lngStr) {
    issues.push({
      rowNumber,
      severity: 'error',
      field: 'Tọa độ GPS',
      message: 'Phải cung cấp đủ cả Vĩ độ (vi_do/latitude) và Kinh độ (kinh_do/longitude), hoặc cùng để trống.',
    });
    return { latitude: null, longitude: null, hasError: true };
  }

  const latRes = parseVietnameseNumber(latStr, 'decimal_measurement');
  const lngRes = parseVietnameseNumber(lngStr, 'decimal_measurement');

  if (latRes.value === null || lngRes.value === null) {
    issues.push({
      rowNumber,
      severity: 'error',
      field: 'Tọa độ GPS',
      message: latRes.error || lngRes.error || 'Định dạng số tọa độ GPS không hợp lệ.',
    });
    return { latitude: null, longitude: null, hasError: true };
  }

  const lat = Number(latRes.value.toFixed(7));
  const lng = Number(lngRes.value.toFixed(7));

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    issues.push({
      rowNumber,
      severity: 'error',
      field: 'Tọa độ GPS',
      message: `Tọa độ (${lat}, ${lng}) vượt phạm vi chuẩn WGS84 (vĩ độ [-90, 90], kinh độ [-180, 180]).`,
    });
    return { latitude: null, longitude: null, hasError: true };
  }

  if (
    lat < KHANH_HOA_BOUNDS.minLat ||
    lat > KHANH_HOA_BOUNDS.maxLat ||
    lng < KHANH_HOA_BOUNDS.minLng ||
    lng > KHANH_HOA_BOUNDS.maxLng
  ) {
    issues.push({
      rowNumber,
      severity: 'warning',
      field: 'Tọa độ GPS',
      message: `Tọa độ (${lat}, ${lng}) nằm ngoài khung địa lý thông thường của tỉnh Khánh Hòa; đề nghị cán bộ đối chiếu lại.`,
    });
  }

  return { latitude: lat, longitude: lng, hasError: false };
}

export function validateAndPreviewImport(
  datasetKind: DatasetKind,
  fileName: string,
  rows: string[][],
  sourceMeta: {
    sourceDocumentName: string;
    effectiveDate: string;
    versionId: string;
  }
): ImportPreviewResult<StateLandPriceRecord | EcovisRecord | KFactorRuleRecord | MarketListingRecord> {
  if (rows.length < 2) {
    return {
      datasetKind,
      fileName,
      totalRows: 0,
      validRows: [],
      missingRequiredColumns: ['Tệp không có dữ liệu (cần ít nhất 1 dòng tiêu đề và 1 dòng dữ liệu)'],
      duplicateCodes: [],
      issues: [
        {
          rowNumber: 1,
          severity: 'error',
          field: 'Tệp dữ liệu',
          message: 'Tệp trống hoặc chỉ có dòng tiêu đề.',
        },
      ],
      canCommit: false,
    };
  }

  const headers = rows[0];
  const dataRows = rows.slice(1).filter((r) => r.some((cell) => cell.trim() !== ''));
  const issues: ValidationRowIssue[] = [];
  const duplicateCodes: string[] = [];
  const seenCodes = new Set<string>();
  const nowIso = new Date().toISOString();

  if (datasetKind === 'state_price') {
    const colCode = findColumnIndex(headers, ['ma_du_lieu', 'recordcode', 'mã dữ liệu', 'ma', 'code']);
    const colDoc = findColumnIndex(headers, ['van_ban_phap_ly', 'legaldocumentname', 'tên văn bản pháp lý', 'van ban']);
    const colWard = findColumnIndex(headers, ['xa_phuong', 'wardcommune', 'xã/phường', 'xa phuong', 'phuong']);
    const colDistrict = findColumnIndex(headers, ['huyen_tp', 'districtcity', 'huyện/thị xã/tp', 'quan huyen', 'huyen']);
    const colStreet = findColumnIndex(headers, ['tuyen_duong', 'streetname', 'tuyến đường', 'ten duong']);
    const colSegment = findColumnIndex(headers, ['doan_duong', 'roadsegment', 'đoạn đường']);
    const colStart = findColumnIndex(headers, ['diem_dau', 'startpoint', 'điểm đầu']);
    const colEnd = findColumnIndex(headers, ['diem_cuoi', 'endpoint', 'điểm cuối']);
    const colLandType = findColumnIndex(headers, ['loai_dat', 'landtype', 'loại đất']);
    const colPos = findColumnIndex(headers, ['vi_tri', 'position', 'vị trí']);
    const colPrice = findColumnIndex(headers, ['don_gia', 'unitprice', 'đơn giá', 'gia dat']);
    const colUnit = findColumnIndex(headers, ['don_vi_tinh', 'unit', 'đơn vị tính', 'don vi']);
    const colPage = findColumnIndex(headers, ['trang_phu_luc', 'sourcepageorappendix', 'trang/phụ lục nguồn', 'trang nguon', 'phu luc']);
    const colEff = findColumnIndex(headers, ['ngay_hieu_luc', 'effectivedate', 'ngày hiệu lực']);
    const colLat = findColumnIndex(headers, ['vi_do', 'latitude', 'vĩ độ', 'lat']);
    const colLng = findColumnIndex(headers, ['kinh_do', 'longitude', 'kinh độ', 'lng', 'lon']);
    const colCoordNote = findColumnIndex(headers, ['ghi_chu_toa_do', 'coordinatenote', 'ghi chú tọa độ']);

    const missingCols: string[] = [];
    if (colCode === -1) missingCols.push('Mã dữ liệu (ma_du_lieu)');
    if (colWard === -1) missingCols.push('Xã/Phường (xa_phuong)');
    if (colStreet === -1) missingCols.push('Tuyến đường (tuyen_duong)');
    if (colLandType === -1) missingCols.push('Loại đất (loai_dat)');
    if (colPos === -1) missingCols.push('Vị trí (vi_tri)');
    if (colPrice === -1) missingCols.push('Đơn giá (don_gia)');
    if (colPage === -1) missingCols.push('Trang/Phụ lục nguồn (trang_phu_luc)');

    const validRows: StateLandPriceRecord[] = [];
    let validSpatialCount = 0;
    if (missingCols.length === 0) {
      dataRows.forEach((row, idx) => {
        const rowNumber = idx + 2;
        const code = (row[colCode] || '').trim();
        const ward = (row[colWard] || '').trim();
        const street = (row[colStreet] || '').trim();
        const landType = (row[colLandType] || '').trim();
        const position = (row[colPos] || '').trim();
        const priceRes = parseVietnameseNumber(row[colPrice] || '', 'currency_integer');
        const price = priceRes.value;
        const page = (row[colPage] || '').trim();

        let rowHasError = false;
        if (!code) {
          issues.push({ rowNumber, severity: 'error', field: 'Mã dữ liệu', message: 'Thiếu mã dữ liệu định danh.' });
          rowHasError = true;
        } else if (seenCodes.has(code)) {
          duplicateCodes.push(code);
          issues.push({ rowNumber, severity: 'error', field: 'Mã dữ liệu', message: `Trùng mã dữ liệu "${code}".` });
          rowHasError = true;
        } else {
          seenCodes.add(code);
        }

        if (!ward) {
          issues.push({ rowNumber, severity: 'error', field: 'Xã/Phường', message: 'Thiếu Xã/Phường.' });
          rowHasError = true;
        }
        if (!street) {
          issues.push({ rowNumber, severity: 'error', field: 'Tuyến đường', message: 'Thiếu Tuyến đường.' });
          rowHasError = true;
        }
        if (!landType) {
          issues.push({ rowNumber, severity: 'error', field: 'Loại đất', message: 'Thiếu Loại đất.' });
          rowHasError = true;
        }
        if (!position) {
          issues.push({ rowNumber, severity: 'error', field: 'Vị trí', message: 'Thiếu Vị trí đất.' });
          rowHasError = true;
        }
        if (price === null || price <= 0) {
          issues.push({
            rowNumber,
            severity: 'error',
            field: 'Đơn giá',
            message: priceRes.error || 'Đơn giá không hợp lệ hoặc <= 0.',
          });
          rowHasError = true;
        }
        if (!page) {
          issues.push({ rowNumber, severity: 'error', field: 'Trang/Phụ lục nguồn', message: 'Thiếu trang hoặc phụ lục nguồn.' });
          rowHasError = true;
        }

        const coords = parseOptionalSpatialCoordinates(
          colLat !== -1 ? row[colLat] || '' : '',
          colLng !== -1 ? row[colLng] || '' : '',
          rowNumber,
          issues
        );
        if (coords.hasError) {
          rowHasError = true;
        }

        if (!rowHasError && price !== null) {
          if (coords.latitude !== null && coords.longitude !== null) {
            validSpatialCount += 1;
          }
          validRows.push({
            id: `state-${sourceMeta.versionId}-${idx + 1}`,
            recordCode: code,
            legalDocumentName:
              (colDoc !== -1 ? row[colDoc] : '') || sourceMeta.sourceDocumentName || 'Chưa ghi tên văn bản pháp lý',
            wardCommune: ward,
            districtCity: colDistrict !== -1 ? row[colDistrict] || '' : '',
            streetName: street,
            roadSegment: colSegment !== -1 ? row[colSegment] || '' : '',
            startPoint: colStart !== -1 ? row[colStart] || '' : '',
            endPoint: colEnd !== -1 ? row[colEnd] || '' : '',
            landType,
            position,
            unitPrice: price,
            unit: (colUnit !== -1 && row[colUnit]) ? row[colUnit] : 'VNĐ/m²',
            sourcePageOrAppendix: page,
            effectiveDate: (colEff !== -1 && row[colEff]) ? row[colEff] : sourceMeta.effectiveDate,
            importedAt: nowIso,
            versionId: sourceMeta.versionId,
            latitude: coords.latitude,
            longitude: coords.longitude,
            coordinateNote: colCoordNote !== -1 && row[colCoordNote] ? row[colCoordNote].trim() : undefined,
            isDemo: false,
          });
        }
      });
    }

    const hasBlockingError = missingCols.length > 0 || issues.some((i) => i.severity === 'error');
    return {
      datasetKind,
      fileName,
      totalRows: dataRows.length,
      validRows,
      validSpatialCount,
      missingRequiredColumns: missingCols,
      duplicateCodes: Array.from(new Set(duplicateCodes)),
      issues,
      canCommit: !hasBlockingError && validRows.length > 0,
    };
  }

  if (datasetKind === 'ecovis') {
    const colCode = findColumnIndex(headers, ['ma_du_lieu', 'recordcode', 'mã dữ liệu', 'ma', 'code']);
    const colWard = findColumnIndex(headers, ['xa_phuong', 'wardcommune', 'xã/phường']);
    const colDistrict = findColumnIndex(headers, ['huyen_tp', 'districtcity', 'huyện/thị xã/tp']);
    const colStreet = findColumnIndex(headers, ['tuyen_duong', 'streetname', 'tuyến đường']);
    const colSegment = findColumnIndex(headers, ['doan_duong', 'roadsegment', 'đoạn đường']);
    const colLandType = findColumnIndex(headers, ['loai_dat', 'landtype', 'loại đất']);
    const colPos = findColumnIndex(headers, ['vi_tri', 'position', 'vị trí']);
    const colPrice = findColumnIndex(headers, ['don_gia_khao_sat', 'surveyunitprice', 'đơn giá khảo sát', 'don_gia', 'đơn giá']);
    const colUnit = findColumnIndex(headers, ['don_vi_tinh', 'unit', 'đơn vị tính']);
    const colDoc = findColumnIndex(headers, ['nguon_tai_lieu', 'sourcedocument', 'nguồn tài liệu']);
    const colPage = findColumnIndex(headers, ['phu_luc_trang', 'appendixandpage', 'phụ lục và trang tham chiếu', 'trang']);
    const colSurveyDate = findColumnIndex(headers, ['thoi_diem_khao_sat', 'surveyorreportdate', 'thời điểm khảo sát', 'ngay_bao_cao']);
    const colLat = findColumnIndex(headers, ['vi_do', 'latitude', 'vĩ độ', 'lat']);
    const colLng = findColumnIndex(headers, ['kinh_do', 'longitude', 'kinh độ', 'lng', 'lon']);
    const colCoordNote = findColumnIndex(headers, ['ghi_chu_toa_do', 'coordinatenote', 'ghi chú tọa độ']);

    const missingCols: string[] = [];
    if (colCode === -1) missingCols.push('Mã dữ liệu (ma_du_lieu)');
    if (colStreet === -1) missingCols.push('Tuyến đường (tuyen_duong)');
    if (colLandType === -1) missingCols.push('Loại đất (loai_dat)');
    if (colPrice === -1) missingCols.push('Đơn giá khảo sát (don_gia_khao_sat)');
    if (colPage === -1) missingCols.push('Phụ lục và trang tham chiếu (phu_luc_trang)');

    const validRows: EcovisRecord[] = [];
    let validSpatialCount = 0;
    if (missingCols.length === 0) {
      dataRows.forEach((row, idx) => {
        const rowNumber = idx + 2;
        const code = (row[colCode] || '').trim();
        const street = (row[colStreet] || '').trim();
        const landType = (row[colLandType] || '').trim();
        const priceRes = parseVietnameseNumber(row[colPrice] || '', 'currency_integer');
        const price = priceRes.value;
        const page = (row[colPage] || '').trim();

        let rowHasError = false;
        if (!code) {
          issues.push({ rowNumber, severity: 'error', field: 'Mã dữ liệu', message: 'Thiếu mã dữ liệu.' });
          rowHasError = true;
        } else if (seenCodes.has(code)) {
          duplicateCodes.push(code);
          issues.push({ rowNumber, severity: 'error', field: 'Mã dữ liệu', message: `Trùng mã dữ liệu "${code}".` });
          rowHasError = true;
        } else {
          seenCodes.add(code);
        }
        if (!street) {
          issues.push({ rowNumber, severity: 'error', field: 'Tuyến đường', message: 'Thiếu Tuyến đường.' });
          rowHasError = true;
        }
        if (!landType) {
          issues.push({ rowNumber, severity: 'error', field: 'Loại đất', message: 'Thiếu Loại đất.' });
          rowHasError = true;
        }
        if (price === null || price <= 0) {
          issues.push({
            rowNumber,
            severity: 'error',
            field: 'Đơn giá khảo sát',
            message: priceRes.error || 'Đơn giá khảo sát không hợp lệ hoặc <= 0.',
          });
          rowHasError = true;
        }
        if (!page) {
          issues.push({ rowNumber, severity: 'error', field: 'Phụ lục & trang', message: 'Thiếu phụ lục và trang tham chiếu.' });
          rowHasError = true;
        }

        const coords = parseOptionalSpatialCoordinates(
          colLat !== -1 ? row[colLat] || '' : '',
          colLng !== -1 ? row[colLng] || '' : '',
          rowNumber,
          issues
        );
        if (coords.hasError) {
          rowHasError = true;
        }

        if (!rowHasError && price !== null) {
          if (coords.latitude !== null && coords.longitude !== null) {
            validSpatialCount += 1;
          }
          validRows.push({
            id: `eco-${sourceMeta.versionId}-${idx + 1}`,
            recordCode: code,
            wardCommune: colWard !== -1 ? row[colWard] || '' : '',
            districtCity: colDistrict !== -1 ? row[colDistrict] || '' : '',
            streetName: street,
            roadSegment: colSegment !== -1 ? row[colSegment] || '' : '',
            landType,
            position: colPos !== -1 ? row[colPos] || '' : 'Chưa ghi rõ',
            surveyUnitPrice: price,
            unit: colUnit !== -1 && row[colUnit] ? row[colUnit] : 'VNĐ/m²',
            sourceDocument:
              (colDoc !== -1 ? row[colDoc] : '') || sourceMeta.sourceDocumentName || 'Báo cáo khảo sát ECOVIS',
            appendixAndPage: page,
            surveyOrReportDate:
              (colSurveyDate !== -1 && row[colSurveyDate]) ? row[colSurveyDate] : sourceMeta.effectiveDate,
            importedAt: nowIso,
            versionId: sourceMeta.versionId,
            latitude: coords.latitude,
            longitude: coords.longitude,
            coordinateNote: colCoordNote !== -1 && row[colCoordNote] ? row[colCoordNote].trim() : undefined,
            isDemo: false,
          });
        }
      });
    }

    const hasBlockingError = missingCols.length > 0 || issues.some((i) => i.severity === 'error');
    return {
      datasetKind,
      fileName,
      totalRows: dataRows.length,
      validRows,
      validSpatialCount,
      missingRequiredColumns: missingCols,
      duplicateCodes: Array.from(new Set(duplicateCodes)),
      issues,
      canCommit: !hasBlockingError && validRows.length > 0,
    };
  }

  if (datasetKind === 'k_factor_rules') {
    const colCode = findColumnIndex(headers, ['ma_he_so', 'rulecode', 'mã hệ số', 'ma_du_lieu']);
    const colName = findColumnIndex(headers, ['ten_he_so', 'factorname', 'tên hệ số']);
    const colVal = findColumnIndex(headers, ['gia_tri', 'factorvalue', 'giá trị', 'he_so']);
    const colFormula = findColumnIndex(headers, ['cong_thuc', 'formula', 'công thức']);
    const colCond = findColumnIndex(headers, ['dieu_kien_ap_dung', 'applicablecondition', 'điều kiện áp dụng']);
    const colInputs = findColumnIndex(headers, ['du_lieu_dau_vao', 'requiredinputfields', 'dữ liệu đầu vào']);
    const colDoc = findColumnIndex(headers, ['nguon_tai_lieu', 'sourcedocument', 'nguồn tài liệu']);
    const colPage = findColumnIndex(headers, ['trang_tham_chieu', 'sourcepage', 'trang tham chiếu', 'trang']);
    const colEff = findColumnIndex(headers, ['ngay_hieu_luc', 'effectivedate', 'ngày hiệu lực']);

    const missingCols: string[] = [];
    if (colCode === -1) missingCols.push('Mã hệ số (ma_he_so)');
    if (colName === -1) missingCols.push('Tên hệ số (ten_he_so)');
    if (colVal === -1) missingCols.push('Giá trị (gia_tri)');
    if (colFormula === -1) missingCols.push('Công thức (cong_thuc)');
    if (colCond === -1) missingCols.push('Điều kiện áp dụng (dieu_kien_ap_dung)');
    if (colPage === -1) missingCols.push('Trang tham chiếu (trang_tham_chieu)');

    const validRows: KFactorRuleRecord[] = [];
    if (missingCols.length === 0) {
      dataRows.forEach((row, idx) => {
        const rowNumber = idx + 2;
        const code = (row[colCode] || '').trim();
        const name = (row[colName] || '').trim();
        const valRes = parseVietnameseNumber(row[colVal] || '', 'decimal_measurement');
        const val = valRes.value;
        const formula = (row[colFormula] || '').trim();
        const cond = (row[colCond] || '').trim();
        const page = (row[colPage] || '').trim();

        let rowHasError = false;
        if (!code) {
          issues.push({ rowNumber, severity: 'error', field: 'Mã hệ số', message: 'Thiếu mã hệ số.' });
          rowHasError = true;
        } else if (seenCodes.has(code)) {
          duplicateCodes.push(code);
          issues.push({ rowNumber, severity: 'error', field: 'Mã hệ số', message: `Trùng mã hệ số "${code}".` });
          rowHasError = true;
        } else {
          seenCodes.add(code);
        }
        if (!name) {
          issues.push({ rowNumber, severity: 'error', field: 'Tên hệ số', message: 'Thiếu tên hệ số.' });
          rowHasError = true;
        }
        if (val === null || val <= 0) {
          issues.push({
            rowNumber,
            severity: 'error',
            field: 'Giá trị',
            message: valRes.error || 'Giá trị hệ số phải là số dương.',
          });
          rowHasError = true;
        }
        if (!formula) {
          issues.push({ rowNumber, severity: 'error', field: 'Công thức', message: 'Thiếu công thức áp dụng.' });
          rowHasError = true;
        }
        if (!cond) {
          issues.push({ rowNumber, severity: 'error', field: 'Điều kiện áp dụng', message: 'Thiếu điều kiện áp dụng.' });
          rowHasError = true;
        }
        if (!page) {
          issues.push({ rowNumber, severity: 'error', field: 'Trang tham chiếu', message: 'Thiếu trang tham chiếu nguồn.' });
          rowHasError = true;
        }

        if (!rowHasError && val !== null) {
          validRows.push({
            id: `krule-${sourceMeta.versionId}-${idx + 1}`,
            ruleCode: code,
            factorName: name,
            factorValue: val,
            formula,
            applicableCondition: cond,
            requiredInputFields: colInputs !== -1 ? row[colInputs] || '' : '',
            sourceDocument:
              (colDoc !== -1 ? row[colDoc] : '') || sourceMeta.sourceDocumentName || 'Tài liệu quy định hệ số K',
            sourcePage: page,
            effectiveDate: (colEff !== -1 && row[colEff]) ? row[colEff] : sourceMeta.effectiveDate,
            importedAt: nowIso,
            versionId: sourceMeta.versionId,
            isDemo: false,
          });
        }
      });
    }

    const hasBlockingError = missingCols.length > 0 || issues.some((i) => i.severity === 'error');
    return {
      datasetKind,
      fileName,
      totalRows: dataRows.length,
      validRows,
      missingRequiredColumns: missingCols,
      duplicateCodes: Array.from(new Set(duplicateCodes)),
      issues,
      canCommit: !hasBlockingError && validRows.length > 0,
    };
  }

  // market_survey
  const colCode = findColumnIndex(headers, ['ma_tin', 'listingcode', 'mã tin', 'ma_du_lieu']);
  const colSource = findColumnIndex(headers, ['nguon_tin', 'sourcename', 'nguồn tin']);
  const colUrl = findColumnIndex(headers, ['duong_dan', 'đường dẫn', 'url', 'link']);
  const colDate = findColumnIndex(headers, ['ngay_dang', 'posteddate', 'ngày đăng']);
  const colAddress = findColumnIndex(headers, ['dia_chi', 'address', 'địa chỉ']);
  const colWard = findColumnIndex(headers, ['xa_phuong', 'wardcommune', 'xã/phường']);
  const colArea = findColumnIndex(headers, ['dien_tich', 'areasqm', 'diện tích']);
  const colPrice = findColumnIndex(headers, ['gia_rao_ban', 'askingpricevnd', 'giá rao bán']);
  const colType = findColumnIndex(headers, ['loai_bds', 'propertytype', 'loại bất động sản']);
  const colLoc = findColumnIndex(headers, ['thong_tin_vi_tri', 'locationinfo', 'thông tin vị trí']);
  const colNote = findColumnIndex(headers, ['ghi_chu_xac_minh', 'verificationnote', 'ghi chú xác minh']);
  const colLat = findColumnIndex(headers, ['vi_do', 'latitude', 'vĩ độ', 'lat']);
  const colLng = findColumnIndex(headers, ['kinh_do', 'longitude', 'kinh độ', 'lng', 'lon']);
  const colCoordNote = findColumnIndex(headers, ['ghi_chu_toa_do', 'coordinatenote', 'ghi chú tọa độ']);

  const missingCols: string[] = [];
  if (colCode === -1) missingCols.push('Mã tin (ma_tin)');
  if (colSource === -1) missingCols.push('Nguồn tin (nguon_tin)');
  if (colAddress === -1) missingCols.push('Địa chỉ (dia_chi)');
  if (colArea === -1) missingCols.push('Diện tích m² (dien_tich)');
  if (colPrice === -1) missingCols.push('Giá rao bán VNĐ (gia_rao_ban)');

  const validRows: MarketListingRecord[] = [];
  let validSpatialCount = 0;
  if (missingCols.length === 0) {
    dataRows.forEach((row, idx) => {
      const rowNumber = idx + 2;
      const code = (row[colCode] || '').trim();
      const source = (row[colSource] || '').trim();
      const address = (row[colAddress] || '').trim();
      const areaRes = parseVietnameseNumber(row[colArea] || '', 'decimal_measurement');
      const priceRes = parseVietnameseNumber(row[colPrice] || '', 'currency_integer');
      const area = areaRes.value;
      const price = priceRes.value;

      let rowHasError = false;
      if (!code) {
        issues.push({ rowNumber, severity: 'error', field: 'Mã tin', message: 'Thiếu mã tin.' });
        rowHasError = true;
      } else if (seenCodes.has(code)) {
        duplicateCodes.push(code);
        issues.push({ rowNumber, severity: 'error', field: 'Mã tin', message: `Trùng mã tin "${code}".` });
        rowHasError = true;
      } else {
        seenCodes.add(code);
      }
      if (!source) {
        issues.push({ rowNumber, severity: 'error', field: 'Nguồn tin', message: 'Thiếu nguồn tin.' });
        rowHasError = true;
      }
      if (!address) {
        issues.push({ rowNumber, severity: 'error', field: 'Địa chỉ', message: 'Thiếu địa chỉ bất động sản.' });
        rowHasError = true;
      }
      if (area === null || area <= 0) {
        issues.push({
          rowNumber,
          severity: 'error',
          field: 'Diện tích',
          message: areaRes.error || 'Diện tích không hợp lệ hoặc <= 0.',
        });
        rowHasError = true;
      }
      if (price === null || price <= 0) {
        issues.push({
          rowNumber,
          severity: 'error',
          field: 'Giá rao bán',
          message: priceRes.error || 'Giá rao bán không hợp lệ hoặc <= 0.',
        });
        rowHasError = true;
      }

      const rawUrl = colUrl !== -1 ? (row[colUrl] || '').trim() : '';
      let safeUrl = '';
      if (rawUrl) {
        try {
          const parsedUrl = new URL(rawUrl);
          if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
            safeUrl = parsedUrl.toString();
          } else {
            issues.push({
              rowNumber,
              severity: 'error',
              field: 'Đường dẫn',
              message: 'Đường dẫn tin rao chỉ chấp nhận giao thức http:// hoặc https://.',
            });
            rowHasError = true;
          }
        } catch {
          issues.push({
            rowNumber,
            severity: 'error',
            field: 'Đường dẫn',
            message: `Đường dẫn "${rawUrl}" không đúng định dạng URL hợp lệ.`,
          });
          rowHasError = true;
        }
      }

      const coords = parseOptionalSpatialCoordinates(
        colLat !== -1 ? row[colLat] || '' : '',
        colLng !== -1 ? row[colLng] || '' : '',
        rowNumber,
        issues
      );
      if (coords.hasError) {
        rowHasError = true;
      }

      if (!rowHasError && area !== null && price !== null) {
        if (coords.latitude !== null && coords.longitude !== null) {
          validSpatialCount += 1;
        }
        validRows.push({
          id: `mkt-${sourceMeta.versionId}-${idx + 1}`,
          listingCode: code,
          sourceName: source,
          url: safeUrl,
          postedDate: colDate !== -1 ? row[colDate] || '' : '',
          address,
          wardCommune: colWard !== -1 ? row[colWard] || '' : '',
          areaSqm: area,
          askingPriceVnd: price,
          unitPricePerSqm: Math.round(price / area),
          propertyType: colType !== -1 ? row[colType] || '' : 'Chưa phân loại',
          locationInfo: colLoc !== -1 ? row[colLoc] || '' : '',
          verificationStatus: 'chua_xac_minh',
          verificationNote: colNote !== -1 ? row[colNote] || 'Nhập từ bảng khảo sát – chưa xác minh.' : 'Nhập từ bảng khảo sát – chưa xác minh.',
          isDuplicate: false,
          duplicateOfId: null,
          createdAt: nowIso,
          latitude: coords.latitude,
          longitude: coords.longitude,
          coordinateNote: colCoordNote !== -1 && row[colCoordNote] ? row[colCoordNote].trim() : undefined,
          isDemo: false,
        });
      }
    });
  }

  const hasBlockingError = missingCols.length > 0 || issues.some((i) => i.severity === 'error');
  return {
    datasetKind,
    fileName,
    totalRows: dataRows.length,
    validRows,
    validSpatialCount,
    missingRequiredColumns: missingCols,
    duplicateCodes: Array.from(new Set(duplicateCodes)),
    issues,
    canCommit: !hasBlockingError && validRows.length > 0,
  };
}

const DATASET_TEMPLATES: Record<
  DatasetKind,
  {
    excelFileName: string;
    jsonFileName: string;
    headers: string[];
    sampleNoteRow: (string | number)[];
  }
> = {
  state_price: {
    excelFileName: 'Mau_Nhap_Bang_Gia_Dat_Nha_Nuoc_KhanhHoa.xlsx',
    jsonFileName: 'Mau_Nhap_Bang_Gia_Dat_Nha_Nuoc_KhanhHoa.json',
    headers: [
      'ma_du_lieu',
      'van_ban_phap_ly',
      'huyen_tp',
      'xa_phuong',
      'tuyen_duong',
      'doan_duong',
      'diem_dau',
      'diem_cuoi',
      'loai_dat',
      'vi_tri',
      'don_gia',
      'don_vi_tinh',
      'trang_phu_luc',
      'ngay_hieu_luc',
      'vi_do',
      'kinh_do',
      'ghi_chu_toa_do',
    ],
    sampleNoteRow: [
      'MA-DU-LIEU-001 (Thay bang ma that)',
      'Nghị quyết 15/2025/NQ-HĐND tỉnh Khánh Hòa',
      'TP. Nha Trang',
      'Nhập tên xã/phường theo văn bản',
      'Nhập nguyên văn tên tuyến đường',
      'Nhập nguyên văn đoạn đường',
      'Điểm đầu đoạn',
      'Điểm cuối đoạn',
      'Đất ở tại đô thị (ODT)',
      'Vị trí 1',
      1000000,
      'VNĐ/m²',
      'Phụ lục I - Trang ...',
      '2026-01-01',
      '',
      '',
      'Để trống nếu không có tọa độ GPS thực tế',
    ],
  },
  ecovis: {
    excelFileName: 'Mau_Nhap_Du_Lieu_Khao_Sat_ECOVIS.xlsx',
    jsonFileName: 'Mau_Nhap_Du_Lieu_Khao_Sat_ECOVIS.json',
    headers: [
      'ma_du_lieu',
      'huyen_tp',
      'xa_phuong',
      'tuyen_duong',
      'doan_duong',
      'loai_dat',
      'vi_tri',
      'don_gia_khao_sat',
      'don_vi_tinh',
      'nguon_tai_lieu',
      'phu_luc_trang',
      'thoi_diem_khao_sat',
      'vi_do',
      'kinh_do',
      'ghi_chu_toa_do',
    ],
    sampleNoteRow: [
      'ECO-001 (Thay bang ma that)',
      'TP. Nha Trang',
      'Nhập xã/phường',
      'Nhập nguyên văn tuyến đường theo ECOVIS',
      'Nhập đoạn đường theo ECOVIS',
      'Đất ở đô thị',
      'Vị trí theo báo cáo',
      1000000,
      'VNĐ/m²',
      'Báo cáo khảo sát giá đất ECOVIS',
      'Phụ lục ... - Trang ...',
      '2025-11-20',
      '',
      '',
      'Để trống nếu không có tọa độ GPS thực tế',
    ],
  },
  k_factor_rules: {
    excelFileName: 'Mau_Nhap_Quy_Dinh_He_So_K.xlsx',
    jsonFileName: 'Mau_Nhap_Quy_Dinh_He_So_K.json',
    headers: [
      'ma_he_so',
      'ten_he_so',
      'gia_tri',
      'cong_thuc',
      'dieu_kien_ap_dung',
      'du_lieu_dau_vao',
      'nguon_tai_lieu',
      'trang_tham_chieu',
      'ngay_hieu_luc',
    ],
    sampleNoteRow: [
      'K-001 (Thay bang ma quy dinh that)',
      'Tên hệ số theo văn bản',
      1.0,
      'Đơn giá điều chỉnh = Đơn giá gốc x K',
      'Ghi rõ điều kiện áp dụng theo văn bản',
      'Số mặt tiền; Chiều rộng đường/hẻm',
      'Tên văn bản/quy định nguồn',
      'Mục ... - Trang ...',
      '2026-01-01',
    ],
  },
  market_survey: {
    excelFileName: 'Mau_Nhap_Khao_Sat_Gia_Thi_Truong.xlsx',
    jsonFileName: 'Mau_Nhap_Khao_Sat_Gia_Thi_Truong.json',
    headers: [
      'ma_tin',
      'nguon_tin',
      'duong_dan',
      'ngay_dang',
      'xa_phuong',
      'dia_chi',
      'dien_tich',
      'gia_rao_ban',
      'loai_bds',
      'thong_tin_vi_tri',
      'ghi_chu_xac_minh',
      'vi_do',
      'kinh_do',
      'ghi_chu_toa_do',
    ],
    sampleNoteRow: [
      'TT-001',
      'Tên website hoặc nguồn tin',
      'https://...',
      '2026-02-01',
      'Phường/Xã',
      'Địa chỉ bất động sản rao bán',
      100,
      3000000000,
      'Đất ở đô thị',
      'Mặt tiền / Hẻm rộng ...m',
      'Chưa xác minh – cần gọi kiểm tra thực tế',
      '',
      '',
      'Để trống nếu không có tọa độ GPS thực tế',
    ],
  },
};

export async function downloadExcelTemplate(datasetKind: DatasetKind): Promise<void> {
  const tpl = DATASET_TEMPLATES[datasetKind];
  const sheetData = [
    tpl.headers.map((h) => ({ value: h, fontWeight: 'bold' as const })),
    tpl.sampleNoteRow.map((v) => ({ value: v })),
  ];

  await writeXlsxFile(sheetData).toFile(tpl.excelFileName);
}

export function downloadJsonPayload(fileName: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadJsonTemplate(datasetKind: DatasetKind): void {
  const tpl = DATASET_TEMPLATES[datasetKind];
  const sampleObj: Record<string, string | number> = {};
  tpl.headers.forEach((h, i) => {
    sampleObj[h] = tpl.sampleNoteRow[i] ?? '';
  });
  downloadJsonPayload(tpl.jsonFileName, {
    datasetKind,
    note: 'Thay thế dòng mẫu bằng dữ liệu thật. Các trường vi_do và kinh_do là tùy chọn (để trống nếu không có tọa độ GPS thực tế).',
    records: [sampleObj],
  });
}

function sanitizeExcelCellValue(val: string | number): string | number {
  if (typeof val === 'number') return val;
  if (/^[=+\-@]/.test(val)) {
    return `'${val}`;
  }
  return val;
}

export interface BuiltExcelReport {
  fileName: string;
  rows: Array<Array<{ value: string | number; fontWeight?: 'bold' }>>;
  isDemoReport: boolean;
}

export function buildReportExcelRows(
  dossier: AppraisalDossier,
  attachedMarketListings: MarketListingRecord[],
  pdfDocuments: PdfReferenceDocument[],
  isDemoMode: boolean
): BuiltExcelReport {
  const integrity = inspectDossierIntegrity(dossier, attachedMarketListings, isDemoMode);

  // Strict business-logic gate: NEVER export a contaminated real dossier as real!
  if (integrity.isContaminatedRealDossier) {
    throw new Error(
      `Bị chặn xuất báo cáo: Hồ sơ thật "${dossier.parcel.dossierCode}" đang chứa ${integrity.contaminatedItems.length} bản ghi DEMO (${integrity.contaminatedItems.map((i) => i.label).join('; ')}). Vui lòng kiểm tra và gỡ bỏ các bản ghi DEMO trước khi xuất báo cáo.`
    );
  }

  const isDemoReport = integrity.hasAnyDemoData || integrity.status === 'isolated_demo' || isDemoMode;
  const autoWarnings = buildAutoWarnings(dossier, attachedMarketListings, integrity);
  const referenceSources = buildReferenceSources(dossier, attachedMarketListings, pdfDocuments);

  const rows: Array<Array<{ value: string | number; fontWeight?: 'bold' }>> = [];
  const cell = (value: string | number, bold = false) =>
    bold
      ? { value: sanitizeExcelCellValue(value), fontWeight: 'bold' as const }
      : { value: sanitizeExcelCellValue(value) };

  const pushSection = (title: string) => {
    rows.push([cell('')]);
    rows.push([cell(title, true)]);
  };

  rows.push([
    cell(
      isDemoReport
        ? '[BÁO CÁO DEMO – KHÔNG DÙNG THẨM ĐỊNH] BÁO CÁO TỔNG HỢP TRA CỨU GIÁ ĐẤT – TỈNH KHÁNH HÒA'
        : 'BÁO CÁO TỔNG HỢP TRA CỨU THÔNG TIN GIÁ ĐẤT – TỈNH KHÁNH HÒA',
      true
    ),
  ]);
  rows.push([
    cell('Trạng thái & Chế độ dữ liệu', true),
    cell(
      isDemoReport
        ? 'CẢNH BÁO: HỒ SƠ SỬ DỤNG DỮ LIỆU MINH HỌA (DEMO) – KHÔNG DÙNG THẨM ĐỊNH THỰC TẾ'
        : 'Dữ liệu nghiệp vụ thực tế (đã kiểm tra không chứa bản ghi DEMO)'
    ),
  ]);
  rows.push([cell('Mã hồ sơ'), cell(dossier.parcel.dossierCode || 'Chưa có')]);
  rows.push([cell('Tên tài sản / Hồ sơ'), cell(dossier.parcel.collateralName || 'Chưa có')]);
  rows.push([cell('Cán bộ thực hiện'), cell(dossier.parcel.officerName || 'Chưa có')]);
  rows.push([cell('Thời điểm xuất báo cáo'), cell(formatDateTimeVi(new Date().toISOString()))]);

  // Component provenance summary
  rows.push([cell('Kiểm tra nguồn gốc từng thành phần gắn kèm', true)]);
  rows.push([
    cell('Thành phần', true),
    cell('Tổng bản ghi', true),
    cell('Bản ghi thật', true),
    cell('Bản ghi DEMO', true),
    cell('Kết luận nguồn gốc', true),
  ]);
  integrity.componentOrigins.forEach((orig) => {
    const label =
      orig.originStatus === 'chua_gan'
        ? 'Chưa gắn bản ghi'
        : orig.originStatus === 'du_lieu_that'
        ? 'Dữ liệu thật'
        : orig.originStatus === 'du_lieu_demo'
        ? 'Dữ liệu DEMO (tách biệt)'
        : 'NHIỄM DỮ LIỆU DEMO';
    rows.push([
      cell(orig.component),
      cell(orig.totalCount),
      cell(orig.realCount),
      cell(orig.demoCount),
      cell(label),
    ]);
  });

  // 1. Thông tin thửa đất
  pushSection('1. THÔNG TIN THỬA ĐẤT');
  rows.push([
    cell('Trạng thái xác nhận thông tin thửa đất', true),
    cell(dossier.parcel.officerConfirmedParcelInfo ? 'Đã xác nhận bởi cán bộ' : 'Chưa xác nhận'),
  ]);
  rows.push([cell('Địa chỉ thửa đất'), cell(dossier.parcel.address || 'Chưa có thông tin')]);
  rows.push([cell('Xã/Phường'), cell(dossier.parcel.wardCommune || 'Chưa có thông tin')]);
  rows.push([cell('Huyện/Thị xã/TP'), cell(dossier.parcel.districtCity || 'Chưa có thông tin')]);
  rows.push([
    cell('Số thửa / Tờ bản đồ'),
    cell(`Thửa ${dossier.parcel.parcelNumber || '...'} / Tờ ${dossier.parcel.mapSheetNumber || '...'}`),
  ]);
  rows.push([cell('Loại đất theo GCN'), cell(dossier.parcel.landTypeCertificate || 'Chưa có thông tin')]);
  rows.push([cell('Diện tích (m²)'), cell(dossier.parcel.areaSqm ?? 'Chưa có thông tin')]);
  rows.push([cell('Chiều rộng mặt tiền (m)'), cell(dossier.parcel.frontageWidthM ?? 'Chưa có thông tin')]);
  rows.push([cell('Chiều sâu thửa đất (m)'), cell(dossier.parcel.depthM ?? 'Chưa có thông tin')]);
  rows.push([cell('Số mặt tiền'), cell(dossier.parcel.frontageCount ?? 'Chưa có thông tin')]);
  rows.push([cell('Thông tin bổ sung khác'), cell(dossier.parcel.additionalNotes || 'Không có')]);

  // 2 & 3. Ảnh thực địa & GPS
  pushSection('2 & 3. HÌNH ẢNH THỰC ĐỊA, TỌA ĐỘ GPS VÀ BẢN ĐỒ');
  if (dossier.photos.length === 0) {
    rows.push([cell('Chưa tải lên ảnh thực địa.')]);
  } else {
    rows.push([
      cell('Tên tệp ảnh', true),
      cell('Tọa độ GPS', true),
      cell('Nguồn tọa độ', true),
      cell('Ngày giờ chụp', true),
      cell('Liên kết Google Maps', true),
      cell('Xác nhận tọa độ', true),
      cell('Xác nhận tại thửa đất', true),
      cell('Ghi chú thực địa', true),
    ]);
    dossier.photos.forEach((p) => {
      rows.push([
        cell(p.fileName),
        cell(formatCoordinate(p.activeLatitude, p.activeLongitude)),
        cell(getCoordinateSourceLabel(p.coordinateSource)),
        cell(p.capturedAt ? formatDateTimeVi(p.capturedAt) : 'Chưa có'),
        cell(buildGoogleMapsUrl(p.activeLatitude, p.activeLongitude) || 'Không có tọa độ hợp lệ'),
        cell(p.officerConfirmedCoordinates ? 'Đã xác nhận' : 'Chưa xác nhận'),
        cell(p.officerConfirmedAtParcel ? 'Đã xác nhận' : 'Chưa xác nhận'),
        cell(p.officerNote || ''),
      ]);
    });
  }

  // 4. Thông tin tuyến đường và đoạn đường tham chiếu
  pushSection('4. THÔNG TIN TUYẾN ĐƯỜNG VÀ ĐOẠN ĐƯỜNG THAM CHIẾU');
  rows.push([cell('Tuyến đường chính (theo hồ sơ thửa đất)'), cell(dossier.parcel.streetName || 'Chưa có thông tin')]);
  rows.push([cell('Đoạn đường tham chiếu (roadSegmentRef)'), cell(dossier.parcel.roadSegmentRef || 'Chưa có thông tin')]);
  rows.push([cell('Đường/Hẻm tiếp giáp trực tiếp'), cell(dossier.parcel.adjacentRoadName || 'Chưa có thông tin')]);
  rows.push([
    cell('Chiều rộng đường/hẻm (m)'),
    cell(dossier.parcel.roadAlleyWidthM !== null ? dossier.parcel.roadAlleyWidthM : 'Chưa có thông tin'),
  ]);
  rows.push([
    cell('Khoảng cách đến đường chính (m)'),
    cell(dossier.parcel.distanceToMainRoadM !== null ? dossier.parcel.distanceToMainRoadM : 'Chưa có thông tin'),
  ]);
  rows.push([cell('Tình trạng đường giao thông'), cell(dossier.parcel.roadCondition || 'Chưa có thông tin')]);

  if (dossier.attachedStateRefs.length > 0 || dossier.attachedEcovisRefs.length > 0) {
    rows.push([cell('Chi tiết tuyến đường / đoạn đường / điểm đầu – điểm cuối đã gắn đối chiếu:', true)]);
    rows.push([
      cell('Nhóm nguồn', true),
      cell('Tuyến đường', true),
      cell('Đoạn đường', true),
      cell('Điểm đầu', true),
      cell('Điểm cuối', true),
      cell('Xã/Phường', true),
      cell('Nguồn gốc', true),
      cell('Xác nhận đối chiếu', true),
    ]);
    dossier.attachedStateRefs.forEach((ref) => {
      rows.push([
        cell('Bảng giá Nhà nước'),
        cell(ref.record.streetName),
        cell(ref.record.roadSegment || 'Chưa ghi rõ'),
        cell(ref.record.startPoint || 'Chưa ghi rõ'),
        cell(ref.record.endPoint || 'Chưa ghi rõ'),
        cell([ref.record.wardCommune, ref.record.districtCity].filter(Boolean).join(', ') || 'Chưa ghi rõ'),
        cell(isStateRecordDemo(ref.record) ? 'DEMO (Minh họa)' : 'Dữ liệu thật'),
        cell(ref.officerConfirmedMatch ? 'Đã xác nhận' : 'Chưa xác nhận'),
      ]);
    });
    dossier.attachedEcovisRefs.forEach((ref) => {
      rows.push([
        cell('Khảo sát ECOVIS'),
        cell(ref.record.streetName),
        cell(ref.record.roadSegment || 'Chưa ghi rõ'),
        cell('Không tách điểm đầu trong ECOVIS'),
        cell('Không tách điểm cuối trong ECOVIS'),
        cell([ref.record.wardCommune, ref.record.districtCity].filter(Boolean).join(', ') || 'Chưa ghi rõ'),
        cell(isEcovisRecordDemo(ref.record) ? 'DEMO (Minh họa)' : 'Dữ liệu thật'),
        cell(ref.officerConfirmedMatch ? 'Đã xác nhận' : 'Chưa xác nhận'),
      ]);
    });
  }

  // 5. Giá đất Nhà nước
  pushSection('5. BẢNG GIÁ ĐẤT NHÀ NƯỚC ĐƯỢC GẮN THAM CHIẾU');
  if (dossier.attachedStateRefs.length === 0) {
    rows.push([cell('Chưa gắn bản ghi từ Bảng giá đất Nhà nước.')]);
  } else {
    rows.push([
      cell('Văn bản pháp lý', true),
      cell('Tuyến đường', true),
      cell('Đoạn đường / Điểm đầu – cuối', true),
      cell('Loại đất', true),
      cell('Vị trí', true),
      cell('Đơn giá', true),
      cell('Trang/Phụ lục', true),
      cell('Nguồn gốc', true),
      cell('Xác nhận đối chiếu', true),
    ]);
    dossier.attachedStateRefs.forEach((ref) => {
      const segText = [
        ref.record.roadSegment,
        ref.record.startPoint || ref.record.endPoint
          ? `(${ref.record.startPoint || '...'} – ${ref.record.endPoint || '...'})`
          : '',
      ]
        .filter(Boolean)
        .join(' ');
      rows.push([
        cell(ref.record.legalDocumentName),
        cell(ref.record.streetName),
        cell(segText || 'Chưa ghi rõ'),
        cell(ref.record.landType),
        cell(ref.record.position),
        cell(`${formatCurrencyVnd(ref.record.unitPrice)} (${ref.record.unit})`),
        cell(ref.record.sourcePageOrAppendix),
        cell(isStateRecordDemo(ref.record) ? 'DEMO (Minh họa)' : 'Dữ liệu thật'),
        cell(ref.officerConfirmedMatch ? 'Đã xác nhận' : 'Chưa xác nhận'),
      ]);
    });
  }

  // 6. ECOVIS
  pushSection('6. DỮ LIỆU KHẢO SÁT ECOVIS (ĐỘC LẬP – KHÔNG MẶC ĐỊNH LÀ GIÁ THỊ TRƯỜNG HIỆN TẠI)');
  if (dossier.attachedEcovisRefs.length === 0) {
    rows.push([cell('Chưa gắn bản ghi khảo sát ECOVIS.')]);
  } else {
    rows.push([
      cell('Tuyến đường (ECOVIS)', true),
      cell('Đoạn đường', true),
      cell('Loại đất / Vị trí', true),
      cell('Đơn giá khảo sát', true),
      cell('Nguồn tài liệu', true),
      cell('Phụ lục & trang', true),
      cell('Thời điểm khảo sát', true),
      cell('Nguồn gốc', true),
      cell('Xác nhận đối chiếu', true),
    ]);
    dossier.attachedEcovisRefs.forEach((ref) => {
      rows.push([
        cell(ref.record.streetName),
        cell(ref.record.roadSegment || 'Chưa ghi rõ'),
        cell(`${ref.record.landType} / ${ref.record.position}`),
        cell(formatCurrencyVnd(ref.record.surveyUnitPrice)),
        cell(ref.record.sourceDocument),
        cell(ref.record.appendixAndPage),
        cell(ref.record.surveyOrReportDate || 'Chưa xác định'),
        cell(isEcovisRecordDemo(ref.record) ? 'DEMO (Minh họa)' : 'Dữ liệu thật'),
        cell(ref.officerConfirmedMatch ? 'Đã xác nhận' : 'Chưa xác nhận'),
      ]);
    });
  }

  // 7. Thị trường
  pushSection('7. GIÁ RAO BÁN THAM KHẢO (KHÔNG PHẢI GIÁ GIAO DỊCH THỰC TẾ)');
  if (attachedMarketListings.length === 0) {
    rows.push([cell('Chưa gắn tin rao bán tham khảo.')]);
  } else {
    rows.push([
      cell('Nguồn tin', true),
      cell('Địa chỉ', true),
      cell('Diện tích (m²)', true),
      cell('Giá rao bán', true),
      cell('Đơn giá/m²', true),
      cell('Trạng thái xác minh', true),
      cell('Nguồn gốc', true),
      cell('Đường dẫn', true),
    ]);
    attachedMarketListings.forEach((m) => {
      rows.push([
        cell(m.sourceName),
        cell(m.address),
        cell(m.areaSqm ?? 'Chưa có'),
        cell(formatCurrencyVnd(m.askingPriceVnd)),
        cell(formatCurrencyVnd(m.unitPricePerSqm)),
        cell(
          m.verificationStatus === 'da_xac_minh_so_bo'
            ? 'Đã xác minh sơ bộ'
            : m.verificationStatus === 'loai_tru'
            ? 'Đã loại trừ'
            : 'Chưa xác minh'
        ),
        cell(isMarketListingDemo(m) ? 'DEMO (Minh họa)' : 'Dữ liệu thật'),
        cell(m.url || 'Nhập thủ công'),
      ]);
    });
  }

  // 8 & 9. Vị trí & Hệ số K
  pushSection('8 & 9. PHÂN TÍCH VỊ TRÍ VÀ HỆ SỐ K');
  rows.push([
    cell('Vị trí theo Bảng giá Nhà nước (cán bộ nhận định)'),
    cell(dossier.locationAnalysis.selectedStatePosition || 'Chưa xác định'),
    cell(dossier.locationAnalysis.statePositionVerified ? 'Đã xác nhận' : 'Chưa xác nhận'),
  ]);
  rows.push([
    cell('Căn cứ văn bản phân loại vị trí'),
    cell(dossier.locationAnalysis.statePositionBasis || 'Chưa ghi nhận căn cứ'),
  ]);
  if (dossier.locationAnalysis.otherDocumentedFactors) {
    rows.push([
      cell('Yếu tố vị trí khác có căn cứ'),
      cell(dossier.locationAnalysis.otherDocumentedFactors),
    ]);
  }

  if (dossier.locationAnalysis.appliedKFactors.length === 0) {
    rows.push([
      cell('Hệ số K'),
      cell('CHƯA ĐỦ CƠ SỞ TÍNH TOÁN (Chưa có hệ số K đủ điều kiện và căn cứ xác minh)'),
    ]);
  } else {
    rows.push([
      cell('Tên hệ số', true),
      cell('Giá trị', true),
      cell('Công thức', true),
      cell('Điều kiện áp dụng', true),
      cell('Nguồn & trang', true),
      cell('Nguồn gốc', true),
      cell('Trạng thái xác minh', true),
    ]);
    dossier.locationAnalysis.appliedKFactors.forEach((k) => {
      rows.push([
        cell(k.factorName),
        cell(
          k.hasSufficientBasis && k.verificationStatus === 'da_xac_minh' && k.value !== null
            ? formatNumberVi(k.value, 4)
            : 'CHƯA ĐỦ CƠ SỞ TÍNH TOÁN'
        ),
        cell(k.formula),
        cell(k.applicableCondition),
        cell(`${k.sourceDocument} (${k.sourcePage})`),
        cell(isAppliedKFactorDemo(k) ? 'DEMO (Minh họa)' : 'Dữ liệu thật'),
        cell(k.verificationStatus === 'da_xac_minh' ? 'Đã xác minh' : 'Chưa xác minh'),
      ]);
    });
  }

  // 10. Nhận xét & Cảnh báo tự động
  pushSection('10. NHẬN XÉT VÀ CẢNH BÁO NGHIỆP VỤ');
  if (autoWarnings.length === 0) {
    rows.push([cell('Cảnh báo kiểm soát tự động'), cell('Không phát hiện cảnh báo tự động.')]);
  } else {
    rows.push([cell('STT', true), cell('Cảnh báo kiểm soát tự động từ hệ thống', true)]);
    autoWarnings.forEach((w, idx) => {
      rows.push([cell(idx + 1), cell(w)]);
    });
  }
  rows.push([
    cell('Nhận xét bổ sung của cán bộ', true),
    cell(dossier.reportNotes || 'Chưa nhập nhận xét bổ sung.'),
  ]);
  rows.push([
    cell('Tuyên bố miễn trừ', true),
    cell(
      'Báo cáo này chỉ phục vụ tổng hợp và tra cứu tham khảo nghiệp vụ. Kết quả từ hệ thống và công cụ AI không phải là kết quả thẩm định giá chính thức.'
    ),
  ]);

  // 11. Danh mục nguồn tài liệu tham chiếu & PDF
  pushSection('11. DANH MỤC NGUỒN TÀI LIỆU THAM CHIẾU VÀ PDF LƯU TRỮ');
  if (referenceSources.length === 0) {
    rows.push([cell('Chưa có nguồn tài liệu tham chiếu hoặc PDF lưu trữ nào được trích dẫn.')]);
  } else {
    rows.push([
      cell('STT', true),
      cell('Nhóm nguồn', true),
      cell('Tên tài liệu / Nguồn tin', true),
      cell('Chi tiết trang / Phụ lục / Hiệu lực / URL', true),
      cell('Nguồn gốc', true),
      cell('Trạng thái xác minh', true),
    ]);
    referenceSources.forEach((src, idx) => {
      rows.push([
        cell(idx + 1),
        cell(src.category),
        cell(src.title),
        cell(src.detail),
        cell(src.originLabel),
        cell(src.verified ? 'Đã xác minh' : 'Chưa xác minh'),
      ]);
    });
  }

  const safeCode = (dossier.parcel.dossierCode || 'HoSo').replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = isDemoReport
    ? `DEMO_BaoCao_TraCuuGiaDat_${safeCode}.xlsx`
    : `BaoCao_TraCuuGiaDat_${safeCode}.xlsx`;

  return { fileName, rows, isDemoReport };
}

export async function exportReportToExcel(
  dossier: AppraisalDossier,
  attachedMarketListings: MarketListingRecord[],
  pdfDocuments: PdfReferenceDocument[],
  isDemoMode: boolean
): Promise<void> {
  const { fileName, rows } = buildReportExcelRows(
    dossier,
    attachedMarketListings,
    pdfDocuments,
    isDemoMode
  );
  await writeXlsxFile(rows).toFile(fileName);
}
