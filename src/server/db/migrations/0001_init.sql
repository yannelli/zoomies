CREATE TABLE upstreams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  load_balancer TEXT NOT NULL CHECK (load_balancer IN ('round_robin', 'least_conn', 'ip_hash')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE upstream_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  upstream_id TEXT NOT NULL REFERENCES upstreams(id) ON DELETE CASCADE,
  host TEXT NOT NULL,
  port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  weight INTEGER NOT NULL CHECK (weight BETWEEN 1 AND 1000),
  position INTEGER NOT NULL,
  UNIQUE (upstream_id, position)
);

CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL UNIQUE,
  upstream_id TEXT NOT NULL REFERENCES upstreams(id) ON DELETE RESTRICT,
  tls_mode TEXT NOT NULL CHECK (tls_mode IN ('off', 'acme', 'manual')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE certs (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL CHECK (provider IN ('acme', 'manual')),
  pem_path TEXT NOT NULL,
  key_path TEXT NOT NULL,
  not_before TEXT NOT NULL,
  not_after TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (not_before < not_after)
);

CREATE INDEX idx_sites_upstream ON sites(upstream_id);
CREATE INDEX idx_targets_upstream ON upstream_targets(upstream_id);
