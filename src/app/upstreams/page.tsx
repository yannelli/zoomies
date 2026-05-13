import Link from 'next/link';

import { UpstreamList } from '@/components/upstreams/upstream-list';
import { buttonVariants } from '@/components/ui/button';
import { requireSession } from '@/lib/require-session';
import { getRepositories } from '@/server/api/db-context';
import { listUpstreams } from '@/server/api/handlers/upstreams';

export default async function UpstreamsPage() {
  await requireSession();
  const { upstreams: upstreamRepo } = getRepositories();
  const upstreams = listUpstreams({ upstreamRepo });

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 sm:px-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Upstreams</h1>
          <p className="text-sm text-muted-foreground">
            Define pools of backend targets that one or more sites can route to.
          </p>
        </div>
        <Link href="/upstreams/new" className={buttonVariants()}>
          New upstream
        </Link>
      </header>
      <UpstreamList upstreams={upstreams} />
    </main>
  );
}
