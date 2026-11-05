# 06 – Kết quả kiểm thử (v1.1 – Kho mỏ · Kho hóa chất · Mua hàng)

## 1. Kiểm thử nghiệp vụ tự động
`cd server && npm test` – mỗi lần tạo CSDL tạm mới, áp toàn bộ migration, seed demo, chạy, rồi xóa CSDL tạm.
**Kết quả: 38/38 kịch bản đạt, ổn định qua nhiều lần chạy liên tiếp.**

| Bộ | Số KB | Nội dung chính |
|---|---|---|
| `mining.test.ts` | 21 | Kịch bản XIX 1–13, 18–23: danh mục, import Excel, nhập nhiều dòng & phê duyệt, xuất & giữ chỗ, chặn xuất vượt tồn, hủy, điều chỉnh, kiểm kê, điều chuyển, trả lại, thẻ kho, tồn quá khứ, khóa kỳ, phân quyền, nhật ký, 11 báo cáo Excel/PDF, sao lưu–khôi phục, duyệt đồng thời, xuất đồng thời, chống tạo trùng |
| `chemical.test.ts` | 12 | **XIX 14–17**: tách biệt kho hóa chất; CAS, SDS bắt buộc trước khi xác nhận an toàn; sửa trường an toàn hủy xác nhận; chặn nhập thiếu SDS/lô/HSD/hóa chất hết hạn/thiếu kiểm tra; nhiều lô cùng mã khác HSD không gộp; cách ly/không đạt; người lập không tự duyệt; cảnh báo 30/60/90; tồn được phép xuất loại lô hết hạn/cách ly; chặn xuất lô hết hạn & cách ly; FEFO + gợi ý FEFO; HSE xác nhận cho hóa chất kiểm soát; SDS quá hạn chặn xuất; quy tắc lưu trữ chỉ cảnh báo khi đã xác nhận; kiểm tra kho & sự cố; kiểm kê theo lô; tiêu hủy; xuất đồng thời không âm lô, sổ cái lô khớp & bất biến; 10 báo cáo hóa chất; hồi quy trường trống |
| `purchasing.test.ts` | 5 | Gợi ý từ tồn thấp (không tự đặt hàng); PR → duyệt độc lập; RFQ 2 NCC & so sánh, ẩn giá với người không có quyền; PO từ báo giá → duyệt (người khác) → gửi; chặn nhập trước khi PO duyệt / vượt SL đặt / sai mặt hàng; nhận một phần → PARTIAL; không hủy PO đã nhận; 2 phiếu nhận đồng thời phần còn lại → chỉ 1 ghi sổ → RECEIVED; PO hóa chất ↔ phiếu nhập hóa chất; PO trễ hạn; hồ sơ NCC, so sánh, đánh giá, khiếu nại; 5 báo cáo mua hàng |

## 2. Kiểm thử vận hành qua giao diện (trình duyệt tự động, đóng vai từng người dùng)
Trên CSDL demo mới, bản build cuối cùng:
- **Kho mỏ:** thủ kho lập phiếu nhập → quản lý duyệt → bộ phận yêu cầu cấp → duyệt → thủ kho xuất theo vị trí → người nhận xác nhận; duyệt 21 màn hình.
- **Kho hóa chất:** thủ kho HC tải SDS → HSE xác nhận tài liệu & thông tin an toàn → tiếp nhận 2 lô (5 bước kiểm tra) → quản lý duyệt nhập → bộ phận nhà máy yêu cầu 130 kg → duyệt → xuất theo lô (gợi ý FEFO 100 + 30 đúng thứ tự HSD) → xác nhận nhận; cách ly lô; kiểm kê theo lô & duyệt; ghi kiểm tra kho & sự cố; duyệt 9 màn hình.
- **Mua hàng:** bộ phận lập đề nghị từ gợi ý tồn thấp → duyệt → mua hàng gửi RFQ 2 NCC, nhập giá, so sánh, chọn → PO → giám đốc duyệt → gửi NCC → thủ kho lập phiếu nhập từ PO (nhận thiếu 50%) → duyệt → PO "Giao một phần"; đánh giá NCC; duyệt 7 màn hình.
- **Phân quyền:** thủ kho vật tư bị chặn ở kho hóa chất; người dùng bộ phận bị chặn ở phiếu nhập kho.
- **Kết quả:** 0 lỗi JavaScript, 0 lỗi HTTP ngoài dự kiến. Đối chiếu sau kiểm thử: số dư kho mỏ lệch sổ cái **0**, tồn lô hóa chất lệch sổ cái lô **0**.

## 3. Kiểm tra nâng cấp không ghi đè
CSDL đang chạy v1.0 (có giao dịch) → `prisma migrate deploy` áp migration 1.1 (chỉ thêm bảng/cột) → seed: vai trò mặc định được cấp **chỉ các quyền của module mới**, không đụng quyền đã tùy chỉnh → số giao dịch, vật tư giữ nguyên. Gói phát hành build được hoàn toàn từ tarball.

## 4. Lỗi phát hiện & đã khắc phục
| Lỗi | Nguyên nhân | Module | Khắc phục | Kiểm thử lại |
|---|---|---|---|---|
| Khôi phục ra sai bản sao lưu | Bản sao lưu an toàn tạo cùng giây trùng tên, ghi đè bản gốc | backup | Tên file mili-giây + ngẫu nhiên, chặn ghi đè | KB 21 |
| Số lượng trả về dạng chuỗi | `Decimal.toJSON` chạy trước replacer | app | Ghi đè `Decimal.prototype.toJSON` | KB 12–13 |
| **Trường để trống bị lưu thành 0 / ngày 1970** (vd nhiệt độ bảo quản trống → 0°C, ngày giao dự kiến trống → bị chặn) | `z.coerce` ép `null` trước khi thử nhánh `null` trong union | 27 vị trí, 11 module | Đặt `z.null()` / `''` trước nhánh coerce | KB hồi quy + E2E |
| Thủ kho hóa chất không tải được danh sách người nhận | API `/users/lookup` thiếu quyền `chemicals.issue` | users | Bổ sung quyền | E2E |
| Người dùng bộ phận xem được phiếu nhập hóa chất & mọi PO | Quyền mặc định quá rộng | permissions | Bộ phận chỉ có `chemicals.request`, `purchase.request`; danh sách đề nghị mua lọc theo bộ phận | E2E |
| Thứ tự kiểm tra khi giải phóng lô hết hạn | Báo "đã ở trạng thái này" thay vì cảnh báo hết hạn | chemicals | Kiểm tra HSD trước | KB 15–16 |
| Lọc từ khóa qua liên kết không áp dụng | Không đọc `q` từ URL | client | Đọc từ URL | Giao diện |

## 5. Bảo mật
Như v1.0, bổ sung: kiểm tra phạm vi dữ liệu bộ phận cho yêu cầu hóa chất & đề nghị mua; ẩn đơn giá mua với người không có `purchase.view_value`; HSE/người phê duyệt không được xác nhận phiếu do chính mình yêu cầu; sổ cái lô hóa chất bất biến bằng trigger.
