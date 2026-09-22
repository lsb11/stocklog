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
import {
  buildLedger,
  ensureOpeningBalances,
  findUnsyncedVariantIds,
  parseQuantityDelta,
} from "../stock.server";
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

type StockRow = {
  variantId: string;
  sku: string;
  title: string;
  onHand: number;
  reorderPoint: number | null;
  neverSynced: boolean;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const [ledger, settings, recentRaw, unsynced] = await Promise.all([
    buildLedger(shop),
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
        variantId: true,
        productTitle: true,
        sku: true,
        quantityDelta: true,
        reason: true,
        orderId: true,
        createdAt: true,
      },
    }),
    findUnsyncedVariantIds(shop),
  ]);

  // Variant titles and order names live in Shopify, not in the ledger, so
  // they are fetched for the rows this page renders and cached per shop.
  const [variantInfo, orderNames, timeZone] = await Promise.all([
    fetchVariantInfo(shop, admin, [
      ...recentRaw.map((m: (typeof recentRaw)[number]) => m.variantId),
      ...Array.from(ledger.keys()),
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

  const settingsMap = new Map<string, number | null>(
    settings.map((s: { variantId: string; reorderPoint: number | null }) => [
      s.variantId,
      s.reorderPoint ?? null,
    ]),
  );

  const unsyncedSet = new Set(unsynced);
  const stock: StockRow[] = Array.from(ledger.values())
    .map((row) => ({
      variantId: row.variantId,
      sku: row.sku,
      title: displayTitle(row.productTitle, variantInfo.get(row.variantId)),
      onHand: row.onHand,
      reorderPoint: settingsMap.get(row.variantId) ?? null,
      neverSynced: unsyncedSet.has(row.variantId),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));

  return { stock, recent, unsyncedCount: unsynced.length };
};

async function actionAdjustStock(
  shop: string,
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  fd: FormData,
) {
  const productTitle = String(fd.get("productTitle") ?? "").trim();
  const variantId = String(fd.get("variantId") ?? "").trim();
  const sku = String(fd.get("sku") ?? "").trim();
  const reason = String(fd.get("reason") ?? "manual");

  if (!productTitle || !variantId) {
    return {
      error: "Pick a product or variant before saving.",
      field: null,
      success: false,
      message: null,
    };
  }

  // The field is free text so merchants can write the adjustment the way they
  // think about it: "+5" received, "-3" damaged. A bare "5" still means +5.
  const delta = parseQuantityDelta(String(fd.get("quantityDelta") ?? ""));
  if (delta === null) {
    return {
      error: "Enter a whole number, optionally signed. For example 5, +5 or -3.",
      field: "quantityDelta",
      success: false,
      message: null,
    };
  }
  if (delta === 0) {
    return {
      error: "A quantity change of 0 wouldn't alter anything. Enter a non-zero amount.",
      field: "quantityDelta",
      success: false,
      message: null,
    };
  }

  // An adjustment against a variant StockLog has never seen must open from
  // Shopify's current quantity, not zero. Nothing here is pushed back to
  // Shopify, so the adjustment itself isn't reflected there yet.
  await ensureOpeningBalances(shop, admin, [
    { variantId, sku: sku || null, productTitle, appliedDelta: 0 },
  ]);

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

  return {
    success: true,
    error: null,
    field: null,
    message: `${delta > 0 ? "+" : ""}${delta} recorded for ${productTitle}.`,
  };
}

async function actionSetReorderPoint(shop: string, fd: FormData) {
  const variantId = String(fd.get("variantId") ?? "").trim();
  const rpRaw = fd.get("reorderPoint");
  const reorderPoint =
    rpRaw === "" || rpRaw === null ? null : parseInt(String(rpRaw), 10);

  if (!variantId) {
    return { error: "Pick a variant before saving a reorder point.", field: null, success: false, message: null };
  }
  if (reorderPoint !== null && isNaN(reorderPoint)) {
    return {
      error: "Reorder point must be a valid number.",
      field: null,
      success: false,
      message: null,
    };
  }

  await prisma.variantSettings.upsert({
    where: { shop_variantId: { shop, variantId } },
    update: { reorderPoint },
    create: { shop, variantId, reorderPoint },
  });

  return {
    success: true,
    error: null,
    field: null,
    message:
      reorderPoint === null
        ? "Reorder point cleared."
        : `Reorder point set to ${reorderPoint}.`,
  };
}

const UNEXPECTED_ERROR =
  "Something went wrong saving that change, so nothing was recorded. Try again. If it keeps happening, the details are in the server logs.";

export const action = async ({ request }: ActionFunctionArgs) => {
  let shop = "unknown shop";

  try {
    const { admin, session } = await authenticate.admin(request);
    shop = session.shop;

    const fd = await request.formData();
    const intent = String(fd.get("intent") ?? "adjust");

    if (intent === "set-reorder-point") {
      return await actionSetReorderPoint(shop, fd);
    }
    return await actionAdjustStock(shop, admin, fd);
  } catch (error) {
    // Shopify throws Responses to drive its auth and billing redirects, and
    // App Bridge retries some of them — those have to keep bubbling.
    if (error instanceof Response) throw error;

    // Everything else (a dropped database connection, a bad session token, a
    // Prisma failure) becomes a banner on the page instead of taking the whole
    // route down with React Router's "Application Error" screen.
    console.error(`[StockLog] Inventory action failed for ${shop}`, error);
    return { error: UNEXPECTED_ERROR, field: null, success: false, message: null };
  }
};

function SkuCell({ sku }: { sku: string }) {
  return sku ? (
    <s-text>{sku}</s-text>
  ) : (
    <s-paragraph color="subdued">No SKU</s-paragraph>
  );
}

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
          placeholder="None"
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

type PickedVariant = {
  variantId: string;
  sku: string;
  productTitle: string;
  variantTitle: string | null;
};

export default function Inventory() {
  const { stock, recent, unsyncedCount } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const formRef = useRef<HTMLFormElement>(null);
  const [pickedVariant, setPickedVariant] = useState<PickedVariant | null>(null);
  const [pickerNotice, setPickerNotice] = useState<string | null>(null);

  const openPicker = useCallback(async () => {
    // The product picker shows each product's image and title and lets a
    // merchant expand it to pick a variant; the variant picker on its own only
    // showed variant titles ("Black", "Large", or blank), which merchants
    // can't tell apart.
    const selection = await shopify.resourcePicker({
      type: "product",
      action: "select",
      multiple: false,
      filter: { variants: true },
    });
    if (!selection || selection.length === 0) return;

    const product = selection[0] as ShopifyResourcePickerProduct;
    // Expanding and choosing a variant returns just that variant; selecting
    // the product row returns all of them. One variant back is unambiguous —
    // either the chosen one, or the sole default variant of a product that has
    // no options. Several means the merchant picked the product without saying
    // which variant, so ask rather than guessing at the first one.
    const variants = product.variants ?? [];
    if (variants.length > 1) {
      setPickedVariant(null);
      setPickerNotice(`Pick one variant of ${product.title}`);
      return;
    }
    const variant = variants[0];
    if (!variant) return;

    setPickerNotice(null);
    setPickedVariant({
      variantId: variant.id,
      sku: variant.sku ?? "",
      productTitle: product.title ?? variant.product?.title ?? "",
      variantTitle:
        variant.title && variant.title !== "Default Title" ? variant.title : null,
    });
  }, []);

  useEffect(() => {
    if (fetcher.data?.success) {
      formRef.current?.reset();
      setPickedVariant(null);
      setPickerNotice(null);
      shopify.toast.show(fetcher.data.message ?? "Adjustment saved");
    }
  }, [fetcher.data]);

  const submitting = fetcher.state !== "idle";

  return (
    <s-page heading="Inventory">
      {unsyncedCount > 0 && (
        <s-banner tone="warning" heading="Sync current stock">
          <s-paragraph>
            {unsyncedCount === 1
              ? "1 variant has"
              : `${unsyncedCount} variants have`}{" "}
            never been matched against Shopify. The on-hand figure below counts
            only the movements StockLog has recorded, so it may not match what
            Shopify shows.
          </s-paragraph>
          <s-link href="/app/import">
            <s-button variant="primary">Sync current stock</s-button>
          </s-link>
        </s-banner>
      )}

      <s-section heading="Stock on hand">
        {stock.length === 0 ? (
          <s-paragraph color="subdued">
            No stock history yet. Use the form below to record an adjustment.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>SKU</s-table-header>
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
                        <span>{row.title}</span>
                        {isLow && (
                          <s-badge tone="warning">Low stock</s-badge>
                        )}
                        {row.neverSynced && (
                          <s-badge tone="warning">Not synced</s-badge>
                        )}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <SkuCell sku={row.sku} />
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
            No movements yet. Orders, adjustments, imports and syncs appear
            here with the time and the reason.
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
        )}
      </s-section>

      <s-section heading="Record stock adjustment">
        {fetcher.data?.error && !fetcher.data.field && (
          <s-banner tone="critical" heading="Adjustment not saved">
            <s-paragraph>{fetcher.data.error}</s-paragraph>
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
                <s-text>
                  {pickedVariant.variantTitle
                    ? `${pickedVariant.productTitle}, ${pickedVariant.variantTitle}`
                    : pickedVariant.productTitle}
                </s-text>
                <s-paragraph color="subdued">
                  {pickedVariant.sku ? `SKU: ${pickedVariant.sku}` : "No SKU"}
                </s-paragraph>
                <s-button onClick={openPicker}>Change product</s-button>
              </s-stack>
            ) : (
              <s-button onClick={openPicker}>Select product / variant</s-button>
            )}
            {pickerNotice && (
              <s-paragraph tone="critical">{pickerNotice}</s-paragraph>
            )}
            <s-text-field
              label="Quantity change"
              name="quantityDelta"
              placeholder="e.g. +10 or -5"
              details="Use + to add stock and - to remove it. A plain number adds."
              required
              {...(fetcher.data?.field === "quantityDelta"
                ? { error: fetcher.data.error }
                : {})}
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
