import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Site } from '@/server/domain/site';
import type { Upstream } from '@/server/domain/upstream';

interface SiteListProps {
  sites: Site[];
  upstreamById: Map<string, Upstream>;
}

function formatDate(iso: string): string {
  // Render in UTC so server-rendered output is deterministic across deploys.
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
}

function tlsModeVariant(mode: Site['tlsMode']): 'default' | 'secondary' | 'outline' {
  switch (mode) {
    case 'acme':
      return 'default';
    case 'manual':
      return 'secondary';
    case 'off':
    default:
      return 'outline';
  }
}

export function SiteList({ sites, upstreamById }: SiteListProps) {
  if (sites.length === 0) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>No sites yet</CardTitle>
          <CardDescription>
            Sites map a hostname to an upstream and control how NGINX terminates TLS.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/sites/new" className={buttonVariants()}>
            Create your first site
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3">
              Hostname
            </th>
            <th scope="col" className="px-4 py-3">
              Upstream
            </th>
            <th scope="col" className="px-4 py-3">
              TLS mode
            </th>
            <th scope="col" className="px-4 py-3">
              Created
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sites.map((site) => {
            const upstream = upstreamById.get(site.upstreamId);
            return (
              <tr key={site.id} className="hover:bg-muted/30">
                <td className="px-4 py-3 font-medium">
                  <Link
                    href={`/sites/${site.id}`}
                    className="text-foreground underline-offset-4 hover:underline"
                  >
                    {site.hostname}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {upstream ? (
                    upstream.name
                  ) : (
                    <span className="italic text-red-600">unknown ({site.upstreamId})</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={tlsModeVariant(site.tlsMode)}>{site.tlsMode}</Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(site.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
