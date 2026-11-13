# Image for the local runtime: one container per operation, no host mounts.
# Build from the repo root:  pnpm runner:build
FROM node:22-slim AS build
WORKDIR /src
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/runner ./packages/runner
RUN pnpm install --filter @hephaestus/runner --frozen-lockfile \
 && pnpm --filter @hephaestus/runner build \
 && pnpm --filter @hephaestus/runner deploy --prod --legacy /out

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 10001 agent
COPY --from=build /out /app
USER agent
WORKDIR /work
ENTRYPOINT ["node", "/app/dist/index.js"]
