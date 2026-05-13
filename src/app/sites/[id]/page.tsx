import { notFound } from 'next/navigation';

import { SiteDeleteButton } from '@/components/sites/site-delete-button';
import { SiteForm } from '@/components/sites/site-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireSession } from '@/lib/require-session';
import { getRepositories } from '@/server/api/db-context';
import { getSite } from '@/server/api/handlers/sites';
import { listUpstreams } from '@/server/api/handlers/upstreams';
import { NotFoundError } from '@/server/domain/errors';
import type { Site } from '@/server/domain/site';

import { deleteSiteAction, updateSiteAction } from '../actions';

interface EditSitePageProps {
  params: Promise<{ id: string }>;
}

export default async function EditSitePage({ params }: EditSitePageProps) {
  await requireSession();
  const { id } = await params;

  const { sites: siteRepo, upstreams: upstreamRepo } = getRepositories();
  let site: Site;
  try {
    site = getSite(id, { siteRepo });
  } catch (err) {
    if (err instanceof NotFoundError) {
      notFound();
    }
    throw err;
  }
  const upstreams = listUpstreams({ upstreamRepo });

  // Server Actions require serialisable arguments; `.bind` is the canonical
  // way to thread the site id into a (FormData) → void action signature.
  const boundUpdate = updateSiteAction.bind(null, id);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10 sm:px-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Edit site</h1>
        <p className="text-sm text-muted-foreground">
          Update the hostname, upstream, or TLS mode for{' '}
          <span className="font-medium text-foreground">{site.hostname}</span>.
        </p>
      </header>

      <SiteForm action={boundUpdate} upstreams={upstreams} initial={site} />

      <Card className="border-red-200 dark:border-red-900/40">
        <CardHeader>
          <CardTitle className="text-red-600">Danger zone</CardTitle>
          <CardDescription>
            Deleting a site removes it from the rendered NGINX config on the next reload.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SiteDeleteButton id={site.id} deleteAction={deleteSiteAction} />
        </CardContent>
      </Card>
    </main>
  );
}
