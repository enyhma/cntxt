# Two stages so the shipped image only carries production deps. The build
# stage's node_modules includes @tinacms/cli and its ~300 build-only
# packages; none of that is needed to run the @astrojs/node standalone
# server, so the runtime stage does its own prod-only install instead of
# reusing the build stage's node_modules wholesale.
FROM node:22-alpine AS build
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

FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist

ENV HOST=0.0.0.0
ENV PORT=80
EXPOSE 80
CMD ["node", "./dist/server/entry.mjs"]
