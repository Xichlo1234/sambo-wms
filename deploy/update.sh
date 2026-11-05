#!/usr/bin/env bash
# ===== CẬP NHẬT PHIÊN BẢN – chạy luôn, KHÔNG ghi đè dữ liệu =====
#   sudo bash update.sh sambo-wms-<version>.tar.gz
# Các bước: sao lưu DB → giải nén vào releases/<version> mới → cài thư viện → build →
#           migrate deploy (chỉ áp migration mới, không reset) → seed idempotent → chuyển symlink → khởi động lại → kiểm tra sức khỏe.
# Lỗi ở bất kỳ bước nào trước khi chuyển symlink: phiên bản cũ vẫn chạy. Lỗi sau khi chuyển: tự quay về phiên bản cũ.
set -euo pipefail
PKG="${1:?Cách dùng: sudo bash update.sh <file .tar.gz>}"
APP=/opt/sambo-wms; SVC=sambo-wms
set -a; . "$APP/shared/.env"; set +a
VERSION=$(tar -xzf "$PKG" -O VERSION 2>/dev/null || date +%Y%m%d%H%M)
REL="$APP/releases/$VERSION"
[ -e "$REL" ] && REL="$REL-$(date +%H%M%S)"
PREV=$(readlink -f "$APP/current" 2>/dev/null || true)

echo "== 1. Sao lưu CSDL trước khi cập nhật =="
mkdir -p "$STORAGE_DIR/backups"
PRE="$STORAGE_DIR/backups/pre_update_$(date +%Y%m%d_%H%M%S).dump"
if [ -n "$PREV" ]; then
  "$PG_BIN_DIR/pg_dump" --format=custom --no-owner --file="$PRE" "${DATABASE_URL%%\?*}"
  echo "   -> $PRE"
fi

echo "== 2. Giải nén vào $REL =="
mkdir -p "$REL"; tar -xzf "$PKG" -C "$REL"
ln -sf "$APP/shared/.env" "$REL/server/.env"

echo "== 3. Cài thư viện & build =="
cd "$REL/client" && npm ci --no-audit --no-fund && npm run build
cd "$REL/server" && npm ci --no-audit --no-fund && npx prisma generate && npm run build

echo "== 4. Migration CSDL (prisma migrate deploy – chỉ thêm, không xóa) =="
npx prisma migrate deploy
echo "== 5. Đồng bộ quyền / cấu hình (idempotent, không ghi đè) =="
npx tsx prisma/seed.ts
chown -R wms:wms "$REL"

echo "== 6. Chuyển sang phiên bản mới & khởi động lại =="
ln -sfn "$REL" "$APP/current"
systemctl restart $SVC
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT:-4000}/api/health" >/dev/null; then echo "OK – phiên bản $VERSION đang chạy."; exit 0; fi
  sleep 2
done
echo "!! Kiểm tra sức khỏe thất bại – quay về phiên bản trước"
if [ -n "$PREV" ]; then ln -sfn "$PREV" "$APP/current"; systemctl restart $SVC; fi
echo "Xem log: journalctl -u $SVC -n 100. Bản sao lưu trước cập nhật: $PRE"
exit 1
