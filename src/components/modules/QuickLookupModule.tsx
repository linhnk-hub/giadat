import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Camera,
  Check,
  CheckCircle2,
  ExternalLink,
  FileText,
  Landmark,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Scale,
  ScanText,
  Search,
  Upload,
} from 'lucide-react';
import { useAppData } from '../../context/AppDataContext';
import {
  CoordinateSourceType,
  FieldPhotoItem,
  ReverseGeocodeResult,
} from '../../types/valuation';
import { buildApiUrl } from '../../utils/apiClient';
import { fileToDataUrl, parseImageExif } from '../../utils/exifParser';
import {
  buildGoogleMapsUrl,
  formatCoordinate,
  formatCurrencyVnd,
  formatDateTimeVi,
  formatNumberVi,
  getCoordinateSourceLabel,
  isValidCoordinatePair,
  sanitizeExternalUrl,
} from '../../utils/formatters';
import {
  detectExifOcrConflict,
  detectMultiPhotoDispersion,
  formatDistanceVi,
  parseVietnameseAddressText,
  PriceRangeStats,
  runUnifiedLandPriceLookup,
  validateCoordinateForKhanhHoa,
} from '../../utils/geoLookup';
import { navigateToPath } from '../../utils/navigation';
import { BankingAlert, BankingPageHeader, MatchTierIndicator } from '../ui/BankingPrimitives';

const RADIUS_OPTIONS = [500, 1000, 2000, 5000] as const;

function formatPriceRange(stats: PriceRangeStats): string {
  if (stats.count === 0 || stats.min === null || stats.max === null) {
    return 'Chưa có dữ liệu';
  }
  if (stats.min === stats.max) {
    return formatCurrencyVnd(stats.min);
  }
  return `${formatCurrencyVnd(stats.min)} – ${formatCurrencyVnd(stats.max)}`;
}

