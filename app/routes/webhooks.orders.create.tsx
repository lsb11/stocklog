import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ensureOpeningBalances } from "../stock.server";

type LineItem = {
  title: string;
  quantity: number;
  sku: string | null;
  variant_id: number | null;
  product_id: number | null;
};

type OrderPayload = {
  id: number;
  line_items: LineItem[];
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const order = payload as OrderPayload;
  const orderId = `gid://shopify/Order/${order.id}`;

  try {
    // Idempotency: Shopify retries webhooks on timeouts/5xx. Without this
    // guard a retried delivery would decrement stock twice.
    const existing = await db.stockMovement.findFirst({
      where: { shop, orderId, reason: "order" },
      select: { id: true },
    });
    if (existing) {
      console.log(`Order ${orderId} already recorded for ${shop}: skipping duplicate delivery`);
      return new Response();
    }

    const movements = order.line_items
      .filter((item) => item.variant_id != null && item.quantity > 0)
      .map((item) => ({
        shop,
        productId: item.product_id != null ? `gid://shopify/Product/${item.product_id}` : null,
        variantId: `gid://shopify/ProductVariant/${item.variant_id}`,
        sku: item.sku || null,
        productTitle: item.title,
        quantityDelta: -item.quantity,
        reason: "order",
        orderId,
      }));

    if (movements.length > 0) {
      // A variant we've never seen must not start life at zero, or this order
      // pushes it straight into negative stock. Open it at whatever Shopify
      // holds right now, net of the decrement Shopify has already applied for
      // this order, so the ledger lands exactly on Shopify's figure.
      await ensureOpeningBalances(
        shop,
        admin,
        movements.map((m) => ({
          variantId: m.variantId,
          sku: m.sku,
          productTitle: m.productTitle,
          appliedDelta: m.quantityDelta,
        })),
      );

      await db.stockMovement.createMany({ data: movements });
      console.log(`Created ${movements.length} stock movement(s) for order ${orderId}`);
    }

    return new Response();
  } catch (err) {
    // Rethrow so the request 500s and Shopify retries; the idempotency guard
    // above makes a replay safe.
    console.error(`[StockLog] ${topic} failed for shop ${shop}, order ${orderId}:`, err);
    throw err;
  }
};
