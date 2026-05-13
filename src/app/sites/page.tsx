import Link from 'next/link';

import { SiteList } from '@/components/sites/site-list';
import { buttonVariants } from '@/components/ui/button';
import { requireSession } from '@/lib/require-session';
import { getRepositories } from '@/server/api/db-context';
import { listSites } from '@/server/api/handlers/sites';
import { listUpstreams } from '@/server/api/handlers/upstreams';
import type { Upstream } from '@/server/domain/upstream';

export default async function SitesPage() {
  await requireSession();

  const { sites: siteRepo, upstreams: upstreamRepo } = getRepositories();
  const sites = listSites({ siteRepo });
  const upstreams = listUpstreams({ upstreamRepo });
  const upstreamById = new Map<string, Upstream>(upstreams.map((u) => [u.id, u]));

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 sm:px-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Sites</h1>
          <p className="text-sm text-muted-foreground">
            Map hostnames to upstreams and control TLS termination.
          </p>
        </div>
        <Link href="/sites/new" className={buttonVariants()}>
          New site
        </Link>
      </header>

      <SiteList sites={sites} upstreamById={upstreamById} />
    </main>
  );
}
