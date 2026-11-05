# Nhật ký phiên bản

## 1.1.0 – Kho hóa chất · Mua hàng · Nhà cung cấp
**Mới**
- Phân hệ **Kho hóa chất** tách biệt hoàn toàn với kho vật tư: danh mục & hồ sơ an toàn (GHS, H/P, bảo quản, PPE…), SDS/MSDS có phiên bản – hạn rà soát – xác nhận chuyên môn, nhập kho theo **lô** (5 bước kiểm tra tiếp nhận, Đạt/Cách ly/Không đạt, từ chối tiếp nhận), xuất theo lô **FEFO**, chặn lô hết hạn/cách ly/không đạt/thiếu SDS, HSE xác nhận cho hóa chất kiểm soát đặc biệt, quản lý lô & cảnh báo hạn 30/60/90 ngày (cấu hình), tồn lâu, bao bì bất thường, kiểm kê theo lô, điều chỉnh/tiêu hủy, quy tắc lưu trữ không tương thích, nhật ký kiểm tra kho & sự cố.
- Phân hệ **Mua hàng**: đề nghị mua (gợi ý từ tồn dưới tối thiểu), yêu cầu báo giá nhiều NCC & bảng so sánh, đơn đặt hàng, theo dõi giao hàng/giao chậm, lịch sử mua hàng; phiếu nhập kho mỏ & hóa chất liên kết dòng PO, tự cập nhật Giao một phần / Đã giao đủ.
- **Nhà cung cấp**: hồ sơ đầy đủ, thống kê (số lần mua, giá trị, đúng hạn, giao thiếu, hàng lỗi), lịch sử giao dịch, đánh giá A–D, khiếu nại, so sánh NCC theo mặt hàng.
- 15 báo cáo mới (10 hóa chất, 5 mua hàng) – tổng 26 báo cáo; 5 mẫu in mới; import danh mục hóa chất; dashboard & việc cần xử lý liên phân hệ; menu bỏ nhãn "5.1".

**Sửa lỗi**: trường để trống bị lưu thành 0 / ngày 1970 (27 vị trí); thủ kho hóa chất không tải được người nhận; thu hẹp quyền mặc định của người dùng bộ phận.

**Nâng cấp từ 1.0** (không ghi đè dữ liệu): `sudo bash deploy/update.sh sambo-wms-1.1.0.tar.gz`
- Tự sao lưu CSDL trước khi cập nhật; áp migration `20261106000000_chemicals_purchasing` (chỉ thêm bảng/cột).
- Seed cấp **chỉ các quyền của module mới** cho vai trò mặc định; quyền đã tùy chỉnh được giữ nguyên.
- Sau cập nhật: Cấu hình → kiểm tra "Chính sách kho hóa chất & mua hàng"; thêm vị trí cho kho hóa chất; gán vai trò Chemical Store Officer / HSE / Procurement cho người dùng.

## 1.0.0 – Nền tảng & Kho mỏ
Đăng nhập, phân quyền RBAC, dashboard, kho mỏ (danh mục, nhập, xuất, tồn, thẻ kho, kiểm kê, điều chuyển, trả lại, điều chỉnh, khóa kỳ), 11 báo cáo, import Excel, sao lưu/khôi phục, nhật ký, hướng dẫn vận hành.
