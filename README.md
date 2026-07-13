# Zoomies

Zoomies is a control plane for NGINX reverse proxies. It manages site configurations, certificates, and upstream targets from a SQLite database, validates configurations using NGINX, and reloads NGINX safely.

## Getting Started

Start the control plane along with NGINX using Docker Compose:

```bash
docker compose up -d
```

Test the default setup:

```bash
curl -kI https://localhost/
```

Manage site state using the command-line interface:

```bash
pnpm cli status
```

Refer to the [Installation Guide](docs/INSTALL.md) for custom environment configuration and production deployment guides.

## Component Tour

- **Dashboard:** A cookie-gated Next.js administration panel running on port 3000 to manage sites, upstreams, and certificates.
- **HTTP API:** A token-authorized HTTP API that exposes site management endpoints to automated systems.
- **CLI:** A command-line companion that modifies configuration records directly in the SQLite database or interacts with the HTTP API.
- **ACME Worker:** A serial certificate renewal agent that automates Let's Encrypt validation.
- **Reload Orchestrator:** A validation engine that tests configurations using NGINX before applying updates, rolling back all files if NGINX validation or health checks fail.

## Developer Setup

Clone the repository and install the dependencies:

```bash
git clone https://github.com/yannelli/zoomies.git
cd zoomies
nvm use
pnpm install
pnpm test
```

Start the Next.js development server:

```bash
export ZOOMIES_API_TOKEN="dev-token"
pnpm dev
```

Open `http://localhost:3000/login` and input `dev-token` to access the dashboard.

## Contributing

Refer to the [Contributor Guide](CONTRIBUTING.md) to learn about branching, ESLint configurations, and coding conventions.

## License

Zoomies is open-source software licensed under the [MIT License](LICENSE).
