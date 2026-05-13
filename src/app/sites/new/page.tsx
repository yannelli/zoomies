import Link from 'next/link';

import { SiteForm } from '@/components/sites/site-form';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireSession } from '@/lib/require-session';
import { getRepositories } from '@/server/api/db-context';
import { listUpstreams } from '@/server/api/handlers/upstreams';

import { createSiteAction } from '../actions';

export default async function NewSitePage() {
  await requireSession();

  const { upstreams: upstreamRepo } = getRepositories();
  const upstreams = listUpstreams({ upstreamRepo });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10 sm:px-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">New site</h1>
        <p className="text-sm text-muted-foreground">
          Choose a hostname, attach an upstream, and decide how TLS is handled.
        </p>
      </header>

      {upstreams.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>No upstreams available</CardTitle>
            <CardDescription>
              You must create an upstream before you can create a site. An upstream is the backend
              that NGINX will proxy requests to.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <Link href="/upstreams/new" className={buttonVariants()}>
              Create an upstream
            </Link>
            <Link
              href="/sites"
              className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
            >
              Back to sites
            </Link>
          </CardContent>
        </Card>
      ) : (
        <SiteForm action={createSiteAction} upstreams={upstreams} />
      )}
    </main>
  );
}
