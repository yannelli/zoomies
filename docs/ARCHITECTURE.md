# Zoomies architecture

This is a one-page sketch of the system as currently envisioned. It is
intentionally minimal — the goal is to bound the scope of v1, not to lock in
implementation details.

## Two planes

```
+--------------------+        +---------------------+        +-----------+
|  Zoomies (Node)    |  IPC   |       NGINX         |   net  |  Clients  |
|  control plane     +------->+    data plane       +<------>+           |
|                    |        |                     |        +-----------+
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
asks NGINX to reload.

## Components (v1)

| Component               | Responsibility                                                                 |
| ----------------------- | ------------------------------------------------------------------------------ |
| **State store**         | SQLite via a thin repository layer. Sites, upstreams, certs.                   |
| **Config renderer**     | Pure function: state -> NGINX config string. No I/O.                           |
| **Validator**           | Writes rendered config to a temp file, runs `nginx -t -c`.                     |
| **Reload orchestrator** | Atomically swaps config, sends `SIGHUP`, probes health, rolls back on failure. |
| **HTTP API**            | Fastify; CRUD for sites/upstreams/certs; protected by token.                   |
| **CLI**                 | Thin wrapper over the API (or direct, for local use).                          |
| **Cert manager**        | ACME (Let's Encrypt) via [`acme-client`]; storage in state.                    |

[`acme-client`]: https://www.npmjs.com/package/acme-client

## Boundaries

- All external input (HTTP bodies, env vars, file contents) is parsed with
  Zod at the boundary. Domain code receives validated types only.
- All shell-outs go through `execa` with argument arrays — never a shell
  string. NGINX reload paths are the only blessed shell-out site.
- Filesystem writes use atomic temp-file + rename.

## Non-goals for v1

- Web UI. (Will be a separate package later.)
- Multi-node / clustered deployment.
- Non-NGINX backends (HAProxy, Caddy, Envoy).
- Built-in observability beyond access/error logs and a `/healthz` endpoint.

## Open questions

- Single-tenant token vs. OIDC for the API. v1 is single-token; revisit after
  the first real deployment.
- Whether to ship NGINX inside a Docker image alongside Zoomies, or assume an
  externally managed NGINX. Leaning toward the latter for v1.
