# Single stage, not static-site-into-nginx: the @astrojs/node standalone
# server (see astro.config.mjs) serves prerendered static pages AND the one
# on-demand /tina-island/[name] route Tina's live-preview bridge needs, so
# node_modules has to be present at runtime, not just during the build.
FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .

# tinacms build (part of `pnpm build`) talks to Tina Cloud to index content
# and needs these at build time — not Fly runtime secrets, or the shipped
# /admin has no cloud config. Pass via `fly deploy --build-arg`.
ARG TINA_CLIENT_ID
ARG TINA_TOKEN
ENV TINA_CLIENT_ID=$TINA_CLIENT_ID
ENV TINA_TOKEN=$TINA_TOKEN

RUN pnpm build

ENV HOST=0.0.0.0
ENV PORT=80
EXPOSE 80
CMD ["node", "./dist/server/entry.mjs"]
