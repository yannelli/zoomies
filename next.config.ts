import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
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
