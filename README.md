# Zoomies

Zoomies is a scaffold for an NGINX reverse proxy manager with a shadcn/ui-backed admin interface.

## What is included

- Next.js control plane UI built with shadcn/ui-style components
- NGINX front proxy configured for Docker Compose
- Shared bootstrap API for future reverse proxy, auto-SSL, load balancing, and overwrite-rule workflows
- Native Ubuntu 22.04 / 24.04 LTS install scaffolding with systemd and NGINX config templates

## Quick start

### Docker Compose

```bash
docker compose up --build
```

Open `http://localhost`.

### Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

### Native Ubuntu install

```bash
sudo ./scripts/install-ubuntu.sh
```

The install script bootstraps Node.js, NGINX, a systemd unit, and an example site config for Ubuntu 22.04/24.04 LTS hosts.
