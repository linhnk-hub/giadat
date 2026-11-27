# M4-FIRESTORE SIMPLIFIED — GATE 2 SECURITY SPECIFICATION
## Zero-Trust Cloud Firestore Rules (Database: `giadat`, Single Fixed Admin: `linhnk2013@gmail.com`)

## 1. Kiến trúc phân quyền & Data Invariants (Bất biến bảo mật)

### 1.1 Mô hình định danh duy nhất (A1 — Single Fixed Admin Email)
- **Admin duy nhất**: `request.auth != null && request.auth.token.email is string && request.auth.token.email_verified == true && request.auth.token.email.lower() == 'linhnk2013@gmail.com'`.
- Không dùng Custom Claims, không cho phép tự đăng ký Admin, không lưu danh sách nhiều Admin trên client, không tồn tại tài khoản thứ hai có quyền ghi.
- Người dùng phổ thông (không đăng nhập hoặc đăng nhập tài khoản Google khác) **chỉ có quyền đọc dữ liệu công khai phi-PII** với giới hạn truy vấn bắt buộc (`limit`), **tuyệt đối không có quyền ghi/sửa/xóa** trên bất kỳ collection nào.

### 1.2 Sơ đồ 6 Collection & Master Source of Truth
1. `/dataset_categories/{datasetKind}` — Danh mục 4 loại dữ liệu cố định (`state_price`, `ecovis`, `k_factor_rules`, `market_survey`). Công khai `get` (0 PII), cấm `list`, chỉ Admin tạo/cập nhật, cấm xóa.
2. `/active_versions/{datasetKind}` — Con trỏ phiên bản đang kích hoạt cho từng loại dữ liệu (`state_price`, `ecovis`, `k_factor_rules`, `market_survey`). Công khai `get` (0 PII, không chứa email/UID), cấm `list`, chỉ Admin ghi và **bắt buộc đồng bộ nguyên tử** với `/dataset_versions/{activeVersionId}` (`commitState == 'committed'`) và `/activation_history/{lastEventId}`. Cấm xóa.
3. `/dataset_versions/{versionId}` — Sổ cái phiên bản dữ liệu (chứa `importedByUid`, `importedByEmail`, `commitState`, `payloadChecksum`). **Cách ly PII tuyệt đối**: chỉ Admin `get`/`list` (`limit <= 200`). Vòng đời chặt chẽ `staging -> committed | aborted` (trạng thái `committed` và `aborted` là **terminal state**, khóa vĩnh viễn). **Cấm xóa vĩnh viễn** để bảo toàn lịch sử và rollback.
4. `/dataset_records/{recordId}` — Bản ghi giá đất đã chuẩn hóa (phi-PII, gắn `geohash5`, `geohash6`, `districtKey`, `wardKey`, `streetKey`, `payload` dạng native Map). Công khai `get`/`list` **chỉ khi** `visibility == 'public' && isDemo == false` và `request.query.limit <= 500`. Khi Admin `create`, bắt buộc bản ghi phải thuộc một `dataset_versions/{versionId}` đang tồn tại, cùng `datasetKind`, và đang ở trạng thái `commitState == 'staging'` (chống bản ghi mồ côi và chống chèn thêm vào phiên bản đã `committed`). **Bất biến hoàn toàn**: cấm `update`, cấm `delete`.
5. `/activation_history/{eventId}` — Nhật ký kiểm toán kích hoạt & rollback (chứa `actorUid`, `actorEmail`). **Chỉ Admin `get`/`list` (`limit <= 200`) và `create` nguyên tử** cùng `/active_versions/{datasetKind}` (`getAfter`). **Append-only bất biến**: cấm `update`, cấm `delete`.
6. `/pdf_documents/{docId}` — Danh mục siêu dữ liệu tài liệu PDF tham chiếu (không lưu tệp nhị phân, 0 PII). Công khai `get`/`list` (`visibility == 'public'`, `limit <= 100`), chỉ Admin tạo/cập nhật/xóa.

