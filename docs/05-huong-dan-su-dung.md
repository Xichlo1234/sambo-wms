# 05 – Hướng dẫn sử dụng

Hướng dẫn chi tiết từng quy trình (SOP đào tạo, có ô tìm kiếm) nằm **ngay trong ứng dụng**: menu **Hướng dẫn vận hành**. Tài liệu này tóm tắt theo vai trò.

| Vai trò | Công việc hằng ngày | Màn hình |
|---|---|---|
| Thủ kho (Warehouse Officer) | Lập phiếu nhập (kiểm chứng từ, kiểm đếm, quy cách → đính kèm → gửi duyệt); xuất kho phiếu đã duyệt; xử lý hàng chờ kiểm tra; lập điều chuyển, kiểm tra hàng trả lại, kiểm kê | Nhập kho, Xuất kho, Kiểm kê, Điều chuyển, Hàng trả lại |
| Quản lý kho | Duyệt phiếu nhập, yêu cầu cấp, điều chuyển, trả lại, điều chỉnh, kiểm kê; theo dõi cảnh báo; khóa kỳ | Dashboard → Công việc cần xử lý; chuông thông báo |
| Bộ phận sử dụng | Lập yêu cầu cấp vật tư / sử dụng hóa chất / đề nghị mua; xác nhận đã nhận (gõ họ tên); lập phiếu trả. Chỉ thấy chứng từ của bộ phận mình | Xuất kho, Xuất hóa chất, Đề nghị mua, Hàng trả lại |
| Kế toán | Báo cáo NXT, tồn theo thời điểm, đối chiếu chứng từ & giá trị (khi được cấp quyền) | Báo cáo, Tồn kho, Thẻ kho |
| Ban giám đốc | Dashboard, báo cáo tổng hợp, nhật ký | Dashboard, Báo cáo |
| Thủ kho hóa chất | Tiếp nhận & nhập hóa chất theo lô (5 bước kiểm tra), xuất theo lô FEFO, quản lý lô (cách ly/giải phóng), kiểm kê theo lô, lập phiếu tiêu hủy, ghi sự cố | Kho hóa chất |
| HSE / An toàn hóa chất | Xác nhận SDS & thông tin an toàn, xác nhận phiếu xuất hóa chất kiểm soát đặc biệt, quy tắc lưu trữ, nhật ký kiểm tra kho, xử lý sự cố | Kho hóa chất → SDS/MSDS, Cảnh báo an toàn |
| Mua hàng | Lập yêu cầu báo giá, nhập & so sánh giá, lập PO, theo dõi giao hàng, hồ sơ – đánh giá – khiếu nại NCC | Mua hàng, Nhà cung cấp |
| Giám đốc | Phê duyệt đơn đặt hàng (mặc định), xem dashboard & báo cáo | Dashboard, Đơn đặt hàng |
| Super Admin | Người dùng, phân quyền, cấu hình, sao lưu, nhật ký | Hệ thống |

**Mẹo:** Ctrl+K để tìm nhanh; gõ không dấu vẫn tìm được; mọi danh sách đều lọc theo trạng thái/ngày; mọi báo cáo có Excel / PDF / In; mỗi chứng từ có nút **In phiếu (PDF)** theo mẫu có ô ký.

**Thông báo lỗi thường gặp & cách xử lý**
| Thông báo | Xử lý |
|---|---|
| "Không đủ tồn khả dụng…" | Giảm SL duyệt/xuất, kiểm tra phiếu khác đang giữ chỗ, hoặc đề nghị mua hàng |
| "Không được tự phê duyệt…" | Nhờ người có thẩm quyền khác duyệt |
| "Kỳ kho đã khóa…" | Dùng ngày chứng từ sau ngày khóa hoặc đề nghị mở khóa kỳ |
| "Trạng thái chứng từ đã thay đổi…" | Người khác vừa xử lý – tải lại trang |
| "Phát hiện mặt hàng tương tự" | Kiểm tra danh sách, tránh tạo trùng mã |
| "Bắt buộc ghi lý do / giải trình" | Nhập lý do vào ô tương ứng (thiếu/thừa, vượt định mức, chênh lệch kiểm kê) |
| "Chưa đủ điều kiện nhập kho hóa chất…" | Bổ sung mã lô, HSD, hoàn tất 5 bước kiểm tra; tải SDS còn hiệu lực tại hồ sơ hóa chất |
| "Lô … bị chặn xuất: Đã hết hạn / Đang bị cách ly…" | Chọn lô khác đủ điều kiện; lô hết hạn lập phiếu tiêu hủy; lô cách ly cần người có thẩm quyền giải phóng |
| "vi phạm nguyên tắc FEFO" | Xuất hết lô có HSD sớm hơn trước (dùng gợi ý của hệ thống) |
| "phải được HSE xác nhận" | Đề nghị HSE xác nhận an toàn trên phiếu (hóa chất kiểm soát đặc biệt) |
| "vượt SL còn lại của đơn …" | Phần giao thừa ghi "không đạt / trả lại" hoặc lập PO bổ sung |
