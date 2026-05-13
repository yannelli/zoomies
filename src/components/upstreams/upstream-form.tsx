'use client';

import { useState, useTransition } from 'react';

import { TargetsEditor } from '@/components/upstreams/targets-editor';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { Upstream, UpstreamTarget } from '@/server/domain/upstream';

interface UpstreamFormProps {
  action: (formData: FormData) => Promise<void>;
  initial?: Upstream;
}

const DEFAULT_TARGET: UpstreamTarget = { host: '', port: 80, weight: 1 };

export function UpstreamForm({ action, initial }: UpstreamFormProps) {
  const isEditing = initial !== undefined;
  const [name, setName] = useState<string>(initial?.name ?? '');
  const [loadBalancer, setLoadBalancer] = useState<Upstream['loadBalancer']>(
    initial?.loadBalancer ?? 'round_robin',
  );
  const [targets, setTargets] = useState<UpstreamTarget[]>(
    initial?.targets ?? [{ ...DEFAULT_TARGET }],
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(undefined);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        await action(formData);
      } catch (err) {
        // Next.js uses thrown control-flow signals for redirect()/notFound() —
        // those carry a special digest and must propagate untouched.
        if (err !== null && typeof err === 'object' && 'digest' in err) {
          throw err;
        }
        setError(err instanceof Error ? err.message : 'Failed to save upstream.');
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <FormField label="Name" htmlFor="upstream-name">
        <Input
          id="upstream-name"
          name="name"
          type="text"
          required
          maxLength={100}
          placeholder="api-cluster"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>

      <FormField label="Load balancer" htmlFor="upstream-load-balancer">
        <Select
          id="upstream-load-balancer"
          name="loadBalancer"
          value={loadBalancer}
          onChange={(event) => setLoadBalancer(event.target.value as Upstream['loadBalancer'])}
        >
          <option value="round_robin">Round robin</option>
          <option value="least_conn">Least connections</option>
          <option value="ip_hash">IP hash</option>
        </Select>
      </FormField>

      <TargetsEditor targets={targets} onChange={setTargets} />

      <input type="hidden" name="targets" value={JSON.stringify(targets)} />

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending
            ? isEditing
              ? 'Saving…'
              : 'Creating…'
            : isEditing
              ? 'Save changes'
              : 'Create upstream'}
        </Button>
      </div>
    </form>
  );
}
