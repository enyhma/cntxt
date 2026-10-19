// Pure event-routing logic, split out of index.ts so it's testable without
// a live Supabase client or a Deno.serve request (same reasoning as
// verify.ts being its own module). Anything that needs to *read* current
// entitlements first (refund.created — see index.ts) can't live here,
// since this stays a pure function of the event alone.

// ponytail: one subscription SKU (Pro) + one one-time SKU (Basic), so
// these are just two large ceilings/flags on existing columns — promote to
// a real plans table if a third SKU ever needs its own ceiling.
export const PRO_MAX_WORKSPACES = 100_000;

// The live Basic product id. Not a secret — the monthly/yearly ids are
// already hardcoded the same way in extension/utils/creem.ts.
export const BASIC_PRODUCT_ID = "prod_3etosXzssLTxYWgp7XKXiv";

export type CreemEvent = {
  eventType: string;
  object: {
    metadata?: { userId?: string };
    current_period_end_date?: string;
    product?: { id?: string };
    order?: { status?: string };
  };
};

export type EntitlementsPatch = {
  has_basic_license?: boolean;
  max_workspaces?: number;
  access_expires_at?: string;
};

// Only subscription.paid grants Pro access (subscription.active fires too,
// but per Creem's docs it's "only for synchronization").
//
// REVOKE_EVENTS revoke Pro access immediately (set access_expires_at =
// now) — unlike subscription.canceled, which is a deliberate no-op: per
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

// Resolves the three events whose entitlements patch is a pure function of
// the event payload alone. Returns null for anything else (including
// refund.created, handled separately in index.ts since it needs to read
// the account's current state first).
export function resolvePatch(
  event: CreemEvent,
): { userId: string | undefined; patch: EntitlementsPatch } | null {
  const obj = event.object;

  if (event.eventType === "subscription.paid") {
    return {
      userId: obj.metadata?.userId,
      patch: {
        max_workspaces: PRO_MAX_WORKSPACES,
        access_expires_at: obj.current_period_end_date,
      },
    };
  }

  if (REVOKE_EVENTS.has(event.eventType)) {
    return {
      userId: obj.metadata?.userId,
      patch: { access_expires_at: new Date().toISOString() },
    };
  }

  // A subscription's initial checkout also fires checkout.completed, but
  // subscription.paid already handles granting Pro for that case — scoping
  // this to the Basic product id specifically avoids double-handling it.
  if (
    event.eventType === "checkout.completed" &&
    obj.product?.id === BASIC_PRODUCT_ID &&
    obj.order?.status === "paid"
  ) {
    return {
      userId: obj.metadata?.userId,
      patch: { has_basic_license: true, max_workspaces: PRO_MAX_WORKSPACES },
    };
  }

  return null;
}
