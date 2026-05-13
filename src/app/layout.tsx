import type { Metadata } from 'next';

import { SiteNav } from '@/components/site-nav';

import './globals.css';

export const metadata: Metadata = {
  title: 'Zoomies',
  description: 'A scaffolded NGINX reverse proxy manager with a shadcn/ui control plane.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
