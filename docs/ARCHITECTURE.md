# Architecture

Zoomies operates as a control plane for NGINX. NGINX handles all data routing. Zoomies manages the configuration files, orchestrates NGINX reloads, and persists state in a SQLite database.

## System Layout

```
             Web Browser
                  |
                  v
       +----------------------+
       |  Zoomies (Node.js)   |
       |  Control Plane       |
       +----------+-----------+
                  |
                  | Writes config & sends SIGHUP
                  v
       +----------------------+
       |        NGINX         | <-------> HTTP/HTTPS Clients
       |  Data Plane (Proxy)  |
       +----------------------+
                  |
                  | Persists site state
                  v
       +----------------------+
       |    SQLite Database   |
       +----------------------+
```

### Control Plane

The control plane runs Next.js and a command-line interface. It reads configuration requirements from the SQLite database, generates NGINX site configuration files, and requests NGINX to reload. It never processes network traffic directly.

### Data Plane

NGINX acts as the data plane. It acts as the reverse proxy, terminates TLS connections, and handles client requests. Zoomies sits outside this hot path to ensure system performance.

## Component Responsibilities

- **Web UI:** A Next.js App Router dashboard located under `src/app/` that manages sites and upstreams.
- **HTTP API:** A Next.js Route Handler interface located under `src/app/api/` that processes site state mutations.
- **State Store:** A database layer managed by SQLite to persist sites, upstreams, and certificates.
- **Config Renderer:** A pure function that translates site records into NGINX configuration files.
- **Validator:** A validation runner that tests candidate configurations with `nginx -t -c <temp-file>`.
- **Reload Orchestrator:** An engine that performs atomic config writes, issues a `SIGHUP` reload signal, and verifies proxy health.
- **CLI:** A command-line wrapper around the SQLite repository and the HTTP API.
- **Cert Manager:** An ACME controller that handles Let's Encrypt certificates.

## Execution Rules

Zoomies enforces four core development boundaries:

1. Validate all external input (HTTP payloads, environment variables, files) with Zod at the application boundary.
2. Execute shell commands with `execa` using argument arrays. Do not pass raw shell strings.
3. Write files atomically by writing to a temporary file first, then renaming it to the final destination.
4. Keep control-plane code in `src/server/` independent of the Next.js UI in `src/app/`.
