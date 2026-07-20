FROM node:22.22.1-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 build-essential ca-certificates && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm PATH=/pnpm/bin:$PATH
RUN corepack enable && corepack prepare pnpm@11.15.1 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile --filter @ai-quiz/api... --filter @ai-quiz/shared...
RUN pnpm --filter @ai-quiz/shared build
RUN pnpm --filter @ai-quiz/api build
# `pnpm install` above is not `--prod`, so api's devDependencies resolve — which
# includes `@ai-quiz/test-doubles`, the package holding the fake adapters. The
# runtime stage copies node_modules but not packages/, so that symlink would
# survive into the production image as a dangling pointer to test code. Nothing
# resolves it (the flag that triggers the dynamic import cannot be set under
# NODE_ENV=production), but shipping an image that gestures at fake-content
# adapters is exactly what this build is supposed to make impossible.
RUN rm -rf /app/node_modules/@ai-quiz/test-doubles \
           /app/apps/api/node_modules/@ai-quiz/test-doubles \
           /app/packages/test-doubles
RUN apt-get purge -y --auto-remove build-essential python3 && rm -rf /var/lib/apt/lists/*

FROM node:22.22.1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production API_PORT=4000
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/drizzle ./apps/api/drizzle
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 4000
USER node
CMD ["node", "apps/api/dist/main.js"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1
