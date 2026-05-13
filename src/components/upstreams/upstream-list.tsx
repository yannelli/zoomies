import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Upstream } from '@/server/domain/upstream';

const LOAD_BALANCER_LABELS: Record<Upstream['loadBalancer'], string> = {
  round_robin: 'Round robin',
  least_conn: 'Least connections',
  ip_hash: 'IP hash',
};

function formatCreatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

interface UpstreamListProps {
  upstreams: Upstream[];
}

export function UpstreamList({ upstreams }: UpstreamListProps) {
  if (upstreams.length === 0) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>No upstreams yet</CardTitle>
          <CardDescription>
            Create an upstream to define a pool of backend targets for one or more sites.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/upstreams/new" className={buttonVariants()}>
            Create your first upstream
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Load balancer</th>
            <th className="px-4 py-3">Targets</th>
            <th className="px-4 py-3">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {upstreams.map((upstream) => (
            <tr key={upstream.id} className="hover:bg-muted/30">
              <td className="px-4 py-3 font-medium">
                <Link
                  href={`/upstreams/${upstream.id}`}
                  className="text-foreground hover:underline"
                >
                  {upstream.name}
                </Link>
              </td>
              <td className="px-4 py-3">
                <Badge variant="secondary">{LOAD_BALANCER_LABELS[upstream.loadBalancer]}</Badge>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {upstream.targets.length} {upstream.targets.length === 1 ? 'target' : 'targets'}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {formatCreatedAt(upstream.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
