# The API runs its TypeScript directly through tsx: the workspace has no
# build step to keep dev and production on the same code path, and the
# container is not the place to introduce one.
FROM node:20-alpine

WORKDIR /app
RUN corepack enable

COPY . .
RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production
EXPOSE 4000

# Migrations run before the server so a fresh volume comes up with a schema.
CMD ["sh", "-c", "pnpm --filter @maicora/database migrate && pnpm --filter @maicora/api start"]
