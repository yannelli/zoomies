import Link from 'next/link';

import { Button } from '@/components/ui/button';

const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/sites', label: 'Sites' },
  { href: '/upstreams', label: 'Upstreams' },
] as const;

export function SiteNav() {
  return (
    <header className="border-b border-border bg-background">
      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3 sm:px-10">
        <Link
          href="/"
          className="text-base font-semibold tracking-tight text-foreground hover:opacity-80"
        >
          Zoomies
        </Link>
        <ul className="flex items-center gap-1">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-foreground hover:bg-muted"
              >
                {link.label}
              </Link>
            </li>
          ))}
          <li>
            <form action="/api/auth/logout" method="post">
              <Button type="submit" variant="ghost" size="sm">
                Logout
              </Button>
            </form>
          </li>
        </ul>
      </nav>
    </header>
  );
}
