import type { authenticate } from "./shopify.server";

type Admin = Awaited<ReturnType<typeof authenticate.admin>>["admin"];

/**
 * Display data that lives in Shopify rather than in our ledger: variant titles
 * and order names. Both are read through read_products / read_orders, which
 * the app already holds, and both are cached per shop so paging through the
 * history doesn't re-query Shopify for rows we just looked up.
 */

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 5000;

type CacheEntry<T> = { value: T; expires: number };

class TtlCache<T> {
  private map = new Map<string, CacheEntry<T>>();

  get(key: string): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T) {
    // Cheapest possible eviction: once the cache is full, drop the oldest
    // insertions (Map preserves insertion order) rather than tracking usage.
    if (this.map.size >= MAX_ENTRIES) {
      for (const k of this.map.keys()) {
        this.map.delete(k);
        if (this.map.size < MAX_ENTRIES * 0.9) break;
      }
    }
    this.map.set(key, { value, expires: Date.now() + TTL_MS });
  }
}

export type VariantInfo = {
  productTitle: string;
  /** null for single-variant products, whose variant is "Default Title". */
  variantTitle: string | null;
};

const variantCache = new TtlCache<VariantInfo>();
const timezoneCache = new TtlCache<string>();
const orderNameCache = new TtlCache<string>();

type VariantNode = {
  id: string;
  title: string | null;
  product: { title: string } | null;
};

type NodesResponse<T> = { data?: { nodes?: (T | null)[] | null } | null; errors?: unknown[] };

/**
 * Resolves variant titles for the given variant GIDs. Anything Shopify can't
 * return (a deleted variant, a failed call) is simply left out, so callers
 * fall back to the product title recorded on the movement.
 */
export async function fetchVariantInfo(
  shop: string,
  admin: Admin | undefined,
  variantIds: string[],
): Promise<Map<string, VariantInfo>> {
  const out = new Map<string, VariantInfo>();
  const missing: string[] = [];

  for (const id of new Set(variantIds)) {
    const cached = variantCache.get(`${shop}:${id}`);
    if (cached) out.set(id, cached);
    else missing.push(id);
  }

  if (!admin || missing.length === 0) return out;

  try {
    for (let i = 0; i < missing.length; i += 100) {
      const ids = missing.slice(i, i + 100);
      const response = await admin.graphql(
        `#graphql
          query VariantTitles($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on ProductVariant {
                id
                title
                product { title }
              }
            }
          }`,
        { variables: { ids } },
      );
      const body = (await response.json()) as NodesResponse<VariantNode>;
      if (body?.errors?.length) {
        console.error(
          "[StockLog] variant title lookup returned GraphQL errors:",
          JSON.stringify(body.errors),
        );
        continue;
      }
      for (const node of body?.data?.nodes ?? []) {
        if (!node?.id) continue;
        const info: VariantInfo = {
          productTitle: node.product?.title ?? "",
          variantTitle:
            node.title && node.title !== "Default Title" ? node.title : null,
        };
        variantCache.set(`${shop}:${node.id}`, info);
        out.set(node.id, info);
      }
    }
  } catch (err) {
    console.error(`[StockLog] Could not read variant titles for ${shop}:`, err);
  }

  return out;
}

type OrderNode = { id: string; name: string | null };

/** Resolves order GIDs to their merchant-facing names, e.g. "#1042". */
export async function fetchOrderNames(
  shop: string,
  admin: Admin | undefined,
  orderIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const missing: string[] = [];

  for (const id of new Set(orderIds)) {
    const cached = orderNameCache.get(`${shop}:${id}`);
    if (cached) out.set(id, cached);
    else missing.push(id);
  }

  if (!admin || missing.length === 0) return out;

  try {
    for (let i = 0; i < missing.length; i += 100) {
      const ids = missing.slice(i, i + 100);
      const response = await admin.graphql(
        `#graphql
          query OrderNames($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Order {
                id
                name
              }
            }
          }`,
        { variables: { ids } },
      );
      const body = (await response.json()) as NodesResponse<OrderNode>;
      if (body?.errors?.length) {
        console.error(
          "[StockLog] order name lookup returned GraphQL errors:",
          JSON.stringify(body.errors),
        );
        continue;
      }
      for (const node of body?.data?.nodes ?? []) {
        if (!node?.id || !node.name) continue;
        orderNameCache.set(`${shop}:${node.id}`, node.name);
        out.set(node.id, node.name);
      }
    }
  } catch (err) {
    console.error(`[StockLog] Could not read order names for ${shop}:`, err);
  }

  return out;
}

/**
 * The shop's own timezone, so a movement recorded at 8:38 pm in the merchant's
 * evening reads as 8:38 pm. Falls back to UTC if Shopify can't be reached.
 */
export async function getShopTimezone(
  shop: string,
  admin: Admin | undefined,
): Promise<string> {
  const cached = timezoneCache.get(shop);
  if (cached) return cached;
  if (!admin) return "UTC";

  try {
    const response = await admin.graphql(
      `#graphql
        query ShopTimezone {
          shop { ianaTimezone }
        }`,
    );
    const body = (await response.json()) as {
      data?: { shop?: { ianaTimezone?: string | null } | null } | null;
    };
    const tz = body?.data?.shop?.ianaTimezone;
    if (tz) {
      timezoneCache.set(shop, tz);
      return tz;
    }
  } catch (err) {
    console.error(`[StockLog] Could not read the timezone for ${shop}:`, err);
  }

  return "UTC";
}

/** "18 Jul 2026, 8:38 pm" in the shop's own timezone. */
export function formatMovementDate(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  } catch {
    // An unrecognised timezone would otherwise throw and take the page down.
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  }
}

/** "Product name, Variant title", so duplicate product names stay distinct. */
export function displayTitle(
  recordedTitle: string,
  info: VariantInfo | undefined,
): string {
  const product = info?.productTitle || recordedTitle;
  return info?.variantTitle ? `${product}, ${info.variantTitle}` : product;
}

export type ReasonTag = {
  label: string;
  tone: "info" | "warning" | "neutral" | "success";
  /** Set for order movements, so the tag can link into the Shopify admin. */
  href?: string;
};

/** Turns a stored reason (plus its order) into the tag merchants read. */
export function reasonTag(reason: string, orderId: string | null, orderName?: string): ReasonTag {
  switch (reason) {
    case "order": {
      const numericId = orderId?.split("/").pop();
      return {
        label: orderName ? `Order ${orderName}` : "Order",
        tone: "info",
        href: numericId ? `shopify://admin/orders/${numericId}` : undefined,
      };
    }
    case "refund_restock":
      return { label: "Refund", tone: "warning" };
    case "order_cancelled":
      return { label: "Cancelled order", tone: "warning" };
    case "manual":
      return { label: "Manual adjustment", tone: "neutral" };
    case "shopify_sync":
      return { label: "Shopify sync", tone: "neutral" };
    case "stocky_import":
      return { label: "Stocky import", tone: "neutral" };
    case "opening_balance":
      return { label: "Opening balance", tone: "neutral" };
    default: {
      // "restock" and anything added later read as sentence case rather than
      // leaking the raw snake_case reason into the table.
      const words = reason.replace(/_/g, " ");
      return {
        label: words.charAt(0).toUpperCase() + words.slice(1),
        tone: "neutral",
      };
    }
  }
}
