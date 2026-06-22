import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useFetcher } from "react-router";
import { useEffect, useRef } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

type StockRow = {
  variantId: string;
  sku: string;
  productTitle: string;
  onHand: number;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const movements = await prisma.stockMovement.findMany({
    where: { shop },
    select: { variantId: true, sku: true, productTitle: true, quantityDelta: true },
  });

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
      });
    }
  }
  const stock = Array.from(grouped.values()).sort((a, b) =>
    a.productTitle.localeCompare(b.productTitle),
  );

  return { stock };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const fd = await request.formData();
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
};

export default function Inventory() {
  const { stock } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (fetcher.data?.success) {
      formRef.current?.reset();
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
            </s-table-header-row>
            <s-table-body>
              {stock.map((row) => (
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
                </s-table-row>
              ))}
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
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Product title"
              name="productTitle"
              placeholder="e.g. Classic T-Shirt"
              required
            />
            <s-text-field
              label="Variant ID"
              name="variantId"
              placeholder="e.g. gid://shopify/ProductVariant/123456"
              required
            />
            <s-text-field
              label="SKU (optional)"
              name="sku"
              placeholder="e.g. TSHIRT-BLK-M"
            />
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
