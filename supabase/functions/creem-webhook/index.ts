import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyCreemSignature } from "./verify.ts";
import {
  BASIC_PRODUCT_ID,
  type CreemEvent,
  resolvePatch,
} from "./resolvePatch.ts";

const webhookSecret = Deno.env.get("CREEM_WEBHOOK_SECRET")!;
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function client() {
  return createClient(supabaseUrl, serviceRoleKey);
}

// refund.created needs to read the account's current Pro status before
// deciding the patch — a Basic refund should only floor max_workspaces
// back to 3 if the account isn't separately covered by an active Pro
// subscription — so unlike the three events in resolvePatch.ts, this can't
// be a pure function of the event alone.
//
// Payload shape taken from Creem's webhook docs, not yet verified against
// a real event (the live account has zero transactions as of writing) —
// double-check object.order.product/object.checkout.metadata here against
// an actual refund.created delivery once the Basic product has its first
// sale.
async function handleRefund(
  event: CreemEvent & {
    object: {
      order?: { product?: { id?: string } };
      checkout?: { metadata?: { userId?: string } };
    };
  },
) {
  const obj = event.object;
  if (obj.order?.product?.id !== BASIC_PRODUCT_ID) return;

  const userId = obj.checkout?.metadata?.userId;
  if (typeof userId !== "string") {
    console.error("refund.created for Basic product missing metadata.userId");
    return;
  }

  const supabase = client();
  const { data } = await supabase
    .from("entitlements")
    .select("access_expires_at")
    .eq("user_id", userId)
    .single();

  const proStillActive =
    !!data?.access_expires_at && new Date(data.access_expires_at) > new Date();

  const { error } = await supabase
    .from("entitlements")
    .update({
      has_basic_license: false,
      ...(proStillActive ? {} : { max_workspaces: 3 }),
    })
    .eq("user_id", userId);

  if (error) console.error(error);
}

Deno.serve(async (req) => {
  const rawBody = await req.text();
  const signature = req.headers.get("creem-signature");

  if (!(await verifyCreemSignature(rawBody, signature, webhookSecret))) {
    return new Response("invalid signature", { status: 401 });
  }

  const event = JSON.parse(rawBody);

  if (event.eventType === "refund.created") {
    await handleRefund(event);
    return new Response("ok", { status: 200 });
  }

  const resolved = resolvePatch(event);
  if (!resolved) return new Response("ok", { status: 200 });

  const { userId, patch } = resolved;
  if (typeof userId !== "string") {
    return new Response("missing metadata.userId", { status: 400 });
  }

  const { error } = await client()
    .from("entitlements")
    .update(patch)
    .eq("user_id", userId);

  if (error) {
    console.error(error);
    return new Response("db error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
});
