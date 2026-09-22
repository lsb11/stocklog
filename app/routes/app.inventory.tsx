import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  isRouteErrorResponse,
  useFetcher,
  useLoaderData,
  useRouteError,
} from "react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

type MovementRow = {
  id: string;
  productTitle: string;
  sku: string;
  quantityDelta: number;
  reason: string;
  orderId: string | null;
  createdAt: string;
};

type StockRow = {
  variantId: string;
  sku: string;
  productTitle: string;
  onHand: number;
  reorderPoint: number | null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [movements, settings, recentRaw] = await Promise.all([
    prisma.stockMovement.findMany({
      where: { shop },
      select: { variantId: true, sku: true, productTitle: true, quantityDelta: true },
    }),
    prisma.variantSettings.findMany({
      where: { shop },
      select: { variantId: true, reorderPoint: true },
    }),
    prisma.stockMovement.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        productTitle: true,
        sku: true,
        quantityDelta: true,
        reason: true,
        orderId: true,
        createdAt: true,
      },
    }),
  ]);

  const recent: MovementRow[] = recentRaw.map((m: (typeof recentRaw)[number]) => ({
    id: m.id,
    productTitle: m.productTitle,
    sku: m.sku ?? "",
    quantityDelta: m.quantityDelta,
    reason: m.reason,
    orderId: m.orderId,
    createdAt: m.createdAt.toISOString(),
  }));

  const grouped = new Map<string, StockRow>();
  for (const m of movements) {
    const existing = grouped.get(m.variantId);
    if (existing) {
      existing.onHand += m.quantityDelta;
    } else {
      grouped.set(m.variantId, {
        variantId: m.variantId,
        sku: m.sku ?? "",
        productTitle: m.productTitle,
        onHand: m.quantityDelta,
        reorderPoint: null,
      });
    }
  }

  const settingsMap = new Map<string, number | null>(
    settings.map((s: { variantId: string; reorderPoint: number | null }) => [
      s.variantId,
      s.reorderPoint ?? null,
    ]),
  );
  for (const row of grouped.values()) {
    row.reorderPoint = settingsMap.get(row.variantId) ?? null;
  }

  const stock = Array.from(grouped.values()).sort((a, b) =>
    a.productTitle.localeCompare(b.productTitle),
  );

  return { stock, recent };
};

async function actionAdjustStock(shop: string, fd: FormData) {
  const productTitle = String(fd.get("productTitle") ?? "").trim();
  const variantId = String(fd.get("variantId") ?? "").trim();
  const sku = String(fd.get("sku") ?? "").trim();
  const delta = parseInt(String(fd.get("quantityDelta") ?? "0"), 10);
  const reason = String(fd.get("reason") ?? "manual");

  if (!productTitle || !variantId || isNaN(delta) || delta === 0) {
    return {
      error: "Product title, variant ID, and a non-zero quantity delta are required.",
      success: false,
    };
  }

  await prisma.stockMovement.create({
    data: {
      shop,
      productId: null,
      variantId,
      sku: sku || null,
      productTitle,
      quantityDelta: delta,
      reason,
      orderId: null,
    },
  });

  return { success: true, error: null };
}

async function actionSetReorderPoint(shop: string, fd: FormData) {
  const variantId = String(fd.get("variantId") ?? "").trim();
  const rpRaw = fd.get("reorderPoint");
  const reorderPoint =
    rpRaw === "" || rpRaw === null ? null : parseInt(String(rpRaw), 10);

  if (!variantId) {
    return { error: "Variant ID is required.", success: false };
  }
  if (reorderPoint !== null && isNaN(reorderPoint)) {
    return { error: "Reorder point must be a valid number.", success: false };
  }

  await prisma.variantSettings.upsert({
    where: { shop_variantId: { shop, variantId } },
    update: { reorderPoint },
    create: { shop, variantId, reorderPoint },
  });

  return { success: true, error: null };
}

const UNEXPECTED_ERROR =
  "Something went wrong saving that change, so nothing was recorded. Try again — if it keeps happening the details are in the server logs.";

export const action = async ({ request }: ActionFunctionArgs) => {
  let shop = "unknown shop";

  try {
    const { session } = await authenticate.admin(request);
    shop = session.shop;

    const fd = await request.formData();
    const intent = String(fd.get("intent") ?? "adjust");

    if (intent === "set-reorder-point") {
      return await actionSetReorderPoint(shop, fd);
    }
    return await actionAdjustStock(shop, fd);
  } catch (error) {
    // Shopify throws Responses to drive its auth and billing redirects, and
    // App Bridge retries some of them — those have to keep bubbling.
    if (error instanceof Response) throw error;

    // Everything else (a dropped database connection, a bad session token, a
    // Prisma failure) becomes a banner on the page instead of taking the whole
    // route down with React Router's "Application Error" screen.
    console.error(`[StockLog] Inventory action failed for ${shop}`, error);
    return { error: UNEXPECTED_ERROR, success: false };
  }
};

function ReorderCell({ row }: { row: StockRow }) {
  const fetcher = useFetcher();
  const saving = fetcher.state !== "idle";
  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="set-reorder-point" />
      <input type="hidden" name="variantId" value={row.variantId} />
      <s-stack direction="inline" gap="small">
        <input
          type="number"
          name="reorderPoint"
          defaultValue={row.reorderPoint ?? ""}
          placeholder="—"
          style={{ width: "72px" }}
          min="0"
          step="1"
        />
        <s-button
          type="submit"
          variant="primary"
          {...{ loading: saving ? true : undefined }}
        >
          Save
        </s-button>
      </s-stack>
    </fetcher.Form>
  );
}

