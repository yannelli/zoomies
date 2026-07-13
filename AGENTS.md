# Agent Environment Guide

This document lists instructions and caveats for working in the Cursor Cloud environment. Refer to `CLAUDE.md` and the `docs` directory for core architecture and install guides.

## Running the Application

Before starting the Next.js development server, export the API token:

```bash
export ZOOMIES_API_TOKEN="your-secure-token"
pnpm dev
```

Submit this same token to log in at `http://localhost:3000/login` and to authenticate API requests.

The development server automatically creates the SQLite database in the directory specified by `ZOOMIES_STATE_DIR`. This defaults to `./.zoomies`.

## Local Development without NGINX

You can manage sites and upstreams using the dashboard, API, or command-line interface without NGINX running locally. These mutations write directly to the SQLite database. NGINX is only required when validating configurations, reloading NGINX, or issuing ACME certificates.

## Running End-to-End Tests

The default test suite mocks NGINX and runs without external dependencies:

```bash
pnpm test
```

To run the end-to-end validator tests, you must point the test runner to your local NGINX binary and run as root:

```bash
export ZOOMIES_E2E=1
export ZOOMIES_NGINX_BIN="/usr/sbin/nginx"
sudo -E pnpm test
```

Running as root is required because NGINX validation reads the pid file at `/run/nginx.pid`, which fails with a permission error for non-root users.

## Command Line Interface Usage

When running the CLI in development, do not use the `--` separator:

```bash
# Correct usage
pnpm cli --local sites list

# Incorrect usage: this forwards a literal '--' and fails
pnpm cli -- --local sites list
```

To run the CLI against the local database used by the dev server, set the state directory:

```bash
export ZOOMIES_STATE_DIR="./.zoomies"
pnpm cli --local status
```
