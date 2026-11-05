#!/bin/sh
set -e
echo "[entrypoint] Áp dụng migration (chỉ thêm, không xóa dữ liệu)..."
npx prisma migrate deploy
echo "[entrypoint] Đồng bộ quyền / dữ liệu cấu hình ban đầu (idempotent)..."
npx tsx prisma/seed.ts
exec node dist/index.js
