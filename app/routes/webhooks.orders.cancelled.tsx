import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

type OrderPayload = { id: number };

/**
 * When an order is cancelled, put the stock back by writing exact
 * reversals of whatever we originally recorded for that order.
 * Reversing our own ledger rows (rather than re-reading the payload)
 * guarantees the ledger returns to precisely its pre-order state.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const order = payload as OrderPayload;
  const orderId = `gid://shopify/Order/${order.id}`;

  // Idempotency guard for retried deliveries.
  const alreadyReversed = await db.stockMovement.findFirst({
    where: { shop, orderId, reason: "order_cancelled" },
    select: { id: true },
  });
  if (alreadyReversed) return new Response();

  const originals = await db.stockMovement.findMany({
    where: { shop, orderId, reason: "order" },
  });
  if (originals.length === 0) return new Response();

  type Movement = (typeof originals)[number];
  await db.stockMovement.createMany({
    data: originals.map((m: Movement) => ({
      shop,
      productId: m.productId,
      variantId: m.variantId,
      sku: m.sku,
      productTitle: m.productTitle,
      quantityDelta: -m.quantityDelta, // exact reversal
      reason: "order_cancelled",
      orderId,
    })),
  });
  console.log(`Reversed ${originals.length} movement(s) for cancelled order ${orderId}`);
  return new Response();
};
