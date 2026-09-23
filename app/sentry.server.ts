import * as Sentry from "@sentry/react-router";

/**
 * Sentry helpers for server code.
 *
 * Sentry itself is initialised in `instrument.server.mjs`, which Node loads via
 * `--import` before this module exists. If SENTRY_DSN is unset there is no
 * client, and everything below is a no-op — callers never need to check.
 */

/**
 * Tags every event raised for the rest of this request with the shop, so an
 * error can be traced to the merchant that hit it.
 *
 * Uses the isolation scope rather than the current scope: React Router runs
 * loaders concurrently, and the isolation scope is the one shared by
 * everything handling this request.
 */
export function tagShop(shop: string | null | undefined): void {
  if (!shop) return;
  Sentry.getIsolationScope().setTag("shop", shop);
}

/**
 * Marks an error as already sent to Sentry.
 *
 * The webhook handlers report their own failures (so the event carries the
 * topic and the Shopify GIDs) and then rethrow, which is what makes Shopify
 * retry. That rethrow reaches React Router's `handleError`, which would
 * otherwise report the same error a second time.
 */
const REPORTED = Symbol.for("stocklog.sentry.reported");

function markReported(error: unknown): void {
  if (error && typeof error === "object") {
    (error as Record<symbol, unknown>)[REPORTED] = true;
  }
}

export function wasReported(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as Record<symbol, unknown>)[REPORTED],
  );
}

type WebhookErrorContext = {
  topic: string;
  shop: string;
  /**
   * Shopify GIDs only. Never pass any of the webhook payload through here —
   * it carries order contents and buyer details.
   */
  ids?: Record<string, string | null | undefined>;
};

/**
 * Reports a failed webhook delivery.
 *
 * Callers rethrow afterwards so the request still 500s and Shopify still
 * retries; this only adds the report, it never swallows the error.
 */
export function captureWebhookError(
  error: unknown,
  { topic, shop, ids }: WebhookErrorContext,
): void {
  Sentry.withScope((scope) => {
    scope.setTag("shop", shop);
    scope.setTag("webhook.topic", topic);
    // Retried deliveries of the same failure group together per topic rather
    // than fanning out into one issue per order.
    scope.setFingerprint(["webhook", topic, "{{ default }}"]);
    if (ids) scope.setContext("shopify", ids);
    Sentry.captureException(error);
  });
  markReported(error);
}
