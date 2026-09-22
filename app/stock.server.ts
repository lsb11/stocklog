import prisma from "./db.server";
import type { authenticate } from "./shopify.server";

type Admin = Awaited<ReturnType<typeof authenticate.admin>>["admin"];

/**
 * Reasons that establish a variant's starting point against Shopify's own
 * numbers. A variant whose ledger contains none of these has never been
 * reconciled, so its on-hand is only a running total of movements we happened
 * to observe — that's what drives the "Sync current stock" banner.
 */
export const BASELINE_REASONS = [
  "opening_balance",
  "shopify_sync",
  "stocky_import",
] as const;

export type LedgerRow = {
  variantId: string;
  sku: string;
  productTitle: string;
  onHand: number;
};

/** Collapses every movement for a shop into one on-hand figure per variant. */
export async function buildLedger(shop: string): Promise<Map<string, LedgerRow>> {
  const movements = await prisma.stockMovement.findMany({
    where: { shop },
    select: { variantId: true, sku: true, productTitle: true, quantityDelta: true },
  });

  const ledger = new Map<string, LedgerRow>();
  for (const m of movements) {
    const existing = ledger.get(m.variantId);
    if (existing) {
      existing.onHand += m.quantityDelta;
      if (!existing.sku && m.sku) existing.sku = m.sku;
    } else {
      ledger.set(m.variantId, {
        variantId: m.variantId,
        sku: m.sku ?? "",
        productTitle: m.productTitle,
        onHand: m.quantityDelta,
      });
    }
  }
  return ledger;
}

/** Variants that have movements but have never been reconciled with Shopify. */
export async function findUnsyncedVariantIds(shop: string): Promise<string[]> {
  const [all, baselined] = await Promise.all([
    prisma.stockMovement.findMany({
      where: { shop },
      select: { variantId: true },
      distinct: ["variantId"],
    }),
    prisma.stockMovement.findMany({
      where: { shop, reason: { in: [...BASELINE_REASONS] } },
      select: { variantId: true },
      distinct: ["variantId"],
    }),
  ]);

  const done = new Set(baselined.map((r: { variantId: string }) => r.variantId));
  return all
    .map((r: { variantId: string }) => r.variantId)
    .filter((id: string) => !done.has(id));
}

export type BaselineEntry = {
  variantId: string;
  sku: string | null;
  productTitle: string;
  /**
   * Units that Shopify has *already* applied to its own inventory for the
   * movement we are about to record. An order line is -qty (Shopify decrements
   * the moment the order is placed, so by the time its webhook reaches us the
   * quantity we read back is already post-order). An app-side adjustment is 0,
   * because StockLog never writes back to Shopify.
   */
  appliedDelta: number;
};

type VariantNode = {
  id: string;
  sku: string | null;
  inventoryQuantity: number | null;
  product: { title: string } | null;
};

type NodesResponse = {
  data?: { nodes?: (VariantNode | null)[] | null } | null;
  errors?: unknown[];
};

async function fetchVariantQuantities(
  admin: Admin,
  variantIds: string[],
): Promise<Map<string, VariantNode>> {
  const out = new Map<string, VariantNode>();

  // `nodes` caps at 250 ids; 100 keeps the query comfortably inside the
  // calculated query cost limit too.
  for (let i = 0; i < variantIds.length; i += 100) {
    const ids = variantIds.slice(i, i + 100);
    const response = await admin.graphql(
      `#graphql
        query VariantBaselines($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id
              sku
              inventoryQuantity
              product { title }
            }
          }
        }`,
      { variables: { ids } },
    );
    const body = (await response.json()) as NodesResponse;
    if (body?.errors?.length) {
      console.error(
        "[StockLog] baseline lookup returned GraphQL errors:",
        JSON.stringify(body.errors),
      );
      continue;
    }
    for (const node of body?.data?.nodes ?? []) {
      if (node?.id) out.set(node.id, node);
    }
  }

  return out;
}

/**
 * Gives every previously-unseen variant an opening balance taken from
 * Shopify's current available quantity, so its first real movement doesn't
 * start from an imaginary zero and drive the ledger negative.
 *
 * The opening balance is `Shopify's quantity now - appliedDelta`, which leaves
 * the ledger agreeing with Shopify once the caller's own movement lands.
 *
 * Best-effort by design: if Shopify can't be reached, or the variant is
 * untracked, the caller's movement is still recorded. Never throws.
 */
export async function ensureOpeningBalances(
  shop: string,
  admin: Admin | undefined,
  entries: BaselineEntry[],
): Promise<void> {
  if (!admin || entries.length === 0) return;

  try {
    // One order can carry several lines for the same variant.
    const wanted = new Map<string, BaselineEntry>();
    for (const e of entries) {
      const existing = wanted.get(e.variantId);
      if (existing) {
        existing.appliedDelta += e.appliedDelta;
      } else {
        wanted.set(e.variantId, { ...e });
      }
    }

    const known = await prisma.stockMovement.findMany({
      where: { shop, variantId: { in: [...wanted.keys()] } },
      select: { variantId: true },
      distinct: ["variantId"],
    });
    for (const row of known as { variantId: string }[]) wanted.delete(row.variantId);
    if (wanted.size === 0) return;

    const quantities = await fetchVariantQuantities(admin, [...wanted.keys()]);

    const rows = [];
    for (const entry of wanted.values()) {
      const node = quantities.get(entry.variantId);
      // A variant with inventory tracking off reports null — there is no
      // "current quantity" to open from, so leave it starting at zero.
      if (!node || node.inventoryQuantity == null) continue;
      rows.push({
        shop,
        productId: null,
        variantId: entry.variantId,
        sku: entry.sku || node.sku || null,
        productTitle: node.product?.title || entry.productTitle,
        quantityDelta: node.inventoryQuantity - entry.appliedDelta,
        reason: "opening_balance",
        orderId: null,
      });
    }

    if (rows.length === 0) return;

    // Concurrent webhooks can race to open the same variant. The partial unique
    // index on (shop, variantId) WHERE reason = 'opening_balance' turns the
    // loser into a no-op rather than a duplicate opening balance.
    await prisma.stockMovement.createMany({ data: rows, skipDuplicates: true });
    console.log(`[StockLog] Wrote ${rows.length} opening balance(s) for ${shop}`);
  } catch (err) {
    console.error(`[StockLog] Could not set opening balances for ${shop}:`, err);
  }
}

/** Parses a quantity field that accepts `5`, `+5` and `-3`. */
export function parseQuantityDelta(raw: string): number | null {
  const trimmed = raw.replace(/\s/g, "");
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  const value = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(value) ? value : null;
}
