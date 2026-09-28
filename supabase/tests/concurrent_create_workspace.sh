#!/usr/bin/env bash
# Concurrency check for create_workspace, per docs/implementation-plan-sync.md
# M2: "two concurrent calls at the limit, exactly one should succeed."
#
# Not a pgTAP test: pgTAP runs one script sequentially in one transaction,
# which can't exercise two backends genuinely racing on the same row lock.
# This fires two real concurrent `psql` connections instead.
#
# ponytail: no artificial delay is injected to widen the race window — two
# backgrounded local psql round-trips against a local Docker Postgres
# reliably overlap enough to contend on the `for update` lock in practice.
# This is a best-effort concurrency check, not a timing-proof one; the
# `for update` lock itself is what guarantees correctness once contention
# happens, not the test's timing.
#
# Usage: ./concurrent_create_workspace.sh (assumes `supabase start` is running
# locally on the default port 54322)

set -euo pipefail

USER_ID="66666666-6666-6666-6666-666666666666"
PSQL() { docker exec -i supabase_db_cntxt psql -U postgres -d postgres "$@"; }

PSQL <<SQL
insert into auth.users (id, email) values ('$USER_ID', 'race2@example.com')
on conflict (id) do nothing;
update public.entitlements set max_workspaces = 1 where user_id = '$USER_ID';
delete from public.workspaces where user_id = '$USER_ID';
SQL

CALL="set role authenticated; set \"request.jwt.claim.sub\" to '$USER_ID'; select create_workspace('race', '[]'::jsonb);"

tmp_a=$(mktemp)
tmp_b=$(mktemp)
trap 'rm -f "$tmp_a" "$tmp_b"' EXIT

PSQL -c "$CALL" >"$tmp_a" 2>&1 &
PSQL -c "$CALL" >"$tmp_b" 2>&1 &
wait

count=$(PSQL -tA -c "select count(*) from public.workspaces where user_id = '$USER_ID';")

echo "--- session A ---"
cat "$tmp_a"
echo "--- session B ---"
cat "$tmp_b"
echo "--- final workspace count (expect 1) ---"
echo "$count"

if [ "$count" != "1" ]; then
  echo "FAIL: expected exactly 1 workspace, got $count — the lock did not close the race"
  exit 1
fi

echo "PASS"
