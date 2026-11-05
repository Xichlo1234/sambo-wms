#!/usr/bin/env bash
# Đóng gói bản phát hành: tạo deploy/dist/sambo-wms-<version>.tar.gz (mã nguồn, không gồm node_modules, .env, dữ liệu)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-$(date +%Y.%m.%d-%H%M)}"
mkdir -p "$ROOT/deploy/dist"
OUT="$ROOT/deploy/dist/sambo-wms-$VERSION.tar.gz"
echo "$VERSION" > "$ROOT/VERSION"
tar -czf "$OUT" -C "$ROOT" --exclude='node_modules' --exclude='dist' --exclude='.env' --exclude='storage' --exclude='storage-test' --exclude='deploy/dist' --exclude='.git' \
  VERSION server client deploy docs README.md CHANGELOG.md
echo "Đã tạo: $OUT"
