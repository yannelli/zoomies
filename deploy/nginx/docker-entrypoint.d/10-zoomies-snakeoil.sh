#!/bin/sh
# Generate a self-signed "snakeoil" certificate for the 443 default_server
# in deploy/nginx/conf.d/default.conf so NGINX can bind 443 on first
# startup before any per-site cert has been rendered.
#
# Idempotent: if the cert files already exist the script is a no-op. The
# cert lives on the shared `zoomies-certs` volume so the control plane
# can reference the same paths when seeding the demo site row.
#
# Runs from the official nginx:1.27-alpine image's
# `/docker-entrypoint.d/` hook, which executes before `nginx -g 'daemon off;'`.
set -eu

CERT_DIR="/var/lib/zoomies/certs/_default"
PEM_PATH="${CERT_DIR}/fullchain.pem"
KEY_PATH="${CERT_DIR}/privkey.pem"

# The pidfile lives on a shared volume so other containers in the same
# compose project can read it. nginx creates the file itself, but the
# directory has to exist with the right permissions first.
mkdir -p /run/zoomies-nginx

if [ -s "${PEM_PATH}" ] && [ -s "${KEY_PATH}" ]; then
  echo "zoomies: snakeoil cert already present at ${CERT_DIR}, skipping"
  exit 0
fi

if ! command -v openssl >/dev/null 2>&1; then
  apk add --no-cache openssl >/dev/null
fi

mkdir -p "${CERT_DIR}"
chmod 755 "${CERT_DIR}"

# 825 days is the maximum lifetime accepted by modern browsers for
# publicly-trusted certs. We're self-signing so it doesn't strictly
# matter, but keeping it under the limit makes the cert behave the same
# as a real one for any tooling that consumes notAfter.
openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout "${KEY_PATH}" \
  -out "${PEM_PATH}" \
  -days 825 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1,IP:::1" \
  >/dev/null 2>&1

chmod 600 "${KEY_PATH}"
chmod 644 "${PEM_PATH}"

echo "zoomies: generated snakeoil cert at ${CERT_DIR}"
