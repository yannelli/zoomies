import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // `runMigrations` reads `.sql` files relative to its compiled location.
  // Next.js's standalone tracer only walks the JS import graph, so without
  // an explicit include the migration files never land in
  // `.next/standalone/` and the production server crashes on first DB use.
  // Limit the include to routes/pages that actually open the DB
  // (`/api/v1/**`, the sites + upstreams pages, and their server actions);
  // healthz/bootstrap/auth do not.
  experimental: {
    outputFileTracingIncludes: {
      '/api/v1/**/*': ['./src/server/db/migrations/*.sql'],
      '/sites/**/*': ['./src/server/db/migrations/*.sql'],
      '/upstreams/**/*': ['./src/server/db/migrations/*.sql'],
    },
  },
  webpack: (config) => {
    // `src/server/**` is built with NodeNext (`tsconfig.cli.json`) and uses
    // explicit `.js` extensions on relative imports. The Next.js webpack
    // build also bundles those files via the App Router import graph, so
    // teach webpack to resolve a request ending in `.js` to a sibling
    // `.ts` (or `.tsx`) when the `.js` file is absent. This mirrors what
    // NodeNext does at runtime and what TypeScript bundler resolution does
    // at typecheck time.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
