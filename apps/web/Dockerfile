FROM node:20-alpine

WORKDIR /app
RUN corepack enable

# Vite inlines VITE_API_URL at build time, so it has to arrive as a build
# argument; setting it as a runtime variable would never reach the bundle.
ARG VITE_API_URL=http://localhost:4000
ENV VITE_API_URL=$VITE_API_URL

COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @maicora/web build

EXPOSE 5173
CMD ["pnpm", "--filter", "@maicora/web", "preview"]