### 1.3 Các bất biến bắt buộc (8 Pillars)
1. **Default-Deny Catch-All**: Mọi path ngoài 6 collection trên đều bị chặn `allow read, write: if false;`.
2. **Chống nạp dữ liệu DEMO**: `dataset_records` bắt buộc `isDemo == false` ở tầng Rules.
3. **Chống bịa giá thị trường / dữ liệu sai miền**: `unitPrice > 0`, `surveyUnitPrice > 0`, `factorValue > 0`, `areaSqm > 0`, `askingPriceVnd > 0`, tọa độ WGS84 `[-90, 90]` / `[-180, 180]` đồng bộ cặp `(latitude, longitude)` và `hasCoordinates`.
4. **Cách ly PII tuyệt đối**: Không có email, số điện thoại hay UID nào xuất hiện trong 4 collection công khai (`dataset_categories`, `active_versions`, `dataset_records`, `pdf_documents`).
5. **Tính nguyên tử (Atomicity)**: Không thể kích hoạt/rollback `/active_versions/{kind}` mà không ghi log `/activation_history/{eventId}` trong cùng batch, và không thể kích hoạt phiên bản chưa `committed`.
6. **Toàn vẹn thời gian (Temporal Integrity)**: `createdAt == request.time`, `updatedAt == request.time`, `createdAt` bất biến khi cập nhật.
7. **Không thể xóa phiên bản cũ**: `allow delete: if false;` trên `dataset_categories`, `active_versions`, `dataset_versions`, `dataset_records`, `activation_history`.
8. **Chống Denial-of-Wallet**: Mọi chuỗi có giới hạn `.size()`, mọi ID kiểm tra `isValidId()`, mọi `allow list` công khai bắt buộc `request.query.limit` và không dùng `get()`/`exists()` trong `allow list`.

---

## 2. The "Dirty Dozen" Adversarial Payloads (12 Kịch bản Tấn công — Bắt buộc `PERMISSION_DENIED`)

1. **Unauthenticated Write (Public Tampering)**: Khách chưa đăng nhập gửi `create` vào `/dataset_records/rec-1` hoặc `update` `/active_versions/state_price` → `PERMISSION_DENIED`.
2. **Non-Admin Google Account Escalation**: Người dùng đăng nhập Google hợp lệ (`email: "attacker@gmail.com"`, `email_verified: true`) gửi `create` vào `/dataset_versions/ver-1` hoặc `read` `/activation_history/evt-1` → `PERMISSION_DENIED`.
3. **Email Spoofing (`email_verified == false`)**: Token giả mạo có `email: "linhnk2013@gmail.com"` nhưng `email_verified: false` gọi bất kỳ thao tác Admin nào → `PERMISSION_DENIED`.
4. **Public PII Leakage (`dataset_versions` / `activation_history`)**: Người dùng công khai hoặc user Google thường gọi `get` hoặc `list` trên `/dataset_versions` hay `/activation_history` → `PERMISSION_DENIED`.
5. **Unbounded Collection Scraping (Query Trust Bypass)**: Khách công khai gọi `list /dataset_records` **không có `.limit()`** hoặc `limit(501)`, hoặc bỏ qua điều kiện `visibility == 'public' && isDemo == false` → `PERMISSION_DENIED`.
6. **Demo Data Poisoning**: Admin gửi `create /dataset_records/rec-demo` với `isDemo: true` → `PERMISSION_DENIED`.
7. **Shadow Field Injection**: Admin gửi `create /dataset_versions/ver-1` hoặc `update /pdf_documents/pdf-1` kèm trường lạ (`{ superAdmin: true }`, `{ hacked: 1 }`) → `PERMISSION_DENIED` (`hasOnly` / `affectedKeys().hasOnly`).
8. **Orphaned Record / Post-Commit Tampering**: Admin gửi `create /dataset_records/rec-2` trỏ tới `versionId` không tồn tại, sai `datasetKind`, hoặc phiên bản đã `commitState == 'committed'` → `PERMISSION_DENIED`.
9. **Uncommitted Activation / Missing Audit Log (Atomicity Bypass)**: Admin `update /active_versions/state_price` trỏ tới phiên bản đang `staging`, HOẶC cập nhật `active_versions` mà không tạo đồng thời `/activation_history/{lastEventId}` trong cùng batch → `PERMISSION_DENIED`.
10. **Terminal State Violation & Version Deletion**: Admin cố gắng `update` `/dataset_versions/ver-1` sau khi `commitState == 'committed'` (ví dụ đổi về `'staging'`), hoặc gọi `delete` trên `/dataset_versions/ver-1`, `/dataset_records/rec-1`, `/activation_history/evt-1` → `PERMISSION_DENIED`.
11. **Value Poisoning & Resource Exhaustion (ID / String Overflow)**: Admin gửi `docId` dài > 128 ký tự hoặc chứa ký tự đặc biệt (`../hack`), hoặc chuỗi `streetName` dài > 240 ký tự, hoặc `unitPrice: -1000`, hoặc `latitude: 999` → `PERMISSION_DENIED`.
12. **Timestamp Forgery & Identity Spoofing**: Admin tạo `/dataset_versions/ver-1` với `createdAt != request.time` hoặc `importedByUid != request.auth.uid` hoặc `importedByEmail != 'linhnk2013@gmail.com'` → `PERMISSION_DENIED`.
