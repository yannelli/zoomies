type FeatureStatus = 'planned' | 'in-progress' | 'shipped';

export interface BootstrapFeature {
  readonly name: string;
  readonly summary: string;
  readonly ready: boolean;
  readonly status: FeatureStatus;
}

export interface BootstrapConfig {
  readonly name: string;
  readonly installModes: readonly string[];
  readonly composeServices: readonly string[];
  readonly nativeInstallSteps: readonly string[];
  readonly features: readonly BootstrapFeature[];
}

// Annotated explicitly (rather than `as const satisfies …`) so that the
// exported `status` type stays the full union — even when no shipped
// snapshot of the data currently includes the `'in-progress'` literal,
// consumers like `src/app/page.tsx` still compile-check their narrowing
// branches against the contract, not the current values.
export const bootstrapConfig: BootstrapConfig = {
  name: 'Zoomies',
  installModes: ['docker compose', 'ubuntu-native'],
  composeServices: ['nginx edge proxy', 'zoomies control plane'],
  nativeInstallSteps: [
    'install Node.js 22.x and NGINX',
    'build the Next.js control plane',
    'register the zoomies systemd service',
    'enable the sample NGINX site',
  ],
  features: [
    {
      name: 'Reverse proxy',
      summary: 'Route traffic to backend apps through a validated NGINX config.',
      ready: true,
      status: 'shipped',
    },
    {
      name: 'Auto SSL',
      summary:
        'Issue and renew Let’s Encrypt certificates via the ACME worker. v1 limitation: NGINX reload after issuance is operator-triggered.',
      ready: true,
      status: 'shipped',
    },
    {
      name: 'Load balancing',
      summary:
        'Define grouped upstreams with weighted targets and per-upstream balancing policies.',
      ready: true,
      status: 'shipped',
    },
    {
      name: 'Overwrite rules',
      summary: 'Reserve room for header, redirect, and path rewrite overrides in a future release.',
      ready: false,
      status: 'planned',
    },
  ],
};
