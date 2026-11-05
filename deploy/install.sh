#!/usr/bin/env bash
# ===== CÀI ĐẶT LẦN ĐẦU trên máy chủ Ubuntu 22.04/24.04 (máy chủ nội bộ hoặc VPS) =====
# Chạy với quyền root:  sudo bash install.sh sambo-wms-<version>.tar.gz
# Cấu trúc:
#   /opt/sambo-wms/releases/<version>/   mã nguồn từng phiên bản (không ghi đè nhau)
#   /opt/sambo-wms/current -> releases/<version>   (symlink phiên bản đang chạy)
#   /opt/sambo-wms/shared/.env           cấu hình (giữ nguyên qua các lần cập nhật)
#   /var/lib/sambo-wms/{uploads,backups} dữ liệu file (giữ nguyên qua các lần cập nhật)
set -euo pipefail
PKG="${1:?Cách dùng: sudo bash install.sh <file .tar.gz>}"
APP=/opt/sambo-wms; DATA=/var/lib/sambo-wms; SVC=sambo-wms

echo "== 1. Cài Node.js 22, PostgreSQL 16 =="
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y postgresql postgresql-contrib tar curl
PG_BIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)

echo "== 2. Tạo user hệ thống & thư mục =="
id wms >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin wms
mkdir -p "$APP/releases" "$APP/shared" "$DATA/uploads" "$DATA/backups"

echo "== 3. Tạo CSDL (bỏ qua nếu đã có) =="
DB_PASS=$(openssl rand -base64 18 | tr -d '/+=')
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='wms_user'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE USER wms_user WITH PASSWORD '$DB_PASS';"
  sudo -u postgres psql -c "CREATE DATABASE sambo_wms OWNER wms_user;"
  sudo -u postgres psql -d sambo_wms -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
  NEW_DB=1
fi

echo "== 4. Cấu hình .env (chỉ tạo nếu chưa có) =="
if [ ! -f "$APP/shared/.env" ]; then
  [ "${NEW_DB:-0}" = 1 ] || { echo "DB đã tồn tại nhưng chưa có $APP/shared/.env – hãy tạo thủ công."; exit 1; }
  ADMIN_PASS=$(openssl rand -base64 12 | tr -d '/+=')
  cat > "$APP/shared/.env" <<ENV
NODE_ENV=production
PORT=4000
DATABASE_URL=postgresql://wms_user:$DB_PASS@localhost:5432/sambo_wms
SESSION_TTL_HOURS=12
COOKIE_SECURE=false
STORAGE_DIR=$DATA
UPLOAD_MAX_MB=20
PG_BIN_DIR=$PG_BIN
BACKUP_CRON=30 1 * * *
BACKUP_KEEP=30
SERVE_CLIENT=true
CLIENT_DIST=$APP/current/client/dist
SEED_ADMIN_PASSWORD=$ADMIN_PASS
ENV
  chmod 600 "$APP/shared/.env"
  echo ">>> Mật khẩu admin ban đầu: $ADMIN_PASS (bắt buộc đổi khi đăng nhập lần đầu). Lưu lại ngay!"
fi
chown -R wms:wms "$APP" "$DATA"

echo "== 5. Dịch vụ systemd =="
cp "$(dirname "$0")/sambo-wms.service" /etc/systemd/system/$SVC.service 2>/dev/null || tar -xzf "$PKG" -O deploy/sambo-wms.service > /etc/systemd/system/$SVC.service
systemctl daemon-reload
systemctl enable $SVC

echo "== 6. Triển khai phiên bản đầu tiên =="
bash "$(dirname "$0")/update.sh" "$PKG"
echo "Hoàn tất. Truy cập: http://<IP máy chủ>:4000  (nên đặt sau Nginx/Cloudflare Tunnel với HTTPS rồi đặt COOKIE_SECURE=true)"
