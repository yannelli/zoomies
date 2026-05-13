import Link from 'next/link';

import { UpstreamForm } from '@/components/upstreams/upstream-form';
import { requireSession } from '@/lib/require-session';

import { createUpstreamAction } from '../actions';

export default async function NewUpstreamPage() {
  await requireSession();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10 sm:px-10">
      <header className="space-y-2">
        <Link
          href="/upstreams"
          className="text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          ← Back to upstreams
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">New upstream</h1>
        <p className="text-sm text-muted-foreground">
          Add a load-balanced pool of backend targets that sites can route to.
        </p>
      </header>
      <UpstreamForm action={createUpstreamAction} />
    </main>
  );
}
