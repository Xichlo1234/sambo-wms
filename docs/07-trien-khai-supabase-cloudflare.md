# 07 – Triển khai thực tế: Máy chủ + Supabase + Cloudflare (0 đồng)

Mô hình:

```
Người dùng (trình duyệt, điện thoại)
        │  HTTPS  https://wms.<tên-miền>
        ▼
Cloudflare (DNS, HTTPS, Access – chỉ nhân viên công ty)
        │  Cloudflare Tunnel (không mở cổng router)
        ▼
Máy chủ ứng dụng (Ubuntu, chạy SAMBO WMS – Node.js)  ──►  Supabase (PostgreSQL, Singapore)
        │
        └── Sao lưu hằng đêm ──► Cloudflare R2
```

Thời gian thực hiện: khoảng 1–2 giờ. Làm lần lượt từ Bước 0 đến Bước 8.

---

## Bước 0 – Chuẩn bị

| Hạng mục | Yêu cầu |
|---|---|
| Máy chủ ứng dụng | Máy luôn bật (mini-PC / máy bàn / VPS), RAM ≥ 4 GB, ổ ≥ 40 GB, cài **Ubuntu 24.04 LTS**, có Internet. Nên có UPS |
| Tên miền | Đã thêm vào Cloudflare (gói Free) – ví dụ `sambogold.com` |
| Tài khoản | GitHub (`Xichlo1234`), Supabase, Cloudflare |

> Chỉ có máy Windows? Cài **WSL2 + Ubuntu 24.04** (PowerShell quyền Admin: `wsl --install -d Ubuntu-24.04`) rồi làm các bước trong cửa sổ Ubuntu. Dùng cho thử nghiệm; vận hành chính thức nên dùng máy Ubuntu riêng.

---

## Bước 1 – Tạo cơ sở dữ liệu Supabase

1. https://supabase.com → **New project**: Name `sambo-wms`, **Generate** mật khẩu và lưu lại, Region **Southeast Asia (Singapore)**, Plan **Free**.
2. **Database → Extensions** → bật **pg_trgm**.
3. **Project Settings → Data API** → **tắt** (hệ thống không dùng API công khai của Supabase).
4. Bấm **Connect** → chọn **Session pooler** → sao chép chuỗi kết nối, thay `[YOUR-PASSWORD]` bằng mật khẩu:
   ```
   postgresql://postgres.xxxxx:MATKHAU@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
   ```
   Mật khẩu nên chỉ gồm chữ và số (tránh `@ # / :`). Không dùng *Direct connection* hay *Transaction pooler*.

---

## Bước 2 – Lấy mã nguồn từ GitHub về máy chủ

Repository là Private nên cần token:

1. GitHub → ảnh đại diện → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - Repository access: **Only select repositories → sambo-wms**
   - Permissions → Repository → **Contents: Read-only**
   - Bấm Generate, sao chép token (bắt đầu bằng `github_pat_...`).
2. Trên máy chủ:
   ```bash
   sudo apt update && sudo apt install -y git curl
   ```
   ```bash
   git clone https://github.com/Xichlo1234/sambo-wms.git ~/sambo-wms
   ```
   Khi hỏi *Username* nhập `Xichlo1234`, *Password* dán token.

---

## Bước 3 – Cài đặt hệ thống

```bash
cd ~/sambo-wms && bash deploy/package.sh 1.1.0
```
```bash
sudo bash deploy/install.sh deploy/dist/sambo-wms-1.1.0.tar.gz
```

Script cài Node.js 22, công cụ PostgreSQL, tạo dịch vụ `sambo-wms` tự khởi động. **Ghi lại mật khẩu admin in ra màn hình.**
(Script tạo kèm một CSDL nội bộ để chạy được ngay; Bước 4 chuyển sang Supabase.)

Kiểm tra:
```bash
curl http://localhost:4000/api/health
```

---

## Bước 4 – Chuyển cơ sở dữ liệu sang Supabase

1. Ghi chuỗi Supabase vào cấu hình (thay `<CHUỖI_SUPABASE>`, giữ nguyên dấu nháy đơn):
   ```bash
   sudo sed -i "s#^DATABASE_URL=.*#DATABASE_URL='<CHUỖI_SUPABASE>'#" /opt/sambo-wms/shared/.env
   ```
2. Tạo bảng + dữ liệu ban đầu trên Supabase:
   ```bash
   cd /opt/sambo-wms/current/server && sudo -u wms bash -c 'set -a; . /opt/sambo-wms/shared/.env; set +a; npx prisma migrate deploy && npx tsx prisma/seed.ts'
   ```
3. Cài công cụ sao lưu đúng phiên bản Supabase (xem *Project Settings → Infrastructure*; ví dụ 17):
   ```bash
   sudo apt install -y postgresql-common && sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
   ```
   ```bash
   sudo apt install -y postgresql-client-17
   ```
   ```bash
   sudo sed -i 's#^PG_BIN_DIR=.*#PG_BIN_DIR=/usr/lib/postgresql/17/bin#' /opt/sambo-wms/shared/.env
   ```
4. Khởi động lại:
   ```bash
   sudo systemctl restart sambo-wms && curl http://localhost:4000/api/health
   ```
5. Supabase → **SQL Editor** → chạy để khóa quyền truy cập công khai:
   ```sql
   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
   REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
   ```
6. (Tùy chọn) Tắt CSDL nội bộ không còn dùng:
   ```bash
   sudo systemctl disable --now postgresql
   ```

---

## Bước 5 – Đăng nhập lần đầu (trong mạng nội bộ)

