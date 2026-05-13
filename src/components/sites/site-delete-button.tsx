'use client';

import { useTransition } from 'react';

import { Button } from '@/components/ui/button';

interface SiteDeleteButtonProps {
  id: string;
  deleteAction: (id: string) => Promise<void>;
}

export function SiteDeleteButton({ id, deleteAction }: SiteDeleteButtonProps) {
  const [isPending, startTransition] = useTransition();

  function onClick() {
    if (!window.confirm('Delete this site? This cannot be undone.')) {
      return;
    }
    startTransition(() => {
      void deleteAction(id);
    });
  }

  return (
    <Button type="button" variant="destructive" onClick={onClick} disabled={isPending}>
      {isPending ? 'Deleting…' : 'Delete site'}
    </Button>
  );
}
