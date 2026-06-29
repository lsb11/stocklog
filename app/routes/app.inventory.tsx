import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

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

  const [movements, settings] = await Promise.all([
    prisma.stockMovement.findMany({
      where: { shop },
      select: { variantId: true, sku: true, productTitle: true, quantityDelta: true },
    }),
    prisma.variantSettings.findMany({
      where: { shop },
      select: { variantId: true, reorderPoint: true },
    }),
  ]);

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

  const settingsMap = new Map(settings.map((s) => [s.variantId, s.reorderPoint ?? null]));
  for (const row of grouped.values()) {
    row.reorderPoint = settingsMap.get(row.variantId) ?? null;
  }

  const stock = Array.from(grouped.values()).sort((a, b) =>
    a.productTitle.localeCompare(b.productTitle),
  );

  return { stock };
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

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "adjust");

  if (intent === "set-reorder-point") {
    return actionSetReorderPoint(shop, fd);
  }
  return actionAdjustStock(shop, fd);
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
  const { stock } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const formRef = useRef<HTMLFormElement>(null);
  const [pickedVariant, setPickedVariant] = useState<PickedVariant | null>(null);

  const openPicker = useCallback(async () => {
    const selection = await shopify.resourcePicker({ type: "variant", multiple: false });
    if (selection && selection.length > 0) {
      const v = selection[0];
      // v.product?.title is the canonical source; displayName falls back as "Product - Variant"
      const productTitle =
        v.product?.title ??
        (v.displayName ?? v.title ?? "").replace(/\s[-–]\s.+$/, "");
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

      <s-section heading="Record stock adjustment">
        {fetcher.data?.error && (
          <s-banner tone="critical" heading="Validation error">
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

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
