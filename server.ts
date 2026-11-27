import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import dns from 'dns/promises';
import net from 'net';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import {
  requireAdminAuth,
  resolveFirebaseProjectId,
  type AdminAuthenticatedRequest,
} from './server/adminAuth.ts';
import {
  defaultDatasetStore,
  isValidDatasetKind,
  validateIncomingDatasetVersion,
  validateIncomingPdfMetadata,
  type ValidatedVersionPayload,
} from './server/datasetStore.ts';
import type { DatasetKind, PdfReferenceDocument } from './src/types/valuation.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isPrivateOrBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fe80:') ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('::ffff:127.') ||
      normalized.startsWith('::ffff:10.') ||
      normalized.startsWith('::ffff:192.168.') ||
      normalized.startsWith('::ffff:169.254.')
    ) {
      return true;
    }
    return false;
  }
  return true;
}

const RESTRICTED_SOCIAL_DOMAINS = [
  'facebook.com',
  'fb.com',
  'm.facebook.com',
  'web.facebook.com',
  'instagram.com',
  'zalo.me',
  'tiktok.com',
];

async function startServer() {
  const app = express();

  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // =========================================================================
  // M1.2 PUBLIC READ-ONLY ACTIVE DATASETS (/api/datasets/active)
  // Public lookup users do not need to log in to read active official datasets
  // and PDF reference metadata published by Admin.
  // =========================================================================
  app.get('/api/datasets/active', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const payload = await defaultDatasetStore.getPublicActiveDatasets();
      res.status(200).json(payload);
    } catch {
      res.status(500).json({
        error: 'Không thể đọc dữ liệu nguồn đang áp dụng trên máy chủ.',
      });
    }
  });

  // =========================================================================
  // A1 SINGLE FIXED ADMIN EMAIL AUTHORIZATION (/api/admin/*)
  // Every admin route verifies Firebase ID token RS256 and checks
  // email_verified === true + exact normalized email match against
  // process.env.ADMIN_EMAIL (default: linhnk2013@gmail.com; fail-closed 503
  // if env var is set but empty/invalid). Zero cache, zero fallback.
  // =========================================================================
  const adminRouter = express.Router();
  adminRouter.use(requireAdminAuth);

  adminRouter.get('/session', (req: AdminAuthenticatedRequest, res) => {
    const adminUser = req.adminUser!;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      authenticated: true,
      isAdmin: true,
      user: {
        uid: adminUser.uid,
        email: adminUser.email,
        emailVerified: adminUser.emailVerified,
        displayName: adminUser.displayName,
      },
      authMethod: adminUser.matchedBy,
      serverVerifiedAt: new Date().toISOString(),
    });
  });

  adminRouter.get('/status', (req: AdminAuthenticatedRequest, res) => {
    const adminUser = req.adminUser!;
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      authorizationModel: 'SINGLE_FIXED_ADMIN_EMAIL',
      firebaseProjectId: resolveFirebaseProjectId(),
      verifiedUid: adminUser.uid,
      authMethod: adminUser.matchedBy,
      protectedNamespaces: [
        '/api/admin/session',
        '/api/admin/status',
        '/api/admin/datasets (M1.2 active)',
        '/api/admin/sources (M2/M5)',
        '/api/admin/config (M3/M4)',
        '/api/admin/backup (M5)',
        '/api/admin/audit-logs (M5)',
      ],
    });
  });

  // =========================================================================
  // M1.2 ADMIN DATASET MANAGEMENT (/api/admin/datasets/*)
  // Protected by existing A1 requireAdminAuth middleware.
  // =========================================================================
  adminRouter.get('/datasets', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const overview = await defaultDatasetStore.getAdminOverview();
      res.status(200).json(overview);
    } catch {
      res.status(500).json({
        error: 'Không thể tải danh sách phiên bản bộ dữ liệu trên máy chủ.',
      });
    }
  });

  adminRouter.post('/datasets/:kind/versions', async (req: AdminAuthenticatedRequest, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const kind = req.params.kind;
    if (!isValidDatasetKind(kind)) {
      res.status(400).json({ error: 'Nhóm bộ dữ liệu (kind) không hợp lệ.' });
      return;
    }

    const body = req.body as { meta?: unknown; records?: unknown; activate?: unknown } | null;
    const adminEmail = req.adminUser?.email ?? 'admin';
    const validated = validateIncomingDatasetVersion(kind, body?.meta, body?.records, adminEmail);
    if (!validated.ok) {
      res.status(400).json({ error: validated.error });
      return;
    }

    try {
      const activate = body?.activate !== false;
      const savedMeta = await defaultDatasetStore.commitVersion(kind, validated.data, activate);
      const activeSnapshot = await defaultDatasetStore.getPublicActiveDatasets();
      res.status(201).json({
        ok: true,
        version: savedMeta,
        activeSnapshot,
      });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('DUPLICATE_VERSION_ID:')) {
        res.status(409).json({
          error: 'Mã phiên bản này đã tồn tại trên máy chủ. Vui lòng tạo mã phiên bản mới.',
        });
        return;
      }
      res.status(500).json({
        error: 'Không thể lưu phiên bản dữ liệu mới lên máy chủ.',
      });
    }
  });

  adminRouter.post(
    '/datasets/:kind/versions/:versionId/activate',
    async (req: AdminAuthenticatedRequest, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const { kind, versionId } = req.params;
      if (!isValidDatasetKind(kind)) {
        res.status(400).json({ error: 'Nhóm bộ dữ liệu (kind) không hợp lệ.' });
        return;
      }

      try {
        const activated = await defaultDatasetStore.activateVersion(kind, versionId);
        if (!activated) {
          res.status(404).json({ error: 'Không tìm thấy phiên bản dữ liệu cần khôi phục.' });
          return;
        }
        const activeSnapshot = await defaultDatasetStore.getPublicActiveDatasets();
        res.status(200).json({
          ok: true,
          version: activated,
          activeSnapshot,
        });
      } catch {
        res.status(500).json({
          error: 'Không thể kích hoạt lại phiên bản dữ liệu đã chọn.',
        });
      }
    }
  );

  adminRouter.get(
    '/datasets/:kind/versions/:versionId/export',
    async (req: AdminAuthenticatedRequest, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const { kind, versionId } = req.params;
      if (!isValidDatasetKind(kind)) {
        res.status(400).json({ error: 'Nhóm bộ dữ liệu (kind) không hợp lệ.' });
        return;
      }

      try {
        const version = await defaultDatasetStore.getVersionForExport(kind, versionId);
        if (!version) {
          res.status(404).json({ error: 'Không tìm thấy phiên bản dữ liệu cần xuất.' });
          return;
        }
        res.status(200).json({
          exportedAt: new Date().toISOString(),
          datasetKind: kind,
          meta: version.meta,
          records: version.records,
        });
      } catch {
        res.status(500).json({
          error: 'Không thể xuất phiên bản dữ liệu.',
        });
      }
    }
  );

  adminRouter.post('/datasets/migrate-local', async (req: AdminAuthenticatedRequest, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const body = req.body as {
      versions?: Array<{
        kind?: unknown;
        meta?: unknown;
        records?: unknown;
        wasActive?: unknown;
      }>;
      pdfDocuments?: unknown[];
    } | null;

    const rawVersions = Array.isArray(body?.versions) ? body.versions : [];
    const rawPdfs = Array.isArray(body?.pdfDocuments) ? body.pdfDocuments : [];
    const adminEmail = req.adminUser?.email ?? 'admin';

    const validatedEntries: Array<{
      kind: DatasetKind;
      payload: ValidatedVersionPayload;
      wasActive: boolean;
    }> = [];

    for (let i = 0; i < rawVersions.length; i++) {
      const item = rawVersions[i];
      if (!isValidDatasetKind(item?.kind)) {
        res.status(400).json({ error: `Phiên bản đồng bộ #${i + 1}: nhóm dữ liệu không hợp lệ.` });
        return;
      }
      const validated = validateIncomingDatasetVersion(
        item.kind,
        item.meta,
        item.records,
        adminEmail
      );
      if (!validated.ok) {
        res.status(400).json({
          error: `Phiên bản đồng bộ #${i + 1}: ${validated.error}`,
        });
        return;
      }
      validatedEntries.push({
        kind: item.kind,
        payload: validated.data,
        wasActive: item.wasActive === true,
      });
    }

    const validatedPdfs: Omit<PdfReferenceDocument, 'sessionObjectUrl'>[] = [];
    for (let i = 0; i < rawPdfs.length; i++) {
      const pdfRes = validateIncomingPdfMetadata(rawPdfs[i]);
      if (!pdfRes.ok) {
        res.status(400).json({ error: `Tài liệu PDF đồng bộ #${i + 1}: ${pdfRes.error}` });
        return;
      }
      validatedPdfs.push(pdfRes.data);
    }

    try {
      const summary = await defaultDatasetStore.migrateLocalVersions(
        validatedEntries,
        validatedPdfs
      );
      const activeSnapshot = await defaultDatasetStore.getPublicActiveDatasets();
      res.status(200).json({
        ok: true,
        ...summary,
        activeSnapshot,
      });
    } catch {
      res.status(500).json({
        error: 'Không thể đồng bộ dữ liệu cục bộ lên máy chủ.',
      });
    }
  });

  adminRouter.post('/datasets/pdfs', async (req: AdminAuthenticatedRequest, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const validated = validateIncomingPdfMetadata(req.body);
    if (!validated.ok) {
      res.status(400).json({ error: validated.error });
      return;
    }

    try {
      const saved = await defaultDatasetStore.addPdfDocument(validated.data);
      const activeSnapshot = await defaultDatasetStore.getPublicActiveDatasets();
      res.status(201).json({
        ok: true,
        pdfDocument: saved,
        activeSnapshot,
      });
    } catch {
      res.status(500).json({
        error: 'Không thể lưu thông tin tài liệu PDF trên máy chủ.',
      });
    }
  });

  adminRouter.delete('/datasets/pdfs/:id', async (req: AdminAuthenticatedRequest, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const removed = await defaultDatasetStore.removePdfDocument(req.params.id);
      if (!removed) {
        res.status(404).json({ error: 'Không tìm thấy tài liệu PDF cần xóa.' });
        return;
      }
      const activeSnapshot = await defaultDatasetStore.getPublicActiveDatasets();
      res.status(200).json({
        ok: true,
        activeSnapshot,
      });
    } catch {
      res.status(500).json({
        error: 'Không thể xóa tài liệu PDF trên máy chủ.',
      });
    }
  });

  // Deny-by-default catch-all for unimplemented /api/admin/* routes
  // (Only reachable AFTER requireAdminAuth verifies ID token + fixed admin email)
  adminRouter.all('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({
      error: 'API quản trị này chưa được triển khai.',
    });
  });

  app.use('/api/admin', adminRouter);

  // Module 3: Read GeoSnapCamera on-image GPS / timestamp overlay using server-side Gemini Vision
  app.post('/api/analyze-photo', async (req, res) => {
    try {
      const { imageBase64, mimeType } = req.body as {
        imageBase64?: string;
        mimeType?: string;
      };

      const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (
        typeof imageBase64 !== 'string' ||
        !imageBase64.trim() ||
        typeof mimeType !== 'string' ||
        !allowedMimeTypes.includes(mimeType)
      ) {
        res.status(400).json({
          error: 'Dữ liệu ảnh không hợp lệ. Chỉ hỗ trợ định dạng JPEG, PNG hoặc WEBP.',
        });
        return;
      }

      if (imageBase64.length > 14_000_000) {
        res.status(413).json({
          error: 'Dung lượng ảnh vượt quá giới hạn 10MB để phân tích OCR.',
        });
        return;
      }

      const ai = getGeminiClient();
      if (!ai) {
        res.status(503).json({
          error:
            'Chưa cấu hình GEMINI_API_KEY trên máy chủ để đọc chữ GPS in trên ảnh. Cán bộ vẫn có thể sử dụng tọa độ EXIF tự động hoặc nhập tọa độ thủ công.',
        });
        return;
      }

      const systemInstruction = [
        'Bạn là công cụ OCR trích xuất thông tin hiển thị trực tiếp trên ảnh chụp thực địa (đặc biệt là ảnh GeoSnapCamera, Timestamp Camera, GPS Map Camera).',
        'NGUYÊN TẮC BẮT BUỘC:',
        '1. CHỈ trích xuất tọa độ GPS (vĩ độ, kinh độ), ngày giờ chụp và dòng địa chỉ NẾU các thông tin này thực sự được in chữ rõ ràng trên ảnh.',
        '2. TUYỆT ĐỐI KHÔNG suy đoán, ước lượng hoặc tự tạo tọa độ GPS từ cảnh quan, biển hiệu hay tên đường nếu trên ảnh không có chữ tọa độ.',
        '3. Nếu ảnh không có chữ tọa độ GPS hiển thị trên ảnh, bắt buộc trả về hasOverlayGps = false và để trống latitude, longitude.',
        '4. Trả về đúng định dạng JSON theo schema.',
      ].join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: imageBase64,
              },
            },
            {
              text: 'Hãy đọc chính xác thông tin tọa độ GPS, ngày giờ chụp và dòng địa chỉ được in trực tiếp trên ảnh (nếu có). Không được bịa hoặc suy diễn tọa độ.',
            },
          ],
        },
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              hasOverlayGps: {
                type: Type.BOOLEAN,
                description: 'True chỉ khi trên ảnh có in chữ tọa độ kinh độ và vĩ độ rõ ràng.',
              },
              latitude: {
                type: Type.NUMBER,
                description: 'Vĩ độ thập phân (ví dụ 12.238791) nếu đọc được trực tiếp trên ảnh. Bỏ trống hoặc 0 nếu không có.',
              },
              longitude: {
                type: Type.NUMBER,
                description: 'Kinh độ thập phân (ví dụ 109.196749) nếu đọc được trực tiếp trên ảnh. Bỏ trống hoặc 0 nếu không có.',
              },
              overlayTimestamp: {
                type: Type.STRING,
                description: 'Chuỗi ngày giờ in trên ảnh nếu có, ngược lại chuỗi rỗng.',
              },
              overlayAddress: {
                type: Type.STRING,
                description: 'Chuỗi địa chỉ in trên ảnh nếu có, ngược lại chuỗi rỗng.',
              },
              rawOverlayText: {
                type: Type.STRING,
                description: 'Nguyên văn đoạn văn bản watermark/overlay đọc được trên ảnh.',
              },
              confidence: {
                type: Type.STRING,
                description: 'Mức độ rõ nét khi đọc chữ trên ảnh: cao, trung_binh, hoặc thap.',
              },
              notes: {
                type: Type.STRING,
                description: 'Ghi chú ngắn gọn bằng tiếng Việt về tình trạng đọc chữ trên ảnh.',
              },
            },
            required: ['hasOverlayGps', 'overlayTimestamp', 'overlayAddress', 'rawOverlayText', 'confidence', 'notes'],
          },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText) as {
        hasOverlayGps?: boolean;
        latitude?: number;
        longitude?: number;
        overlayTimestamp?: string;
        overlayAddress?: string;
        rawOverlayText?: string;
        confidence?: string;
        notes?: string;
      };

      const validCoords =
        Boolean(parsed.hasOverlayGps) &&
        typeof parsed.latitude === 'number' &&
        typeof parsed.longitude === 'number' &&
        Number.isFinite(parsed.latitude) &&
        Number.isFinite(parsed.longitude) &&
        Math.abs(parsed.latitude) <= 90 &&
        Math.abs(parsed.longitude) <= 180 &&
        !(parsed.latitude === 0 && parsed.longitude === 0);

      res.json({
        hasOverlayGps: validCoords,
        latitude: validCoords ? parsed.latitude : null,
        longitude: validCoords ? parsed.longitude : null,
        overlayTimestamp: typeof parsed.overlayTimestamp === 'string' ? parsed.overlayTimestamp.trim() : '',
        overlayAddress: typeof parsed.overlayAddress === 'string' ? parsed.overlayAddress.trim() : '',
        rawOverlayText: typeof parsed.rawOverlayText === 'string' ? parsed.rawOverlayText.trim() : '',
        confidence:
          parsed.confidence === 'cao' || parsed.confidence === 'trung_binh' || parsed.confidence === 'thap'
            ? parsed.confidence
            : 'thap',
        notes: typeof parsed.notes === 'string' ? parsed.notes.trim() : '',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lỗi không xác định khi phân tích ảnh.';
      res.status(502).json({
        error: `Không thể phân tích chữ in trên ảnh bằng AI OCR: ${message}`,
      });
    }
  });

  // M2: Reverse Geocode GPS coordinates into structured Khánh Hòa administrative location
  // Uses fixed allowlisted OpenStreetMap Nominatim endpoint (no arbitrary URL fetch, no API key required)
  app.post('/api/reverse-geocode', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const body = req.body as { latitude?: unknown; longitude?: unknown } | null;
    const lat = typeof body?.latitude === 'number' ? body.latitude : Number(body?.latitude);
    const lng = typeof body?.longitude === 'number' ? body.longitude : Number(body?.longitude);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180 ||
      (lat === 0 && lng === 0)
    ) {
      res.status(400).json({
        available: false,
        source: 'none',
        error: 'Tọa độ GPS không hợp lệ. Vĩ độ phải trong [-90, 90], kinh độ trong [-180, 180] và khác 0,0.',
      });
      return;
    }

    const inKhanhHoaBounds = lat >= 11.7 && lat <= 13.1 && lng >= 108.5 && lng <= 109.7;
    const resolvedAt = new Date().toISOString();

    const params = new URLSearchParams({
      format: 'jsonv2',
      lat: lat.toFixed(6),
      lon: lng.toFixed(6),
      addressdetails: '1',
      zoom: '18',
      'accept-language': 'vi',
    });
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?${params.toString()}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(nominatimUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'KhanhHoaLandLookup/1.2 (public-valuation-lookup)',
          Accept: 'application/json',
          'Accept-Language': 'vi,en;q=0.8',
        },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        res.status(200).json({
          available: false,
          source: 'nominatim_osm',
          resolvedAt,
          displayName: '',
          streetName: '',
          wardCommune: '',
          districtCity: '',
          province: '',
          country: '',
          inKhanhHoa: inKhanhHoaBounds,
          note: `Dịch vụ định danh vị trí bản đồ tạm thời phản hồi mã ${response.status}. Cán bộ có thể đối chiếu bằng địa chỉ in trên ảnh (OCR) hoặc nhập thủ công.`,
        });
        return;
      }

      const data = (await response.json()) as {
        display_name?: unknown;
        error?: unknown;
        address?: Record<string, unknown>;
      };

      if (typeof data.error === 'string' && data.error.trim()) {
        res.status(200).json({
          available: false,
          source: 'nominatim_osm',
          resolvedAt,
          displayName: '',
          streetName: '',
          wardCommune: '',
          districtCity: '',
          province: '',
          country: '',
          inKhanhHoa: inKhanhHoaBounds,
          note: 'Không tìm thấy địa chỉ hành chính tại tọa độ này trên bản đồ công khai.',
        });
        return;
      }

      const addr = data.address && typeof data.address === 'object' ? data.address : {};
      const pick = (...keys: string[]): string => {
        for (const k of keys) {
          const val = addr[k];
          if (typeof val === 'string' && val.trim()) {
            return val.trim().slice(0, 180);
          }
        }
        return '';
      };

      const streetName = pick('road', 'pedestrian', 'residential', 'footway', 'path');
      const wardCommune = pick('suburb', 'quarter', 'neighbourhood', 'village', 'hamlet', 'town');
      const districtCity = pick('city', 'city_district', 'county', 'municipality', 'state_district');
      const province = pick('state', 'province', 'region');
      const country = pick('country');
      const displayName =
        typeof data.display_name === 'string' ? data.display_name.trim().slice(0, 400) : '';

      const provNorm = province.toLowerCase();
      const inKhanhHoa =
        provNorm.includes('khánh hòa') || provNorm.includes('khanh hoa')
          ? true
          : province
          ? false
          : inKhanhHoaBounds;

      res.status(200).json({
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
          streetName || wardCommune
            ? 'Kết quả định danh từ bản đồ mở OpenStreetMap (Nominatim) chỉ mang tính hỗ trợ đối chiếu, cán bộ cần xác nhận theo Giấy chứng nhận.'
            : 'Bản đồ công khai không có đủ tên đường/xã tại tọa độ này. Vui lòng kiểm tra địa chỉ OCR trên ảnh hoặc nhập thủ công.',
      });
    } catch {
      clearTimeout(timeout);
      res.status(200).json({
        available: false,
        source: 'nominatim_osm',
        resolvedAt,
        displayName: '',
        streetName: '',
        wardCommune: '',
        districtCity: '',
        province: '',
        country: '',
        inKhanhHoa: inKhanhHoaBounds,
        note: 'Không thể kết nối dịch vụ định danh vị trí bản đồ trong thời gian cho phép. Cán bộ vẫn có thể tra cứu trực tiếp bằng địa chỉ OCR hoặc nhập thủ công.',
      });
    }
  });

  // Module 6: Inspect public listing URL metadata safely (SSRF-hardened, never spoofs blocked sites)
  app.post('/api/inspect-listing-url', async (req, res) => {
    try {
      const { url } = req.body as { url?: string };
      if (typeof url !== 'string' || !url.trim()) {
        res.status(400).json({ accessible: false, reason: 'Đường dẫn không được để trống.' });
        return;
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url.trim());
      } catch {
        res.status(400).json({ accessible: false, reason: 'Đường dẫn không đúng định dạng URL (http/https).' });
        return;
      }

      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        res.status(400).json({ accessible: false, reason: 'Chỉ chấp nhận đường dẫn giao thức http:// hoặc https://.' });
        return;
      }

      const hostname = parsedUrl.hostname.toLowerCase();
      if (
        hostname === 'localhost' ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal') ||
        net.isIP(hostname)
      ) {
        res.status(400).json({
          accessible: false,
          reason: 'Không cho phép truy cập địa chỉ nội bộ hoặc địa chỉ IP trực tiếp.',
        });
        return;
      }

      if (RESTRICTED_SOCIAL_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`))) {
        res.json({
          accessible: false,
          sourceDomain: hostname,
          reason:
            'Nguồn tin thuộc nền tảng mạng xã hội/Marketplace yêu cầu đăng nhập hoặc hạn chế truy cập tự động. Hệ thống không giả lập truy cập — vui lòng nhập thủ công thông tin tin rao bên dưới.',
        });
        return;
      }

      // Resolve DNS and reject private/loopback/link-local addresses (SSRF protection)
      try {
        const records = await dns.lookup(hostname, { all: true });
        if (!records.length || records.some((r) => isPrivateOrBlockedIp(r.address))) {
          res.status(400).json({
            accessible: false,
            reason: 'Tên miền trỏ về dải mạng nội bộ không được phép truy cập.',
          });
          return;
        }
      } catch {
        res.json({
          accessible: false,
          sourceDomain: hostname,
          reason: 'Không phân giải được tên miền của đường dẫn. Vui lòng kiểm tra lại URL hoặc nhập thủ công.',
        });
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(parsedUrl.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; KhanhHoaLandLookup/1.0)',
            Accept: 'text/html,application/xhtml+xml',
          },
        });
        clearTimeout(timeout);

        if (response.status >= 300 && response.status < 400) {
          res.json({
            accessible: false,
            sourceDomain: hostname,
            reason:
              'Trang nguồn chuyển hướng truy cập (HTTP ' +
              response.status +
              '). Vui lòng mở liên kết trực tiếp trên trình duyệt và nhập thủ công thông số tin rao.',
          });
          return;
        }

        if (!response.ok) {
          res.json({
            accessible: false,
            sourceDomain: hostname,
            reason: `Trang nguồn từ chối hoặc giới hạn truy cập tự động (HTTP ${response.status}). Hệ thống không giả lập dữ liệu — vui lòng nhập thủ công các thông tin từ tin rao.`,
          });
          return;
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.toLowerCase().includes('text/html')) {
          res.json({
            accessible: false,
            sourceDomain: hostname,
            reason: 'Đường dẫn không trả về trang web HTML công khai. Vui lòng nhập dữ liệu thủ công.',
          });
          return;
        }

        const text = (await response.text()).slice(0, 120_000);
        const titleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const descMatch =
          text.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i) ||
          text.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i);

        const cleanText = (s?: string) =>
          (s ?? '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 400);

        const pageTitle = cleanText(titleMatch?.[1]);
        const pageDescription = cleanText(descMatch?.[1]);

        if (!pageTitle && !pageDescription) {
          res.json({
            accessible: false,
            sourceDomain: hostname,
            reason:
              'Trang nguồn không cung cấp nội dung tóm tắt công khai (có thể yêu cầu JavaScript hoặc chống bot). Vui lòng nhập thủ công.',
          });
          return;
        }

        res.json({
          accessible: true,
          sourceDomain: hostname,
          pageTitle,
          pageDescription,
          note: 'Chỉ trích xuất tiêu đề và mô tả công khai để cán bộ đối chiếu. Cán bộ bắt buộc kiểm tra và tự nhập/xác nhận diện tích, giá rao bán.',
        });
      } catch {
        clearTimeout(timeout);
        res.json({
          accessible: false,
          sourceDomain: hostname,
          reason:
            'Không thể kết nối tới trang nguồn trong thời gian cho phép (hết thời gian chờ hoặc bị tường lửa chặn). Vui lòng nhập thông tin tin rao thủ công.',
        });
      }
    } catch {
      res.status(500).json({
        accessible: false,
        reason: 'Đã xảy ra lỗi hệ thống khi kiểm tra đường dẫn. Vui lòng nhập thủ công.',
      });
    }
  });

  const httpServer = http.createServer(app);

  if (isProduction) {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
