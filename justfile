# Deployment commands for the standalone web dashboard (web/). Run from
# the repo root — `just` isn't available in this sandbox to test these,
# so treat them as reviewed-by-hand, not verified, until run for real.
#
# Scope: web/ only. extension/ ships through the Chrome/Firefox/Edge
# stores (see extension/package.json's zip scripts), not Fly, and
# marketing/'s deploy isn't wired here — ask if that's wanted too.

set dotenv-filename := ".env.production"
set dotenv-load := true

# List available commands.
default:
    @just --list

# Build web/ locally — a sanity check before deploying.
build-web:
    pnpm --filter web build

# Deploy web/ to Fly.io. Build context is the repo root, not web/ itself
# (web/ depends on workspace:* packages that only resolve from the root
# lockfile/workspace graph — see web/Dockerfile). Vite inlines VITE_*
# vars at build time, not runtime, so these have to be --build-arg, not
# Fly runtime secrets.
deploy-web:
    fly deploy --config web/fly.toml --dockerfile web/Dockerfile \
      --build-arg VITE_SUPABASE_URL="$SUPABASE_URL" \
      --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="$SUPABASE_PUBLISHABLE_KEY" \
      .

# One-time setup, run once before the first deploy-web.
create-web-app:
    fly apps create cntxt-production-dashboard

# One-time setup — provisions the app.cntxt.work TLS cert. Still requires
# adding the DNS record Fly prints, and adding https://app.cntxt.work to
# Supabase Auth's redirect allowlist, by hand (dashboard config, not
# something this recipe can do).
certs-web:
    fly certs add app.cntxt.work --app cntxt-production-dashboard
