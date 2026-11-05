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
| 4 | **Kho hóa chất** – phân hệ riêng: lô/batch, HSD, FEFO, SDS/MSDS, GHS, kiểm soát đặc biệt (HSE xác nhận), cách ly, kiểm kê theo lô, tiêu hủy, nhật ký kiểm tra & sự cố | ✅ v1.1 |
| 5 | **Mua hàng & NCC** – Đề nghị mua → Yêu cầu báo giá/so sánh → PO → Phiếu nhập (mỏ & hóa chất), theo dõi giao hàng, hồ sơ – đánh giá – so sánh – khiếu nại NCC | ✅ v1.1 |
| 6 | Import Excel (vật tư, tồn đầu kỳ, hóa chất, NCC, bộ phận), sao lưu/khôi phục, thông báo, mẫu biểu in, 26 báo cáo, hướng dẫn vận hành | ✅ |
| 7 | Nghiệm thu với dữ liệu thật, đào tạo người dùng, vận hành | ⏳ cần công ty phối hợp |

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

Tài khoản: `admin` / mật khẩu in ra khi seed (mặc định `Admin@2026`, bắt buộc đổi). Dữ liệu demo (chỉ môi trường đào tạo): `thukho`, `quanlykho`, `baotri`, `khaithac`, `ketoan`, `giamdoc`, `muahang`, `khohc` (kho hóa chất), `hse`, `nhamay`… mật khẩu `Demo@2026`.

## Kiểm thử

```bash
cd server && npm test     # tạo DB kiểm thử tạm riêng, chạy 38 kịch bản nghiệp vụ (kho mỏ, hóa chất, mua hàng), rồi xóa DB tạm
```

## Triển khai & cập nhật

Hướng dẫn từng bước (máy chủ + Supabase + Cloudflare, 0 đồng): `docs/07-trien-khai-supabase-cloudflare.md`. Chi tiết kỹ thuật: `docs/04-cai-dat-trien-khai.md`. Tóm tắt:
- Đóng gói: `bash deploy/package.sh 1.1.0`
- Cài lần đầu: `sudo bash deploy/install.sh sambo-wms-1.1.0.tar.gz`
- Cập nhật (không ghi đè dữ liệu, tự sao lưu, tự quay lui nếu lỗi): `sudo bash deploy/update.sh sambo-wms-1.1.0.tar.gz` – từ 1.0 lên 1.1: tự áp migration thêm bảng hóa chất & mua hàng, tự cấp quyền module mới cho vai trò mặc định, giữ nguyên quyền đã tùy chỉnh
- Docker: `cd deploy && cp .env.docker.example .env && docker compose up -d --build`

## Cấu trúc thư mục

```
server/   prisma/schema.prisma, migrations/, seed.ts · src/modules (API theo module) · src/services/inventory.ts (bộ máy ghi sổ) · tests/
client/   src/pages (màn hình) · src/components (UI dùng chung) · src/lib (API, quyền, định dạng)
deploy/   install.sh, update.sh, package.sh, backup.sh, restore.sh, systemd, Docker, Cloudflare Tunnel, Nginx
docs/     01 phân tích thiết kế · 02 database · 03 API · 04 cài đặt triển khai · 05 hướng dẫn sử dụng · 06 kiểm thử · 07 triển khai Supabase + Cloudflare
```
