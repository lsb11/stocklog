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
    }));

  if (movements.length > 0) {
    await db.stockMovement.createMany({ data: movements });
    console.log(`Restocked ${movements.length} line(s) for refund ${refundRef}`);
  }
  return new Response();
};
