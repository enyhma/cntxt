# Build context must be the repo root, not web/ — unlike marketing/ (its
# own pnpm-workspace.yaml/lockfile, fully self-contained), web/ depends on
# workspace:* packages (@cntxt/ui, @cntxt/tokens) that only resolve from
# the root lockfile/workspace graph. Deploy with:
#   fly deploy --config web/fly.toml --dockerfile web/Dockerfile .
# (run from the repo root).
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile

# Vite inlines import.meta.env.VITE_* at build time, not runtime — these
# have to be build args (passed via `fly deploy --build-arg`), not Fly
# runtime secrets, or the shipped bundle silently has no Supabase config.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY

RUN pnpm --filter web build

FROM nginx:alpine
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80
