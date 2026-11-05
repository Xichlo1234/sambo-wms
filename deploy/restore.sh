#!/usr/bin/env bash
# KHÔI PHỤC KHI SỰ CỐ (ứng dụng không chạy được):  sudo bash restore.sh /var/lib/sambo-wms/backups/<file>.dump
set -euo pipefail
FILE="${1:?Chỉ định file .dump}"
ENV=${ENV_FILE:-/opt/sambo-wms/shared/.env}; set -a; . "$ENV"; set +a
URL="${DATABASE_URL%%\?*}"
[ -f "$FILE.sha256" ] && (cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256")
"$PG_BIN_DIR/pg_restore" --list "$FILE" >/dev/null || { echo "File sao lưu hỏng"; exit 1; }
read -r -p "Toàn bộ dữ liệu hiện tại sẽ bị thay thế. Gõ KHOI PHUC để tiếp tục: " A
[ "$A" = "KHOI PHUC" ] || exit 1
systemctl stop sambo-wms || true
SAFE="$STORAGE_DIR/backups/before_restore_$(date +%Y%m%d_%H%M%S).dump"
"$PG_BIN_DIR/pg_dump" --format=custom --no-owner --file="$SAFE" "$URL" && echo "Bản an toàn: $SAFE"
"$PG_BIN_DIR/pg_restore" --clean --if-exists --no-owner --no-privileges --single-transaction --dbname="$URL" "$FILE"
UP="${FILE%.dump}.uploads.tar.gz"; [ -f "$UP" ] && tar -xzf "$UP" -C "$STORAGE_DIR/uploads" --skip-old-files
systemctl start sambo-wms || true
echo "Khôi phục xong. Đăng nhập và chạy Cấu hình → Đối chiếu dữ liệu kho."
