import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[StockLog] ${topic} received for ${shop}: deleting shop data`);

  // Every table that carries a `shop` column must be cleared here. If a new
  // shop-scoped model is added to schema.prisma, add its deleteMany below.
  const [movements, settings, sessions] = await Promise.all([
    db.stockMovement.deleteMany({ where: { shop } }),
    db.variantSettings.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
  ]);

  console.log(
    `[StockLog] shop/redact ${shop}: deleted ${movements.count} stock movement(s), ` +
      `${settings.count} variant setting(s), ${sessions.count} session(s)`
  );

  return new Response();
};
