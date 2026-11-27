import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  MapPin,
  ScanText,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAppData } from '../../context/AppDataContext';
import { CoordinateSourceType, FieldPhotoItem } from '../../types/valuation';
import { fileToDataUrl, parseImageExif } from '../../utils/exifParser';
import {
  buildGoogleMapsUrl,
  formatBytes,
  formatCoordinate,
  formatDateTimeVi,
  getConfidenceLabel,
  getCoordinateSourceLabel,
  isValidCoordinatePair,
} from '../../utils/formatters';
import {
  detectExifOcrConflict,
  detectMultiPhotoDispersion,
  validateCoordinateForKhanhHoa,
} from '../../utils/geoLookup';

export const PhotoGpsModule: React.FC = () => {
  const { activeDossier, addFieldPhotos, updateFieldPhoto, removeFieldPhoto, setActiveModule } = useAppData();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [ocrLoadingIds, setOcrLoadingIds] = useState<Record<string, boolean>>({});
  const [ocrErrors, setOcrErrors] = useState<Record<string, string>>({});
  const [editingCoords, setEditingCoords] = useState<
    Record<string, { lat: string; lng: string; source: CoordinateSourceType }>
  >({});

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
      const newPhotos: FieldPhotoItem[] = [];

      for (const file of files) {
        const [exif, dataUrl] = await Promise.all([
          parseImageExif(file),
          fileToDataUrl(file),
        ]);

        const hasExifGps = isValidCoordinatePair(exif.latitude, exif.longitude);

        newPhotos.push({
          id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          fileName: file.name,
          fileSizeBytes: file.size,
          mimeType: file.type || 'image/jpeg',
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
          // Strictly use EXIF if present; NEVER fabricate coordinates
          activeLatitude: hasExifGps ? exif.latitude : null,
          activeLongitude: hasExifGps ? exif.longitude : null,
          coordinateSource: hasExifGps ? 'exif' : 'none',
          confidence: hasExifGps ? 'cao' : 'khong_xac_dinh',
          capturedAt: exif.capturedAt,
          officerConfirmedCoordinates: false,
          officerConfirmedAtParcel: false,
          officerNote: '',
        });
      }

      if (newPhotos.length > 0) {
        addFieldPhotos(newPhotos);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRunOcr = async (photo: FieldPhotoItem) => {
    if (!photo.previewDataUrl) {
      setOcrErrors((prev) => ({
        ...prev,
        [photo.id]: 'Không còn dữ liệu ảnh gốc trong phiên để đọc OCR. Vui lòng tải lại ảnh.',
      }));
      return;
    }

    setOcrLoadingIds((prev) => ({ ...prev, [photo.id]: true }));
    setOcrErrors((prev) => {
      const copy = { ...prev };
      delete copy[photo.id];
      return copy;
    });

    try {
      const commaIdx = photo.previewDataUrl.indexOf(',');
      const base64 = commaIdx >= 0 ? photo.previewDataUrl.slice(commaIdx + 1) : photo.previewDataUrl;

      const resp = await fetch('/api/analyze-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64,
          mimeType: photo.mimeType === 'image/png' || photo.mimeType === 'image/webp' ? photo.mimeType : 'image/jpeg',
        }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        setOcrErrors((prev) => ({
          ...prev,
          [photo.id]: data.error || 'Không thể phân tích chữ in trên ảnh.',
        }));
        return;
      }

      const ocrValidGps =
        Boolean(data.hasOverlayGps) && isValidCoordinatePair(data.latitude, data.longitude);

      const shouldAdoptOcr = ocrValidGps && photo.coordinateSource === 'none';

      updateFieldPhoto(photo.id, {
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
              capturedAt: photo.capturedAt || data.overlayTimestamp || null,
            }
          : {}),
      });
    } catch {
      setOcrErrors((prev) => ({
        ...prev,
        [photo.id]: 'Không kết nối được dịch vụ phân tích ảnh trên máy chủ.',
      }));
    } finally {
      setOcrLoadingIds((prev) => ({ ...prev, [photo.id]: false }));
    }
  };

  const startManualEdit = (photo: FieldPhotoItem) => {
    setEditingCoords((prev) => ({
      ...prev,
      [photo.id]: {
        lat: photo.activeLatitude !== null ? String(photo.activeLatitude) : '',
        lng: photo.activeLongitude !== null ? String(photo.activeLongitude) : '',
        source: photo.coordinateSource === 'none' ? 'user_input' : photo.coordinateSource,
      },
    }));
  };

  const saveManualEdit = (photoId: string) => {
    const draft = editingCoords[photoId];
    if (!draft) return;

    const lat = draft.lat.trim() === '' ? null : Number(draft.lat.trim().replace(',', '.'));
    const lng = draft.lng.trim() === '' ? null : Number(draft.lng.trim().replace(',', '.'));

    if (lat === null && lng === null) {
      updateFieldPhoto(photoId, {
        activeLatitude: null,
        activeLongitude: null,
        coordinateSource: 'none',
        confidence: 'khong_xac_dinh',
        officerConfirmedCoordinates: false,
      });
    } else if (isValidCoordinatePair(lat, lng)) {
      updateFieldPhoto(photoId, {
        activeLatitude: lat,
        activeLongitude: lng,
        coordinateSource: draft.source === 'none' ? 'user_input' : draft.source,
        confidence: draft.source === 'user_input' ? 'cao' : 'trung_binh',
      });
    } else {
      setOcrErrors((prev) => ({
        ...prev,
        [photoId]: 'Tọa độ không hợp lệ. Vĩ độ phải trong [-90, 90], kinh độ trong [-180, 180] và khác 0,0.',
      }));
      return;
    }

    setEditingCoords((prev) => {
      const next = { ...prev };
      delete next[photoId];
      return next;
    });
  };

  const useExifCoords = (photo: FieldPhotoItem) => {
    if (!isValidCoordinatePair(photo.exifLatitude, photo.exifLongitude)) return;
    updateFieldPhoto(photo.id, {
      activeLatitude: photo.exifLatitude,
      activeLongitude: photo.exifLongitude,
      coordinateSource: 'exif',
      confidence: 'cao',
      officerConfirmedCoordinates: false,
    });
  };

  const useOcrCoords = (photo: FieldPhotoItem) => {
    if (!isValidCoordinatePair(photo.ocrLatitude, photo.ocrLongitude)) return;
    updateFieldPhoto(photo.id, {
      activeLatitude: photo.ocrLatitude,
      activeLongitude: photo.ocrLongitude,
      coordinateSource: 'image_overlay',
      confidence: photo.ocrConfidence,
      officerConfirmedCoordinates: false,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header & Upload Panel */}
      <div className="banking-card p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-xs sm:text-[13px] font-medium text-[#6B7280]">
              Hồ sơ khảo sát hiện trường · Tách biệt EXIF GPS, OCR ảnh và tọa độ cán bộ nhập
            </div>
            <h2 className="mt-1 banking-page-title">
              Module 3 · Ảnh khảo sát thực địa & Phân tích GPS
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-[#4B5563]">
              Hỗ trợ tải nhiều ảnh thực địa (ưu tiên ảnh chụp bằng <strong className="text-[#1F2429]">GeoSnapCamera</strong>). Hệ thống đọc tự động thông tin EXIF GPS trong tệp ảnh gốc và cung cấp chức năng AI OCR đọc dòng tọa độ in trực tiếp trên ảnh.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => handleFilesSelected(e.target.files)}
              className="hidden"
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="banking-btn-primary whitespace-nowrap"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Tải ảnh thực địa (chọn nhiều ảnh)
            </button>
            <button
              type="button"
              onClick={() => setActiveModule('quick-lookup')}
              className="banking-btn-secondary whitespace-nowrap"
            >
              Mở Tra cứu nhanh từ ảnh
            </button>
          </div>
        </div>

        {/* Strict GPS Integrity Notice */}
        <div className="mt-5 grid grid-cols-1 gap-3 border-t border-[#E2E5E9] pt-4 text-[13px] leading-relaxed text-[#4B5563] md:grid-cols-2">
          <div>
            <strong className="text-[#1F2429]">Phân loại 5 nguồn tọa độ:</strong>{' '}
            1. EXIF của ảnh · 2. GPS hiển thị trên ảnh (OCR) · 3. Người dùng nhập · 4. Kết quả định vị địa lý · 5. AI suy luận.
          </div>
          <div>
            <strong className="text-[#1F2429]">Nguyên tắc kiểm soát:</strong>{' '}
            Không tự tạo tọa độ khi ảnh không có GPS; không tự khẳng định ảnh chụp tại chính thửa đất khi chưa được cán bộ xác nhận.
          </div>
        </div>
      </div>

      {/* Empty State */}
      {activeDossier.photos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#CBD2D9] bg-white px-6 py-12 text-center">
          <Camera className="mx-auto h-9 w-9 text-[#9D1D26]" />
          <h3 className="mt-3 text-base font-semibold text-[#1F2429]">
            Chưa có ảnh khảo sát thực địa cho hồ sơ {activeDossier.parcel.dossierCode}
          </h3>
          <p className="mt-1.5 text-sm text-[#4B5563] max-w-lg mx-auto leading-relaxed">
            Tải ảnh gốc trực tiếp từ điện thoại hoặc GeoSnapCamera (tránh ảnh đã bị nén mất EXIF qua ứng dụng nhắn tin) để đọc chính xác tọa độ GPS và thời điểm chụp.
          </p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-5 banking-btn-primary"
          >
            <Upload className="h-4 w-4" />
            Chọn ảnh từ máy tính
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {(() => {
            const dispersion = detectMultiPhotoDispersion(activeDossier.photos);
            if (!dispersion.hasConflict || !dispersion.message) return null;
            return (
              <div className="rounded-md border border-[#E8B8BC] bg-[#FDF2F3] px-4 py-3 text-[13px] text-[#641016] flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 shrink-0 text-[#9D1D26] mt-0.5" />
                <span>
                  <strong className="text-[#7F151D]">Cảnh báo sai lệch giữa nhiều ảnh thực địa:</strong> {dispersion.message}
                </span>
              </div>
            );
          })()}
          {activeDossier.photos.map((photo, index) => {
            const mapsUrl = buildGoogleMapsUrl(photo.activeLatitude, photo.activeLongitude);
            const editDraft = editingCoords[photo.id];
            const isOcrRunning = Boolean(ocrLoadingIds[photo.id]);
            const ocrErr = ocrErrors[photo.id];
            const conflictReport = detectExifOcrConflict(photo);
            const boundsReport = validateCoordinateForKhanhHoa(photo.activeLatitude, photo.activeLongitude);

            return (
              <article
                key={photo.id}
                className="banking-card overflow-hidden"
              >
                <div className="grid grid-cols-1 lg:grid-cols-12">
                  {/* Image Preview Column */}
                  <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-[#E2E5E9] bg-[#F6F7F8] flex flex-col justify-between">
                    <div className="relative aspect-[4/3] w-full bg-[#1F2429]/5 flex items-center justify-center overflow-hidden">
                      {photo.previewDataUrl ? (
                        <img
                          src={photo.previewDataUrl}
                          alt={`Ảnh thực địa ${index + 1}: ${photo.fileName}`}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-contain bg-[#111418]"
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-2 p-6 text-center text-[13px] text-[#4B5563]">
                          <ImageIcon className="h-8 w-8 text-[#6B7280]" />
                          <span>Ảnh xem trước tạm không khả dụng sau khi tải lại trang. Tọa độ và xác nhận vẫn được giữ nguyên.</span>
                        </div>
                      )}
                    </div>
                    <div className="border-t border-[#E2E5E9] bg-white px-4 py-2.5 text-[13px] text-[#4B5563] flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-[#1F2429]" title={photo.fileName}>
                        Ảnh #{index + 1} · {photo.fileName}
                      </span>
                      <span className="font-mono text-xs text-[#6B7280] shrink-0 tabular-nums">
                        {formatBytes(photo.fileSizeBytes)}
                      </span>
                    </div>
                  </div>

                  {/* Metadata & Verification Column */}
                  <div className="lg:col-span-8 p-5 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-medium text-[#6B7280]">
                          Tọa độ đang áp dụng cho ảnh #{index + 1}
                        </div>
                        <div className="mt-0.5 font-mono text-lg font-bold text-[#1F2429] tabular-nums">
                          {formatCoordinate(photo.activeLatitude, photo.activeLongitude)}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[#4B5563]">
                          <span>
                            Nguồn: <strong className="text-[#1F2429]">{getCoordinateSourceLabel(photo.coordinateSource)}</strong>
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            Độ tin cậy: <strong className="text-[#1F2429]">{getConfidenceLabel(photo.confidence)}</strong>
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            Ngày giờ chụp:{' '}
                            <strong className="font-mono text-[#1F2429] tabular-nums">
                              {photo.capturedAt ? formatDateTimeVi(photo.capturedAt) : 'Chưa có thông tin'}
                            </strong>
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {mapsUrl && (
                          <a
                            href={mapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-[#E8B8BC] bg-[#FDF2F3] px-3 py-1.5 text-[13px] font-semibold text-[#9D1D26] hover:bg-[#F9E3E5] whitespace-nowrap"
                          >
                            <MapPin className="h-3.5 w-3.5" />
                            Mở Google Maps
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRunOcr(photo)}
                          disabled={isOcrRunning}
                          className="banking-btn-secondary !min-h-[36px] !px-3 !py-1.5 !text-[13px] whitespace-nowrap"
                        >
                          {isOcrRunning ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#9D1D26]" />
                          ) : (
                            <ScanText className="h-3.5 w-3.5 text-[#9D1D26]" />
                          )}
                          Đọc tọa độ in trên ảnh (AI OCR)
                        </button>
                        <button
                          type="button"
                          onClick={() => removeFieldPhoto(photo.id)}
                          aria-label="Xóa ảnh"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#E2E5E9] text-[#6B7280] hover:border-[#E8B8BC] hover:bg-[#FDF2F3] hover:text-[#9D1D26] cursor-pointer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {ocrErr && (
                      <div className="rounded-md border border-[#E8B8BC] bg-[#FDF2F3] px-3.5 py-2.5 text-[13px] text-[#641016]">
                        {ocrErr}
                      </div>
                    )}

                    {(conflictReport.status === 'conflict' || conflictReport.status === 'minor_drift') && (
                      <div
                        className={`rounded-md border px-3.5 py-2.5 text-[13px] ${
                          conflictReport.status === 'conflict'
                            ? 'border-[#E8B8BC] bg-[#FDF2F3] text-[#641016] font-medium'
                            : 'border-[#EAD196] bg-[#FEF7E6] text-[#6E4200]'
                        }`}
                      >
                        {conflictReport.message}
                      </div>
                    )}

                    {boundsReport.status === 'outside_khanh_hoa' && (
                      <div className="rounded-md border border-[#E8B8BC] bg-[#FDF2F3] px-3.5 py-2.5 text-[13px] text-[#641016]">
                        {boundsReport.message}
                      </div>
                    )}

                    {/* Extracted Sources Comparison */}
                    <div className="grid grid-cols-1 gap-4 border-t border-[#E2E5E9] pt-4 sm:grid-cols-2 text-[13px]">
                      <div className="space-y-1.5 rounded-md border border-[#E2E5E9] bg-[#F8F9FA] p-3.5">
                        <div className="font-semibold text-[#1F2429]">
                          A. Dữ liệu EXIF gốc của tệp ảnh
                        </div>
                        <div className="font-mono text-[#1F2429] tabular-nums">
                          GPS: {formatCoordinate(photo.exifLatitude, photo.exifLongitude)}
                        </div>
                        <div className="text-[#4B5563]">
                          Thời gian EXIF: {photo.exifCapturedAt ? formatDateTimeVi(photo.exifCapturedAt) : 'Không có'}
                          {photo.cameraModel ? ` · Thiết bị: ${photo.cameraModel}` : ''}
                        </div>
                        {isValidCoordinatePair(photo.exifLatitude, photo.exifLongitude) &&
                          photo.coordinateSource !== 'exif' && (
                            <button
                              type="button"
                              onClick={() => useExifCoords(photo)}
                              className="text-[#9D1D26] font-semibold hover:text-[#7F151D] hover:underline cursor-pointer"
                            >
                              Áp dụng tọa độ EXIF này
                            </button>
                          )}
                      </div>

                      <div className="space-y-1.5 rounded-md border border-[#E2E5E9] bg-[#F8F9FA] p-3.5">
                        <div className="font-semibold text-[#1F2429]">
                          B. Chữ GPS in trực tiếp trên ảnh (GeoSnapCamera / AI OCR)
                        </div>
                        {!photo.ocrAttempted ? (
                          <div className="text-[#4B5563]">
                            Chưa chạy đọc chữ trên ảnh. Nhấn “Đọc tọa độ in trên ảnh (AI OCR)” nếu ảnh chụp bằng GeoSnapCamera có in tọa độ.
                          </div>
                        ) : (
                          <>
                            <div className="font-mono text-[#1F2429] tabular-nums">
                              GPS OCR: {photo.ocrHasGps ? formatCoordinate(photo.ocrLatitude, photo.ocrLongitude) : 'Không phát hiện chữ tọa độ in trên ảnh'}
                            </div>
                            {photo.ocrCapturedAt && (
                              <div className="text-[#4B5563]">Thời gian in trên ảnh: {photo.ocrCapturedAt}</div>
                            )}
                            {photo.ocrAddress && (
                              <div className="text-[#4B5563]">Địa chỉ in trên ảnh: {photo.ocrAddress}</div>
                            )}
                            {photo.ocrNotes && (
                              <div className="text-[#6B7280] italic">Ghi chú AI OCR: {photo.ocrNotes}</div>
                            )}
                            {photo.ocrHasGps && photo.coordinateSource !== 'image_overlay' && (
                              <button
                                type="button"
                                onClick={() => useOcrCoords(photo)}
                                className="text-[#9D1D26] font-semibold hover:text-[#7F151D] hover:underline cursor-pointer"
                              >
                                Áp dụng tọa độ OCR này
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Manual Edit Coordinates */}
                    <div className="border-t border-[#E2E5E9] pt-3.5">
                      {!editDraft ? (
                        <button
                          type="button"
                          onClick={() => startManualEdit(photo)}
                          className="text-[13px] font-semibold text-[#9D1D26] hover:text-[#7F151D] hover:underline cursor-pointer"
                        >
                          Chỉnh sửa / Nhập tọa độ thủ công và phân loại nguồn
                        </button>
                      ) : (
                        <div className="space-y-3 rounded-md border border-[#E2E5E9] bg-[#F8F9FA] p-4">
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div>
                              <label className="banking-label">Vĩ độ (Latitude)</label>
                              <input
                                type="text"
                                placeholder="VD: 12.238791"
                                value={editDraft.lat}
                                onChange={(e) =>
                                  setEditingCoords((prev) => ({
                                    ...prev,
                                    [photo.id]: { ...editDraft, lat: e.target.value },
                                  }))
                                }
                                className="banking-input font-mono tabular-nums"
                              />
                            </div>
                            <div>
                              <label className="banking-label">Kinh độ (Longitude)</label>
                              <input
                                type="text"
                                placeholder="VD: 109.196749"
                                value={editDraft.lng}
                                onChange={(e) =>
                                  setEditingCoords((prev) => ({
                                    ...prev,
                                    [photo.id]: { ...editDraft, lng: e.target.value },
                                  }))
                                }
                                className="banking-input font-mono tabular-nums"
                              />
                            </div>
                            <div>
                              <label className="banking-label">Nguồn tọa độ</label>
                              <select
                                value={editDraft.source}
                                onChange={(e) =>
                                  setEditingCoords((prev) => ({
                                    ...prev,
                                    [photo.id]: {
                                      ...editDraft,
                                      source: e.target.value as CoordinateSourceType,
                                    },
                                  }))
                                }
                                className="banking-input"
                              >
                                <option value="user_input">3. Người dùng nhập</option>
                                <option value="exif">1. EXIF của ảnh</option>
                                <option value="image_overlay">2. GPS hiển thị trên ảnh</option>
                                <option value="geocoding">4. Kết quả định vị địa lý</option>
                                <option value="ai_inferred">5. AI suy luận</option>
                              </select>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => saveManualEdit(photo.id)}
                              className="banking-btn-primary !min-h-[36px] !px-3.5 !py-1.5 !text-[13px]"
                            >
                              Lưu tọa độ
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setEditingCoords((prev) => {
                                  const next = { ...prev };
                                  delete next[photo.id];
                                  return next;
                                })
                              }
                              className="banking-btn-secondary !min-h-[36px] !px-3.5 !py-1.5 !text-[13px]"
                            >
                              Hủy
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Officer Verification Checkboxes */}
                    <div className="border-t border-[#E2E5E9] pt-3.5 space-y-3">
                      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-6 text-[13px]">
                        <label className="inline-flex items-center gap-2 text-[#1F2429] cursor-pointer">
                          <input
                            type="checkbox"
                            disabled={!isValidCoordinatePair(photo.activeLatitude, photo.activeLongitude)}
                            checked={photo.officerConfirmedCoordinates}
                            onChange={(e) =>
                              updateFieldPhoto(photo.id, {
                                officerConfirmedCoordinates: e.target.checked,
                              })
                            }
                            className="h-4 w-4 rounded border-[#CBD2D9] accent-[#9D1D26]"
                          />
                          <span>Cán bộ xác nhận tọa độ GPS hợp lệ</span>
                        </label>

                        <label className="inline-flex items-center gap-2 text-[#1F2429] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={photo.officerConfirmedAtParcel}
                            onChange={(e) =>
                              updateFieldPhoto(photo.id, {
                                officerConfirmedAtParcel: e.target.checked,
                              })
                            }
                            className="h-4 w-4 rounded border-[#CBD2D9] accent-[#9D1D26]"
                          />
                          <span>Cán bộ xác nhận ảnh chụp đúng tại thửa đất thẩm định</span>
                        </label>
                      </div>

                      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                        <input
                          type="text"
                          placeholder="Ghi chú thực địa của cán bộ (góc chụp, hiện trạng đường trước đất...)"
                          value={photo.officerNote}
                          onChange={(e) =>
                            updateFieldPhoto(photo.id, { officerNote: e.target.value })
                          }
                          className="banking-input sm:max-w-md"
                        />
                        <div className="text-[13px] font-semibold shrink-0">
                          {photo.officerConfirmedCoordinates && photo.officerConfirmedAtParcel ? (
                            <span className="inline-flex items-center gap-1.5 text-[#0B5D3F]">
                              <CheckCircle2 className="h-4 w-4" />
                              Đã xác nhận đầy đủ
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-[#8A5300]">
                              <AlertTriangle className="h-4 w-4" />
                              Chưa xác nhận vị trí chụp
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
