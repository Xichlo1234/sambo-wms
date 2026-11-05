# SAMBO GOLD – WAREHOUSE MANAGEMENT SYSTEM

Hệ thống quản lý kho vật tư, thiết bị, mua hàng, nhà cung cấp và kho hóa chất cho mỏ vàng SAMBO GOLD.

| Thành phần | Công nghệ |
|---|---|
| Frontend | React 18 + TypeScript, Tailwind CSS, TanStack Query, React Hook Form + Zod, Recharts |
| Backend | Node.js 22 + Express 5 (TypeScript), REST API |
| Database | PostgreSQL 16 + Prisma ORM (migration) |
| Báo cáo | ExcelJS (Excel), pdfmake (PDF tiếng Việt) |
| Bảo mật | Phiên đăng nhập httpOnly cookie + bảng sessions (thu hồi được), RBAC, chống CSRF, rate-limit, audit log |
| Triển khai | Máy chủ nội bộ / VPS (systemd) hoặc Docker; công khai an toàn qua Cloudflare Tunnel |

## Tiến độ theo giai đoạn

| Giai đoạn | Nội dung | Trạng thái |
|---|---|---|
| 1 | Phân tích, thiết kế, database, các điểm cần xác nhận | ✅ `docs/01`, `docs/02` |
| 2 | Nền tảng: đăng nhập, phân quyền, dashboard, nhật ký, cấu hình | ✅ |
| 3 | Kho mỏ: danh mục, nhập, xuất, tồn, thẻ kho, kiểm kê, điều chuyển, trả lại, điều chỉnh, báo cáo | ✅ |
| 6 (một phần) | Import Excel, sao lưu/khôi phục, thông báo, mẫu biểu in, hướng dẫn vận hành | ✅ |
| 4 | Kho hóa chất (lô/batch, FEFO, SDS/MSDS, an toàn) | ⏳ tiếp theo |
| 5 | Mua hàng & đánh giá nhà cung cấp (PR, RFQ, PO, theo dõi giao hàng) | ⏳ |
| 7 | Kiểm thử nghiệm thu với dữ liệu thật, đào tạo, vận hành | ⏳ |

## Chạy nhanh (môi trường phát triển)

```bash
# 1. CSDL
createdb sambo_wms            # hoặc dùng PostgreSQL sẵn có
# 2. Backend
cd server && cp .env.example .env   # sửa DATABASE_URL, STORAGE_DIR=./storage, COOKIE_SECURE=false
npm install && npx prisma migrate deploy && SEED_DEMO=true npm run seed
npm run dev                          # API tại http://localhost:4000
# 3. Frontend (cửa sổ khác)
cd client && npm install && npm run dev   # http://localhost:5173
```

Tài khoản: `admin` / mật khẩu in ra khi seed (mặc định `Admin@2026`, bắt buộc đổi). Dữ liệu demo (chỉ môi trường đào tạo): `thukho`, `quanlykho`, `baotri`, `khaithac`, `ketoan`, `giamdoc`… mật khẩu `Demo@2026`.

## Kiểm thử

```bash
cd server && npm test     # tạo DB kiểm thử tạm riêng, chạy 21 kịch bản nghiệp vụ, rồi xóa DB tạm
```

## Triển khai & cập nhật

Xem `docs/04-cai-dat-trien-khai.md`. Tóm tắt:
- Đóng gói: `bash deploy/package.sh 1.0.1`
- Cài lần đầu: `sudo bash deploy/install.sh sambo-wms-1.0.1.tar.gz`
- Cập nhật (không ghi đè dữ liệu, tự sao lưu, tự quay lui nếu lỗi): `sudo bash deploy/update.sh sambo-wms-1.0.2.tar.gz`
- Docker: `cd deploy && cp .env.docker.example .env && docker compose up -d --build`

## Cấu trúc thư mục

```
server/   prisma/schema.prisma, migrations/, seed.ts · src/modules (API theo module) · src/services/inventory.ts (bộ máy ghi sổ) · tests/
client/   src/pages (màn hình) · src/components (UI dùng chung) · src/lib (API, quyền, định dạng)
deploy/   install.sh, update.sh, package.sh, backup.sh, restore.sh, systemd, Docker, Cloudflare Tunnel, Nginx
docs/     01 phân tích thiết kế · 02 database · 03 API · 04 cài đặt triển khai · 05 hướng dẫn sử dụng · 06 kiểm thử
```
