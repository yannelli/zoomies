FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN apk add --no-cache python3 make g++
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Create a non-root user and group for the runtime. The standalone bundle
# does not need any write access inside /app — state lives under
# ZOOMIES_STATE_DIR (a mounted volume). A fixed UID/GID makes it easy to
# chown the host-mounted state dir from a `docker compose` host.
RUN addgroup -g 1000 zoomies \
  && adduser -D -u 1000 -G zoomies zoomies

# `wget` is needed for the HEALTHCHECK below. Alpine's `wget` is provided
# by BusyBox and is already on the image — kept explicit so the dependency
# is documented.
RUN apk add --no-cache wget

COPY --from=builder --chown=zoomies:zoomies /app/.next/standalone ./
COPY --from=builder --chown=zoomies:zoomies /app/.next/static ./.next/static
COPY --from=builder --chown=zoomies:zoomies /app/public ./public

# `dist/` carries the CLI + the renewal worker (`zoomies-worker` bin). The
# worker reuses the standalone bundle's `node_modules` for native deps like
# better-sqlite3 / acme-client.
COPY --from=builder --chown=zoomies:zoomies /app/dist ./dist

USER zoomies

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/healthz || exit 1

CMD ["node", "server.js"]
