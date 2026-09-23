import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { isRouteErrorResponse, type ClientOnErrorFunction } from "react-router";
import * as Sentry from "@sentry/react-router";

import { scrubEvent } from "../sentry-scrub.js";

// Set by the inline script that root.tsx renders, from the server's
// SENTRY_DSN. Unset locally, which leaves everything below inert.
const dsn = window.__STOCKLOG_SENTRY_DSN__;

if (dsn) {
  Sentry.init({
    dsn,
    environment: window.__STOCKLOG_ENV__ || "development",

    // Errors only, matching the server. No tracing, no session replay, no
    // profiling — all of which would cost free-tier quota.
    tracesSampleRate: 0,

    sendDefaultPii: false,

    beforeSend: scrubEvent,
  });
}

/**
 * React Router calls this for every middleware, loader, action or render error
 * that reaches an error boundary, exactly once per error — which is why Sentry
 * recommends it over reporting from inside the boundary component, where a
 * re-render would report the same crash again.
 */
const onError: ClientOnErrorFunction = (error, info) => {
  // A route error response is the server's error travelling to the client: the
  // server already reported it through handleError, with the real stack that
  // React Router strips out before sending it here. Reporting it again would
  // only add an "Unexpected Server Error" duplicate. 404s land here too.
  if (isRouteErrorResponse(error)) return;

  // @sentry/react-router resolves to its browser entry point here, which is
  // what tsc checks against, but eslint's resolver only ever sees the Node
  // entry — where this export is genuinely absent.
  // eslint-disable-next-line import/namespace
  Sentry.sentryOnError(error, { errorInfo: info.errorInfo });
};

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter onError={onError} />
    </StrictMode>,
  );
});
