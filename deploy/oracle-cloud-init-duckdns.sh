#!/bin/bash
GITHUB_TOKEN="DAN_GITHUB_TOKEN_VAO_DAY"
DUCKDNS_TOKEN="DAN_DUCKDNS_TOKEN_VAO_DAY"
DUCKDNS_NAME="sambostock"
ADMIN_PASSWORD="DatMatKhauChiChuVaSo2026"
# =====================================================================
# SAMBO WMS - tự cài khi tạo máy chủ Ubuntu 24.04 (Oracle Cloud).
# Tên miền miễn phí DuckDNS + HTTPS Let's Encrypt (Caddy). Chỉ sửa 4 dòng trên.
# Không cần sửa gì bên dưới. Nhật ký: /var/log/sambo-setup.log
# =====================================================================
exec > /var/log/sambo-setup.log 2>&1
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive HOME=/root
DOMAIN="${DUCKDNS_NAME}.duckdns.org"
echo 'DPkg::Lock::Timeout "900";' > /etc/apt/apt.conf.d/99sambo-wait
timedatectl set-timezone Asia/Ho_Chi_Minh || true

# 1. Trỏ tên miền DuckDNS về IP máy chủ, tự cập nhật 5 phút/lần
cat > /usr/local/bin/duckdns-update.sh <<EOF
#!/bin/sh
curl -fsS -m 30 "https://www.duckdns.org/update?domains=${DUCKDNS_NAME}&token=${DUCKDNS_TOKEN}&ip=" -o /var/log/duckdns.last
EOF
chmod 700 /usr/local/bin/duckdns-update.sh
/usr/local/bin/duckdns-update.sh || true
echo '*/5 * * * * root /usr/local/bin/duckdns-update.sh' > /etc/cron.d/duckdns

# 2. Mở cổng web 80/443 trong tường lửa của Ubuntu (Oracle chặn sẵn)
for P in 443 80; do
  N=$(iptables -L INPUT --line-numbers -n | awk '/REJECT/{print $1; exit}')
  if [ -n "$N" ]; then iptables -I INPUT "$N" -p tcp -m state --state NEW --dport "$P" -j ACCEPT
  else iptables -A INPUT -p tcp -m state --state NEW --dport "$P" -j ACCEPT; fi
done
netfilter-persistent save || true

# 3. Cài SAMBO WMS
apt-get update
apt-get install -y git curl openssl fail2ban unattended-upgrades
rm -rf /home/ubuntu/sambo-wms
git clone "https://x-access-token:${GITHUB_TOKEN}@github.com/Xichlo1234/sambo-wms.git" /home/ubuntu/sambo-wms
git -C /home/ubuntu/sambo-wms remote set-url origin https://github.com/Xichlo1234/sambo-wms.git
cd /home/ubuntu/sambo-wms
bash deploy/package.sh 1.1.0
ADMIN_PASS="$ADMIN_PASSWORD" bash deploy/install.sh deploy/dist/sambo-wms-1.1.0.tar.gz
chown -R ubuntu:ubuntu /home/ubuntu/sambo-wms || true
sed -i 's/^COOKIE_SECURE=.*/COOKIE_SECURE=true/' /opt/sambo-wms/shared/.env
systemctl restart sambo-wms

# 4. HTTPS tự động (Let's Encrypt) bằng Caddy
apt-get install -y caddy
cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
	encode gzip
	reverse_proxy localhost:4000 {
		header_up -Cf-Connecting-Ip
	}
}
EOF
systemctl enable caddy
systemctl restart caddy

sleep 10
curl -fsS http://127.0.0.1:4000/api/health
echo "SAMBO-WMS-CAI-DAT-XONG: https://${DOMAIN}"
