import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { buildLedger, findUnsyncedVariantIds } from "../stock.server";

type MovementRow = {
  id: string;
  productTitle: string;
  sku: string;
  quantityDelta: number;
  reason: string;
  createdAt: string;
};

type LowStockRow = {
  variantId: string;
  productTitle: string;
  sku: string;
  onHand: number;
  reorderPoint: number;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [ledger, settings, recentRaw, movements7d, unsynced] = await Promise.all([
    buildLedger(shop),
    prisma.variantSettings.findMany({
      where: { shop },
      select: { variantId: true, reorderPoint: true },
    }),
    prisma.stockMovement.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        productTitle: true,
        sku: true,
        quantityDelta: true,
        reason: true,
        createdAt: true,
      },
    }),
    prisma.stockMovement.count({ where: { shop, createdAt: { gte: sevenDaysAgo } } }),
    findUnsyncedVariantIds(shop),
  ]);

  const recent: MovementRow[] = recentRaw.map((m: (typeof recentRaw)[number]) => ({
    id: m.id,
    productTitle: m.productTitle,
    sku: m.sku ?? "",
    quantityDelta: m.quantityDelta,
    reason: m.reason,
    createdAt: m.createdAt.toISOString(),
  }));

  const lowStock: LowStockRow[] = [];
  for (const s of settings as { variantId: string; reorderPoint: number | null }[]) {
    if (s.reorderPoint == null) continue;
    const row = ledger.get(s.variantId);
    if (!row || row.onHand > s.reorderPoint) continue;
    lowStock.push({
      variantId: row.variantId,
      productTitle: row.productTitle,
      sku: row.sku,
      onHand: row.onHand,
      reorderPoint: s.reorderPoint,
    });
  }
  lowStock.sort((a, b) => a.onHand - b.onHand);

  return {
    skusTracked: ledger.size,
    movements7d,
    lowStockCount: lowStock.length,
    lowStock: lowStock.slice(0, 5),
    recent,
    unsyncedCount: unsynced.length,
  };
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function reasonTone(reason: string) {
  if (reason === "order") return "info";
  if (reason === "order_cancelled" || reason === "refund_restock") return "warning";
  return "neutral";
}

export default function Index() {
  const {
    skusTracked,
    movements7d,
    lowStockCount,
    lowStock,
    recent,
    unsyncedCount,
  } = useLoaderData<typeof loader>();

  if (skusTracked === 0) {
    return (
      <s-page heading="StockLog">
        <s-section heading="Start your stock ledger">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Nothing is being tracked yet. Pull your current quantities in from
              Shopify, or paste your Stocky export, and every order, refund and
              adjustment from then on lands here with a full audit trail.
            </s-paragraph>
            <s-stack direction="inline" gap="base">
              <s-link href="/app/import">
                <s-button variant="primary">Import / Sync stock</s-button>
              </s-link>
              <s-link href="/app/inventory">
                <s-button>Record an adjustment</s-button>
              </s-link>
            </s-stack>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="StockLog">
      {unsyncedCount > 0 && (
        <s-banner tone="warning" heading="Sync current stock">
          <s-paragraph>
            {unsyncedCount} variant(s) have never been reconciled with Shopify,
            so their on-hand counts only the movements StockLog has seen. Run a
            sync to set them to Shopify&apos;s current quantities.
          </s-paragraph>
          <s-link href="/app/import">
            <s-button variant="primary">Sync current stock</s-button>
          </s-link>
        </s-banner>
      )}

      <s-section>
        <s-stack direction="inline" gap="base">
          <s-box padding="base" background="base">
            <s-paragraph color="subdued">SKUs tracked</s-paragraph>
            <s-heading>{skusTracked}</s-heading>
          </s-box>
          <s-box padding="base" background="base">
            <s-paragraph color="subdued">Movements (7 days)</s-paragraph>
            <s-heading>{movements7d}</s-heading>
          </s-box>
          <s-box padding="base" background="base">
            <s-paragraph color="subdued">Low stock items</s-paragraph>
            <s-heading>{lowStockCount}</s-heading>
          </s-box>
        </s-stack>
      </s-section>

      {lowStock.length > 0 && (
        <s-section heading="Low stock">
          <s-table>
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>SKU</s-table-header>
              <s-table-header format="numeric">On hand</s-table-header>
              <s-table-header format="numeric">Reorder point</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {lowStock.map((row) => (
                <s-table-row key={row.variantId}>
                  <s-table-cell>{row.productTitle}</s-table-cell>
                  <s-table-cell>
                    {row.sku ? (
                      <s-text>{row.sku}</s-text>
                    ) : (
                      <s-paragraph color="subdued">—</s-paragraph>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={row.onHand > 0 ? "warning" : "critical"}>
                      {row.onHand}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{row.reorderPoint}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
          {lowStockCount > lowStock.length && (
            <s-paragraph color="subdued">
              Showing the {lowStock.length} lowest of {lowStockCount}.
            </s-paragraph>
          )}
        </s-section>
      )}

      <s-section heading="Recent movements">
        <s-table>
          <s-table-header-row>
            <s-table-header>When</s-table-header>
            <s-table-header>Product</s-table-header>
            <s-table-header>SKU</s-table-header>
            <s-table-header format="numeric">Change</s-table-header>
            <s-table-header>Reason</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {recent.map((m) => (
              <s-table-row key={m.id}>
                <s-table-cell>
                  <s-paragraph color="subdued">{fmtDate(m.createdAt)}</s-paragraph>
                </s-table-cell>
                <s-table-cell>{m.productTitle}</s-table-cell>
                <s-table-cell>
                  {m.sku ? (
                    <s-text>{m.sku}</s-text>
                  ) : (
                    <s-paragraph color="subdued">—</s-paragraph>
                  )}
                </s-table-cell>
                <s-table-cell>
                  <s-badge tone={m.quantityDelta >= 0 ? "success" : "warning"}>
                    {m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                  </s-badge>
                </s-table-cell>
                <s-table-cell>
                  <s-badge tone={reasonTone(m.reason)}>
                    {m.reason.replace(/_/g, " ")}
                  </s-badge>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        <s-link href="/app/inventory">
          <s-button>View full inventory</s-button>
        </s-link>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
