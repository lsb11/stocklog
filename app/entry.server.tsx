import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { type EntryContext, type HandleErrorFunction } from "react-router";
import { isbot } from "isbot";
import * as Sentry from "@sentry/react-router";
import { addDocumentResponseHeaders } from "./shopify.server";
import { wasReported } from "./sentry.server";

export const streamTimeout = 5000;

const sentryHandleError = Sentry.createSentryHandleError({ logErrors: true });

/**
 * React Router calls this for every unhandled server error — loaders, actions,
 * resource routes and server rendering alike — which is what puts them in
 * Sentry. It is a no-op when SENTRY_DSN is unset, apart from the logging that
 * React Router would have done anyway.
 */
export const handleError: HandleErrorFunction = (error, args) => {
  // The webhook handlers already reported this one, with the topic and the
  // Shopify IDs attached, before rethrowing for Shopify's retry.
  if (wasReported(error)) return;
  return sentryHandleError(error, args);
};

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext
) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? '')
    ? "onAllReady"
    : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter
        context={reactRouterContext}
        url={request.url}
      />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        },
      }
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
