import { verifyCreemSignature } from "./verify.ts";

async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.test("accepts a signature computed with the right secret", async () => {
  const body = '{"eventType":"subscription.paid"}';
  const secret = "whsec_test";
  const sig = await sign(body, secret);
  if (!(await verifyCreemSignature(body, sig, secret))) {
    throw new Error("expected valid signature to verify");
  }
});

Deno.test("rejects a tampered body", async () => {
  const secret = "whsec_test";
  const sig = await sign('{"eventType":"subscription.paid"}', secret);
  const tampered = '{"eventType":"subscription.canceled"}';
  if (await verifyCreemSignature(tampered, sig, secret)) {
    throw new Error("expected tampered body to fail verification");
  }
});

Deno.test("rejects a missing signature header", async () => {
  if (await verifyCreemSignature("{}", null, "whsec_test")) {
    throw new Error("expected missing signature to fail verification");
  }
});
