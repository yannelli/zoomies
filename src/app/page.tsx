import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { bootstrapConfig } from '@/lib/bootstrap-config';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-6 py-10 sm:px-10">
      <section className="grid gap-4 rounded-3xl border bg-card p-8 shadow-sm lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <Badge className="w-fit">shadcn/ui scaffold</Badge>
          <div className="space-y-3">
            <h1 className="text-4xl font-semibold tracking-tight text-balance">
              Zoomies control plane for NGINX-powered edge routing
            </h1>
            <p className="max-w-3xl text-base leading-7 text-muted-foreground">
              A starter control panel for an approachable reverse proxy manager with space for
              auto-SSL, load balancing, overwrite rules, and Cloudflare-style routing workflows.
            </p>
          </div>
        </div>
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Scaffold status</CardTitle>
            <CardDescription>The project is bootstrapped for Docker-first usage.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Runtime: <span className="font-medium text-foreground">Next.js + NGINX</span>
            </p>
            <p>
              Install modes:{' '}
              <span className="font-medium text-foreground">
                {bootstrapConfig.installModes.join(' / ')}
              </span>
            </p>
            <p>
              API bootstrap:{' '}
              <code className="rounded bg-muted px-2 py-1 text-xs text-foreground">
                /api/bootstrap
              </code>
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {bootstrapConfig.features.map((feature) => (
          <Card key={feature.name}>
            <CardHeader>
              <CardTitle className="text-xl">{feature.name}</CardTitle>
              <CardDescription>{feature.summary}</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-2">
              <Badge variant={feature.ready ? 'default' : 'secondary'}>
                {feature.ready ? 'Ready' : 'Not ready'}
              </Badge>
              <span
                className={
                  feature.status === 'in-progress'
                    ? 'text-xs font-medium text-foreground capitalize'
                    : 'text-xs text-muted-foreground capitalize'
                }
              >
                {feature.status === 'in-progress' ? 'In progress' : feature.status}
              </span>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Docker Compose</CardTitle>
            <CardDescription>
              Primary deployment path for local and self-hosted installs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl bg-muted p-4 font-mono text-sm text-muted-foreground">
              <p>docker compose up --build</p>
            </div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {bootstrapConfig.composeServices.map((service) => (
                <li key={service}>
                  • <span className="text-foreground">{service}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ubuntu 22.04 / 24.04 LTS</CardTitle>
            <CardDescription>
              Native install scaffolding is included for systemd + NGINX.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl bg-muted p-4 font-mono text-sm text-muted-foreground">
              <p>sudo ./scripts/install-ubuntu.sh</p>
            </div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {bootstrapConfig.nativeInstallSteps.map((step) => (
                <li key={step}>• {step}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
