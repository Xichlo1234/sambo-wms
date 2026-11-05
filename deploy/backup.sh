#!/usr/bin/env bash
# Sao lưu thủ công từ dòng lệnh (dùng khi ứng dụng không chạy). Tùy chọn đẩy lên Cloudflare R2 qua rclone:
#   R2_REMOTE=r2:sambo-wms-backup bash backup.sh
set -euo pipefail
ENV=${ENV_FILE:-/opt/sambo-wms/shared/.env}; set -a; . "$ENV"; set +a
F="$STORAGE_DIR/backups/manual_cli_$(date +%Y%m%d_%H%M%S)"
"$PG_BIN_DIR/pg_dump" --format=custom --no-owner --no-privileges --file="$F.dump" "${DATABASE_URL%%\?*}"
tar -czf "$F.uploads.tar.gz" -C "$STORAGE_DIR/uploads" .
sha256sum "$F.dump" > "$F.dump.sha256"
"$PG_BIN_DIR/pg_restore" --list "$F.dump" >/dev/null && echo "Kiểm tra toàn vẹn: OK"
echo "Đã sao lưu: $F.dump"
if [ -n "${R2_REMOTE:-}" ]; then rclone copy "$STORAGE_DIR/backups" "$R2_REMOTE" --include "*.dump*" --include "*.tar.gz" && echo "Đã đồng bộ lên $R2_REMOTE"; fi
