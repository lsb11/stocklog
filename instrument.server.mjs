/**
 * Sentry for the Node server. Loaded via `--import` (see the `start` script)
 * so that it runs before React Router, Prisma or the Shopify SDK are imported
 * and can therefore auto-instrument them.
 *
 * With SENTRY_DSN unset — the normal local case — init is skipped entirely and
 * every `Sentry.captureException` elsewhere in the app becomes a no-op, so the
 * app runs exactly as it did before.
 */
import * as Sentry from "@sentry/react-router";

import { scrubEvent } from "./sentry-scrub.js";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",

    // Errors only. Performance data is what burns the free tier, and we have
    // no latency question that needs answering yet.
    tracesSampleRate: 0,

    // Never attach IPs, cookies or user records to an event.
    sendDefaultPii: false,

    beforeSend: scrubEvent,
  });
}
