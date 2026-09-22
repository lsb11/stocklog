import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { buildLedger, findUnsyncedVariantIds } from "../stock.server";
import {
  displayTitle,
  fetchOrderNames,
  fetchVariantInfo,
  formatMovementDate,
  getShopTimezone,
  reasonTag,
  type ReasonTag,
} from "../catalog.server";

type MovementRow = {
  id: string;
  title: string;
  sku: string;
  quantityDelta: number;
  reason: ReasonTag;
  when: string;
};

type LowStockRow = {
  variantId: string;
  title: string;
  sku: string;
  onHand: number;
  reorderPoint: number;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
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
        variantId: true,
        productTitle: true,
        sku: true,
        quantityDelta: true,
        reason: true,
        orderId: true,
        createdAt: true,
      },
    }),
    prisma.stockMovement.count({ where: { shop, createdAt: { gte: sevenDaysAgo } } }),
    findUnsyncedVariantIds(shop),
  ]);

  const lowStockRaw: {
    variantId: string;
    productTitle: string;
    sku: string;
    onHand: number;
    reorderPoint: number;
  }[] = [];
  for (const s of settings as { variantId: string; reorderPoint: number | null }[]) {
    if (s.reorderPoint == null) continue;
    const row = ledger.get(s.variantId);
    if (!row || row.onHand > s.reorderPoint) continue;
    lowStockRaw.push({
      variantId: row.variantId,
      productTitle: row.productTitle,
      sku: row.sku,
      onHand: row.onHand,
      reorderPoint: s.reorderPoint,
    });
  }
  lowStockRaw.sort((a, b) => a.onHand - b.onHand);
  const lowStockTop = lowStockRaw.slice(0, 5);

  // Titles and order names come from Shopify, so ask only for the rows this
  // page actually renders.
  const [variantInfo, orderNames, timeZone] = await Promise.all([
    fetchVariantInfo(shop, admin, [
      ...recentRaw.map((m: (typeof recentRaw)[number]) => m.variantId),
      ...lowStockTop.map((r) => r.variantId),
    ]),
    fetchOrderNames(
      shop,
      admin,
      recentRaw
        .filter((m: (typeof recentRaw)[number]) => m.reason === "order" && m.orderId)
        .map((m: (typeof recentRaw)[number]) => m.orderId as string),
    ),
    getShopTimezone(shop, admin),
  ]);

  const recent: MovementRow[] = recentRaw.map((m: (typeof recentRaw)[number]) => ({
    id: m.id,
    title: displayTitle(m.productTitle, variantInfo.get(m.variantId)),
    sku: m.sku ?? "",
    quantityDelta: m.quantityDelta,
    reason: reasonTag(
      m.reason,
      m.orderId,
      m.orderId ? orderNames.get(m.orderId) : undefined,
    ),
    when: formatMovementDate(m.createdAt.toISOString(), timeZone),
  }));

  const lowStock: LowStockRow[] = lowStockTop.map((r) => ({
    variantId: r.variantId,
    title: displayTitle(r.productTitle, variantInfo.get(r.variantId)),
    sku: r.sku,
    onHand: r.onHand,
    reorderPoint: r.reorderPoint,
  }));

  return {
    skusTracked: ledger.size,
    movements7d,
    lowStockCount: lowStockRaw.length,
    lowStock,
    recent,
    unsyncedCount: unsynced.length,
  };
};

function SkuCell({ sku }: { sku: string }) {
  return sku ? (
    <s-text>{sku}</s-text>
  ) : (
    <s-paragraph color="subdued">No SKU</s-paragraph>
  );
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
              No stock history yet. Sync your current stock to start your
              ledger, or import a Stocky export.
            </s-paragraph>
            <s-link href="/app/import">
              <s-button variant="primary">Go to Import / Sync</s-button>
            </s-link>
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
            {unsyncedCount === 1
              ? "1 variant has"
              : `${unsyncedCount} variants have`}{" "}
            never been matched against Shopify, so the on-hand figure counts
            only the movements StockLog has seen. Run a sync to set{" "}
            {unsyncedCount === 1 ? "it" : "them"} to Shopify&apos;s current
            quantities.
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
                  <s-table-cell>{row.title}</s-table-cell>
                  <s-table-cell>
                    <SkuCell sku={row.sku} />
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
                  <s-paragraph color="subdued">{m.when}</s-paragraph>
                </s-table-cell>
                <s-table-cell>{m.title}</s-table-cell>
                <s-table-cell>
                  <SkuCell sku={m.sku} />
                </s-table-cell>
                <s-table-cell>
                  <s-badge tone={m.quantityDelta >= 0 ? "success" : "warning"}>
                    {m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                  </s-badge>
                </s-table-cell>
                <s-table-cell>
                  {m.reason.href ? (
                    <s-link href={m.reason.href}>
                      <s-badge tone={m.reason.tone}>{m.reason.label}</s-badge>
                    </s-link>
                  ) : (
                    <s-badge tone={m.reason.tone}>{m.reason.label}</s-badge>
                  )}
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