1. Trên máy cùng mạng LAN mở `http://<IP-máy-chủ>:4000` (xem IP bằng lệnh `hostname -I`).
2. Đăng nhập `admin` + mật khẩu ở Bước 3 → hệ thống bắt đổi mật khẩu.
3. **Cấu hình hệ thống**: tên công ty, kho (Kho tổng – Mỏ, Kho hóa chất), vị trí lưu kho, nhóm vật tư, đơn vị tính; *Chính sách kho hóa chất & mua hàng*.
4. **Sao lưu & khôi phục → Sao lưu ngay → Kiểm tra toàn vẹn** phải báo "Đạt".

---

## Bước 6 – Đưa ra Internet bằng Cloudflare Tunnel

1. dash.cloudflare.com → **Zero Trust → Networks → Tunnels → Create a tunnel** → *Cloudflared* → tên `sambo-wms`.
2. Chọn *Debian / 64-bit*, chạy trên máy chủ lệnh Cloudflare hiển thị (dạng `sudo cloudflared service install eyJ...`).
3. **Public Hostname**: Subdomain `wms`, Domain `<tên-miền>`, Service `HTTP` → `localhost:4000` → Save.
4. Bật cookie bảo mật cho HTTPS:
   ```bash
   sudo sed -i 's/^COOKIE_SECURE=.*/COOKIE_SECURE=true/' /opt/sambo-wms/shared/.env && sudo systemctl restart sambo-wms
   ```
5. Mở `https://wms.<tên-miền>` – đăng nhập được là xong. (Sau bước này truy cập qua `http://IP:4000` sẽ không giữ được đăng nhập – dùng địa chỉ HTTPS.)

**Giới hạn người truy cập (khuyến nghị, miễn phí ≤ 50 người):** Zero Trust → **Access → Applications → Add → Self-hosted** → domain `wms.<tên-miền>` → Policy *Allow* → *Emails ending in* `@<tên-miền-công-ty>` (hoặc danh sách email).

---

## Bước 7 – Sao lưu ngoài site lên Cloudflare R2 (miễn phí 10 GB)

1. Cloudflare → **R2** → Create bucket `sambo-wms-backup` → **Manage API tokens → Create** (Object Read & Write) → lưu *Access Key ID*, *Secret*, *Endpoint*.
2. Trên máy chủ:
   ```bash
   sudo apt install -y rclone && sudo rclone config
   ```
   Chọn `n` (new) → tên `r2` → `s3` → provider `Cloudflare` → nhập Access Key, Secret, Endpoint → các mục còn lại Enter.
3. Lịch đẩy bản sao lưu hằng đêm:
   ```bash
   echo '0 2 * * * root R2_REMOTE=r2:sambo-wms-backup bash /opt/sambo-wms/current/deploy/backup.sh' | sudo tee /etc/cron.d/sambo-wms-r2
   ```
4. Thử ngay:
   ```bash
   sudo R2_REMOTE=r2:sambo-wms-backup bash /opt/sambo-wms/current/deploy/backup.sh
   ```
5. Trên bucket R2 đặt *Lifecycle rule* xóa file cũ hơn 90 ngày.

Sao lưu hằng đêm cũng giữ cho dự án Supabase luôn "hoạt động", tránh bị tạm dừng.

---

## Bước 8 – Nhập dữ liệu thật & tạo người dùng

1. **Nhập dữ liệu từ Excel** theo thứ tự: Bộ phận → Nhà cung cấp → Danh mục vật tư → Tồn kho ban đầu (Quản lý kho duyệt phiếu tồn đầu kỳ) → Danh mục hóa chất.
2. Tồn hóa chất ban đầu: lập **phiếu nhập hóa chất** theo từng lô (đủ mã lô, HSD) – tải SDS và để HSE xác nhận trước.
3. **Người dùng**: tạo tài khoản, gán bộ phận & vai trò (Thủ kho, Quản lý kho, Thủ kho hóa chất, HSE, Mua hàng, Kế toán, Giám đốc, Bộ phận sử dụng).
4. Đối chiếu với kiểm kê thực tế → **Khóa kỳ** đến ngày chốt tồn đầu kỳ.
5. Đào tạo theo menu **Hướng dẫn vận hành**.

---

## Cập nhật phiên bản sau này

```bash
cd ~/sambo-wms && git pull
```
```bash
bash deploy/package.sh <phiên-bản> && sudo bash deploy/update.sh deploy/dist/sambo-wms-<phiên-bản>.tar.gz
```
`update.sh` tự sao lưu, áp migration mới (không xóa dữ liệu), tự quay về bản cũ nếu lỗi. Tunnel và cấu hình giữ nguyên.

---

## Xử lý sự cố thường gặp

| Hiện tượng | Kiểm tra |
|---|---|
| `curl .../api/health` lỗi | `sudo journalctl -u sambo-wms -n 50` – thường do sai chuỗi `DATABASE_URL` |
| Lỗi kết nối Supabase | Dùng đúng *Session pooler* port 5432; mật khẩu có ký tự đặc biệt phải mã hóa URL; dự án Supabase có đang bị *Paused* không |
| Đăng nhập xong bị đẩy ra ngay | Đang mở bằng `http://` trong khi `COOKIE_SECURE=true` – dùng `https://wms...` |
| Sao lưu báo lỗi phiên bản | `PG_BIN_DIR` phải trỏ tới `pg_dump` cùng/lớn hơn phiên bản Supabase (Bước 4.3) |
| Trang Cloudflare báo 502 | Dịch vụ chưa chạy: `sudo systemctl status sambo-wms`; Tunnel trỏ đúng `localhost:4000` |
