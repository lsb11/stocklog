import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

type RefundLineItem = {
  quantity: number;
  restock_type: string; // "no_restock" | "cancel" | "return" | "legacy_restock"
  line_item: {
    title: string;
    sku: string | null;
    variant_id: number | null;
    product_id: number | null;
  };
};

type RefundPayload = {
  id: number;
  order_id: number;
  refund_line_items: RefundLineItem[];
};

/**
 * When a refund restocks items, add them back to the ledger.
 * Items refunded with restock_type "no_restock" are deliberately
 * ignored — the merchant chose not to return them to inventory.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const refund = payload as RefundPayload;
  const refundRef = `gid://shopify/Refund/${refund.id}`;
  const sourceOrderId = `gid://shopify/Order/${refund.order_id}`;

  // Idempotency guard keyed on the refund's own GID.
  const existing = await db.stockMovement.findFirst({
    where: { shop, orderId: refundRef, reason: "refund_restock" },
    select: { id: true },
  });
  if (existing) return new Response();

  const movements = (refund.refund_line_items ?? [])
    .filter(
      (r) =>
        r.restock_type !== "no_restock" &&
        r.quantity > 0 &&
        r.line_item?.variant_id != null,
    )
    .map((r) => ({
      shop,
      productId:
        r.line_item.product_id != null
          ? `gid://shopify/Product/${r.line_item.product_id}`
          : null,
      variantId: `gid://shopify/ProductVariant/${r.line_item.variant_id}`,
      sku: r.line_item.sku || null,
      productTitle: r.line_item.title,
      quantityDelta: r.quantity,
      reason: "refund_restock",
      orderId: refundRef,
      sourceOrderId,
    }));

  // The cancellation webhook may have landed first (Shopify fires both for a
  // cancel-with-restock, and delivery order is not guaranteed). If it already
  // put these units back, don't restock them a second time.
  const priorCancelRestocks = await db.stockMovement.findMany({
    where: { shop, sourceOrderId, reason: "order_cancelled" },
    select: { variantId: true, quantityDelta: true },
  });
  const alreadyRestocked = new Map<string, number>();
  for (const r of priorCancelRestocks) {
    alreadyRestocked.set(
      r.variantId,
      (alreadyRestocked.get(r.variantId) ?? 0) + r.quantityDelta,
    );
  }

  const netted = movements
    .map((m) => {
      const credited = alreadyRestocked.get(m.variantId) ?? 0;
      const remaining = m.quantityDelta - credited;
      alreadyRestocked.set(
        m.variantId,
        Math.max(0, credited - m.quantityDelta),
      );
      return { ...m, quantityDelta: remaining };
    })
    .filter((m) => m.quantityDelta > 0);

  if (netted.length > 0) {
    await db.stockMovement.createMany({ data: netted });
    console.log(`Restocked ${netted.length} line(s) for refund ${refundRef}`);
  } else if (movements.length > 0) {
    console.log(`Refund ${refundRef} already restocked by cancellation; no movement written`);
  }
  return new Response();
};
