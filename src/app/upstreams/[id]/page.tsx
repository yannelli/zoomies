import Link from 'next/link';
import { notFound } from 'next/navigation';

import { UpstreamDeleteButton } from '@/components/upstreams/upstream-delete-button';
import { UpstreamForm } from '@/components/upstreams/upstream-form';
import { requireSession } from '@/lib/require-session';
import { getRepositories } from '@/server/api/db-context';
import { NotFoundError } from '@/server/domain/errors';
import { getUpstream } from '@/server/api/handlers/upstreams';

import { deleteUpstreamAction, updateUpstreamAction } from '../actions';

interface UpstreamEditPageProps {
  params: Promise<{ id: string }>;
}

export default async function UpstreamEditPage({ params }: UpstreamEditPageProps) {
  await requireSession();
  const { id } = await params;
  const { upstreams: upstreamRepo } = getRepositories();

  let upstream;
  try {
    upstream = getUpstream(id, { upstreamRepo });
  } catch (err) {
    if (err instanceof NotFoundError) {
      notFound();
    }
    throw err;
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10 sm:px-10">
      <header className="space-y-2">
        <Link
          href="/upstreams"
          className="text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          ← Back to upstreams
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">{upstream.name}</h1>
        <p className="text-sm text-muted-foreground">Edit the upstream targets or settings.</p>
      </header>
      <UpstreamForm action={updateUpstreamAction.bind(null, id)} initial={upstream} />
      <section className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50/40 p-6">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">Danger zone</h2>
          <p className="text-sm text-muted-foreground">
            Deleting an upstream is permanent. Sites that still reference it must be reassigned
            first.
          </p>
        </div>
        <UpstreamDeleteButton id={id} deleteAction={deleteUpstreamAction} />
      </section>
    </main>
  );
}
