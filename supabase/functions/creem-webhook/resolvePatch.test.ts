import {
  BASIC_PRODUCT_ID,
  PRO_MAX_WORKSPACES,
  resolvePatch,
} from "./resolvePatch.ts";

function assertEquals(actual: unknown, expected: unknown, msg?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      msg ??
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("subscription.paid grants Pro", () => {
  const result = resolvePatch({
    eventType: "subscription.paid",
    object: {
      metadata: { userId: "user-1" },
      current_period_end_date: "2027-01-01T00:00:00.000Z",
    },
  });
  assertEquals(result, {
    userId: "user-1",
    patch: {
      max_workspaces: PRO_MAX_WORKSPACES,
      access_expires_at: "2027-01-01T00:00:00.000Z",
    },
  });
});

for (const eventType of [
  "subscription.expired",
  "subscription.paused",
  "subscription.unpaid",
]) {
  Deno.test(`${eventType} revokes Pro access immediately`, () => {
    const result = resolvePatch({
      eventType,
      object: { metadata: { userId: "user-1" } },
    });
    if (!result) throw new Error("expected a patch");
    assertEquals(result.userId, "user-1");
    assertEquals(Object.keys(result.patch), ["access_expires_at"]);
    if (new Date(result.patch.access_expires_at!).getTime() > Date.now()) {
      throw new Error(
        "expected access_expires_at to be set to now, not the future",
      );
    }
  });
}

Deno.test(
  "subscription.canceled is a no-op (time already paid for isn't clawed back)",
  () => {
    assertEquals(
      resolvePatch({ eventType: "subscription.canceled", object: {} }),
      null,
    );
  },
);

Deno.test(
  "checkout.completed for the Basic product grants has_basic_license",
  () => {
    const result = resolvePatch({
      eventType: "checkout.completed",
      object: {
        metadata: { userId: "user-1" },
        product: { id: BASIC_PRODUCT_ID },
        order: { status: "paid" },
      },
    });
    assertEquals(result, {
      userId: "user-1",
      patch: { has_basic_license: true, max_workspaces: PRO_MAX_WORKSPACES },
    });
  },
);

Deno.test(
  "checkout.completed for a different product (e.g. a Pro subscription's initial checkout) is a no-op",
  () => {
    assertEquals(
      resolvePatch({
        eventType: "checkout.completed",
        object: {
          metadata: { userId: "user-1" },
          product: { id: "prod_some_other_product" },
          order: { status: "paid" },
        },
      }),
      null,
    );
  },
);

Deno.test(
  "checkout.completed for the Basic product with a non-paid order status is a no-op",
  () => {
    assertEquals(
      resolvePatch({
        eventType: "checkout.completed",
        object: {
          metadata: { userId: "user-1" },
          product: { id: BASIC_PRODUCT_ID },
          order: { status: "pending" },
        },
      }),
      null,
    );
  },
);
