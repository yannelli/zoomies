# Zoomies architecture

This is a one-page sketch of the system as currently envisioned. It is
intentionally minimal — the goal is to bound the scope of v1, not to lock in
implementation details.

## Two planes

```
   Browser
      |
      v
+--------------------+        +---------------------+        +-----------+
|  Zoomies (Node)    |  IPC   |       NGINX         |   net  |  Clients  |
|  control plane     +------->+    data plane       +<------>+           |
|  (Next.js + CLI)   |        |                     |        +-----------+
+----------+---------+        +---------------------+
           |
           | reads/writes
           v
   +-------------------+
   |  state (SQLite)   |
   +-------------------+
```

**NGINX** terminates TLS and proxies every byte. We never put Node in the
hot path.

**Zoomies** owns the _intent_: which sites exist, what they proxy to, which
certs they use. It renders that intent into NGINX config, validates it, and
asks NGINX to reload. The dashboard UI surfaces the same intent the API
exposes.

## Components (v1)

| Component               | Responsibility                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web UI**              | Next.js App Router + shadcn/ui in `src/app/`. Renders the same intent the API exposes.                                                                                    |
| **HTTP API**            | Next.js Route Handlers in `src/app/api/**`; CRUD for sites/upstreams/certs; protected by token. May graduate to a dedicated Node service if Route Handler limits are hit. |
| **State store**         | SQLite via a thin repository layer. Sites, upstreams, certs.                                                                                                              |
| **Config renderer**     | Pure function: state -> NGINX config string. No I/O.                                                                                                                      |
| **Validator**           | Writes rendered config to a temp file, runs `nginx -t -c`.                                                                                                                |
| **Reload orchestrator** | Atomically swaps config, sends `SIGHUP`, probes health, rolls back on failure.                                                                                            |
| **CLI**                 | Thin wrapper over the API (or direct, for local use). Emitted to `dist/` from `src/index.ts`.                                                                             |
| **Cert manager**        | ACME (Let's Encrypt) via [`acme-client`]; storage in state.                                                                                                               |

[`acme-client`]: https://www.npmjs.com/package/acme-client

## Boundaries

- All external input (HTTP bodies, env vars, file contents) is parsed with
  Zod at the boundary. Domain code receives validated types only.
- All shell-outs go through `execa` with argument arrays — never a shell
  string. NGINX reload paths are the only blessed shell-out site.
- Filesystem writes use atomic temp-file + rename.
- UI components live under `src/app/` and `src/components/`. Control-plane
  domain code lives under `src/server/` and never imports from the UI tree.

## Non-goals for v1

- Multi-node / clustered deployment.
- Non-NGINX backends (HAProxy, Caddy, Envoy).
- Built-in observability beyond access/error logs and a `/healthz` endpoint.

## Open questions

- Single-tenant token vs. OIDC for the API. v1 is single-token; revisit after
  the first real deployment.
- Whether to ship NGINX inside a Docker image alongside Zoomies, or assume an
  externally managed NGINX. Leaning toward the latter for v1.
- Whether the Route Handler API stays in-process with the Next.js server long
  term, or graduates into a dedicated Node service that the UI calls over
  HTTP. The split would only matter once the control plane is doing
  long-running work (cert renewal, NGINX reload supervision) that doesn't
  fit Next.js's request lifecycle.
