import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyCreemSignature } from "./verify.ts";

const webhookSecret = Deno.env.get("CREEM_WEBHOOK_SECRET")!;
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ponytail: one paid tier, so "pro" is just a large ceiling on the existing
// column — promote to a real plans table once there's a second SKU to
// differentiate max_workspaces by.
const PRO_MAX_WORKSPACES = 100_000;

async function setEntitlements(
  userId: string,
  patch: { max_workspaces?: number; access_expires_at: string },
) {
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  return supabase.from("entitlements").update(patch).eq("user_id", userId);
}

// Only subscription.paid grants access (subscription.active fires too, but
// per Creem's docs it's "only for synchronization").
//
// REVOKE_EVENTS revoke access immediately (set access_expires_at = now) —
// unlike subscription.canceled, which is a deliberate no-op: per
// docs/architecture-sync.md, time already paid for isn't clawed back on a
// plain cancellation, it just lapses on its own at the end of the current
// period. Expired/paused/unpaid all mean the current period itself is no
// longer paid up, so there's nothing left to let run out:
//  - expired: billing period ended without a renewal payment
//  - paused: put on hold (by the merchant or customer)
//  - unpaid: terminal state after expired's payment retries are exhausted
//    (may arrive after expired already revoked — same no-op end state)
const REVOKE_EVENTS = new Set([
  "subscription.expired",
  "subscription.paused",
  "subscription.unpaid",
]);

Deno.serve(async (req) => {
  const rawBody = await req.text();
  const signature = req.headers.get("creem-signature");

  if (!(await verifyCreemSignature(rawBody, signature, webhookSecret))) {
    return new Response("invalid signature", { status: 401 });
  }

  const event = JSON.parse(rawBody);
  const sub = event.object;
  const userId = sub?.metadata?.userId;

  const revokes = REVOKE_EVENTS.has(event.eventType);
  const grants = event.eventType === "subscription.paid";

  if (grants || revokes) {
    if (typeof userId !== "string") {
      return new Response("missing metadata.userId", { status: 400 });
    }

    const { error } = await setEntitlements(
      userId,
      grants
        ? {
            max_workspaces: PRO_MAX_WORKSPACES,
            access_expires_at: sub.current_period_end_date,
          }
        : { access_expires_at: new Date().toISOString() },
    );

    if (error) {
      console.error(error);
      return new Response("db error", { status: 500 });
    }
  }

  return new Response("ok", { status: 200 });
});
