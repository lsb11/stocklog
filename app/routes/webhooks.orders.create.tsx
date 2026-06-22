import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

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
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const order = payload as OrderPayload;
  const orderId = `gid://shopify/Order/${order.id}`;

  const movements = order.line_items
    .filter((item) => item.variant_id != null && item.quantity > 0)
    .map((item) => ({
      shop,
      variantId: `gid://shopify/ProductVariant/${item.variant_id}`,
      sku: item.sku || null,
      productTitle: item.title,
      quantityDelta: -item.quantity,
      reason: "order",
      orderId,
    }));

  if (movements.length > 0) {
    await db.stockMovement.createMany({ data: movements });
    console.log(`Created ${movements.length} stock movement(s) for order ${orderId}`);
  }

  return new Response();
};
