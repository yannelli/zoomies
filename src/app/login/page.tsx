import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 items-center px-6 py-16 sm:px-10">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl">Sign in to Zoomies</CardTitle>
          <CardDescription>
            Enter the API token configured via{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">ZOOMIES_API_TOKEN</code> to
            unlock the control plane.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  );
}
