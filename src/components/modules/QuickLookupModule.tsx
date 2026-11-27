import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import exifr from 'exifr';
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  Camera,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileSearch,
  Info,
  Landmark,
  Loader2,
  MapPin,
  RefreshCw,
  RotateCcw,
  Search,
  Store,
  Upload,
} from 'lucide-react';
import { useAppData } from '../../context/AppDataContext';
import type {
  EcovisRecord,
  MarketListingRecord,
  ReverseGeocodeResult,
  StateLandPriceRecord,
} from '../../types/valuation';
import {
  buildGoogleMapsUrl,
  formatCurrencyVnd,
  formatDateTimeVi,
  isValidCoordinatePair,
  sanitizeExternalUrl,
} from '../../utils/formatters';
import {
  EMPTY_MARKET_DATA_MESSAGE,
  formatDistanceVi,
  runUnifiedLandPriceLookup,
  validateCoordinateForKhanhHoa,
  type MatchedLookupItem,
} from '../../utils/geoLookup';
import { reverseGeocodeInBrowser } from '../../utils/reverseGeocodeClient';
import { queryTargetedRecordsFromFirestore } from '../../services/firestoreDatasetStore';

interface PhotoExifSummary {
  fileName: string;
  previewUrl: string;
  latitude: number | null;
  longitude: number | null;
  capturedAt: string | null;
  cameraModel: string | null;
}

const RADIUS_OPTIONS = [
  { value: 300, label: '300 m' },
  { value: 500, label: '500 m' },
  { value: 1000, label: '1 km' },
  { value: 2000, label: '2 km' },
  { value: 5000, label: '5 km' },
];

