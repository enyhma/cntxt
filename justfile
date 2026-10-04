# Deployment commands for the standalone web dashboard (web/) and the
# marketing site (marketing/). Run from the repo root — `just` isn't
# available in this sandbox to test these, so treat them as
# reviewed-by-hand, not verified, until run for real.
#
# Scope: web/ and marketing/ only. extension/ ships through the
# Chrome/Firefox/Edge stores (see extension/package.json's zip scripts),
# not Fly.

# List available commands.
default:
    @just --list

# Deploy web/ to Fly.io against the named environment's .env.<env> file
# (e.g. `just deploy-web production` reads .env.production; add a
# .env.staging and run `just deploy-web staging` the same way — no
# justfile change needed for a new environment). `env` is required, no
# default — just errors out if it's omitted rather than silently picking
# one environment over another.
# Build context is the repo root, not web/ itself (web/ depends on
# workspace:* packages that only resolve from the root lockfile/workspace
# graph — see web/Dockerfile). Vite inlines VITE_* vars at build time,
# not runtime, so these have to be --build-arg, not Fly runtime secrets.
deploy-web env:
    #!/usr/bin/env bash
    set -euo pipefail
    set -a
    source ".env.{{env}}"
    set +a
    fly deploy --config web/fly.toml --dockerfile web/Dockerfile \
      --build-arg VITE_SUPABASE_URL="$SUPABASE_URL" \
      --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="$SUPABASE_PUBLISHABLE_KEY" \
      .

# Deploy marketing/ to Fly.io. Unlike web/, marketing/ is fully
# self-contained (own pnpm-workspace.yaml/lockfile, no workspace:*
# deps), so the build context is marketing/ itself and there's no env
# to pick. tinacms build does need Tina Cloud build-time secrets though
# (see marketing/Dockerfile), read from marketing/.env same as the CMS
# dev/build scripts expect.
deploy-marketing:
    #!/usr/bin/env bash
    set -euo pipefail
    cd marketing
    set -a
    source .env
    set +a
    fly deploy --config fly.toml --dockerfile Dockerfile \
      --build-arg TINA_CLIENT_ID="$TINA_CLIENT_ID" \
      --build-arg TINA_TOKEN="$TINA_TOKEN" \
      .
