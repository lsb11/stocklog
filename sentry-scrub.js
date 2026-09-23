/**
 * Redaction shared by the two Sentry clients: the server one in
 * `instrument.server.mjs` and the browser one in `app/entry.client.tsx`.
 *
 * StockLog sees buyer names, order contents and Shopify access tokens, none
 * of which belong in an error tracker. Sentry is only allowed to carry what
 * locates a bug: the route, the shop, and the stack.
 *
 * Query strings matter as much as headers here — Shopify puts a session token
 * in `id_token` and an OAuth authorization code in `code`, so an unredacted
 * embedded-app URL is a credential.
 *
 * Plain JS rather than TypeScript because `instrument.server.mjs` is loaded by
 * Node via `--import` before any build step exists to compile it.
 */

const REDACTED = "[Filtered]";

/**
 * Allowlist, not a denylist: Shopify adds query params over time and a missed
 * one is a leak, whereas a missed safe param only costs us a breadcrumb.
 * These identify the merchant and the surface and authenticate nothing.
 */
const SAFE_QUERY_PARAMS = new Set([
  "shop",
  "embedded",
  "locale",
  "host_name",
  "page",
  "reason",
  "variantId",
]);

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-shopify-access-token",
  "x-shopify-hmac-sha256",
]);

/** Rewrites a query string, keeping only allowlisted params. */
function scrubQueryString(queryString) {
  if (!queryString) return queryString;
  const params = new URLSearchParams(queryString);
  let changed = false;
  for (const key of [...params.keys()]) {
    if (!SAFE_QUERY_PARAMS.has(key)) {
      params.set(key, REDACTED);
      changed = true;
    }
  }
  return changed ? params.toString() : queryString;
}

/**
 * Strips credentials from a URL's query string, leaving the path intact.
 * Non-URL strings are returned untouched rather than thrown away — a mangled
 * breadcrumb is worse than an unparsed one.
 */
export function scrubUrl(url) {
  if (typeof url !== "string" || url === "") return url;
  try {
    // Relative URLs need a base; it is stripped again below.
    const isRelative = url.startsWith("/");
    const parsed = new URL(url, isRelative ? "http://scrub.invalid" : undefined);
    if (!parsed.search) return url;
    parsed.search = scrubQueryString(parsed.search.slice(1));
    return isRelative ? `${parsed.pathname}${parsed.search}` : parsed.toString();
  } catch {
    return url;
  }
}

/** Reads the myshopify domain out of whatever the event happens to carry. */
export function shopFromRequest(request) {
  if (!request) return undefined;

  const headers = request.headers ?? {};
  for (const [key, value] of Object.entries(headers)) {
    // Shopify sets this on every verified webhook delivery.
    if (key.toLowerCase() === "x-shopify-shop-domain" && value) {
      return String(value);
    }
  }

  // Embedded admin requests carry ?shop=acme.myshopify.com instead.
  const source =
    typeof request.query_string === "string" && request.query_string
      ? request.query_string
      : typeof request.url === "string" && request.url.includes("?")
        ? request.url.slice(request.url.indexOf("?") + 1)
        : undefined;
  if (!source) return undefined;
  try {
    return new URLSearchParams(source).get("shop") ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * The `beforeSend` body for both clients: drops request bodies, redacts
 * credentials, and tags the event with the shop when nothing upstream already
 * did. Mutates and returns the event, which is what Sentry expects.
 */
export function scrubEvent(event) {
  const request = event.request;

  if (request) {
    // Request bodies are the big one: a webhook body is the entire order,
    // buyer included. Nothing we debug needs it.
    delete request.data;
    delete request.cookies;

    if (request.headers) {
      for (const key of Object.keys(request.headers)) {
        if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
          request.headers[key] = REDACTED;
        }
      }
    }

    if (typeof request.query_string === "string") {
      request.query_string = scrubQueryString(request.query_string);
    }
    request.url = scrubUrl(request.url);
  }

  // Tag last, and only as a fallback — the webhook handlers and the admin
  // loader set a shop they have actually authenticated.
  const tags = event.tags ?? (event.tags = {});
  if (!tags.shop) {
    const shop = shopFromRequest(request);
    if (shop) tags.shop = shop;
  }

  if (Array.isArray(event.breadcrumbs)) {
    for (const crumb of event.breadcrumbs) {
      if (crumb?.data?.url) crumb.data.url = scrubUrl(crumb.data.url);
    }
  }

  return event;
}
