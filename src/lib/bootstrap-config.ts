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
      ready: true,
    },
    {
      name: 'Auto SSL',
      summary: 'Reserve certificate storage and deployment hooks for ACME automation.',
      ready: true,
    },
    {
      name: 'Load balancing',
      summary: 'Prepare grouped upstreams and balancing policies for multi-node services.',
      ready: true,
    },
    {
      name: 'Overwrite rules',
      summary: 'Leave room for header, redirect, and path rewrite overrides in the UI.',
      ready: true,
    },
  ],
} as const;
