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

  try {
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

    // Shopify fires refunds/create AND orders/cancelled when a paid order is
    // cancelled with restock. Those refund rows have already returned some (or
    // all) of the stock, so reverse only what remains — otherwise the ledger
    // gains phantom units. Netting per variant also handles partial refunds.
    const priorRestocks = await db.stockMovement.findMany({
      where: { shop, sourceOrderId: orderId, reason: "refund_restock" },
      select: { variantId: true, quantityDelta: true },
    });
    const alreadyRestocked = new Map<string, number>();
    for (const r of priorRestocks) {
      alreadyRestocked.set(
        r.variantId,
        (alreadyRestocked.get(r.variantId) ?? 0) + r.quantityDelta,
      );
    }

    type Movement = (typeof originals)[number];
    const rows = originals
      .map((m: Movement): { m: Movement; remaining: number } => {
        const owed = -m.quantityDelta; // positive: units to put back
        const credited = alreadyRestocked.get(m.variantId) ?? 0;
        const remaining = owed - credited;
        // Consume the credit so multiple lines on one variant don't reuse it.
        alreadyRestocked.set(m.variantId, Math.max(0, credited - owed));
        return { m, remaining };
      })
      .filter(({ remaining }: { m: Movement; remaining: number }) => remaining > 0)
      .map(({ m, remaining }: { m: Movement; remaining: number }) => ({
        shop,
        productId: m.productId,
        variantId: m.variantId,
        sku: m.sku,
        productTitle: m.productTitle,
        quantityDelta: remaining,
        reason: "order_cancelled",
        orderId,
        sourceOrderId: orderId,
      }));

    if (rows.length === 0) {
      console.log(`Cancelled order ${orderId} already fully restocked by refund(s); no reversal needed`);
      return new Response();
    }

    await db.stockMovement.createMany({ data: rows });
    console.log(`Reversed ${rows.length} movement(s) for cancelled order ${orderId}`);
    return new Response();
  } catch (err) {
    // Rethrow so the request 500s and Shopify retries; the idempotency guard
    // above makes a replay safe.
    console.error(`[StockLog] ${topic} failed for shop ${shop}, order ${orderId}:`, err);
    throw err;
  }
};
