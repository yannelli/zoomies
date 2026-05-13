'use client';

import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

export function LoginForm() {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
        credentials: 'include',
      });
      if (!response.ok) {
        setError('Invalid token. Please try again.');
        setSubmitting(false);
        return;
      }
      window.location.assign('/');
    } catch {
      setError('Could not reach the server. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormField label="API token" htmlFor="zoomies-api-token" error={error}>
        <Input
          id="zoomies-api-token"
          name="token"
          type="password"
          autoComplete="off"
          autoFocus
          required
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Paste your ZOOMIES_API_TOKEN"
        />
      </FormField>
      <Button type="submit" disabled={submitting || token.length === 0}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
