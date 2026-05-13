'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/require-session';
import { getRepositories } from '@/server/api/db-context';
import {
  CreateUpstreamInputSchema,
  UpdateUpstreamInputSchema,
  createUpstream,
  deleteUpstream,
  updateUpstream,
} from '@/server/api/handlers/upstreams';

/**
 * Parse the multi-row targets editor out of FormData.
 *
 * HTML forms can't natively express arrays of objects, so the client
 * serialises the rows into a single hidden `targets` field as JSON. We pull
 * the raw string out here and hand it to Zod unchanged — any malformed
 * payload (missing field, invalid JSON, wrong shape, out-of-range numbers)
 * surfaces from `CreateUpstreamInputSchema.parse` as a `ZodError`.
 */
function parseUpstreamFormData(formData: FormData): unknown {
  const targetsRaw = formData.get('targets');
  let targets: unknown = undefined;
  if (typeof targetsRaw === 'string' && targetsRaw.length > 0) {
    try {
      targets = JSON.parse(targetsRaw);
    } catch {
      // Leave `targets` undefined so Zod produces a meaningful error.
    }
  }

  return {
    name: formData.get('name'),
    loadBalancer: formData.get('loadBalancer'),
    targets,
  };
}

export async function createUpstreamAction(formData: FormData): Promise<void> {
  await requireSession();
  const { upstreams: upstreamRepo } = getRepositories();
  const input = CreateUpstreamInputSchema.parse(parseUpstreamFormData(formData));
  createUpstream(input, { upstreamRepo });
  revalidatePath('/upstreams');
  redirect('/upstreams');
}

export async function updateUpstreamAction(id: string, formData: FormData): Promise<void> {
  await requireSession();
  const { upstreams: upstreamRepo } = getRepositories();
  const patch = UpdateUpstreamInputSchema.parse(parseUpstreamFormData(formData));
  updateUpstream(id, patch, { upstreamRepo });
  revalidatePath('/upstreams');
  revalidatePath(`/upstreams/${id}`);
  redirect('/upstreams');
}

export async function deleteUpstreamAction(id: string): Promise<void> {
  await requireSession();
  const { upstreams: upstreamRepo } = getRepositories();
  deleteUpstream(id, { upstreamRepo });
  revalidatePath('/upstreams');
  redirect('/upstreams');
}