function parseNumericCoord(val: string): number | null {
  const trimmed = val.trim().replace(',', '.');
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function formatPriceRange(min: number | null, max: number | null): string {
  if (min === null || max === null) return 'Chưa có số liệu';
  if (min === max) return formatCurrencyVnd(min);
  return `${formatCurrencyVnd(min)} – ${formatCurrencyVnd(max)}`;
}

export const QuickLookupModule: React.FC = () => {
  const {
    activeStateRecords,
    activeEcovisRecords,
    activeMarketListings,
    activeStateMeta,
    activeEcovisMeta,
    activeMarketMeta,
    activeVersionPointers,
    hasLargeDatasetRequiringTargetedQuery,
    serverDatasetStatus,
    firestoreError,
    refreshServerDatasets,
  } = useAppData();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  // Photo & EXIF state (browser-only, zero Firebase Storage upload)
  const [photo, setPhoto] = useState<PhotoExifSummary | null>(null);
  const [readingPhoto, setReadingPhoto] = useState(false);
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);

  // Reverse geocoding state (browser-only Nominatim)
  const [geocoding, setGeocoding] = useState(false);
  const [reverseGeo, setReverseGeo] = useState<ReverseGeocodeResult | null>(null);

  // Query inputs (auto-populated from EXIF + reverse geocoding, editable by user)
  const [latInput, setLatInput] = useState('');
  const [lngInput, setLngInput] = useState('');
  const [districtCity, setDistrictCity] = useState('');
  const [wardCommune, setWardCommune] = useState('');
  const [streetName, setStreetName] = useState('');
  const [landType, setLandType] = useState('');
  const [radiusMeters, setRadiusMeters] = useState(1000);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Targeted Firestore query results for datasets > 500 rows
  const [targetedRecords, setTargetedRecords] = useState<{
    statePriceRecords: StateLandPriceRecord[];
    ecovisRecords: EcovisRecord[];
    marketListings: MarketListingRecord[];
  } | null>(null);
  const [runningTargetedQuery, setRunningTargetedQuery] = useState(false);
  const [targetedQueryError, setTargetedQueryError] = useState<string | null>(null);

  // Expandable nearby rows toggle per pillar
  const [expandStateNearby, setExpandStateNearby] = useState(false);
  const [expandEcovisNearby, setExpandEcovisNearby] = useState(false);
  const [expandMarketNearby, setExpandMarketNearby] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  // Derive distinct districts/wards from loaded datasets for quick datalist suggestions
  const locationSuggestions = useMemo(() => {
    const districts = new Set<string>();
    const wards = new Set<string>();
    const streets = new Set<string>();

    for (const r of activeStateRecords) {
      if (r.districtCity) districts.add(r.districtCity);
      if (r.wardCommune && r.wardCommune !== 'Toàn huyện') wards.add(r.wardCommune);
      if (r.streetName && r.streetName !== '-') streets.add(r.streetName);
    }
    for (const r of activeEcovisRecords) {
      if (r.districtCity) districts.add(r.districtCity);
      if (r.wardCommune && r.wardCommune !== 'Toàn huyện') wards.add(r.wardCommune);
      if (r.streetName && r.streetName !== '-') streets.add(r.streetName);
    }

    return {
      districts: Array.from(districts).sort((a, b) => a.localeCompare(b, 'vi')),
      wards: Array.from(wards).sort((a, b) => a.localeCompare(b, 'vi')),
      streets: Array.from(streets).sort((a, b) => a.localeCompare(b, 'vi')),
    };
  }, [activeStateRecords, activeEcovisRecords]);

  const parsedLat = parseNumericCoord(latInput);
  const parsedLng = parseNumericCoord(lngInput);
  const coordValidation = useMemo(
    () => validateCoordinateForKhanhHoa(parsedLat, parsedLng),
    [parsedLat, parsedLng]
  );

  const needsTargetedFirestoreQuery =
    hasLargeDatasetRequiringTargetedQuery.state_price ||
    hasLargeDatasetRequiringTargetedQuery.ecovis ||
    hasLargeDatasetRequiringTargetedQuery.market_survey;

  const runReverseGeocode = useCallback(async (lat: number, lng: number) => {
    setGeocoding(true);
    try {
      const geo = await reverseGeocodeInBrowser(lat, lng);
      setReverseGeo(geo);
      if (geo.available) {
        if (geo.districtCity) setDistrictCity((prev) => prev || geo.districtCity);
        if (geo.wardCommune) setWardCommune((prev) => prev || geo.wardCommune);
        if (geo.streetName) setStreetName((prev) => prev || geo.streetName);
      }
    } finally {
      setGeocoding(false);
    }
  }, []);

  const handlePhotoSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setReadingPhoto(true);
    setPhotoNotice(null);
    setReverseGeo(null);
    setExpandStateNearby(false);
    setExpandEcovisNearby(false);
    setExpandMarketNearby(false);

    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }

    const previewUrl = URL.createObjectURL(file);
    previewUrlRef.current = previewUrl;

    try {
      let exifLat: number | null = null;
      let exifLng: number | null = null;
      let capturedAt: string | null = null;
      let cameraModel: string | null = null;

      try {
        const gps = await exifr.gps(file).catch(() => null);
        if (gps && isValidCoordinatePair(gps.latitude, gps.longitude)) {
          exifLat = Number(gps.latitude.toFixed(6));
          exifLng = Number(gps.longitude.toFixed(6));
        }
        const meta = await exifr
          .parse(file, ['DateTimeOriginal', 'CreateDate', 'Make', 'Model'])
          .catch(() => null);
        if (meta) {
          const dt = meta.DateTimeOriginal || meta.CreateDate;
          if (dt instanceof Date && !Number.isNaN(dt.getTime())) {
            capturedAt = dt.toISOString();
          } else if (typeof dt === 'string' && dt.trim()) {
            capturedAt = dt.trim();
          }
          const camParts = [meta.Make, meta.Model]
            .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
            .map((v) => v.trim());
          if (camParts.length > 0) {
            cameraModel = Array.from(new Set(camParts)).join(' ');
          }
        }
      } catch {
        // Non-EXIF image format (e.g., PNG or compressed chat photo)
      }

      setPhoto({
        fileName: file.name,
        previewUrl,
        latitude: exifLat,
        longitude: exifLng,
        capturedAt,
        cameraModel,
      });

      if (exifLat !== null && exifLng !== null) {
        setLatInput(String(exifLat));
        setLngInput(String(exifLng));
        // Clear previous address fields so new GPS reverse geocode populates fresh location
        setDistrictCity('');
        setWardCommune('');
        setStreetName('');
        void runReverseGeocode(exifLat, exifLng);
      } else {
        setLatInput('');
        setLngInput('');
        setPhotoNotice(
          'Ảnh chưa có tọa độ GPS trong EXIF (thường do ảnh bị nén qua Zalo/Messenger hoặc tắt định vị khi chụp). Vui lòng tải ảnh gốc từ GeoSnapCam hoặc nhập địa chỉ / tọa độ bên dưới.'
        );
        setShowAdvancedFilters(true);
      }
    } finally {
      setReadingPhoto(false);
    }
  };

  // Trigger targeted Firestore query automatically when any active dataset exceeds 500 rows
  useEffect(() => {
    if (!needsTargetedFirestoreQuery) {
      setTargetedRecords(null);
      setTargetedQueryError(null);
      return;
    }

    const hasInput =
      isValidCoordinatePair(parsedLat, parsedLng) ||
      Boolean(districtCity.trim() || wardCommune.trim() || streetName.trim());

    if (!hasInput) {
      setTargetedRecords(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setRunningTargetedQuery(true);
      setTargetedQueryError(null);
      try {
        const res = await queryTargetedRecordsFromFirestore({
          latitude: parsedLat,
          longitude: parsedLng,
          districtCity,
          wardCommune,
          streetName,
          activePointers: activeVersionPointers,
        });
        if (!cancelled) {
          setTargetedRecords(res);
        }
      } catch (err) {
        if (!cancelled) {
          setTargetedQueryError(
            err instanceof Error ? err.message : 'Lỗi truy vấn Cloud Firestore theo khu vực.'
          );
        }
      } finally {
        if (!cancelled) setRunningTargetedQuery(false);
      }
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    needsTargetedFirestoreQuery,
    parsedLat,
    parsedLng,
    districtCity,
    wardCommune,
    streetName,
    activeVersionPointers,
  ]);

  const effectiveStateRecords = targetedRecords?.statePriceRecords ?? activeStateRecords;
  const effectiveEcovisRecords = targetedRecords?.ecovisRecords ?? activeEcovisRecords;
  const effectiveMarketListings = targetedRecords?.marketListings ?? activeMarketListings;

  const hasAnyActiveInput =
    isValidCoordinatePair(parsedLat, parsedLng) ||
    Boolean(districtCity.trim() || wardCommune.trim() || streetName.trim());

  const lookupResult = useMemo(
    () =>
      runUnifiedLandPriceLookup({
        query: {
          latitude: parsedLat,
          longitude: parsedLng,
          districtCity,
          wardCommune,
          streetName,
          landType,
          radiusMeters,
        },
        stateRecords: effectiveStateRecords,
        ecovisRecords: effectiveEcovisRecords,
        marketListings: effectiveMarketListings,
      }),
    [
      parsedLat,
      parsedLng,
      districtCity,
      wardCommune,
      streetName,
      landType,
      radiusMeters,
      effectiveStateRecords,
      effectiveEcovisRecords,
      effectiveMarketListings,
    ]
  );

  const handleResetLookup = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPhoto(null);
    setPhotoNotice(null);
    setReverseGeo(null);
    setLatInput('');
    setLngInput('');
    setDistrictCity('');
    setWardCommune('');
    setStreetName('');
    setLandType('');
    setTargetedRecords(null);
    setTargetedQueryError(null);
    setExpandStateNearby(false);
    setExpandEcovisNearby(false);
    setExpandMarketNearby(false);
  };

  const totalDatasetsEmpty =
    serverDatasetStatus === 'synced' &&
    activeStateRecords.length === 0 &&
    activeEcovisRecords.length === 0 &&
    activeMarketListings.length === 0;

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Firestore Connection Loading / Error / Empty Banner */}
      {serverDatasetStatus === 'loading' && (
        <div className="banking-card px-4 py-3 flex items-center gap-2.5 text-sm text-[#4B5563]">
          <Loader2 className="h-4 w-4 animate-spin text-[#9D1D26] shrink-0" />
          <span>Đang tải dữ liệu giá đất chính thức từ Cloud Firestore...</span>
        </div>
      )}

      {serverDatasetStatus === 'offline' && (
        <div
          role="alert"
          className="rounded-md border border-[#E8B8BC] bg-[#FDF2F3] px-4 py-3.5 text-sm text-[#641016] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 text-[#9D1D26] shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div className="font-semibold">Không thể tải dữ liệu từ Cloud Firestore</div>
              <div className="text-[13px] leading-relaxed">
                {firestoreError ||
                  'Vui lòng kiểm tra kết nối mạng hoặc thử tải lại dữ liệu.'}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refreshServerDatasets()}
            className="banking-btn-secondary shrink-0 !min-h-[38px] !px-3 !text-[13px]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Thử lại
          </button>
        </div>
      )}

      {totalDatasetsEmpty && (
        <div className="rounded-md border border-[#E5D3A8] bg-[#FFFBEB] px-4 py-3 text-[13px] text-[#784A0A] flex items-start gap-2.5">
          <Info className="h-4 w-4 shrink-0 mt-0.5 text-[#B45309]" />
          <div>
            Kho dữ liệu Cloud Firestore hiện chưa có phiên bản giá đất nào được kích hoạt. Khi Quản trị viên nạp và kích hoạt dữ liệu chính thức, kết quả sẽ hiển thị ngay tại đây.
          </div>
        </div>
      )}

      {/* STEP 1: GeoSnapCam Photo Upload & GPS Extraction */}
      <section className="banking-card overflow-hidden">
        <div className="px-4 py-3.5 sm:px-5 sm:py-4 border-b border-[#E2E5E9] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#FDF2F3] border border-[#E8B8BC] text-[#9D1D26]">
              <Camera className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-[#1F2429]">
                1. Chụp hoặc tải ảnh GeoSnapCam có GPS
              </h2>
              <p className="text-xs text-[#6B7280]">
                Ảnh chỉ được đọc GPS EXIF ngay trên thiết bị, không tải ảnh lên máy chủ.
              </p>
            </div>
          </div>

          {(photo || hasAnyActiveInput) && (
            <button
              type="button"
              onClick={handleResetLookup}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#4B5563] hover:text-[#9D1D26] px-2.5 py-2 rounded-md border border-[#E2E5E9] bg-white cursor-pointer shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Làm mới
            </button>
          )}
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => void handlePhotoSelected(e)}
            className="hidden"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              disabled={readingPhoto}
              onClick={() => fileInputRef.current?.click()}
              className="banking-btn-primary w-full !min-h-[48px]"
            >
              {readingPhoto ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              <span>{photo ? 'Chọn ảnh GeoSnapCam khác' : 'Tải ảnh GeoSnapCam từ máy'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowAdvancedFilters((prev) => !prev)}
              className="banking-btn-secondary w-full !min-h-[48px]"
            >
              <Search className="h-4 w-4" />
              <span>
                {showAdvancedFilters
                  ? 'Thu gọn nhập địa chỉ / tọa độ'
                  : 'Hoặc nhập địa chỉ / tọa độ thủ công'}
              </span>
            </button>
          </div>

          {/* Photo Preview + EXIF GPS Readout */}
          {photo && (
            <div className="rounded-md border border-[#E2E5E9] bg-[#F8F9FA] p-3.5 flex flex-col sm:flex-row gap-3.5">
              <img
                src={photo.previewUrl}
                alt={photo.fileName}
                className="h-36 w-full sm:h-28 sm:w-36 object-cover rounded-md border border-[#E2E5E9] shrink-0 bg-white"
              />
              <div className="flex-1 min-w-0 space-y-2 text-[13px]">
                <div className="font-medium text-[#1F2429] truncate">{photo.fileName}</div>

                {photo.latitude !== null && photo.longitude !== null ? (
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="inline-flex items-center gap-1 font-mono font-semibold text-[#0B5D3F]">
                        <MapPin className="h-3.5 w-3.5" />
                        {photo.latitude.toFixed(6)}, {photo.longitude.toFixed(6)}
                      </span>
                      {buildGoogleMapsUrl(photo.latitude, photo.longitude) && (
                        <a
                          href={buildGoogleMapsUrl(photo.latitude, photo.longitude)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#9D1D26] hover:underline"
                        >
                          Mở Google Maps
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="text-xs text-[#6B7280] flex flex-wrap gap-x-3 gap-y-0.5">
                      {photo.capturedAt && <span>Chụp lúc: {formatDateTimeVi(photo.capturedAt)}</span>}
                      {photo.cameraModel && <span>Thiết bị: {photo.cameraModel}</span>}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-[#9D1D26] font-medium">
                    Không tìm thấy tọa độ GPS trong EXIF của tệp ảnh này.
                  </div>
                )}

                {geocoding && (
                  <div className="inline-flex items-center gap-1.5 text-xs text-[#4B5563]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[#0B5D3F]" />
                    Đang xác định tuyến đường và địa bàn hành chính từ GPS...
                  </div>
                )}

                {!geocoding && reverseGeo?.available && (
                  <div className="text-xs text-[#1F2429] bg-white border border-[#E2E5E9] rounded px-2.5 py-2">
                    <span className="font-semibold text-[#0B5D3F]">Vị trí gợi ý: </span>
                    <span>{reverseGeo.displayName}</span>
                  </div>
                )}

                {!geocoding && reverseGeo && !reverseGeo.available && (
                  <div className="text-xs text-[#784A0A]">{reverseGeo.note}</div>
                )}
              </div>
            </div>
          )}

          {photoNotice && (
            <div className="rounded-md border border-[#E5D3A8] bg-[#FFFBEB] px-3.5 py-2.5 text-[13px] text-[#784A0A] flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-[#B45309]" />
              <span>{photoNotice}</span>
            </div>
          )}

          {coordValidation.status === 'outside_khanh_hoa' && (
            <div className="rounded-md border border-[#E8B8BC] bg-[#FDF2F3] px-3.5 py-2.5 text-[13px] text-[#641016] flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-[#9D1D26]" />
              <span>{coordValidation.message}</span>
            </div>
          )}

          {/* Location Confirmation / Manual Input Panel */}
          {(showAdvancedFilters || photo !== null || hasAnyActiveInput) && (
            <div className="pt-3 border-t border-[#E2E5E9] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-[#1F2429]">
                  Xác nhận địa bàn &amp; tuyến đường tra cứu
                </h3>
                {isValidCoordinatePair(parsedLat, parsedLng) && !geocoding && (
                  <button
                    type="button"
                    onClick={() => void runReverseGeocode(parsedLat!, parsedLng!)}
                    className="text-xs font-medium text-[#0B5D3F] hover:underline cursor-pointer"
                  >
                    Định danh lại từ GPS
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="lookup-district" className="banking-label">
                    Huyện / Thị xã / TP
                  </label>
                  <input
                    id="lookup-district"
                    list="khanh-hoa-districts"
                    value={districtCity}
                    onChange={(e) => setDistrictCity(e.target.value)}
                    placeholder="VD: Huyện Khánh Sơn, TP. Nha Trang"
                    className="banking-input"
                  />
                  <datalist id="khanh-hoa-districts">
                    {locationSuggestions.districts.map((d) => (
                      <option key={d} value={d} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label htmlFor="lookup-ward" className="banking-label">
                    Xã / Phường / Thị trấn
                  </label>
                  <input
                    id="lookup-ward"
                    list="khanh-hoa-wards"
                    value={wardCommune}
                    onChange={(e) => setWardCommune(e.target.value)}
                    placeholder="VD: Thị trấn Tô Hạp"
                    className="banking-input"
                  />
                  <datalist id="khanh-hoa-wards">
                    {locationSuggestions.wards.map((w) => (
                      <option key={w} value={w} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label htmlFor="lookup-street" className="banking-label">
                    Tên đường / Tuyến đường
                  </label>
                  <input
                    id="lookup-street"
                    list="khanh-hoa-streets"
                    value={streetName}
                    onChange={(e) => setStreetName(e.target.value)}
                    placeholder="VD: Trần Phú, Âu Cơ..."
                    className="banking-input"
                  />
                  <datalist id="khanh-hoa-streets">
                    {locationSuggestions.streets.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label htmlFor="lookup-landtype" className="banking-label">
                    Loại đất (tùy chọn)
                  </label>
                  <input
                    id="lookup-landtype"
                    value={landType}
                    onChange={(e) => setLandType(e.target.value)}
                    placeholder="VD: Đất ở, Đất trồng cây lâu năm"
                    className="banking-input"
                  />
                </div>

                <div>
                  <label htmlFor="lookup-lat" className="banking-label">
                    Vĩ độ (Latitude)
                  </label>
                  <input
                    id="lookup-lat"
                    inputMode="decimal"
                    value={latInput}
                    onChange={(e) => setLatInput(e.target.value)}
                    placeholder="12.025000"
                    className="banking-input font-mono"
                  />
                </div>

                <div>
                  <label htmlFor="lookup-lng" className="banking-label">
                    Kinh độ (Longitude)
                  </label>
                  <input
                    id="lookup-lng"
                    inputMode="decimal"
                    value={lngInput}
                    onChange={(e) => setLngInput(e.target.value)}
                    placeholder="108.918000"
                    className="banking-input font-mono"
                  />
                </div>

                <div>
                  <label htmlFor="lookup-radius" className="banking-label">
                    Bán kính lân cận (GPS)
                  </label>
                  <select
                    id="lookup-radius"
                    value={radiusMeters}
                    onChange={(e) => setRadiusMeters(Number(e.target.value))}
                    className="banking-input"
                  >
                    {RADIUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Targeted Firestore Query Feedback (for datasets > 500 rows) */}
      {runningTargetedQuery && (
        <div className="banking-card px-4 py-3 flex items-center gap-2 text-sm text-[#4B5563]">
          <Loader2 className="h-4 w-4 animate-spin text-[#0B5D3F]" />
          <span>Đang truy vấn vị trí trên Cloud Firestore...</span>
        </div>
      )}

      {targetedQueryError && (
        <div className="rounded-md border border-[#E8B8BC] bg-[#FDF2F3] px-4 py-3 text-[13px] text-[#641016]">
          {targetedQueryError}
        </div>
      )}

      {/* STEP 2: Three Independent Land Price Pillars */}
      {!hasAnyActiveInput ? (
        <section className="banking-card p-6 sm:p-8 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-md bg-[#F6F7F8] border border-[#E2E5E9] text-[#4B5563]">
            <FileSearch className="h-5 w-5" />
          </div>
          <h2 className="mt-3 text-[15px] font-semibold text-[#1F2429]">
            Sẵn sàng tra cứu giá đất Khánh Hòa
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[#6B7280] max-w-lg mx-auto">
            Tải ảnh chụp từ GeoSnapCam (có tọa độ GPS EXIF) hoặc nhập Huyện / Xã / Tên tuyến đường để đối chiếu độc lập 3 nhóm giá: Giá đất Nhà nước, Giá ECOVIS và Giá tham khảo thị trường.
          </p>
          <div className="mt-4 pt-4 border-t border-[#E2E5E9] grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs text-[#4B5563] max-w-2xl mx-auto">
            <div className="rounded border border-[#E2E5E9] bg-[#F8F9FA] px-3 py-2">
              <div className="font-semibold text-[#1F2429]">Bảng giá Nhà nước</div>
              <div className="mt-0.5 font-mono">
                {activeStateMeta
                  ? `${activeStateMeta.rowCount.toLocaleString('vi-VN')} bản ghi`
                  : 'Chưa nạp dữ liệu'}
              </div>
            </div>
            <div className="rounded border border-[#E2E5E9] bg-[#F8F9FA] px-3 py-2">
              <div className="font-semibold text-[#1F2429]">Khảo sát ECOVIS</div>
              <div className="mt-0.5 font-mono">
                {activeEcovisMeta
                  ? `${activeEcovisMeta.rowCount.toLocaleString('vi-VN')} bản ghi`
                  : 'Chưa nạp dữ liệu'}
              </div>
            </div>
            <div className="rounded border border-[#E2E5E9] bg-[#F8F9FA] px-3 py-2">
              <div className="font-semibold text-[#1F2429]">Tham khảo thị trường</div>
              <div className="mt-0.5 font-mono">
                {activeMarketMeta
                  ? `${activeMarketMeta.rowCount.toLocaleString('vi-VN')} tin rao`
                  : 'Chưa có số liệu'}
              </div>
            </div>
          </div>
        </section>
      ) : (
        <div className="space-y-4">
          {/* Missing-GPS dataset honest explanation notice */}
          {lookupResult.hasQueryCoords &&
            effectiveStateRecords.length + effectiveEcovisRecords.length > 0 &&
            lookupResult.statePrice.datasetSpatialCount === 0 &&
            lookupResult.ecovis.datasetSpatialCount === 0 && (
              <div className="rounded-md border border-[#D4E4DC] bg-[#F2F8F5] px-4 py-3 text-[13px] text-[#174632] flex items-start gap-2.5">
                <Info className="h-4 w-4 shrink-0 mt-0.5 text-[#0B5D3F]" />
                <span>
                  Dữ liệu Nhà nước và ECOVIS hiện hành được lập theo tuyến đường &amp; địa bàn hành chính (chưa có tọa độ GPS cho từng tuyến). Hệ thống đang đối chiếu theo địa bàn đã xác định từ tọa độ GPS của ảnh.
                </span>
              </div>
            )}

          {/* 3-Pillar Top Summary Strip */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {/* Summary 1: State Price */}
            <div className="banking-card p-4">
              <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[#9D1D26]">
                <span className="inline-flex items-center gap-1.5">
                  <Landmark className="h-3.5 w-3.5" />
                  1. GIÁ ĐẤT NHÀ NƯỚC
                </span>
                <span className="font-mono text-[#6B7280]">
                  {lookupResult.statePrice.exactMatches.length > 0
                    ? `${lookupResult.statePrice.exactMatches.length} đúng vị trí`
                    : `${lookupResult.statePrice.nearbyMatches.length} lân cận`}
                </span>
              </div>
              <div className="mt-2 banking-figure text-lg font-bold text-[#1F2429]">
                {lookupResult.statePrice.exactMatches.length > 0
                  ? formatPriceRange(
                      lookupResult.statePrice.exactStats.min,
                      lookupResult.statePrice.exactStats.max
                    )
                  : lookupResult.statePrice.nearbyMatches.length > 0
                  ? formatPriceRange(
                      lookupResult.statePrice.nearbyStats.min,
                      lookupResult.statePrice.nearbyStats.max
                    )
                  : 'Chưa có dữ liệu khớp'}
              </div>
              <div className="mt-1 text-xs text-[#6B7280] truncate">
                {activeStateMeta
                  ? `${activeStateMeta.sourceDocumentName} (${activeStateMeta.effectiveDate})`
                  : 'Chưa có phiên bản Nhà nước'}
              </div>
            </div>

            {/* Summary 2: ECOVIS */}
            <div className="banking-card p-4">
              <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[#0B5D3F]">
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" />
                  2. GIÁ ĐẤT ECOVIS
                </span>
                <span className="font-mono text-[#6B7280]">
                  {lookupResult.ecovis.exactMatches.length > 0
                    ? `${lookupResult.ecovis.exactMatches.length} đúng vị trí`
                    : `${lookupResult.ecovis.nearbyMatches.length} lân cận`}
                </span>
              </div>
              <div className="mt-2 banking-figure text-lg font-bold text-[#1F2429]">
                {lookupResult.ecovis.exactMatches.length > 0
                  ? formatPriceRange(
                      lookupResult.ecovis.exactStats.min,
                      lookupResult.ecovis.exactStats.max
                    )
                  : lookupResult.ecovis.nearbyMatches.length > 0
                  ? formatPriceRange(
                      lookupResult.ecovis.nearbyStats.min,
                      lookupResult.ecovis.nearbyStats.max
                    )
                  : 'Chưa có dữ liệu khớp'}
              </div>
              <div className="mt-1 text-xs text-[#6B7280] truncate">
                {activeEcovisMeta
                  ? `${activeEcovisMeta.sourceDocumentName} (${activeEcovisMeta.effectiveDate})`
                  : 'Chưa có phiên bản ECOVIS'}
              </div>
            </div>

            {/* Summary 3: Market */}
            <div className="banking-card p-4">
              <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[#374151]">
                <span className="inline-flex items-center gap-1.5">
                  <Store className="h-3.5 w-3.5" />
                  3. GIÁ THAM KHẢO THỊ TRƯỜNG
                </span>
                <span className="font-mono text-[#6B7280]">
                  {lookupResult.market.exactMatches.length > 0
                    ? `${lookupResult.market.exactMatches.length} đúng vị trí`
                    : `${lookupResult.market.nearbyMatches.length} lân cận`}
                </span>
              </div>
              <div className="mt-2 banking-figure text-lg font-bold text-[#1F2429]">
                {lookupResult.market.exactMatches.length > 0
                  ? formatPriceRange(
                      lookupResult.market.exactStats.min,
                      lookupResult.market.exactStats.max
                    )
                  : lookupResult.market.nearbyMatches.length > 0
                  ? formatPriceRange(
                      lookupResult.market.nearbyStats.min,
                      lookupResult.market.nearbyStats.max
                    )
                  : 'Chưa có số liệu'}
              </div>
              <div className="mt-1 text-xs text-[#6B7280] truncate">
                {lookupResult.market.exactMatches.length > 0 ||
                lookupResult.market.nearbyMatches.length > 0
                  ? 'Giá rao bán tham khảo (không phải giao dịch thành công)'
                  : EMPTY_MARKET_DATA_MESSAGE}
              </div>
            </div>
          </div>

          {/* DETAILED PILLAR 1: STATE LAND PRICE */}
          <section className="banking-card overflow-hidden">
            <div className="px-4 py-3.5 sm:px-5 border-b border-[#E2E5E9] flex flex-wrap items-center justify-between gap-2 bg-white">
              <div className="flex items-center gap-2">
                <Landmark className="h-4 w-4 text-[#9D1D26]" />
                <h3 className="text-[15px] font-semibold text-[#1F2429]">
                  Bảng giá đất Nhà nước
                </h3>
              </div>
              {activeStateMeta && (
                <span className="text-xs text-[#6B7280]">
                  Nguồn: <strong className="text-[#1F2429]">{activeStateMeta.sourceDocumentName}</strong> · Hiệu lực: {activeStateMeta.effectiveDate}
                </span>
              )}
            </div>

            <div className="p-4 sm:p-5 space-y-3">
              {lookupResult.statePrice.exactMatches.length > 0 ? (
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#0B5D3F]">
                    Khớp đúng vị trí ({lookupResult.statePrice.exactMatches.length} bản ghi)
                  </div>
                  <div className="divide-y divide-[#E2E5E9] rounded-md border border-[#E2E5E9]">
                    {lookupResult.statePrice.exactMatches.slice(0, 12).map((item) => (
                      <StatePriceRow key={item.record.id} item={item} />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-[13px] text-[#4B5563]">
                  {lookupResult.statePrice.missingDataReason ||
                    'Chưa có bản ghi Bảng giá đất Nhà nước khớp đúng vị trí này.'}
                </div>
              )}

              {lookupResult.statePrice.nearbyMatches.length > 0 && (
                <div className="pt-2 border-t border-[#E2E5E9]">
                  <button
                    type="button"
                    onClick={() => setExpandStateNearby((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#9D1D26] hover:underline cursor-pointer"
                  >
                    {expandStateNearby ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                    Tham chiếu khu vực lân cận ({lookupResult.statePrice.nearbyMatches.length} bản ghi)
                  </button>
                  {expandStateNearby && (
                    <div className="mt-2.5 divide-y divide-[#E2E5E9] rounded-md border border-[#E2E5E9]">
                      {lookupResult.statePrice.nearbyMatches.slice(0, 15).map((item) => (
                        <StatePriceRow key={item.record.id} item={item} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* DETAILED PILLAR 2: ECOVIS */}
          <section className="banking-card overflow-hidden">
            <div className="px-4 py-3.5 sm:px-5 border-b border-[#E2E5E9] flex flex-wrap items-center justify-between gap-2 bg-white">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-[#0B5D3F]" />
                <h3 className="text-[15px] font-semibold text-[#1F2429]">
                  Giá đất khảo sát ECOVIS
                </h3>
              </div>
              {activeEcovisMeta && (
                <span className="text-xs text-[#6B7280]">
                  Nguồn: <strong className="text-[#1F2429]">{activeEcovisMeta.sourceDocumentName}</strong> · Ngày: {activeEcovisMeta.effectiveDate}
                </span>
              )}
            </div>

            <div className="p-4 sm:p-5 space-y-3">
              {lookupResult.ecovis.exactMatches.length > 0 ? (
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#0B5D3F]">
                    Khớp đúng vị trí ({lookupResult.ecovis.exactMatches.length} bản ghi)
                  </div>
                  <div className="divide-y divide-[#E2E5E9] rounded-md border border-[#E2E5E9]">
                    {lookupResult.ecovis.exactMatches.slice(0, 12).map((item) => (
                      <EcovisRow key={item.record.id} item={item} />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-[13px] text-[#4B5563]">
                  {lookupResult.ecovis.missingDataReason ||
                    'Chưa có bản ghi khảo sát ECOVIS khớp đúng vị trí này.'}
                </div>
              )}

              {lookupResult.ecovis.nearbyMatches.length > 0 && (
                <div className="pt-2 border-t border-[#E2E5E9]">
                  <button
                    type="button"
                    onClick={() => setExpandEcovisNearby((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#0B5D3F] hover:underline cursor-pointer"
                  >
                    {expandEcovisNearby ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                    Tham chiếu khu vực lân cận ({lookupResult.ecovis.nearbyMatches.length} bản ghi)
                  </button>
                  {expandEcovisNearby && (
                    <div className="mt-2.5 divide-y divide-[#E2E5E9] rounded-md border border-[#E2E5E9]">
                      {lookupResult.ecovis.nearbyMatches.slice(0, 15).map((item) => (
                        <EcovisRow key={item.record.id} item={item} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* DETAILED PILLAR 3: MARKET REFERENCE */}
          <section className="banking-card overflow-hidden">
            <div className="px-4 py-3.5 sm:px-5 border-b border-[#E2E5E9] flex flex-wrap items-center justify-between gap-2 bg-white">
              <div className="flex items-center gap-2">
                <Store className="h-4 w-4 text-[#374151]" />
                <h3 className="text-[15px] font-semibold text-[#1F2429]">
                  Giá thị trường tham khảo
                </h3>
              </div>
              <span className="text-xs text-[#6B7280]">
                Chỉ mang tính chất tham khảo · Giá rao bán, không phải giá giao dịch thành công
              </span>
            </div>

            <div className="p-4 sm:p-5 space-y-3">
              {lookupResult.market.exactMatches.length > 0 ? (
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#0B5D3F]">
                    Tin rao bán cùng vị trí ({lookupResult.market.exactMatches.length} tin)
                  </div>
                  <div className="divide-y divide-[#E2E5E9] rounded-md border border-[#E2E5E9]">
                    {lookupResult.market.exactMatches.slice(0, 10).map((item) => (
                      <MarketRow key={item.record.id} item={item} />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-[#E2E5E9] bg-[#F8F9FA] px-4 py-3 text-sm font-medium text-[#1F2429]">
                  {EMPTY_MARKET_DATA_MESSAGE}
                </div>
              )}

              {lookupResult.market.nearbyMatches.length > 0 && (
                <div className="pt-2 border-t border-[#E2E5E9]">
                  <button
                    type="button"
                    onClick={() => setExpandMarketNearby((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#374151] hover:text-[#9D1D26] hover:underline cursor-pointer"
                  >
                    {expandMarketNearby ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                    Tham chiếu khu vực lân cận ({lookupResult.market.nearbyMatches.length} tin rao bán)
                  </button>
                  {expandMarketNearby && (
                    <div className="mt-2.5 divide-y divide-[#E2E5E9] rounded-md border border-[#E2E5E9]">
                      {lookupResult.market.nearbyMatches.slice(0, 10).map((item) => (
                        <MarketRow key={item.record.id} item={item} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

const StatePriceRow: React.FC<{ item: MatchedLookupItem<StateLandPriceRecord> }> = ({ item }) => {
  const { record, distanceMeters, matchReason } = item;
  return (
    <div className="p-3.5 bg-white flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2.5">
      <div className="min-w-0 space-y-1">
        <div className="text-sm font-semibold text-[#1F2429]">
          {record.streetName !== '-' ? record.streetName : record.landType}
          {record.roadSegment ? (
            <span className="font-normal text-[#4B5563]"> · {record.roadSegment}</span>
          ) : null}
        </div>
        <div className="text-xs text-[#4B5563] flex flex-wrap gap-x-3 gap-y-0.5">
          <span>
            Địa bàn: <strong className="text-[#1F2429]">{record.wardCommune}</strong>
            {record.districtCity ? `, ${record.districtCity}` : ''}
          </span>
          <span>Loại đất: {record.landType}</span>
          <span>Vị trí: {record.position}</span>
        </div>
        <div className="text-[11px] text-[#6B7280] flex flex-wrap gap-x-3 gap-y-0.5">
          <span>
            Nguồn: {record.legalDocumentName} ({record.sourcePageOrAppendix})
          </span>
          <span>Hiệu lực: {record.effectiveDate}</span>
          {distanceMeters !== null && <span>Cách {formatDistanceVi(distanceMeters)}</span>}
          <span className="text-[#0B5D3F]">{matchReason}</span>
        </div>
      </div>
      <div className="sm:text-right shrink-0">
        <div className="banking-figure text-base font-bold text-[#9D1D26]">
          {formatCurrencyVnd(record.unitPrice)}
        </div>
        <div className="text-[11px] text-[#6B7280]">{record.unit || 'đ/m²'}</div>
      </div>
    </div>
  );
};

const EcovisRow: React.FC<{ item: MatchedLookupItem<EcovisRecord> }> = ({ item }) => {
  const { record, distanceMeters, matchReason } = item;
  return (
    <div className="p-3.5 bg-white flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2.5">
      <div className="min-w-0 space-y-1">
        <div className="text-sm font-semibold text-[#1F2429]">
          {record.streetName !== '-' ? record.streetName : record.landType}
          {record.roadSegment ? (
            <span className="font-normal text-[#4B5563]"> · {record.roadSegment}</span>
          ) : null}
        </div>
        <div className="text-xs text-[#4B5563] flex flex-wrap gap-x-3 gap-y-0.5">
          <span>
            Địa bàn: <strong className="text-[#1F2429]">{record.wardCommune || 'Toàn địa bàn'}</strong>
            {record.districtCity ? `, ${record.districtCity}` : ''}
          </span>
          <span>Loại đất: {record.landType}</span>
          <span>Vị trí: {record.position}</span>
        </div>
        <div className="text-[11px] text-[#6B7280] flex flex-wrap gap-x-3 gap-y-0.5">
          <span>
            Nguồn: {record.sourceDocument} ({record.appendixAndPage})
          </span>
          <span>Ngày khảo sát: {record.surveyOrReportDate}</span>
          {distanceMeters !== null && <span>Cách {formatDistanceVi(distanceMeters)}</span>}
          <span className="text-[#0B5D3F]">{matchReason}</span>
        </div>
      </div>
      <div className="sm:text-right shrink-0">
        <div className="banking-figure text-base font-bold text-[#0B5D3F]">
          {formatCurrencyVnd(record.surveyUnitPrice)}
        </div>
        <div className="text-[11px] text-[#6B7280]">{record.unit || 'đ/m²'}</div>
      </div>
    </div>
  );
};

const MarketRow: React.FC<{ item: MatchedLookupItem<MarketListingRecord> }> = ({ item }) => {
  const { record, distanceMeters, matchReason } = item;
  const safeUrl = sanitizeExternalUrl(record.url);
  return (
    <div className="p-3.5 bg-white flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2.5">
      <div className="min-w-0 space-y-1">
        <div className="text-sm font-semibold text-[#1F2429]">{record.address}</div>
        <div className="text-xs text-[#4B5563] flex flex-wrap gap-x-3 gap-y-0.5">
          {record.wardCommune && <span>Xã/Phường: {record.wardCommune}</span>}
          {record.areaSqm && <span>Diện tích: {record.areaSqm.toLocaleString('vi-VN')} m²</span>}
          {record.askingPriceVnd && <span>Tổng giá rao: {formatCurrencyVnd(record.askingPriceVnd)}</span>}
          <span>Loại BĐS: {record.propertyType}</span>
        </div>
        <div className="text-[11px] text-[#6B7280] flex flex-wrap gap-x-3 gap-y-0.5">
          <span>Nguồn tin: {record.sourceName}</span>
          <span>Ngày đăng: {record.postedDate}</span>
          {distanceMeters !== null && <span>Cách {formatDistanceVi(distanceMeters)}</span>}
          <span className="text-[#0B5D3F]">{matchReason}</span>
          {safeUrl && (
            <a
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-[#9D1D26] hover:underline"
            >
              Xem tin gốc
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
      <div className="sm:text-right shrink-0">
        <div className="banking-figure text-base font-bold text-[#1F2429]">
          {record.unitPricePerSqm ? formatCurrencyVnd(record.unitPricePerSqm) : '—'}
        </div>
        <div className="text-[11px] text-[#6B7280]">đ/m² (Giá rao bán)</div>
      </div>
    </div>
  );
};
