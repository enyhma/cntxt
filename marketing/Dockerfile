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

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
