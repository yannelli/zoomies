import type * as React from 'react';

import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';

type FormFieldProps = {
  label: string;
  htmlFor: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
};

function FormField({ label, htmlFor, error, className, children }: FormFieldProps) {
  return (
    <div data-slot="form-field" className={cn('flex flex-col gap-2', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p data-slot="form-field-error" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export { FormField };
