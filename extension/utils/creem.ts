// Live Creem products (public hosted checkout links, safe to embed
// client-side — no API key involved). Keep in sync with the same constants
// in marketing/src/pages/index.astro.
const CREEM_MONTHLY_URL =
  "https://www.creem.io/product/prod_1vEVfh4WUKbCPlPaoFLpS5";
const CREEM_YEARLY_URL =
  "https://www.creem.io/product/prod_7i6mdEk2fz7x5pdo3ZwHC3";

// Creem's hosted checkout link accepts metadata as a query param and
// carries it through to the subscription.paid webhook untouched — no
// server-side "create checkout session" call needed just to attach which
// user is paying. See supabase/functions/creem-webhook.
function checkoutUrl(productUrl: string, userId: string): string {
  const url = new URL(productUrl);
  url.searchParams.set("metadata[userId]", userId);
  return url.toString();
}

export function creemMonthlyCheckoutUrl(userId: string): string {
  return checkoutUrl(CREEM_MONTHLY_URL, userId);
}

export function creemYearlyCheckoutUrl(userId: string): string {
  return checkoutUrl(CREEM_YEARLY_URL, userId);
}
