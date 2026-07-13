# Installation

Zoomies requires an NGINX installation to act as the reverse proxy. You can run the application using Docker Compose or install it natively on Ubuntu.

## Option A: Docker Compose

The Docker Compose setup launches the Next.js control plane, an NGINX proxy sidecar, and the ACME certificate renewal worker.

First, clone the repository:

```bash
git clone https://github.com/yannelli/zoomies.git
cd zoomies
```

Create a `.env` file in the root directory to define the required environment variables:

```env
ZOOMIES_API_TOKEN=your-secure-api-token
ZOOMIES_ACME_EMAIL=admin@example.com
```

Start the containers in the background:

```bash
docker compose up -d
```

Confirm that the application works by querying the default site:

```bash
curl -kI https://localhost/
```

To run the control plane without the ACME worker:

```bash
docker compose up -d app nginx
```

## Option B: Ubuntu Native (22.04 or 24.04)

The native installation runs the control plane as a systemd service and integrates with a local NGINX installation.

Clone the repository and run the installation script:

```bash
git clone https://github.com/yannelli/zoomies.git
cd zoomies
sudo ./scripts/install-ubuntu.sh
```

The installer installs Node.js 22 if missing, builds the application to `/opt/zoomies`, and configures NGINX.

Start the ACME worker service after configuring credentials in `/etc/zoomies/worker.env`:

```bash
sudo systemctl enable --now zoomies-worker.service
```

## Environment Variables

| Variable | Default | Required | Purpose |
| --- | --- | --- | --- |
| `ZOOMIES_API_TOKEN` | *None* | Yes | Bearer token that gates the HTTP API and cookie sessions. |
| `ZOOMIES_STATE_DIR` | `/var/lib/zoomies` | Recommended | Directory containing the SQLite database and certificates. |
| `ZOOMIES_NGINX_BIN` | `/usr/sbin/nginx` | No | Path to the NGINX executable. |
| `ZOOMIES_NGINX_SITES_DIR` | `/etc/zoomies/nginx/sites` | Recommended | Directory where Zoomies writes NGINX configuration fragments. |
| `ZOOMIES_NGINX_PIDFILE` | *None* | Docker only | File containing the NGINX master PID for SIGHUP reloads. |
| `ZOOMIES_HEALTH_CHECK_URL` | `http://nginx/api/healthz` | Yes | URL verified by the orchestrator after a reload. |
| `ZOOMIES_DEMO_UPSTREAM` | `http://app:3000` | No | Target URL for the default demonstration site. |
| `ZOOMIES_DEMO_HOSTNAME` | `localhost` | No | Hostname for the default demonstration site. |
| `ZOOMIES_DEFAULT_CERT_PEM` | `/var/lib/zoomies/certs/_default/fullchain.pem` | No | SSL certificate fallback path. |
| `ZOOMIES_DEFAULT_CERT_KEY` | `/var/lib/zoomies/certs/_default/privkey.pem` | No | SSL private key fallback path. |
| `ZOOMIES_ACME_EMAIL` | *None* | ACME only | Email address for Let's Encrypt registrations. |
| `ZOOMIES_ACME_DIRECTORY_URL` | `https://acme-v02.api.letsencrypt.org/directory` | No | ACME directory endpoint. |
| `ZOOMIES_CERT_DIR` | `${ZOOMIES_STATE_DIR}/certs` | No | Directory for generated SSL certificates. |
| `ZOOMIES_API_URL` | `http://localhost:3000` | CLI only | Base API endpoint for the CLI. |

## First Run Guide

Once installed, verify the installation by creating your first site:

1. Open `http://localhost:3000/login` and log in with your `ZOOMIES_API_TOKEN`.
2. Navigate to **Upstreams**, select **New**, and add a backend target.
3. Navigate to **Sites**, select **New**, name the site, and link it to your upstream.
4. Run the reload command to write configurations and reload NGINX:

```bash
pnpm cli reload
```

5. Access your configured site hostname using `curl` to verify traffic routing.

## CLI Usage

The `zoomies` CLI manages configuration state directly from the terminal.

Run commands against the local database to bypass the HTTP API:

```bash
pnpm cli --local status
```

Run commands against a remote HTTP API:

```bash
pnpm cli --api-url http://localhost:3000 --token your-token status
```
