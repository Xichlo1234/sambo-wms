# 06 – Kết quả kiểm thử (Giai đoạn 1–3)

## 1. Kiểm thử nghiệp vụ tự động – `server/tests/mining.test.ts`
Chạy `cd server && npm test` (mỗi lần tạo CSDL tạm mới, áp migration, seed demo, xóa sau khi xong).
**Kết quả: 21/21 kịch bản đạt.**

| # XIX | Kịch bản | Kết quả |
|---|---|---|
| 1 | Tạo vật tư; chặn trùng mã; cảnh báo tên/quy cách tương tự; chặn tối đa < tối thiểu; tìm không dấu | Đạt |
| 2 | Import Excel: xem trước 6 dòng (2 mới, 1 trùng, 3 lỗi), chặn nhập khi còn lỗi, nhập dòng hợp lệ, **không ghi đè** mã đã có | Đạt |
| 3–5 | Phiếu nhập 3 dòng có thiếu hàng, chờ KT, không đạt; bắt buộc 3 bước kiểm tra; chưa duyệt không tăng tồn; người lập không tự duyệt; duyệt → tồn đúng; duyệt lần 2 bị chặn; xử lý hàng chờ KT | Đạt |
| – | Ẩn đơn giá với người không có quyền xem giá trị | Đạt |
| 6–9 | Bộ phận chỉ lập cho bộ phận mình; duyệt vượt tồn bị chặn; xuất vượt SL duyệt bị chặn; xuất → tồn giảm đúng; xác nhận điện tử sai tên bị chặn | Đạt |
| – | Vượt định mức bắt buộc lý do; giữ chỗ chặn duyệt/điều chỉnh lấn SL đã duyệt; hủy phiếu giải phóng giữ chỗ | Đạt |
| 10 | Hủy phiếu chưa ghi sổ; không hủy/xóa phiếu đã ghi sổ; sổ cái không sửa được (trigger) | Đạt |
| 11 | Điều chỉnh: bắt buộc lý do, không tự duyệt, chặn làm âm kho | Đạt |
| 12–13 | Kiểm kê: chốt sổ, nhập số không đổi tồn, bắt buộc giải trình, duyệt mới điều chỉnh, báo cáo chênh lệch | Đạt |
| – | Điều chuyển ghi sổ 2 chiều; hàng trả lại chỉ tăng khả dụng phần dùng được | Đạt |
| – | Thẻ kho lũy kế đúng; tồn tại thời điểm quá khứ; khóa kỳ chặn ghi sổ | Đạt |
| 18–19 | Phân quyền (403/404 đúng), chống CSRF, nhật ký có người/IP/phiên | Đạt |
| 20 | 11 báo cáo kho mỏ JSON + Excel, PDF, thẻ kho PDF, in phiếu; NXT: đầu kỳ + nhập − xuất = cuối kỳ | Đạt |
| 21 | Sao lưu, kiểm tra toàn vẹn, khôi phục, đối chiếu sau khôi phục | Đạt |
| 22 | Hai người cùng duyệt 1 phiếu → 1 thành công, 1 nhận 409, chỉ 1 lần ghi sổ | Đạt |
| 23 | 5 yêu cầu đồng thời cùng mặt hàng vượt tồn → chỉ 2 được duyệt, xuất đồng thời không âm kho, số dư khớp sổ cái | Đạt |
| – | Bấm lưu 2 lần đồng thời → chỉ 1 chứng từ | Đạt |
| 14–17 | Hóa chất (lô, hạn dùng, chặn xuất hết hạn, SDS) | Giai đoạn 4 |

## 2. Kiểm thử vận hành qua giao diện (vai trò người dùng thật, trình duyệt tự động)
Luồng: Thủ kho lập phiếu nhập trên giao diện → Quản lý duyệt & ghi sổ → Bộ phận Bảo trì lập yêu cầu cấp → Quản lý duyệt → Thủ kho xuất (gợi ý vị trí) → Người nhận xác nhận điện tử → kiểm tra Tồn kho, Dashboard, tìm kiếm toàn hệ thống; duyệt 16 màn hình với vai trò thủ kho và 5 màn hình quản trị. **Kết quả: toàn bộ thành công, không có lỗi JavaScript/HTTP 5xx.**

## 3. Lỗi phát hiện & đã khắc phục
| Lỗi | Nguyên nhân | Module | Khắc phục | Kiểm thử lại |
|---|---|---|---|---|
| Khôi phục dữ liệu ra sai phiên bản | Bản sao lưu an toàn tạo cùng giây → **trùng tên file, ghi đè bản gốc** | backup | Tên file gồm mili-giây + chuỗi ngẫu nhiên, kiểm tra tồn tại trước khi ghi | Kịch bản 21 đạt |
| Số lượng trả về dạng chuỗi ("105") | `Decimal.toJSON` chạy trước JSON replacer | app (toàn cục) | Ghi đè `Decimal.prototype.toJSON` trả về số | Kịch bản 12–13 đạt |
| Lọc từ khóa qua liên kết không áp dụng | Trang Tồn kho/danh sách chứng từ không đọc `q` trên URL | client | Khởi tạo từ khóa từ URL | Kiểm tra giao diện |

## 4. Bảo mật đã áp dụng
Mật khẩu bcrypt; khóa tạm sau 5 lần sai + rate limit; phiên httpOnly SameSite=Strict, thu hồi khi đăng xuất/đổi mật khẩu/khóa tài khoản; header chống CSRF; Helmet CSP; kiểm tra quyền & phạm vi dữ liệu ở mọi API; Zod kiểm tra đầu vào; upload kiểm tra đuôi + MIME + magic bytes, tên lưu ngẫu nhiên, ngoài thư mục web; dữ liệu nhạy cảm NCC ẩn theo quyền; audit log bất biến.
