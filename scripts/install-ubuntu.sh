#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root (for example: sudo ./scripts/install-ubuntu.sh)."
  exit 1
fi

if [[ ! -f /etc/os-release ]]; then
  echo "Unable to determine the host operating system."
  exit 1
fi

. /etc/os-release

if [[ "${ID}" != "ubuntu" || ( "${VERSION_ID}" != "22.04" && "${VERSION_ID}" != "24.04" ) ]]; then
  echo "This scaffold supports Ubuntu 22.04 and 24.04 LTS."
  exit 1
fi

APP_DIR="/opt/zoomies"
SERVICE_FILE="/etc/systemd/system/zoomies.service"
SITE_FILE="/etc/nginx/sites-available/zoomies"

apt-get update
apt-get install -y ca-certificates curl gnupg nginx

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

mkdir -p "${APP_DIR}"
cp -R . "${APP_DIR}"
cd "${APP_DIR}"

npm install
npm run build

cp deploy/systemd/zoomies.service "${SERVICE_FILE}"
cp deploy/nginx/native.conf "${SITE_FILE}"
ln -sf "${SITE_FILE}" /etc/nginx/sites-enabled/zoomies
rm -f /etc/nginx/sites-enabled/default

systemctl daemon-reload
systemctl enable --now zoomies.service
nginx -t
systemctl reload nginx

echo "Zoomies scaffold installed. Open your server over HTTP to reach the control plane."
