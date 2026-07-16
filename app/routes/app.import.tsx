import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * Import / Sync
 *
 * Two ways to give the ledger a correct starting point:
 *
 * 1) "Sync from Shopify" — reads every variant's current inventoryQuantity
 *    via the Admin GraphQL API and writes a corrective movement per variant
 *    so the ledger's on-hand exactly matches Shopify right now.
 *
 * 2) "Import Stocky / CSV quantities" — paste rows of `SKU,quantity`
 *    (Stocky's stock-level export maps directly to this). Each matching SKU
 *    gets a corrective movement so its on-hand equals the imported quantity.
 *    Run the Shopify sync first so every SKU exists in the ledger.
 */

type LedgerRow = {
  variantId: string;
  sku: string | null;
  productTitle: string;
  onHand: number;
};

async function getLedger(shop: string): Promise<Map<string, LedgerRow>> {
  const movements = await prisma.stockMovement.findMany({
    where: { shop },
    select: {
      variantId: true,
      sku: true,
      productTitle: true,
      quantityDelta: true,
    },
  });
  const map = new Map<string, LedgerRow>();
  for (const m of movements) {
    const existing = map.get(m.variantId);
    if (existing) {
      existing.onHand += m.quantityDelta;
      if (!existing.sku && m.sku) existing.sku = m.sku;
    } else {
      map.set(m.variantId, {
        variantId: m.variantId,
        sku: m.sku,
        productTitle: m.productTitle,
        onHand: m.quantityDelta,
      });
    }
  }
  return map;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const ledger = await getLedger(session.shop);
  return { trackedVariants: ledger.size };
};

type VariantNode = {
  id: string;
  sku: string | null;
  inventoryQuantity: number | null;
  product: { title: string };
};

async function fetchAllVariants(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
): Promise<VariantNode[]> {
  const out: VariantNode[] = [];
  let cursor: string | null = null;
  // Hard page cap keeps a pathological catalogue from running forever.
  for (let page = 0; page < 40; page++) {
    const response = await admin.graphql(
      `#graphql
        query Variants($cursor: String) {
          productVariants(first: 250, after: $cursor) {
            edges {
              cursor
              node {
                id
                sku
                inventoryQuantity
                product { title }
              }
            }
            pageInfo { hasNextPage }
          }
        }`,
      { variables: { cursor } },
    );
    const body = (await response.json()) as any;
    const conn = body?.data?.productVariants;
    if (!conn) break;
    for (const edge of conn.edges) {
      out.push(edge.node);
      cursor = edge.cursor;
    }
    if (!conn.pageInfo?.hasNextPage) break;
  }
  return out;
}

async function actionSyncShopify(
  shop: string,
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
) {
  const [variants, ledger] = await Promise.all([
    fetchAllVariants(admin),
    getLedger(shop),
  ]);

  const corrections = [];
  for (const v of variants) {
    if (v.inventoryQuantity == null) continue; // untracked variant
    const current = ledger.get(v.id)?.onHand ?? 0;
    const delta = v.inventoryQuantity - current;
    if (delta === 0) continue;
    corrections.push({
      shop,
      productId: null,
      variantId: v.id,
      sku: v.sku || null,
      productTitle: v.product.title,
      quantityDelta: delta,
      reason: "shopify_sync",
      orderId: null,
    });
  }

  if (corrections.length > 0) {
    await prisma.stockMovement.createMany({ data: corrections });
  }

  return {
    success: true,
    error: null,
    summary: `Synced ${variants.length} variant(s) from Shopify — ${corrections.length} correction(s) written. Ledger on-hand now matches Shopify.`,
    unmatched: [] as string[],
  };
}

async function actionImportCsv(shop: string, fd: FormData) {
  const raw = String(fd.get("csv") ?? "").trim();
  if (!raw) {
    return {
      success: false,
      error: "Paste at least one line of SKU,quantity.",
      summary: null,
      unmatched: [] as string[],
    };
  }

  const ledger = await getLedger(shop);
  const bySku = new Map<string, LedgerRow>();
  for (const row of ledger.values()) {
    if (row.sku) bySku.set(row.sku.trim().toLowerCase(), row);
  }

  const corrections = [];
  const unmatched: string[] = [];
  let parsed = 0;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(",").map((p) => p.trim().replace(/^"|"$/g, ""));
    if (parts.length < 2) continue;
    // Accept `SKU,qty` or Stocky-style exports where qty is the last column.
    const sku = parts[0];
    const qty = parseInt(parts[parts.length - 1], 10);
    if (!sku || isNaN(qty)) continue;
    if (sku.toLowerCase() === "sku") continue; // header row
    parsed++;

    const row = bySku.get(sku.toLowerCase());
    if (!row) {
      unmatched.push(sku);
      continue;
    }
    const delta = qty - row.onHand;
    if (delta === 0) continue;
    corrections.push({
      shop,
      productId: null,
      variantId: row.variantId,
      sku: row.sku,
      productTitle: row.productTitle,
      quantityDelta: delta,
      reason: "stocky_import",
      orderId: null,
    });
  }

  if (parsed === 0) {
    return {
      success: false,
      error:
        "No valid rows found. Expected one `SKU,quantity` pair per line (a header row is skipped automatically).",
      summary: null,
      unmatched,
    };
  }

  if (corrections.length > 0) {
    await prisma.stockMovement.createMany({ data: corrections });
  }

  return {
    success: true,
    error: null,
    summary: `Imported ${parsed} row(s) — ${corrections.length} quantity correction(s) applied${
      unmatched.length > 0 ? `, ${unmatched.length} SKU(s) not found` : ""
    }.`,
    unmatched: unmatched.slice(0, 25),
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");

  if (intent === "sync-shopify") {
    return actionSyncShopify(session.shop, admin);
  }
  if (intent === "import-csv") {
    return actionImportCsv(session.shop, fd);
  }
  return {
    success: false,
    error: "Unknown action.",
    summary: null,
    unmatched: [] as string[],
  };
};

export default function ImportSync() {
  const { trackedVariants } = useLoaderData<typeof loader>();
  const syncFetcher = useFetcher<typeof action>();
  const csvFetcher = useFetcher<typeof action>();
  const syncing = syncFetcher.state !== "idle";
  const importing = csvFetcher.state !== "idle";

  return (
    <s-page heading="Import / Sync">
      <s-section heading="Step 1 — Sync current stock from Shopify">
        <s-paragraph>
          Reads every variant&apos;s current on-hand quantity from Shopify and
          sets the ledger to match. Run this once when you install, and again
          any time you want to re-baseline. Currently tracking{" "}
          {trackedVariants} variant(s).
        </s-paragraph>
        {syncFetcher.data?.error && (
          <s-banner tone="critical" heading="Sync failed">
            <s-paragraph>{syncFetcher.data.error}</s-paragraph>
          </s-banner>
        )}
        {syncFetcher.data?.success && (
          <s-banner tone="success" heading="Sync complete">
            <s-paragraph>{syncFetcher.data.summary}</s-paragraph>
          </s-banner>
        )}
        <syncFetcher.Form method="post">
          <input type="hidden" name="intent" value="sync-shopify" />
          <s-button
            type="submit"
            variant="primary"
            {...{ loading: syncing ? true : undefined }}
          >
            Sync stock from Shopify
          </s-button>
        </syncFetcher.Form>
      </s-section>

      <s-section heading="Step 2 — Import Stocky quantities (before 31 August)">
        <s-paragraph>
          Shopify permanently deletes all Stocky data on 31 August 2026.
          Export your stock levels from Stocky as CSV, then paste rows of{" "}
          <code>SKU,quantity</code> below (extra columns are ignored; the last
          column is read as the quantity). Matching SKUs are corrected to the
          imported quantity with full audit history. Run Step 1 first so your
          SKUs exist in the ledger.
        </s-paragraph>
        {csvFetcher.data?.error && (
          <s-banner tone="critical" heading="Import error">
            <s-paragraph>{csvFetcher.data.error}</s-paragraph>
          </s-banner>
        )}
        {csvFetcher.data?.success && (
          <s-banner tone="success" heading="Import complete">
            <s-paragraph>{csvFetcher.data.summary}</s-paragraph>
            {csvFetcher.data.unmatched.length > 0 && (
              <s-paragraph>
                Not found: {csvFetcher.data.unmatched.join(", ")}
              </s-paragraph>
            )}
          </s-banner>
        )}
        <csvFetcher.Form method="post">
          <input type="hidden" name="intent" value="import-csv" />
          <s-stack direction="block" gap="base">
            <textarea
              name="csv"
              rows={10}
              placeholder={"SKU,quantity\nTSHIRT-BLK-M,42\nMUG-01,17"}
              style={{ width: "100%", fontFamily: "monospace" }}
            />
            <s-button
              type="submit"
              variant="primary"
              {...{ loading: importing ? true : undefined }}
            >
              Import quantities
            </s-button>
          </s-stack>
        </csvFetcher.Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
