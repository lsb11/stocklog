import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { captureWebhookError } from "../sentry.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    // Webhook requests can trigger multiple times and after an app has already been uninstalled.
    // If this webhook already ran, the session may have been deleted previously.
    if (session) {
      await db.session.deleteMany({ where: { shop } });
    }

    return new Response();
  } catch (err) {
    // Rethrow so the request 500s and Shopify retries; deleting sessions is
    // idempotent, so a replay is safe.
    captureWebhookError(err, { topic, shop });
    console.error(`[StockLog] ${topic} failed for shop ${shop}:`, err);
    throw err;
  }
};
