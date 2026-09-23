import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { captureWebhookError } from "../sentry.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { payload, session, topic, shop } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);

    try {
        const current = payload.current as string[];
        if (session) {
            await db.session.update({
                where: {
                    id: session.id
                },
                data: {
                    scope: current.toString(),
                },
            });
        }
        return new Response();
    } catch (err) {
        // Rethrow so the request 500s and Shopify retries; rewriting the scope
        // is idempotent, so a replay is safe.
        captureWebhookError(err, { topic, shop });
        console.error(`[StockLog] ${topic} failed for shop ${shop}:`, err);
        throw err;
    }
};
