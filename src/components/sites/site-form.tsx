import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { Site } from '@/server/domain/site';
import type { Upstream } from '@/server/domain/upstream';

interface SiteFormProps {
  action: (formData: FormData) => Promise<void>;
  upstreams: Upstream[];
  initial?: Site;
}

const TLS_MODES = [
  { value: 'off', label: 'Off (HTTP only)' },
  { value: 'acme', label: 'ACME (Let’s Encrypt)' },
  { value: 'manual', label: 'Manual (bring your own cert)' },
] as const;

export function SiteForm({ action, upstreams, initial }: SiteFormProps) {
  const isEdit = initial !== undefined;
  return (
    <form action={action} className="flex flex-col gap-5">
      <FormField label="Hostname" htmlFor="site-hostname">
        <Input
          id="site-hostname"
          name="hostname"
          type="text"
          autoComplete="off"
          required
          defaultValue={initial?.hostname ?? ''}
          placeholder="example.com"
        />
      </FormField>

      <FormField label="Upstream" htmlFor="site-upstream-id">
        <Select
          id="site-upstream-id"
          name="upstreamId"
          required
          defaultValue={initial?.upstreamId ?? ''}
        >
          <option value="" disabled>
            Select an upstream…
          </option>
          {upstreams.map((upstream) => (
            <option key={upstream.id} value={upstream.id}>
              {upstream.name}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label="TLS mode" htmlFor="site-tls-mode">
        <Select id="site-tls-mode" name="tlsMode" required defaultValue={initial?.tlsMode ?? 'off'}>
          {TLS_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </Select>
      </FormField>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit">{isEdit ? 'Save changes' : 'Create site'}</Button>
        <Link
          href="/sites"
          className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
