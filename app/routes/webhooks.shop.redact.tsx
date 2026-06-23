import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[StockLog] ${topic} received for ${shop}: deleting shop data`);

  const [movements, sessions] = await Promise.all([
    db.stockMovement.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
  ]);

  console.log(
    `[StockLog] shop/redact ${shop}: deleted ${movements.count} stock movement(s), ${sessions.count} session(s)`
  );

  return new Response();
};
