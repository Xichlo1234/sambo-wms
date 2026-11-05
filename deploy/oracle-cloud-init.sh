#!/bin/bash
# =====================================================================
#  SAMBO WMS - TỰ ĐỘNG CÀI ĐẶT KHI TẠO MÁY CHỦ (Oracle Cloud / VPS bất kỳ)
#  Dán toàn bộ nội dung này vào ô "Initialization script / cloud-init"
#  khi tạo máy chủ Ubuntu 24.04. Chỉ cần sửa 3 dòng dưới đây.
# =====================================================================
GITHUB_TOKEN="DAN_GITHUB_TOKEN_VAO_DAY"
CF_TUNNEL_TOKEN="DAN_CLOUDFLARE_TUNNEL_TOKEN_VAO_DAY"
ADMIN_PASSWORD="DatMatKhauChiChuVaSo2026"
# ---------------------------------------------------------------------
# Không cần sửa gì bên dưới. Nhật ký: /var/log/sambo-setup.log
exec > /var/log/sambo-setup.log 2>&1
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive HOME=/root
echo 'DPkg::Lock::Timeout "900";' > /etc/apt/apt.conf.d/99sambo-wait
timedatectl set-timezone Asia/Ho_Chi_Minh || true

apt-get update
apt-get install -y git curl openssl fail2ban unattended-upgrades

# Mã nguồn (token chỉ dùng lúc tải, không lưu lại trong cấu hình git)
rm -rf /home/ubuntu/sambo-wms
git clone "https://x-access-token:${GITHUB_TOKEN}@github.com/Xichlo1234/sambo-wms.git" /home/ubuntu/sambo-wms
git -C /home/ubuntu/sambo-wms remote set-url origin https://github.com/Xichlo1234/sambo-wms.git
cd /home/ubuntu/sambo-wms
bash deploy/package.sh 1.1.0
ADMIN_PASS="$ADMIN_PASSWORD" bash deploy/install.sh deploy/dist/sambo-wms-1.1.0.tar.gz
chown -R ubuntu:ubuntu /home/ubuntu/sambo-wms || true

# HTTPS qua Cloudflare Tunnel
sed -i 's/^COOKIE_SECURE=.*/COOKIE_SECURE=true/' /opt/sambo-wms/shared/.env
systemctl restart sambo-wms
ARCH=$(dpkg --print-architecture)
curl -fsSL -o /tmp/cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb"
dpkg -i /tmp/cloudflared.deb
cloudflared service install "$CF_TUNNEL_TOKEN"

sleep 10
curl -fsS http://127.0.0.1:4000/api/health
echo "SAMBO-WMS-CAI-DAT-XONG"
