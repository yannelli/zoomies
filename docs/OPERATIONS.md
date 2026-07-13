# Operations

Zoomies manages NGINX configuration fragments. Operating Zoomies requires setting up the proper include paths, user permissions, and understanding the reload orchestration lifecycle.

## NGINX Include Contract

Zoomies writes one configuration file per site. Include the target directory in your main `nginx.conf` file:

```nginx
http {
    include /etc/zoomies/nginx/sites/*.conf;
}
```

Do not edit files inside `/etc/zoomies/nginx/sites/` manually. Zoomies replaces them on each configuration apply. You remain responsible for all top-level NGINX configuration settings.

## Permission Strategies

Zoomies runs as the `zoomies` user. NGINX runs as `nginx` or `www-data`. The `zoomies` user requires permission to write site configurations and send reload signals to NGINX.

### Recommended: Shared Group

Create a shared management group to authorize writes to the configuration folder:

```bash
groupadd zoomies-mgmt
usermod -aG zoomies-mgmt zoomies
usermod -aG zoomies-mgmt nginx
install -d -m 2775 -g zoomies-mgmt /etc/zoomies/nginx/sites
```

Ensure the NGINX pidfile (default `/run/nginx.pid`) allows read access to the `zoomies-mgmt` group. Zoomies uses this to signal NGINX during reload.

### Alternative: Sudo Rules

Add a sudo rule to allow the `zoomies` user to run NGINX validation and reload commands:

```sudoers
Defaults!/usr/sbin/nginx !requiretty
zoomies ALL=(root) NOPASSWD: /usr/sbin/nginx -s reload, \
    /usr/sbin/nginx -t -c /tmp/zoomies-validate-*/nginx.conf
```

### Alternative: Run as NGINX User

Set the systemd unit `User=nginx` to run the control plane under the NGINX system account. This removes isolation boundaries.

## Reload Orchestration

The reload orchestrator executes five sequential steps when applying configuration updates:

1. **Validate:** Executes `nginx -t -c <temp-file>` to verify the configuration syntax.
2. **Write:** Writes the site configuration files to the active directory.
3. **Reload:** Issues a `SIGHUP` signal to the NGINX master process.
4. **Probe:** Verifies NGINX health by querying the URL defined in `ZOOMIES_HEALTH_CHECK_URL`.
5. **Commit:** Cleans up temporary files and commits the database state.

If validation, write, reload, or probe steps fail, the orchestrator reverts all files to their previous states and reloads NGINX.

## ACME Challenge Integration

Configure a default server block in NGINX to route Let's Encrypt HTTP-01 challenges to the challenge directory:

```nginx
server {
    listen 80 default_server;

    location /.well-known/acme-challenge/ {
        root /var/lib/zoomies/acme;
    }
}
```

The cert manager writes challenge files to this directory. NGINX serves these files to Let's Encrypt during the verification loop.