type PickedVariant = { variantId: string; sku: string; productTitle: string };

export default function Inventory() {
  const { stock, recent } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const formRef = useRef<HTMLFormElement>(null);
  const [pickedVariant, setPickedVariant] = useState<PickedVariant | null>(null);

  const openPicker = useCallback(async () => {
    const selection = await shopify.resourcePicker({ type: "variant", multiple: false });
    if (selection && selection.length > 0) {
      const v = selection[0];
      // v.product?.title is the canonical source; displayName/title fall back
      // as "Product - Variant" (not in the published picker types).
      const fallback = v as { displayName?: string; title?: string };
      const productTitle =
        v.product?.title ??
        (fallback.displayName ?? fallback.title ?? "").replace(/\s[-–]\s.+$/, "");
      setPickedVariant({ variantId: v.id, sku: v.sku ?? "", productTitle });
    }
  }, []);

  useEffect(() => {
    if (fetcher.data?.success) {
      formRef.current?.reset();
      setPickedVariant(null);
    }
  }, [fetcher.data]);

  const submitting = fetcher.state !== "idle";

  return (
    <s-page heading="Inventory">
      <s-section heading="Stock on hand">
        {stock.length === 0 ? (
          <s-paragraph color="subdued">
            No stock movements recorded yet. Use the form below to record an adjustment.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>SKU</s-table-header>
              <s-table-header>Variant ID</s-table-header>
              <s-table-header format="numeric">On hand</s-table-header>
              <s-table-header>Reorder point</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {stock.map((row) => {
                const isLow =
                  row.reorderPoint !== null && row.onHand <= row.reorderPoint;
                return (
                  <s-table-row key={row.variantId}>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small">
                        <span>{row.productTitle}</span>
                        {isLow && (
                          <s-badge tone="warning">Low stock</s-badge>
                        )}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      {row.sku ? (
                        <s-text>{row.sku}</s-text>
                      ) : (
                        <s-paragraph color="subdued">—</s-paragraph>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      <s-paragraph color="subdued">{row.variantId}</s-paragraph>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge
                        tone={
                          row.onHand > 10
                            ? "success"
                            : row.onHand > 0
                              ? "warning"
                              : "critical"
                        }
                      >
                        {row.onHand}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <ReorderCell key={row.variantId + "-" + row.reorderPoint} row={row} />
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Movement history (last 25)">
        {recent.length === 0 ? (
          <s-paragraph color="subdued">
            No movements yet. Orders, adjustments, imports, and syncs will
            appear here with a full audit trail.
          </s-paragraph>
        ) : (
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
                    <s-paragraph color="subdued">
                      {new Date(m.createdAt).toLocaleString()}
                    </s-paragraph>
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
                    <s-badge
                      tone={
                        m.reason === "order"
                          ? "info"
                          : m.reason === "order_cancelled" || m.reason === "refund_restock"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {m.reason.replace(/_/g, " ")}
                    </s-badge>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Record stock adjustment">
        {fetcher.data?.error && (
          <s-banner tone="critical" heading="Couldn't save">
            <s-paragraph>{fetcher.data.error}</s-paragraph>
          </s-banner>
        )}
        {fetcher.data?.success && (
          <s-banner tone="success" heading="Adjustment saved">
            <s-paragraph>Stock movement recorded successfully.</s-paragraph>
          </s-banner>
        )}

        <fetcher.Form ref={formRef} method="post">
          <input type="hidden" name="intent" value="adjust" />
          <input type="hidden" name="variantId" value={pickedVariant?.variantId ?? ""} />
          <input type="hidden" name="sku" value={pickedVariant?.sku ?? ""} />
          <input type="hidden" name="productTitle" value={pickedVariant?.productTitle ?? ""} />
          <s-stack direction="block" gap="base">
            {pickedVariant ? (
              <s-stack direction="block" gap="small">
                <s-text>{pickedVariant.productTitle}</s-text>
                <s-paragraph color="subdued">
                  {pickedVariant.sku ? `SKU: ${pickedVariant.sku}` : "No SKU"}
                  {" · "}
                  {pickedVariant.variantId}
                </s-paragraph>
                <s-button onClick={openPicker}>Change product</s-button>
              </s-stack>
            ) : (
              <s-button onClick={openPicker}>Select product / variant</s-button>
            )}
            <s-number-field
              label="Quantity delta"
              name="quantityDelta"
              placeholder="e.g. 10 or -5"
              required
            />
            <s-select label="Reason" name="reason">
              <s-option value="manual">Manual adjustment</s-option>
              <s-option value="restock">Restock</s-option>
              <s-option value="order">Order fulfillment</s-option>
            </s-select>
            <s-button type="submit" variant="primary" {...{ loading: submitting ? true : undefined }}>
              Save adjustment
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>
    </s-page>
  );
}

/**
 * Anything the action can't catch — a loader failure, an unreachable app
 * instance, a response the client can't parse — lands here. Without it
 * React Router falls back to its bare "Application Error" page, which tells a
 * merchant nothing and hides the whole Inventory screen.
 */
export function ErrorBoundary() {
  const error = useRouteError();

  // Shopify's thrown Responses carry the App Bridge redirect markup, so they
  // still have to render through its own boundary.
  if (isRouteErrorResponse(error)) {
    return boundary.error(error);
  }

  const message =
    error instanceof Error && error.message ? error.message : String(error);

  return (
    <s-page heading="Inventory">
      <s-section heading="Something went wrong">
        <s-banner tone="critical" heading="Inventory is temporarily unavailable">
          <s-paragraph>{message}</s-paragraph>
          <s-paragraph>
            No stock was changed. Reload the page to try again.
          </s-paragraph>
        </s-banner>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
