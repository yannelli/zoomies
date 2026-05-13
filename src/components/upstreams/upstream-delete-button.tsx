'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';

interface UpstreamDeleteButtonProps {
  id: string;
  deleteAction: (id: string) => Promise<void>;
}

const CONFIRM_MESSAGE =
  'Delete this upstream? Sites that reference it will fail to update until reassigned.';

export function UpstreamDeleteButton({ id, deleteAction }: UpstreamDeleteButtonProps) {
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  function onClick(): void {
    setError(undefined);
    if (!window.confirm(CONFIRM_MESSAGE)) return;
    startTransition(async () => {
      try {
        await deleteAction(id);
      } catch (err) {
        // Allow redirect()/notFound() control-flow signals to propagate.
        if (err !== null && typeof err === 'object' && 'digest' in err) {
          throw err;
        }
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to delete upstream. Check that no sites still reference it.',
        );
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        variant="destructive"
        onClick={onClick}
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? 'Deleting…' : 'Delete upstream'}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
