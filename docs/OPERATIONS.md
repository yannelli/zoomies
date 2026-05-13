# Zoomies operations

Operator-facing guide for installing Zoomies alongside an existing NGINX. The
[architecture sketch](./ARCHITECTURE.md) is the conceptual companion; this
doc is the "what do I actually configure on the host" reference.

## The NGINX contract

Zoomies generates one `*.conf` file per site and drops them into a directory
it fully owns. Your `nginx.conf` must `include` that directory inside its
`http {}` block:

```nginx
http {
    # ...your existing http config...
    include /etc/zoomies/nginx/sites/*.conf;
}
```

- Zoomies will create, overwrite, and delete files in
  `/etc/zoomies/nginx/sites/`. **Do not hand-edit anything there** — your
  edit will be silently discarded on the next reload.
- Zoomies will never modify the top-level `nginx.conf`. That file is yours.
- Anything outside the include path (events, top-level http settings, the
  ACME server block — see below) is the operator's responsibility.

## Permissions

NGINX runs as `nginx` (or `www-data` on Debian/Ubuntu). Zoomies should run
as a dedicated `zoomies` user — never as root. The control plane needs to
(a) write files in the sites directory, and (b) tell the NGINX master
process to reload. Pick one of the three strategies below.

### Recommended: shared group

Create a `zoomies-mgmt` group and add both users to it; chown the sites dir
to that group with `g+rwx`:

```sh
groupadd zoomies-mgmt
usermod -aG zoomies-mgmt zoomies
usermod -aG zoomies-mgmt nginx        # or www-data
install -d -m 2775 -g zoomies-mgmt /etc/zoomies/nginx/sites
```

The orchestrator shells out to `nginx -s reload`, which signals the master
via the pid file. The `nginx` binary must be on `$PATH` (or set
`ZOOMIES_NGINX_BIN`), and the pid file at `/run/nginx.pid` must be readable
by `zoomies-mgmt`. This is the tightest blast radius without sudo.

### Alternative: sudoers rule

If you cannot share a group, allow `zoomies` to invoke specific NGINX
sub-commands via sudo:

```sudoers
Defaults!/usr/sbin/nginx !requiretty
zoomies ALL=(root) NOPASSWD: /usr/sbin/nginx -s reload, \
    /usr/sbin/nginx -t -c /tmp/zoomies-validate-*/nginx.conf
```

The wildcard on the `-t -c` path is required because the validator writes
each candidate config to a fresh `mkdtemp` directory. Sudo's pattern matcher
treats `*` as a glob, so this allows any path under `/tmp/zoomies-validate-`
— effectively trusting that `/tmp` cannot be written to by an untrusted
user, which is the standard Linux assumption. Audit your `/tmp` mount
options (`nosuid`, `noexec`) if that worries you.

### Alternative: run Zoomies as the NGINX user

Set the systemd unit's `User=nginx`. Simplest, but you lose the
control-plane/data-plane isolation, and any RCE in Zoomies inherits NGINX's
file access. Not recommended for production.

## Environment variables

| Variable                  | Default                    | Purpose                                            |
| ------------------------- | -------------------------- | -------------------------------------------------- |
| `ZOOMIES_NGINX_BIN`       | `/usr/sbin/nginx`          | Path to the NGINX binary (used for `-t` + reload). |
| `ZOOMIES_NGINX_SITES_DIR` | `/etc/zoomies/nginx/sites` | Managed include directory.                         |
| `ZOOMIES_STATE_DIR`       | `/var/lib/zoomies`         | SQLite DB + ACME challenge dir.                    |
| `ZOOMIES_HEALTH_URL`      | `http://127.0.0.1/healthz` | URL probed after each reload.                      |
| `ZOOMIES_API_TOKEN`       | _required (Phase 6)_       | Bearer token for the HTTP API.                     |

The defaults assume a native Linux install. The Docker image will surface
the same names with appropriate in-container defaults.

## Failure modes

The orchestrator (`applyDesiredState`) walks five steps in order and stops
on the first failure. Each failure has a well-defined recovery posture:

| Step       | Failure means                              | What happens                                                  |
| ---------- | ------------------------------------------ | ------------------------------------------------------------- |
| `validate` | `nginx -t` rejected the rendered bundle.   | No disk changes. Caller gets the stderr in `validation`.      |
| `write`    | A `writeAtomic`/`deleteAtomic` call threw. | Previously applied changes rolled back. NGINX not signalled.  |
| `reload`   | `nginx -s reload` exited non-zero.         | All disk changes rolled back, then NGINX reloaded again.      |
| `probe`    | Health URL failed after the reload.        | All disk changes rolled back, then NGINX reloaded again.      |
| `success`  | n/a                                        | Rollback handles discarded; new state is the committed state. |

If the post-rollback reload also fails (configs restored, but NGINX still
refuses to re-read them), the orchestrator logs both stderrs to the systemd
journal and returns the original failure step. The system needs hand
intervention at that point — usually it means the previously-committed
configs on disk drifted out from under Zoomies.

## ACME challenge directory

Phase 8 will introduce the cert manager. When it lands, Zoomies will write
HTTP-01 challenges to `${ZOOMIES_STATE_DIR}/acme` (default
`/var/lib/zoomies/acme`). Your `nginx.conf` should already have a server
block that serves `/.well-known/acme-challenge/` from that path:

```nginx
server {
    listen 80 default_server;
    location /.well-known/acme-challenge/ {
        root /var/lib/zoomies/acme;
    }
    # ...everything else can 404 / redirect to https...
}
```

Set this up now and it will just work when the cert manager ships. Detailed
ACME flow docs will arrive with Phase 8.