export const QuickLookupModule: React.FC = () => {
  const {
    activeDossier,
    activeStateRecords,
    activeEcovisRecords,
    activeMarketListings,
    isDemoMode,
    setIsDemoMode,
    setActiveModule,
    addFieldPhotos,
    updateFieldPhoto,
    updateParcelInfo,
    attachStateReference,
    attachEcovisReference,
    toggleAttachMarketListing,
  } = useAppData();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(
    () => activeDossier.photos[0]?.id ?? null
  );

  const selectedPhoto: FieldPhotoItem | null = useMemo(() => {
    if (activeDossier.photos.length === 0) return null;
    return (
      activeDossier.photos.find((p) => p.id === selectedPhotoId) ??
      activeDossier.photos[0] ??
      null
    );
  }, [activeDossier.photos, selectedPhotoId]);

  const [manualLatStr, setManualLatStr] = useState<string>('');
  const [manualLngStr, setManualLngStr] = useState<string>('');
  const [streetName, setStreetName] = useState<string>(activeDossier.parcel.streetName || '');
  const [wardCommune, setWardCommune] = useState<string>(activeDossier.parcel.wardCommune || '');
  const [districtCity, setDistrictCity] = useState<string>(activeDossier.parcel.districtCity || '');
  const [roadSegment, setRoadSegment] = useState<string>(activeDossier.parcel.roadSegmentRef || '');
  const [landType, setLandType] = useState<string>(activeDossier.parcel.landTypeCertificate || '');
  const [radiusMeters, setRadiusMeters] = useState<number>(1000);

  const [processingUpload, setProcessingUpload] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [geocodeLoading, setGeocodeLoading] = useState(false);
  const [pipelineMessage, setPipelineMessage] = useState<string | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [parcelSyncNotice, setParcelSyncNotice] = useState<string | null>(null);
  const [activeResultTab, setActiveResultTab] = useState<'state' | 'ecovis' | 'market'>('state');

  const effectiveCoords = useMemo(() => {
    const manualLat =
      manualLatStr.trim() !== '' ? Number(manualLatStr.trim().replace(',', '.')) : null;
    const manualLng =
      manualLngStr.trim() !== '' ? Number(manualLngStr.trim().replace(',', '.')) : null;

    if (manualLatStr.trim() !== '' || manualLngStr.trim() !== '') {
      return {
        latitude: manualLat !== null && Number.isFinite(manualLat) ? manualLat : null,
        longitude: manualLng !== null && Number.isFinite(manualLng) ? manualLng : null,
        sourceLabel: 'Tọa độ nhập trong khung tra cứu',
      };
    }

    if (selectedPhoto && isValidCoordinatePair(selectedPhoto.activeLatitude, selectedPhoto.activeLongitude)) {
      return {
        latitude: selectedPhoto.activeLatitude,
        longitude: selectedPhoto.activeLongitude,
        sourceLabel: getCoordinateSourceLabel(selectedPhoto.coordinateSource),
      };
    }

    return {
      latitude: null,
      longitude: null,
      sourceLabel: 'Chưa có tọa độ GPS',
    };
  }, [manualLatStr, manualLngStr, selectedPhoto]);

  const exifOcrConflict = useMemo(
    () => (selectedPhoto ? detectExifOcrConflict(selectedPhoto) : null),
    [selectedPhoto]
  );

  const multiPhotoDispersion = useMemo(
    () => detectMultiPhotoDispersion(activeDossier.photos),
    [activeDossier.photos]
  );

  const coordValidation = useMemo(
    () => validateCoordinateForKhanhHoa(effectiveCoords.latitude, effectiveCoords.longitude),
    [effectiveCoords]
  );

  const lookupResult = useMemo(
    () =>
      runUnifiedLandPriceLookup({
        query: {
          latitude: effectiveCoords.latitude,
          longitude: effectiveCoords.longitude,
          streetName,
          wardCommune,
          districtCity,
          roadSegment,
          landType,
          radiusMeters,
        },
        stateRecords: activeStateRecords,
        ecovisRecords: activeEcovisRecords,
        marketListings: activeMarketListings,
      }),
    [
      effectiveCoords,
      streetName,
      wardCommune,
      districtCity,
      roadSegment,
      landType,
      radiusMeters,
      activeStateRecords,
      activeEcovisRecords,
      activeMarketListings,
    ]
  );

  const hydrateLocationFields = (
    reverseGeo: ReverseGeocodeResult | null | undefined,
    ocrAddressText: string | null | undefined,
    forceReplace = false
  ) => {
    const parsedOcr = parseVietnameseAddressText(ocrAddressText);
    const nextStreet = reverseGeo?.streetName || parsedOcr.streetName || '';
    const nextWard = reverseGeo?.wardCommune || parsedOcr.wardCommune || '';
    const nextDistrict = reverseGeo?.districtCity || parsedOcr.districtCity || '';

    if (nextStreet && (forceReplace || !streetName.trim())) setStreetName(nextStreet);
    if (nextWard && (forceReplace || !wardCommune.trim())) setWardCommune(nextWard);
    if (nextDistrict && (forceReplace || !districtCity.trim())) setDistrictCity(nextDistrict);
  };

  const runReverseGeocode = async (
    lat: number,
    lng: number,
    photoIdToSave?: string,
    ocrAddressFallback?: string | null
  ): Promise<ReverseGeocodeResult | null> => {
    if (!isValidCoordinatePair(lat, lng)) return null;
    setGeocodeLoading(true);
    try {
      const resp = await fetch(buildApiUrl('/api/reverse-geocode'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: lat, longitude: lng }),
      });
      const data = (await resp.json()) as ReverseGeocodeResult & { error?: string };
      if (!resp.ok) {
        setPipelineError(data.error || 'Không thể định danh vị trí từ tọa độ GPS.');
        return null;
      }
      if (photoIdToSave) {
        updateFieldPhoto(photoIdToSave, { reverseGeocode: data });
      }
      hydrateLocationFields(data, ocrAddressFallback, true);
      return data;
    } catch {
      setPipelineError('Không kết nối được dịch vụ định danh vị trí trên máy chủ.');
      return null;
    } finally {
      setGeocodeLoading(false);
    }
  };

  const runOcrForPhoto = async (
    photoId: string,
    dataUrl: string,
    mimeType: string,
    hasExistingExif: boolean,
    existingCapturedAt: string | null
  ): Promise<{
    ocrHasGps: boolean;
    ocrLat: number | null;
    ocrLng: number | null;
    ocrAddress: string | null;
  }> => {
    setOcrLoading(true);
    try {
      const commaIdx = dataUrl.indexOf(',');
      const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;

      const resp = await fetch(buildApiUrl('/api/analyze-photo'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64,
          mimeType:
            mimeType === 'image/png' || mimeType === 'image/webp' ? mimeType : 'image/jpeg',
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setPipelineMessage(
          data.error ||
            'Không chạy được OCR tự động. Hệ thống vẫn giữ nguyên tọa độ EXIF (nếu có) và cho phép nhập thủ công.'
        );
        return { ocrHasGps: false, ocrLat: null, ocrLng: null, ocrAddress: null };
      }

      const ocrValidGps =
        Boolean(data.hasOverlayGps) && isValidCoordinatePair(data.latitude, data.longitude);
      const shouldAdoptOcr = ocrValidGps && !hasExistingExif;

      updateFieldPhoto(photoId, {
        ocrAttempted: true,
        ocrHasGps: ocrValidGps,
        ocrLatitude: ocrValidGps ? data.latitude : null,
        ocrLongitude: ocrValidGps ? data.longitude : null,
        ocrCapturedAt: data.overlayTimestamp || null,
        ocrAddress: data.overlayAddress || null,
        ocrRawText: data.rawOverlayText || null,
        ocrConfidence: data.confidence || 'thap',
        ocrNotes: data.notes || null,
        ...(shouldAdoptOcr
          ? {
              activeLatitude: data.latitude,
              activeLongitude: data.longitude,
              coordinateSource: 'image_overlay' as CoordinateSourceType,
              confidence: data.confidence || 'trung_binh',
              capturedAt: existingCapturedAt || data.overlayTimestamp || null,
            }
          : {}),
      });

      return {
        ocrHasGps: ocrValidGps,
        ocrLat: ocrValidGps ? data.latitude : null,
        ocrLng: ocrValidGps ? data.longitude : null,
        ocrAddress: data.overlayAddress || null,
      };
    } catch {
      setPipelineMessage(
        'Dịch vụ AI OCR tạm thời không phản hồi. Hệ thống giữ nguyên tọa độ EXIF (nếu có).'
      );
      return { ocrHasGps: false, ocrLat: null, ocrLng: null, ocrAddress: null };
    } finally {
      setOcrLoading(false);
    }
  };

  const handleGeoSnapUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const imageFile = Array.from(fileList).find((f) => f.type.startsWith('image/'));
    if (!imageFile) {
      setPipelineError('Vui lòng chọn tệp hình ảnh hợp lệ (JPEG, PNG, WEBP).');
      return;
    }

    setProcessingUpload(true);
    setPipelineError(null);
    setPipelineMessage(null);
    setParcelSyncNotice(null);
    setManualLatStr('');
    setManualLngStr('');

    try {
      const [exif, dataUrl] = await Promise.all([
        parseImageExif(imageFile),
        fileToDataUrl(imageFile),
      ]);

      const hasExifGps = isValidCoordinatePair(exif.latitude, exif.longitude);
      const photoId = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const newPhoto: FieldPhotoItem = {
        id: photoId,
        fileName: imageFile.name,
        fileSizeBytes: imageFile.size,
        mimeType: imageFile.type || 'image/jpeg',
        previewDataUrl: dataUrl,
        uploadedAt: new Date().toISOString(),
        exifLatitude: exif.latitude,
        exifLongitude: exif.longitude,
        exifCapturedAt: exif.capturedAt,
        cameraModel: exif.cameraModel,
        ocrAttempted: false,
        ocrHasGps: false,
        ocrLatitude: null,
        ocrLongitude: null,
        ocrCapturedAt: null,
        ocrAddress: null,
        ocrRawText: null,
        ocrConfidence: 'khong_xac_dinh',
        ocrNotes: null,
        activeLatitude: hasExifGps ? exif.latitude : null,
        activeLongitude: hasExifGps ? exif.longitude : null,
        coordinateSource: hasExifGps ? 'exif' : 'none',
        confidence: hasExifGps ? 'cao' : 'khong_xac_dinh',
        capturedAt: exif.capturedAt,
        officerConfirmedCoordinates: false,
        officerConfirmedAtParcel: false,
        officerNote: '',
        reverseGeocode: null,
      };

      addFieldPhotos([newPhoto]);
      setSelectedPhotoId(photoId);

      const ocrRes = await runOcrForPhoto(
        photoId,
        dataUrl,
        newPhoto.mimeType,
        hasExifGps,
        exif.capturedAt
      );

      const resolvedLat = hasExifGps ? exif.latitude : ocrRes.ocrHasGps ? ocrRes.ocrLat : null;
      const resolvedLng = hasExifGps ? exif.longitude : ocrRes.ocrHasGps ? ocrRes.ocrLng : null;

      if (isValidCoordinatePair(resolvedLat, resolvedLng)) {
        await runReverseGeocode(resolvedLat!, resolvedLng!, photoId, ocrRes.ocrAddress);
      } else if (ocrRes.ocrAddress) {
        hydrateLocationFields(null, ocrRes.ocrAddress, true);
      }
    } finally {
      setProcessingUpload(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSelectPhotoCoordSource = async (
    photo: FieldPhotoItem,
    source: 'exif' | 'image_overlay'
  ) => {
    const lat = source === 'exif' ? photo.exifLatitude : photo.ocrLatitude;
    const lng = source === 'exif' ? photo.exifLongitude : photo.ocrLongitude;
    if (!isValidCoordinatePair(lat, lng)) return;

    setManualLatStr('');
    setManualLngStr('');
    updateFieldPhoto(photo.id, {
      activeLatitude: lat,
      activeLongitude: lng,
      coordinateSource: source,
      confidence: source === 'exif' ? 'cao' : photo.ocrConfidence,
      officerConfirmedCoordinates: false,
    });
    await runReverseGeocode(lat!, lng!, photo.id, photo.ocrAddress);
  };

  const handleSyncLocationToParcel = () => {
    const patch: Partial<typeof activeDossier.parcel> = {};
    if (streetName.trim()) patch.streetName = streetName.trim();
    if (wardCommune.trim()) patch.wardCommune = wardCommune.trim();
    if (districtCity.trim()) patch.districtCity = districtCity.trim();
    if (roadSegment.trim()) patch.roadSegmentRef = roadSegment.trim();
    if (landType.trim()) patch.landTypeCertificate = landType.trim();

    const displayAddr =
      selectedPhoto?.reverseGeocode?.displayName || selectedPhoto?.ocrAddress || '';
    if (displayAddr && !activeDossier.parcel.address.trim()) {
      patch.address = displayAddr;
    }

    if (Object.keys(patch).length === 0) {
      setParcelSyncNotice('Chưa có thông tin vị trí nào để đồng bộ sang Hồ sơ thửa đất.');
      return;
    }

    updateParcelInfo(patch);
    setParcelSyncNotice(
      `Đã đồng bộ vị trí đã định danh sang Hồ sơ thửa đất (${activeDossier.parcel.dossierCode}). Cán bộ cần đối chiếu lại với Giấy chứng nhận trước khi xác nhận.`
    );
  };

  const mapsUrl = buildGoogleMapsUrl(effectiveCoords.latitude, effectiveCoords.longitude);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <BankingPageHeader
        kicker="Quy trình tra cứu cốt lõi · GeoSnapCamera → GPS/OCR → Định danh vị trí → Đối chiếu 3 nguồn giá độc lập"
        title="Tra cứu nhanh giá đất từ ảnh GeoSnapCamera & Tọa độ GPS"
        description={
          <>
            Tải ảnh thực địa chụp bằng <strong>GeoSnapCamera</strong> (hoặc nhập tọa độ/địa chỉ) để đọc GPS EXIF, trích xuất chữ in trên ảnh (OCR), phát hiện xung đột tọa độ, định danh tuyến đường và đối chiếu đồng thời <strong>Bảng giá đất Nhà nước</strong>, <strong>Khảo sát ECOVIS</strong> và <strong>Giá rao bán thị trường</strong>.
          </>
        }
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => void handleGeoSnapUpload(e.target.files)}
              className="hidden"
            />
            <button
              type="button"
              disabled={processingUpload}
              onClick={() => fileInputRef.current?.click()}
              className="banking-btn-primary"
            >
              {processingUpload ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              <span>{processingUpload ? 'Đang trích xuất EXIF & OCR...' : 'Tải ảnh GeoSnapCamera'}</span>
            </button>
          </>
        }
        footer={
          activeDossier.photos.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="font-semibold text-[#374151]">Ảnh trong hồ sơ hiện hành:</span>
              {activeDossier.photos.map((p, idx) => {
                const isSelected = selectedPhoto?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelectedPhotoId(p.id);
                      setManualLatStr('');
                      setManualLngStr('');
                      if (p.reverseGeocode || p.ocrAddress) {
                        hydrateLocationFields(p.reverseGeocode, p.ocrAddress, true);
                      }
                    }}
                    className={`min-h-[34px] rounded-md px-3 py-1 font-medium transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#9D1D26] text-white'
                        : 'border border-[#CBD2D9] bg-white text-[#374151] hover:bg-[#F3F4F6]'
                    }`}
                  >
                    Ảnh #{idx + 1}: {p.fileName.length > 24 ? `${p.fileName.slice(0, 21)}…` : p.fileName}
                  </button>
                );
              })}
            </div>
          ) : undefined
        }
      />

      {/* Pipeline messages */}
      {pipelineError && (
        <BankingAlert
          variant="error"
          action={
            <button
              type="button"
              onClick={() => setPipelineError(null)}
              className="text-[13px] font-semibold text-[#9D1D26] underline cursor-pointer"
            >
              Đóng
            </button>
          }
        >
          {pipelineError}
        </BankingAlert>
      )}
      {pipelineMessage && (
        <BankingAlert
          variant="warning"
          action={
            <button
              type="button"
              onClick={() => setPipelineMessage(null)}
              className="text-[13px] font-semibold text-[#6E4200] underline cursor-pointer"
            >
              Đóng
            </button>
          }
        >
          {pipelineMessage}
        </BankingAlert>
      )}

      {/* Multi-photo dispersion conflict alert */}
      {multiPhotoDispersion.hasConflict && multiPhotoDispersion.message && (
        <BankingAlert variant="error" title="Cảnh báo sai lệch giữa nhiều ảnh thực địa">
          {multiPhotoDispersion.message}
        </BankingAlert>
      )}

      {/* STEP 1 & 2: GeoSnapCamera Photo + EXIF/OCR Comparison + Location Identification */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Photo Preview, EXIF GPS vs OCR GPS & Conflict Alerts */}
        <div className="lg:col-span-5 banking-card overflow-hidden flex flex-col">
          <div className="border-b border-[#E2E5E9] bg-[#F9FAFB] px-5 py-3.5 flex items-center justify-between gap-2">
            <h3 className="text-[15px] font-semibold text-[#1F2429]">
              1. Ảnh GeoSnapCamera & Đối chiếu GPS
            </h3>
            {selectedPhoto && (
              <button
                type="button"
                disabled={ocrLoading || !selectedPhoto.previewDataUrl}
                onClick={() =>
                  void runOcrForPhoto(
                    selectedPhoto.id,
                    selectedPhoto.previewDataUrl,
                    selectedPhoto.mimeType,
                    isValidCoordinatePair(selectedPhoto.exifLatitude, selectedPhoto.exifLongitude),
                    selectedPhoto.exifCapturedAt
                  )
                }
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#9D1D26] hover:text-[#7F151D] disabled:opacity-50 cursor-pointer"
              >
                {ocrLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ScanText className="h-3.5 w-3.5" />
                )}
                <span>Chạy lại OCR</span>
              </button>
            )}
          </div>

          {!selectedPhoto ? (
            <div className="flex-1 p-6 flex flex-col items-center justify-center text-center">
              <Camera className="h-10 w-10 text-[#9CA3AF]" />
              <div className="mt-3 text-[15px] font-semibold text-[#1F2429]">
                Chưa tải ảnh thực địa GeoSnapCamera
              </div>
              <p className="mt-1.5 text-[13px] sm:text-sm text-[#6B7280] max-w-sm leading-relaxed">
                Tải ảnh gốc trực tiếp từ GeoSnapCamera để đọc tự động EXIF GPS, chữ tọa độ in trên ảnh và định danh vị trí. Hoặc nhập tọa độ/địa chỉ ở khung bên phải.
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 banking-btn-secondary"
              >
                <Upload className="h-4 w-4 text-[#9D1D26]" />
                <span>Chọn ảnh GeoSnapCamera</span>
              </button>
            </div>
          ) : (
            <div className="p-5 space-y-4 text-[13px] sm:text-sm">
              <div className="aspect-[16/10] w-full overflow-hidden rounded-md border border-[#E2E5E9] bg-[#1F2429] flex items-center justify-center">
                {selectedPhoto.previewDataUrl ? (
                  <img
                    src={selectedPhoto.previewDataUrl}
                    alt={selectedPhoto.fileName}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <span className="text-white/70 text-xs">Không có ảnh xem trước trong phiên</span>
                )}
              </div>

              {/* Active GPS Coordinate Readout */}
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs sm:text-[13px]">
                  <span className="text-[#6B7280] font-medium">Tọa độ đang áp dụng</span>
                  {mapsUrl && (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-[#9D1D26] hover:underline"
                    >
                      Mở Google Maps <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
                <div className="font-mono text-base font-bold text-[#1F2429] tabular-nums">
                  {formatCoordinate(effectiveCoords.latitude, effectiveCoords.longitude)}
                </div>
                <div className="text-xs sm:text-[13px] text-[#4B5563]">
                  Nguồn: <strong className="text-[#1F2429]">{effectiveCoords.sourceLabel}</strong>
                  {selectedPhoto.capturedAt && (
                    <>
                      {' · '}Chụp:{' '}
                      <span className="font-mono tabular-nums">{formatDateTimeVi(selectedPhoto.capturedAt)}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Validation Status */}
              <BankingAlert
                variant={
                  coordValidation.status === 'valid_khanh_hoa'
                    ? 'success'
                    : coordValidation.status === 'missing'
                    ? 'neutral'
                    : 'error'
                }
              >
                {coordValidation.message}
              </BankingAlert>

              {/* Separate EXIF GPS vs OCR GPS Comparison */}
              <div className="border-t border-[#E2E5E9] pt-4 space-y-3">
                <div className="text-[13px] font-semibold text-[#1F2429]">
                  Đối chiếu riêng biệt: EXIF gốc vs Chữ in trên ảnh (OCR)
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-md border border-[#E2E5E9] bg-[#F9FAFB] p-3 space-y-1">
                    <div className="text-xs font-semibold text-[#4B5563]">A. EXIF GPS gốc</div>
                    <div className="font-mono text-[13px] font-semibold text-[#1F2429] tabular-nums break-all">
                      {formatCoordinate(selectedPhoto.exifLatitude, selectedPhoto.exifLongitude)}
                    </div>
                    {isValidCoordinatePair(selectedPhoto.exifLatitude, selectedPhoto.exifLongitude) &&
                      selectedPhoto.coordinateSource !== 'exif' && (
                        <button
                          type="button"
                          onClick={() => void handleSelectPhotoCoordSource(selectedPhoto, 'exif')}
                          className="text-xs font-semibold text-[#9D1D26] hover:underline cursor-pointer pt-0.5"
                        >
                          Áp dụng tọa độ EXIF
                        </button>
                      )}
                  </div>

                  <div className="rounded-md border border-[#E2E5E9] bg-[#F9FAFB] p-3 space-y-1">
                    <div className="text-xs font-semibold text-[#4B5563]">B. OCR GPS trên ảnh</div>
                    <div className="font-mono text-[13px] font-semibold text-[#1F2429] tabular-nums break-all">
                      {ocrLoading
                        ? 'Đang phân tích OCR...'
                        : selectedPhoto.ocrHasGps
                        ? formatCoordinate(selectedPhoto.ocrLatitude, selectedPhoto.ocrLongitude)
                        : selectedPhoto.ocrAttempted
                        ? 'Không có chữ GPS trên ảnh'
                        : 'Chưa chạy OCR'}
                    </div>
                    {selectedPhoto.ocrHasGps && selectedPhoto.coordinateSource !== 'image_overlay' && (
                      <button
                        type="button"
                        onClick={() =>
                          void handleSelectPhotoCoordSource(selectedPhoto, 'image_overlay')
                        }
                        className="text-xs font-semibold text-[#9D1D26] hover:underline cursor-pointer pt-0.5"
                      >
                        Áp dụng tọa độ OCR
                      </button>
                    )}
                  </div>
                </div>

                {exifOcrConflict && (
                  <BankingAlert
                    variant={
                      exifOcrConflict.severity === 'error'
                        ? 'error'
                        : exifOcrConflict.severity === 'warning'
                        ? 'warning'
                        : exifOcrConflict.status === 'consistent'
                        ? 'success'
                        : 'neutral'
                    }
                  >
                    {exifOcrConflict.message}
                  </BankingAlert>
                )}

                {selectedPhoto.ocrAddress && (
                  <div className="text-[13px] text-[#4B5563]">
                    <span className="font-semibold text-[#1F2429]">Địa chỉ OCR in trên ảnh:</span>{' '}
                    {selectedPhoto.ocrAddress}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: Location Identification & Lookup Criteria */}
        <div className="lg:col-span-7 banking-card p-5 sm:p-6 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between border-b border-[#E2E5E9] pb-4">
            <div>
              <h3 className="banking-section-title">
                2. Định danh vị trí hành chính & Điều kiện đối chiếu
              </h3>
              <p className="mt-1 text-[13px] text-[#6B7280]">
                Tự động nhận diện từ tọa độ GPS và chữ trên ảnh; cán bộ có thể chỉnh sửa trực tiếp trước khi gắn vào hồ sơ.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {isValidCoordinatePair(effectiveCoords.latitude, effectiveCoords.longitude) && (
                <button
                  type="button"
                  disabled={geocodeLoading}
                  onClick={() =>
                    void runReverseGeocode(
                      effectiveCoords.latitude!,
                      effectiveCoords.longitude!,
                      selectedPhoto?.id,
                      selectedPhoto?.ocrAddress
                    )
                  }
                  className="banking-btn-secondary text-[13px] min-h-[36px] py-1.5 px-3"
                >
                  {geocodeLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  <span>Định danh từ GPS</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleSyncLocationToParcel}
                className="inline-flex items-center gap-1.5 min-h-[36px] rounded-md border border-[#E8B8BC] bg-[#FDF2F3] px-3 py-1.5 text-[13px] font-semibold text-[#9D1D26] hover:bg-[#FCE6E8] whitespace-nowrap cursor-pointer"
              >
                <MapPin className="h-3.5 w-3.5" />
                <span>Điền vào Hồ sơ thửa đất</span>
              </button>
            </div>
          </div>

          {parcelSyncNotice && (
            <BankingAlert variant="success">{parcelSyncNotice}</BankingAlert>
          )}

          {/* Reverse Geocode Readout */}
          {selectedPhoto?.reverseGeocode && (
            <div className="rounded-md border border-[#E2E5E9] bg-[#F9FAFB] p-3.5 text-[13px] space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-[#1F2429]">
                  Địa chỉ nhận diện từ bản đồ (OpenStreetMap Nominatim)
                </span>
                <span className="font-mono text-xs text-[#6B7280]">
                  {formatDateTimeVi(selectedPhoto.reverseGeocode.resolvedAt)}
                </span>
              </div>
              {selectedPhoto.reverseGeocode.available ? (
                <div className="text-sm font-medium text-[#1F2429]">
                  {selectedPhoto.reverseGeocode.displayName}
                </div>
              ) : (
                <div className="text-[#8A5300] font-medium">
                  Không định danh được địa chỉ chi tiết từ bản đồ công khai.
                </div>
              )}
              <div className="text-xs text-[#6B7280]">{selectedPhoto.reverseGeocode.note}</div>
            </div>
          )}

          {/* Manual Coordinate Override & Radius */}
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <div>
              <label className="banking-label">Vĩ độ tra cứu (ghi đè)</label>
              <input
                type="text"
                placeholder={
                  selectedPhoto?.activeLatitude
                    ? String(selectedPhoto.activeLatitude.toFixed(6))
                    : 'VD: 12.238791'
                }
                value={manualLatStr}
                onChange={(e) => setManualLatStr(e.target.value)}
                className="banking-input font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="banking-label">Kinh độ tra cứu (ghi đè)</label>
              <input
                type="text"
                placeholder={
                  selectedPhoto?.activeLongitude
                    ? String(selectedPhoto.activeLongitude.toFixed(6))
                    : 'VD: 109.196749'
                }
                value={manualLngStr}
                onChange={(e) => setManualLngStr(e.target.value)}
                className="banking-input font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="banking-label">Bán kính tham chiếu lân cận</label>
              <select
                value={radiusMeters}
                onChange={(e) => setRadiusMeters(Number(e.target.value))}
                className="banking-input"
              >
                {RADIUS_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {formatDistanceVi(r)} (Đúng vị trí ≤ 150 m)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Administrative Location Fields */}
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div>
              <label className="banking-label">Tuyến đường đối chiếu</label>
              <input
                type="text"
                placeholder="VD: Lê Hồng Phong, Trần Phú, Quốc lộ 1A..."
                value={streetName}
                onChange={(e) => setStreetName(e.target.value)}
                className="banking-input"
              />
            </div>
            <div>
              <label className="banking-label">Xã / Phường / Thị trấn</label>
              <input
                type="text"
                placeholder="VD: Phường Phước Hải, Thị trấn Cam Đức..."
                value={wardCommune}
                onChange={(e) => setWardCommune(e.target.value)}
                className="banking-input"
              />
            </div>
            <div>
              <label className="banking-label">Thành phố / Thị xã / Huyện</label>
              <input
                type="text"
                placeholder="VD: TP. Nha Trang, Huyện Cam Lâm..."
                value={districtCity}
                onChange={(e) => setDistrictCity(e.target.value)}
                className="banking-input"
              />
            </div>
            <div>
              <label className="banking-label">Đoạn đường / Loại đất ưu tiên (tùy chọn)</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Đoạn đường..."
                  value={roadSegment}
                  onChange={(e) => setRoadSegment(e.target.value)}
                  className="banking-input"
                />
                <input
                  type="text"
                  placeholder="Loại đất (ODT...)"
                  value={landType}
                  onChange={(e) => setLandType(e.target.value)}
                  className="banking-input"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E2E5E9] pt-3.5 text-xs sm:text-[13px] text-[#6B7280]">
            <span>
              <strong className="text-[#0B5D3F]">Đúng vị trí</strong> = khớp tuyến đường & xã/phường hoặc GPS ≤ 150 m ·{' '}
              <strong className="text-[#8A5300]">Tham chiếu lân cận</strong> = cùng xã/phường hoặc trong {formatDistanceVi(radiusMeters)}.
            </span>
            <button
              type="button"
              onClick={() => {
                setStreetName(activeDossier.parcel.streetName || '');
                setWardCommune(activeDossier.parcel.wardCommune || '');
                setDistrictCity(activeDossier.parcel.districtCity || '');
                setRoadSegment(activeDossier.parcel.roadSegmentRef || '');
                setLandType(activeDossier.parcel.landTypeCertificate || '');
              }}
              className="font-semibold text-[#9D1D26] hover:underline whitespace-nowrap cursor-pointer"
            >
              Lấy từ Hồ sơ thửa đất
            </button>
          </div>
        </div>
      </section>

      {/* Honest Missing-Data Diagnostics */}
      {lookupResult.missingDataNotices.length > 0 && (
        <BankingAlert
          variant="warning"
          title="Ghi nhận thiếu dữ liệu / giới hạn đối chiếu (Hệ thống không tự suy diễn giá hoặc tọa độ)"
          action={
            lookupResult.statePrice.datasetTotalCount === 0 && !isDemoMode ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => navigateToPath('/admin')}
                  className="text-[13px] font-semibold text-[#9D1D26] underline cursor-pointer"
                >
                  Nạp dữ liệu tại /admin
                </button>
                <button
                  type="button"
                  onClick={() => setIsDemoMode(true)}
                  className="text-[13px] font-semibold text-[#6E4200] underline cursor-pointer"
                >
                  Xem thử chế độ DEMO
                </button>
              </div>
            ) : undefined
          }
        >
          <ul className="list-disc pl-5 space-y-1 mt-1">
            {lookupResult.missingDataNotices.map((notice, i) => (
              <li key={i}>{notice}</li>
            ))}
          </ul>
        </BankingAlert>
      )}

      {/* STEP 3: Three Independent Valuation Pillars (Strict Visual Separation: Exact vs Nearby vs Missing) */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="banking-section-title">
            3. Tổng hợp 3 nhóm giá đất độc lập
          </h3>
          <div className="flex flex-wrap items-center gap-4 text-xs sm:text-[13px]">
            <MatchTierIndicator tier="exact_location" />
            <MatchTierIndicator tier="nearby_comparable" />
            <MatchTierIndicator tier="missing" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Pillar 1: Official State Price */}
          <div className="banking-card overflow-hidden flex flex-col">
            <div className="border-b border-[#E2E5E9] bg-[#F9FAFB] px-5 py-3.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-[#1F2429]">
                <Landmark className="h-4 w-4 text-[#9D1D26] shrink-0" />
                <span>Giá đất Nhà nước</span>
              </div>
              <span className="text-xs font-mono text-[#6B7280]">
                Kho: {lookupResult.statePrice.datasetTotalCount}
              </span>
            </div>

            <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
              {/* Primary Exact-Location Valuation Block */}
              <div
                className={`rounded-md border p-3.5 ${
                  lookupResult.statePrice.exactStats.count > 0
                    ? 'border-[#B8DEC9] bg-[#ECF7F2]'
                    : 'border-[#E2E5E9] bg-[#F9FAFB]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <MatchTierIndicator
                    tier={lookupResult.statePrice.exactStats.count > 0 ? 'exact_location' : 'missing'}
                  />
                  <span className="text-xs font-mono text-[#4B5563]">
                    {lookupResult.statePrice.exactMatches.length} bản ghi
                  </span>
                </div>
                <div
                  className={`mt-2 banking-figure ${
                    lookupResult.statePrice.exactStats.count > 0
                      ? 'text-[#084730]'
                      : 'text-[#6B7280] text-base font-medium'
                  }`}
                >
                  {formatPriceRange(lookupResult.statePrice.exactStats)}
                </div>
                <div className="mt-1 text-xs text-[#4B5563]">
                  Theo văn bản pháp lý chính thức (NQ 15/2025/NQ-HĐND)
                </div>
              </div>

              {/* Visually Distinct Subordinate Nearby Comparable Block */}
              <div className="rounded-md border border-dashed border-[#EAD196] bg-[#FEF7E6]/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <MatchTierIndicator
                    tier={lookupResult.statePrice.nearbyStats.count > 0 ? 'nearby_comparable' : 'missing'}
                  />
                  <span className="text-xs font-mono text-[#6E4200]">
                    {lookupResult.statePrice.nearbyMatches.length} bản ghi
                  </span>
                </div>
                <div className="mt-1.5 text-[15px] font-semibold text-[#6E4200] tabular-nums">
                  {formatPriceRange(lookupResult.statePrice.nearbyStats)}
                </div>
                <div className="mt-0.5 text-xs text-[#6B7280]">
                  Chỉ dùng đối chiếu khu vực lân cận, không phải giá trực tiếp tại thửa
                </div>
              </div>

              {lookupResult.statePrice.missingDataReason && (
                <div className="text-xs text-[#6E4200] leading-relaxed">
                  {lookupResult.statePrice.missingDataReason}
                </div>
              )}
            </div>
          </div>

          {/* Pillar 2: ECOVIS Independent Survey */}
          <div className="banking-card overflow-hidden flex flex-col">
            <div className="border-b border-[#E2E5E9] bg-[#F9FAFB] px-5 py-3.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-[#1F2429]">
                <Building2 className="h-4 w-4 text-[#9D1D26] shrink-0" />
                <span>Giá khảo sát ECOVIS</span>
              </div>
              <span className="text-xs font-mono text-[#6B7280]">
                Kho: {lookupResult.ecovis.datasetTotalCount}
              </span>
            </div>

            <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
              <div
                className={`rounded-md border p-3.5 ${
                  lookupResult.ecovis.exactStats.count > 0
                    ? 'border-[#B8DEC9] bg-[#ECF7F2]'
                    : 'border-[#E2E5E9] bg-[#F9FAFB]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <MatchTierIndicator
                    tier={lookupResult.ecovis.exactStats.count > 0 ? 'exact_location' : 'missing'}
                  />
                  <span className="text-xs font-mono text-[#4B5563]">
                    {lookupResult.ecovis.exactMatches.length} bản ghi
                  </span>
                </div>
                <div
                  className={`mt-2 banking-figure ${
                    lookupResult.ecovis.exactStats.count > 0
                      ? 'text-[#084730]'
                      : 'text-[#6B7280] text-base font-medium'
                  }`}
                >
                  {formatPriceRange(lookupResult.ecovis.exactStats)}
                </div>
                <div className="mt-1 text-xs text-[#4B5563]">
                  Báo cáo khảo sát độc lập · Kiểm tra thời điểm báo cáo
                </div>
              </div>

              <div className="rounded-md border border-dashed border-[#EAD196] bg-[#FEF7E6]/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <MatchTierIndicator
                    tier={lookupResult.ecovis.nearbyStats.count > 0 ? 'nearby_comparable' : 'missing'}
                  />
                  <span className="text-xs font-mono text-[#6E4200]">
                    {lookupResult.ecovis.nearbyMatches.length} bản ghi
                  </span>
                </div>
                <div className="mt-1.5 text-[15px] font-semibold text-[#6E4200] tabular-nums">
                  {formatPriceRange(lookupResult.ecovis.nearbyStats)}
                </div>
                <div className="mt-0.5 text-xs text-[#6B7280]">
                  Tuyến đường/khu vực lân cận theo báo cáo ECOVIS
                </div>
              </div>

              {lookupResult.ecovis.missingDataReason && (
                <div className="text-xs text-[#6E4200] leading-relaxed">
                  {lookupResult.ecovis.missingDataReason}
                </div>
              )}
            </div>
          </div>

          {/* Pillar 3: Market Reference Asking Prices */}
          <div className="banking-card overflow-hidden flex flex-col">
            <div className="border-b border-[#E2E5E9] bg-[#F9FAFB] px-5 py-3.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-[#1F2429]">
                <Search className="h-4 w-4 text-[#9D1D26] shrink-0" />
                <span>Giá tham khảo thị trường</span>
              </div>
              <span className="text-xs font-mono text-[#6B7280]">
                Kho: {lookupResult.market.datasetTotalCount} tin
              </span>
            </div>

            <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
              <div
                className={`rounded-md border p-3.5 ${
                  lookupResult.market.exactStats.count > 0
                    ? 'border-[#B8DEC9] bg-[#ECF7F2]'
                    : 'border-[#E2E5E9] bg-[#F9FAFB]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <MatchTierIndicator
                    tier={lookupResult.market.exactStats.count > 0 ? 'exact_location' : 'missing'}
                  />
                  <span className="text-xs font-mono text-[#4B5563]">
                    {lookupResult.market.exactMatches.length} tin ({lookupResult.market.exactVerifiedStats.count} đã XM)
                  </span>
                </div>
                <div
                  className={`mt-2 banking-figure ${
                    lookupResult.market.exactStats.count > 0
                      ? 'text-[#084730]'
                      : 'text-[#6B7280] text-base font-medium'
                  }`}
                >
                  {formatPriceRange(lookupResult.market.exactStats)}
                </div>
                <div className="mt-1 text-xs text-[#4B5563]">
                  Giá chào bán tham khảo, không phải giá chốt giao dịch
                </div>
              </div>

              <div className="rounded-md border border-dashed border-[#EAD196] bg-[#FEF7E6]/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <MatchTierIndicator
                    tier={lookupResult.market.nearbyStats.count > 0 ? 'nearby_comparable' : 'missing'}
                  />
                  <span className="text-xs font-mono text-[#6E4200]">
                    {lookupResult.market.nearbyMatches.length} tin ({lookupResult.market.nearbyVerifiedStats.count} đã XM)
                  </span>
                </div>
                <div className="mt-1.5 text-[15px] font-semibold text-[#6E4200] tabular-nums">
                  {formatPriceRange(lookupResult.market.nearbyStats)}
                </div>
                <div className="mt-0.5 text-xs text-[#6B7280]">
                  Tin rao khu vực lân cận dùng tham chiếu mặt bằng giá
                </div>
              </div>

              {lookupResult.market.missingDataReason && (
                <div className="text-xs text-[#6E4200] leading-relaxed">
                  {lookupResult.market.missingDataReason}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {attachError && (
        <BankingAlert
          variant="error"
          action={
            <button
              type="button"
              onClick={() => setAttachError(null)}
              className="text-[13px] font-semibold text-[#9D1D26] underline cursor-pointer"
            >
              Đóng
            </button>
          }
        >
          {attachError}
        </BankingAlert>
      )}

      {/* Detailed Results Tables (Separated by Source & Exact vs Nearby) */}
      <section className="banking-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E5E9] bg-[#F9FAFB] px-5 py-3">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-[#ECEFF2] rounded-md">
            <button
              type="button"
              onClick={() => setActiveResultTab('state')}
              className={`min-h-[34px] px-3 py-1.5 text-[13px] font-semibold rounded transition-colors cursor-pointer ${
                activeResultTab === 'state'
                  ? 'bg-white text-[#9D1D26] shadow-xs'
                  : 'text-[#4B5563] hover:text-[#1F2429]'
              }`}
            >
              1. Giá Nhà nước ({lookupResult.statePrice.exactMatches.length} đúng ·{' '}
              {lookupResult.statePrice.nearbyMatches.length} lân cận)
            </button>
            <button
              type="button"
              onClick={() => setActiveResultTab('ecovis')}
              className={`min-h-[34px] px-3 py-1.5 text-[13px] font-semibold rounded transition-colors cursor-pointer ${
                activeResultTab === 'ecovis'
                  ? 'bg-white text-[#9D1D26] shadow-xs'
                  : 'text-[#4B5563] hover:text-[#1F2429]'
              }`}
            >
              2. ECOVIS ({lookupResult.ecovis.exactMatches.length} đúng ·{' '}
              {lookupResult.ecovis.nearbyMatches.length} lân cận)
            </button>
            <button
              type="button"
              onClick={() => setActiveResultTab('market')}
              className={`min-h-[34px] px-3 py-1.5 text-[13px] font-semibold rounded transition-colors cursor-pointer ${
                activeResultTab === 'market'
                  ? 'bg-white text-[#9D1D26] shadow-xs'
                  : 'text-[#4B5563] hover:text-[#1F2429]'
              }`}
            >
              3. Thị trường ({lookupResult.market.exactMatches.length} đúng ·{' '}
              {lookupResult.market.nearbyMatches.length} lân cận)
            </button>
          </div>

          <div className="text-[13px] text-[#6B7280]">
            Hồ sơ nhận dữ liệu:{' '}
            <strong className="font-mono text-[#1F2429]">{activeDossier.parcel.dossierCode}</strong>
          </div>
        </div>

        {/* TAB 1: Official State Price */}
        {activeResultTab === 'state' && (
          <div className="divide-y divide-[#E2E5E9]">
            {[
              {
                key: 'exact' as const,
                title: 'A. Bảng giá đất Nhà nước — ĐÚNG VỊ TRÍ / CÙNG TUYẾN ĐƯỜNG',
                emptyText:
                  'Không tìm thấy bản ghi Bảng giá đất Nhà nước khớp đúng tuyến đường hoặc trong bán kính 150 m.',
                items: lookupResult.statePrice.exactMatches,
              },
              {
                key: 'nearby' as const,
                title: `B. Bảng giá đất Nhà nước — THAM CHIẾU LÂN CẬN (cùng Xã/Phường hoặc trong ${formatDistanceVi(radiusMeters)})`,
                emptyText: 'Không có bản ghi tham chiếu lân cận phù hợp trong phạm vi đang chọn.',
                items: lookupResult.statePrice.nearbyMatches,
              },
            ].map((group) => (
              <div key={group.key} className="p-5 space-y-3">
                <div className="flex items-center justify-between gap-2 text-[13px] sm:text-sm">
                  <h4
                    className={`font-semibold ${
                      group.key === 'exact' ? 'text-[#0B5D3F]' : 'text-[#8A5300]'
                    }`}
                  >
                    {group.title}
                  </h4>
                  <span className="font-mono text-xs text-[#6B7280]">{group.items.length} bản ghi</span>
                </div>

                {group.items.length === 0 ? (
                  <p className="text-[13px] text-[#6B7280]">{group.emptyText}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[13px] sm:text-sm border border-[#E2E5E9]">
                      <thead>
                        <tr className="bg-[#F9FAFB] border-b border-[#E2E5E9] text-xs sm:text-[13px] text-[#4B5563] font-semibold">
                          <th className="px-3.5 py-2.5">Tuyến đường & Đoạn đường</th>
                          <th className="px-3.5 py-2.5">Loại đất & Vị trí</th>
                          <th className="px-3.5 py-2.5 text-right">Đơn giá</th>
                          <th className="px-3.5 py-2.5">Phân loại & Khoảng cách</th>
                          <th className="px-3.5 py-2.5">Nguồn văn bản pháp lý</th>
                          <th className="px-3.5 py-2.5 text-right">Hồ sơ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E2E5E9]">
                        {group.items.map(({ record: rec, tier, distanceMeters, matchReason }) => {
                          const isAttached = activeDossier.attachedStateRefs.some(
                            (a) => a.record.id === rec.id
                          );
                          return (
                            <tr key={rec.id} className="hover:bg-[#F9FAFB] align-top">
                              <td className="px-3.5 py-3">
                                <div className="font-semibold text-[#1F2429]">{rec.streetName}</div>
                                {rec.roadSegment && (
                                  <div className="text-[13px] text-[#4B5563]">{rec.roadSegment}</div>
                                )}
                                <div className="text-xs text-[#6B7280] mt-0.5">
                                  {[rec.wardCommune, rec.districtCity].filter(Boolean).join(', ')} ·{' '}
                                  <span className="font-mono">{rec.recordCode}</span>
                                </div>
                              </td>
                              <td className="px-3.5 py-3">
                                <div className="font-medium text-[#1F2429]">{rec.landType}</div>
                                <div className="text-[13px] text-[#4B5563]">{rec.position}</div>
                              </td>
                              <td className="px-3.5 py-3 text-right font-bold text-[#1F2429] tabular-nums whitespace-nowrap">
                                {formatCurrencyVnd(rec.unitPrice)}
                                <div className="text-xs font-normal text-[#6B7280]">{rec.unit}</div>
                              </td>
                              <td className="px-3.5 py-3">
                                <MatchTierIndicator
                                  tier={tier}
                                  distanceLabel={distanceMeters !== null ? formatDistanceVi(distanceMeters) : null}
                                />
                                <div className="mt-0.5 text-xs text-[#6B7280]">{matchReason}</div>
                              </td>
                              <td className="px-3.5 py-3 text-[#4B5563] max-w-xs">
                                <div className="font-medium text-[#1F2429]">{rec.legalDocumentName}</div>
                                <div className="text-xs text-[#6B7280]">{rec.sourcePageOrAppendix}</div>
                              </td>
                              <td className="px-3.5 py-3 text-right whitespace-nowrap">
                                {isAttached ? (
                                  <span className="inline-flex items-center gap-1 font-semibold text-[#0B5D3F]">
                                    <Check className="h-4 w-4" />
                                    Đã gắn
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAttachError(null);
                                      const res = attachStateReference(rec, {
                                        matchTier: tier,
                                        matchReason,
                                        distanceMeters,
                                      });
                                      if (!res.ok) setAttachError(res.error || 'Không thể gắn bản ghi.');
                                    }}
                                    className="inline-flex items-center gap-1 min-h-[34px] rounded border border-[#E8B8BC] bg-[#FDF2F3] px-3 py-1.5 text-[13px] font-semibold text-[#9D1D26] hover:bg-[#FCE6E8] cursor-pointer"
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                    Gắn hồ sơ
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* TAB 2: ECOVIS Independent Survey */}
        {activeResultTab === 'ecovis' && (
          <div className="divide-y divide-[#E2E5E9]">
            {[
              {
                key: 'exact' as const,
                title: 'A. Khảo sát ECOVIS — ĐÚNG VỊ TRÍ / CÙNG TUYẾN ĐƯỜNG',
                emptyText:
                  'Không tìm thấy bản ghi khảo sát ECOVIS khớp đúng tuyến đường hoặc trong bán kính 150 m.',
                items: lookupResult.ecovis.exactMatches,
              },
              {
                key: 'nearby' as const,
                title: `B. Khảo sát ECOVIS — THAM CHIẾU LÂN CẬN (cùng Xã/Phường hoặc trong ${formatDistanceVi(radiusMeters)})`,
                emptyText: 'Không có bản ghi ECOVIS tham chiếu lân cận trong phạm vi đang chọn.',
                items: lookupResult.ecovis.nearbyMatches,
              },
            ].map((group) => (
              <div key={group.key} className="p-5 space-y-3">
                <div className="flex items-center justify-between gap-2 text-[13px] sm:text-sm">
                  <h4
                    className={`font-semibold ${
                      group.key === 'exact' ? 'text-[#0B5D3F]' : 'text-[#8A5300]'
                    }`}
                  >
                    {group.title}
                  </h4>
                  <span className="font-mono text-xs text-[#6B7280]">{group.items.length} bản ghi</span>
                </div>

                {group.items.length === 0 ? (
                  <p className="text-[13px] text-[#6B7280]">{group.emptyText}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[13px] sm:text-sm border border-[#E2E5E9]">
                      <thead>
                        <tr className="bg-[#F9FAFB] border-b border-[#E2E5E9] text-xs sm:text-[13px] text-[#4B5563] font-semibold">
                          <th className="px-3.5 py-2.5">Tuyến đường & Đoạn đường (ECOVIS)</th>
                          <th className="px-3.5 py-2.5">Loại đất & Vị trí</th>
                          <th className="px-3.5 py-2.5 text-right">Đơn giá khảo sát</th>
                          <th className="px-3.5 py-2.5">Phân loại & Thời điểm</th>
                          <th className="px-3.5 py-2.5">Nguồn tài liệu</th>
                          <th className="px-3.5 py-2.5 text-right">Hồ sơ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E2E5E9]">
                        {group.items.map(({ record: rec, tier, distanceMeters, matchReason }) => {
                          const isAttached = activeDossier.attachedEcovisRefs.some(
                            (a) => a.record.id === rec.id
                          );
                          return (
                            <tr key={rec.id} className="hover:bg-[#F9FAFB] align-top">
                              <td className="px-3.5 py-3">
                                <div className="font-semibold text-[#1F2429]">{rec.streetName}</div>
                                {rec.roadSegment && (
                                  <div className="text-[13px] text-[#4B5563]">{rec.roadSegment}</div>
                                )}
                                <div className="text-xs text-[#6B7280] mt-0.5">
                                  {[rec.wardCommune, rec.districtCity].filter(Boolean).join(', ')} ·{' '}
                                  <span className="font-mono">{rec.recordCode}</span>
                                </div>
                              </td>
                              <td className="px-3.5 py-3">
                                <div className="font-medium text-[#1F2429]">{rec.landType}</div>
                                <div className="text-[13px] text-[#4B5563]">{rec.position}</div>
                              </td>
                              <td className="px-3.5 py-3 text-right font-bold text-[#1F2429] tabular-nums whitespace-nowrap">
                                {formatCurrencyVnd(rec.surveyUnitPrice)}
                                <div className="text-xs font-normal text-[#6B7280]">{rec.unit}</div>
                              </td>
                              <td className="px-3.5 py-3">
                                <MatchTierIndicator
                                  tier={tier}
                                  distanceLabel={distanceMeters !== null ? formatDistanceVi(distanceMeters) : null}
                                />
                                <div className="mt-0.5 text-xs text-[#6B7280]">{matchReason}</div>
                                <div className="text-xs text-[#6B7280]">
                                  Thời điểm KS: <span className="font-mono">{rec.surveyOrReportDate || 'Chưa rõ'}</span>
                                </div>
                              </td>
                              <td className="px-3.5 py-3 text-[#4B5563] max-w-xs">
                                <div className="font-medium text-[#1F2429]">{rec.sourceDocument}</div>
                                <div className="text-xs text-[#6B7280]">{rec.appendixAndPage}</div>
                              </td>
                              <td className="px-3.5 py-3 text-right whitespace-nowrap">
                                {isAttached ? (
                                  <span className="inline-flex items-center gap-1 font-semibold text-[#0B5D3F]">
                                    <Check className="h-4 w-4" />
                                    Đã gắn
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAttachError(null);
                                      const res = attachEcovisReference(rec, {
                                        matchTier: tier,
                                        matchReason,
                                        distanceMeters,
                                      });
                                      if (!res.ok) setAttachError(res.error || 'Không thể gắn bản ghi.');
                                    }}
                                    className="inline-flex items-center gap-1 min-h-[34px] rounded border border-[#E8B8BC] bg-[#FDF2F3] px-3 py-1.5 text-[13px] font-semibold text-[#9D1D26] hover:bg-[#FCE6E8] cursor-pointer"
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                    Gắn hồ sơ
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* TAB 3: Market Reference Listings */}
        {activeResultTab === 'market' && (
          <div className="divide-y divide-[#E2E5E9]">
            {[
              {
                key: 'exact' as const,
                title: 'A. Tin rao bán thị trường — ĐÚNG VỊ TRÍ / CÙNG TUYẾN ĐƯỜNG (Giá chào bán tham khảo)',
                emptyText:
                  'Không có tin rao bán thị trường khớp đúng tuyến đường hoặc trong bán kính 150 m.',
                items: lookupResult.market.exactMatches,
              },
              {
                key: 'nearby' as const,
                title: `B. Tin rao bán thị trường — THAM CHIẾU LÂN CẬN (cùng Xã/Phường hoặc trong ${formatDistanceVi(radiusMeters)})`,
                emptyText: 'Không có tin rao bán tham chiếu lân cận trong phạm vi đang chọn.',
                items: lookupResult.market.nearbyMatches,
              },
            ].map((group) => (
              <div key={group.key} className="p-5 space-y-3">
                <div className="flex items-center justify-between gap-2 text-[13px] sm:text-sm">
                  <h4
                    className={`font-semibold ${
                      group.key === 'exact' ? 'text-[#0B5D3F]' : 'text-[#8A5300]'
                    }`}
                  >
                    {group.title}
                  </h4>
                  <span className="font-mono text-xs text-[#6B7280]">{group.items.length} tin rao</span>
                </div>

                {group.items.length === 0 ? (
                  <p className="text-[13px] text-[#6B7280]">{group.emptyText}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[13px] sm:text-sm border border-[#E2E5E9]">
                      <thead>
                        <tr className="bg-[#F9FAFB] border-b border-[#E2E5E9] text-xs sm:text-[13px] text-[#4B5563] font-semibold">
                          <th className="px-3.5 py-2.5">Địa chỉ & Nguồn tin</th>
                          <th className="px-3.5 py-2.5 text-right">Diện tích / Giá rao</th>
                          <th className="px-3.5 py-2.5 text-right">Đơn giá/m²</th>
                          <th className="px-3.5 py-2.5">Phân loại & Xác minh</th>
                          <th className="px-3.5 py-2.5 text-right">Hồ sơ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E2E5E9]">
                        {group.items.map(({ record: item, tier, distanceMeters, matchReason }) => {
                          const isAttached = activeDossier.attachedMarketIds.includes(item.id);
                          const safeHref = sanitizeExternalUrl(item.url);
                          return (
                            <tr key={item.id} className="hover:bg-[#F9FAFB] align-top">
                              <td className="px-3.5 py-3 max-w-xs">
                                <div className="font-semibold text-[#1F2429]">{item.address}</div>
                                <div className="text-xs text-[#4B5563] mt-0.5">
                                  {item.sourceName}
                                  {item.postedDate ? ` · Đăng: ${item.postedDate}` : ''}
                                </div>
                                {safeHref && (
                                  <a
                                    href={safeHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs font-medium text-[#9D1D26] hover:underline mt-0.5"
                                  >
                                    Mở liên kết gốc <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </td>
                              <td className="px-3.5 py-3 text-right tabular-nums whitespace-nowrap text-[#4B5563]">
                                <div className="font-medium text-[#1F2429]">
                                  {item.areaSqm !== null ? `${formatNumberVi(item.areaSqm)} m²` : 'Chưa có'}
                                </div>
                                <div className="text-xs text-[#6B7280]">
                                  {formatCurrencyVnd(item.askingPriceVnd)}
                                </div>
                              </td>
                              <td className="px-3.5 py-3 text-right font-bold tabular-nums whitespace-nowrap text-[#1F2429]">
                                {formatCurrencyVnd(item.unitPricePerSqm)}
                              </td>
                              <td className="px-3.5 py-3">
                                <MatchTierIndicator
                                  tier={tier}
                                  distanceLabel={distanceMeters !== null ? formatDistanceVi(distanceMeters) : null}
                                />
                                <div className="mt-0.5 text-xs text-[#6B7280]">{matchReason}</div>
                                <div className="mt-1 text-xs">
                                  {item.verificationStatus === 'da_xac_minh_so_bo' ? (
                                    <span className="inline-flex items-center gap-1 font-semibold text-[#0B5D3F]">
                                      <CheckCircle2 className="h-3.5 w-3.5" /> Đã xác minh sơ bộ
                                    </span>
                                  ) : (
                                    <span className="font-semibold text-[#8A5300]">
                                      Chưa xác minh (Giá chào bán)
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3.5 py-3 text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAttachError(null);
                                    const res = toggleAttachMarketListing(item.id);
                                    if (!res.ok) setAttachError(res.error || 'Không thể gắn tin rao.');
                                  }}
                                  className={`inline-flex items-center gap-1 min-h-[34px] rounded px-3 py-1.5 text-[13px] font-semibold cursor-pointer ${
                                    isAttached
                                      ? 'border border-[#B8DEC9] bg-[#ECF7F2] text-[#0B5D3F]'
                                      : 'border border-[#E8B8BC] bg-[#FDF2F3] text-[#9D1D26] hover:bg-[#FCE6E8]'
                                  }`}
                                >
                                  {isAttached ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                                  {isAttached ? 'Đã gắn' : 'Gắn hồ sơ'}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Bottom Workflow Handoff Bar */}
      <section className="banking-card p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-[13px] sm:text-sm text-[#4B5563]">
          <div className="font-semibold text-[#1F2429]">
            Hồ sơ <span className="font-mono">{activeDossier.parcel.dossierCode}</span>: đã gắn{' '}
            <span className="font-bold tabular-nums">{activeDossier.photos.length}</span> ảnh ·{' '}
            <span className="font-bold tabular-nums">{activeDossier.attachedStateRefs.length}</span> Bảng giá Nhà nước ·{' '}
            <span className="font-bold tabular-nums">{activeDossier.attachedEcovisRefs.length}</span> ECOVIS ·{' '}
            <span className="font-bold tabular-nums">{activeDossier.attachedMarketIds.length}</span> tin thị trường.
          </div>
          <p className="mt-0.5 text-xs sm:text-[13px] text-[#6B7280]">
            Tiếp tục đối chiếu Hệ số K (nếu có căn cứ văn bản) hoặc mở Báo cáo tổng hợp 11 mục để kiểm tra và xuất PDF/Excel.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setActiveModule('location-k')}
            className="banking-btn-secondary"
          >
            <Scale className="h-4 w-4 text-[#9D1D26]" />
            <span>Phân tích vị trí & Hệ số K</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveModule('report')}
            className="banking-btn-primary"
          >
            <FileText className="h-4 w-4" />
            <span>Mở Báo cáo tổng hợp & Xuất PDF/Excel</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </section>
    </div>
  );
};
