/**
 * Movement history helpers the browser needs as well as the server. The
 * paged database query itself is in history.server.ts.
 */

export const HISTORY_PAGE_SIZE = 25;

/**
 * The variant filter travels in the URL as the numeric part of the GID, so the
 * query string stays readable. Anything that isn't a plain number is ignored.
 */
export function variantIdFromParam(raw: string | null): string | null {
  return raw && /^\d+$/.test(raw) ? `gid://shopify/ProductVariant/${raw}` : null;
}

export function variantParam(variantId: string): string {
  return variantId.split("/").pop() ?? "";
}
