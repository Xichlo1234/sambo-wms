# 04 – Cài đặt, triển khai & cập nhật

## A. Máy chủ nội bộ / VPS (Ubuntu 22.04/24.04) – khuyến nghị
Yêu cầu tối thiểu: 2 vCPU, 4 GB RAM, 40 GB SSD (quy mô < 1.000 mã, 10–30 phiếu/ngày).

**Cài lần đầu**
```bash
# Trên máy phát triển: đóng gói
bash deploy/package.sh 1.0.0            # → deploy/dist/sambo-wms-1.0.0.tar.gz
# Chép file lên máy chủ, rồi:
mkdir -p /tmp/wms && tar -xzf sambo-wms-1.0.0.tar.gz -C /tmp/wms
sudo bash /tmp/wms/deploy/install.sh /path/sambo-wms-1.0.0.tar.gz
```
Script cài Node 22 + PostgreSQL, tạo user `wms`, CSDL `sambo_wms`, file cấu hình `/opt/sambo-wms/shared/.env` (mật khẩu ngẫu nhiên), dịch vụ systemd `sambo-wms`, rồi triển khai phiên bản đầu. **Mật khẩu admin ban đầu được in ra màn hình – lưu lại, bắt buộc đổi khi đăng nhập.**

**Cập nhật phiên bản mới (chạy luôn, không ghi đè)**
```bash
sudo bash /tmp/wms-new/deploy/update.sh sambo-wms-1.0.1.tar.gz
```
`update.sh` thực hiện: (1) sao lưu CSDL `pre_update_*.dump`; (2) giải nén vào thư mục phiên bản **mới** `/opt/sambo-wms/releases/<version>` (không đè phiên bản cũ); (3) `npm ci` + build; (4) `prisma migrate deploy` – chỉ áp các migration mới, **không reset, không xóa dữ liệu**; (5) seed idempotent – chỉ thêm quyền/vai trò mới, không đổi dữ liệu đã có; (6) chuyển symlink `current` và khởi động lại; (7) kiểm tra `/api/health`, **tự quay về phiên bản trước nếu lỗi**.
Dữ liệu không nằm trong thư mục mã nguồn: CSDL PostgreSQL, file `/var/lib/sambo-wms/{uploads,backups}`, cấu hình `/opt/sambo-wms/shared/.env`.

Quy ước cho mọi bản cập nhật sau: thay đổi cấu trúc CSDL luôn bằng **migration mới** (thêm bảng/cột, không sửa migration cũ, không xóa cột có dữ liệu khi chưa có kế hoạch chuyển đổi được phê duyệt).

Lệnh vận hành: `systemctl status|restart sambo-wms` · log: `journalctl -u sambo-wms -f`.

## B. Docker
```bash
cd deploy && cp .env.docker.example .env   # đặt DB_PASSWORD, SEED_ADMIN_PASSWORD
docker compose up -d --build
# Cập nhật: thay mã nguồn mới → docker compose up -d --build (volume pgdata, wmsdata giữ nguyên)
```

## C. Truy cập từ xa qua Cloudflare (không mở cổng router)
1. Cloudflare Zero Trust → Networks → Tunnels → Create tunnel → lấy token.
2. Docker: đặt `CLOUDFLARE_TUNNEL_TOKEN` trong `deploy/.env` → `docker compose --profile cloudflare up -d`.
   Máy chủ thường: cài `cloudflared`, dùng `deploy/cloudflared-config.example.yml`.
3. Public hostname `wms.<tên-miền>` → `http://localhost:4000`. Đặt `COOKIE_SECURE=true` trong `.env` rồi khởi động lại.
4. (Khuyến nghị) Bật Cloudflare Access để chỉ email công ty truy cập được.
Hệ thống đọc IP thật qua header `CF-Connecting-IP` để ghi nhật ký.
Lý do không dùng Cloudflare D1 làm CSDL: xem `01-phan-tich-thiet-ke.md` mục 5.

## D. Sao lưu & khôi phục
- Tự động theo `BACKUP_CRON` (mặc định 01:30 hằng ngày), giữ `BACKUP_KEEP` bản; tự kiểm tra toàn vẹn sau khi sao lưu.
- Thủ công: menu Sao lưu & khôi phục, hoặc `bash deploy/backup.sh` (thêm `R2_REMOTE=r2:bucket` để đẩy lên Cloudflare R2 qua rclone).
- Khôi phục trong ứng dụng: kiểm tra toàn vẹn → tự sao lưu an toàn → `pg_restore` trong 1 transaction.
- **Quy trình sự cố khi ứng dụng không chạy:** `sudo bash deploy/restore.sh /var/lib/sambo-wms/backups/<file>.dump` → đăng nhập → Cấu hình → Chạy đối chiếu dữ liệu kho.
- Khuyến nghị: mỗi tuần chép bản sao lưu ra nơi khác (R2/ổ ngoài); mỗi quý diễn tập khôi phục lên máy thử.

## E. Biến môi trường (server/.env)
Xem `server/.env.example` (DATABASE_URL, PORT, SESSION_TTL_HOURS, COOKIE_SECURE, STORAGE_DIR, UPLOAD_MAX_MB, PG_BIN_DIR, BACKUP_CRON, BACKUP_KEEP, SERVE_CLIENT, CLIENT_DIST, CORS_ORIGIN).
Chạy **một tiến trình** Node (systemd/Docker mặc định) – cache phiên trong bộ nhớ được làm mới khi đổi quyền.

## F. Nhập dữ liệu thực tế lần đầu (go-live)
1. Đăng nhập admin, đổi mật khẩu; Cấu hình: tên công ty, kho, vị trí, nhóm vật tư, ĐVT.
2. Import Bộ phận → Nhà cung cấp → Danh mục vật tư (Import Excel, xem trước, sửa lỗi).
3. Tạo người dùng & gán vai trò/bộ phận.
4. Import Tồn kho ban đầu → Quản lý kho duyệt phiếu tồn đầu kỳ → đối chiếu với kiểm kê thực tế.
5. Khóa kỳ đến ngày chốt tồn đầu kỳ.
