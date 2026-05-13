'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/require-session';
import { getRepositories } from '@/server/api/db-context';
import {
  CreateSiteInputSchema,
  UpdateSiteInputSchema,
  createSite,
  deleteSite,
  updateSite,
} from '@/server/api/handlers/sites';

/**
 * Pull a non-empty trimmed string from FormData, or `undefined` if the field
 * is absent / blank. Used so an unfilled `<input>` doesn't smuggle an empty
 * string through `UpdateSiteInputSchema.partial()` and overwrite a real value
 * with the empty string (which the schema would also reject).
 */
function readOptional(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function createSiteAction(formData: FormData): Promise<void> {
  await requireSession();
  const input = CreateSiteInputSchema.parse({
    hostname: readOptional(formData, 'hostname'),
    upstreamId: readOptional(formData, 'upstreamId'),
    tlsMode: readOptional(formData, 'tlsMode'),
  });
  const { sites: siteRepo } = getRepositories();
  createSite(input, { siteRepo });
  revalidatePath('/sites');
  redirect('/sites');
}

export async function updateSiteAction(id: string, formData: FormData): Promise<void> {
  await requireSession();
  // Build patch by omitting blank fields entirely — Zod's `.partial()` treats
  // `undefined` as "no change", whereas an empty string would fail validation.
  const patchInput: Record<string, string> = {};
  const hostname = readOptional(formData, 'hostname');
  if (hostname !== undefined) patchInput.hostname = hostname;
  const upstreamId = readOptional(formData, 'upstreamId');
  if (upstreamId !== undefined) patchInput.upstreamId = upstreamId;
  const tlsMode = readOptional(formData, 'tlsMode');
  if (tlsMode !== undefined) patchInput.tlsMode = tlsMode;

  const patch = UpdateSiteInputSchema.parse(patchInput);
  const { sites: siteRepo } = getRepositories();
  updateSite(id, patch, { siteRepo });
  revalidatePath('/sites');
  revalidatePath(`/sites/${id}`);
  redirect('/sites');
}

export async function deleteSiteAction(id: string): Promise<void> {
  await requireSession();
  const { sites: siteRepo } = getRepositories();
  deleteSite(id, { siteRepo });
  revalidatePath('/sites');
  redirect('/sites');
}
