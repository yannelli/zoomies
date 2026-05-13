export const bootstrapConfig = {
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
      summary: 'Route traffic to backend apps with a future-friendly control plane.',
      ready: false,
      status: 'in-progress',
    },
    {
      name: 'Auto SSL',
      summary: 'Reserve certificate storage and deployment hooks for ACME automation.',
      ready: false,
      status: 'planned',
    },
    {
      name: 'Load balancing',
      summary: 'Prepare grouped upstreams and balancing policies for multi-node services.',
      ready: false,
      status: 'in-progress',
    },
    {
      name: 'Overwrite rules',
      summary: 'Leave room for header, redirect, and path rewrite overrides in the UI.',
      ready: false,
      status: 'planned',
    },
  ],
} as const satisfies {
  name: string;
  installModes: readonly string[];
  composeServices: readonly string[];
  nativeInstallSteps: readonly string[];
  features: readonly {
    name: string;
    summary: string;
    ready: boolean;
    status: 'planned' | 'in-progress' | 'shipped';
  }[];
};
