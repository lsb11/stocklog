import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

type OrderNode = {
  id: string;
  name: string;
  createdAt: string;
  displayFulfillmentStatus: string;
  totalPriceSet?: {
    shopMoney?: { amount?: string; currencyCode?: string } | null;
  } | null;
};

type RecentOrdersResponse = {
  data?: { orders?: { edges?: { node: OrderNode }[] } | null } | null;
  errors?: unknown[];
};

type OrderRow = {
  id: string;
  name: string;
  createdAt: string;
  displayFulfillmentStatus: string;
  total: string;
  currency: string;
};

const PCD_ERROR_PATTERN = /not approved to access the order object|protected customer data|read_orders|access denied/i;

function errToString(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const body = (err as Error & { body?: unknown }).body;
    return [err.message, body ? JSON.stringify(body) : ""].join(" ");
  }
  return JSON.stringify(err) ?? "";
}

function isPcdError(err: unknown): boolean {
  return PCD_ERROR_PATTERN.test(errToString(err));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const noOrders = { orders: [] as OrderRow[], ordersToday: 0, revenue7d: 0, totalOrders: 0, currency: "", accessPending: false };
  const accessPendingResult = { ...noOrders, accessPending: true };

  try {
    const response = await admin.graphql(
      `#graphql
        query RecentOrders {
          orders(first: 50, sortKey: CREATED_AT, reverse: true) {
            edges {
              node {
                id
                name
                createdAt
                displayFulfillmentStatus
                totalPriceSet { shopMoney { amount currencyCode } }
              }
            }
          }
        }`,
    );

    const body = (await response.json()) as RecentOrdersResponse;

    if (body?.errors?.length) {
      const errs = body.errors;
      console.error("[StockLog] GraphQL errors:", JSON.stringify(errs, null, 2));
      if (isPcdError(errs)) return accessPendingResult;
      return noOrders;
    }

    const edges = body?.data?.orders?.edges ?? [];

    const orders: OrderRow[] = edges.map((e: { node: OrderNode }) => ({
      id: e.node.id,
      name: e.node.name,
      createdAt: e.node.createdAt,
      displayFulfillmentStatus: e.node.displayFulfillmentStatus,
      total: e.node.totalPriceSet?.shopMoney?.amount ?? "0",
      currency: e.node.totalPriceSet?.shopMoney?.currencyCode ?? "",
    }));

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const ordersToday = orders.filter(
      (o) => new Date(o.createdAt) >= startOfToday,
    ).length;
    const revenue7d = orders
      .filter((o) => new Date(o.createdAt) >= sevenDaysAgo)
      .reduce((sum, o) => sum + parseFloat(o.total || "0"), 0);
    const currency = orders[0]?.currency ?? "";

    return { orders, ordersToday, revenue7d, totalOrders: orders.length, currency, accessPending: false };
  } catch (err) {
    console.error("[StockLog] loader threw:", errToString(err), err);
    if (isPcdError(err)) return accessPendingResult;
    return noOrders;
  }
};

function fmtMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency || "USD",
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fulfillmentTone(status: string) {
  if (status === "FULFILLED") return "success";
  if (status === "PARTIALLY_FULFILLED") return "warning";
  if (status === "UNFULFILLED") return "caution";
  return "neutral";
}

export default function Index() {
  const { orders, ordersToday, revenue7d, totalOrders, currency, accessPending } =
    useLoaderData<typeof loader>();

  return (
    <s-page heading="StockLog">
      {accessPending && (
        <s-banner tone="warning" heading="Order data access pending">
          <s-paragraph>
            Approve order data access in the Partners Dashboard → App Setup →
            Protected customer data, then reinstall the app.
          </s-paragraph>
        </s-banner>
      )}
      <s-section>
        <s-stack direction="inline" gap="base">
          <s-box padding="base" background="base">
            <s-paragraph color="subdued">Orders today</s-paragraph>
            <s-heading>{ordersToday}</s-heading>
          </s-box>
          <s-box padding="base" background="base">
            <s-paragraph color="subdued">Revenue (7 days)</s-paragraph>
            <s-heading>{fmtMoney(revenue7d, currency)}</s-heading>
          </s-box>
          <s-box padding="base" background="base">
            <s-paragraph color="subdued">Orders shown</s-paragraph>
            <s-heading>{totalOrders}</s-heading>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="Recent orders">
        {orders.length === 0 ? (
          <s-paragraph>
            Once your store takes orders, they&apos;ll appear here.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Order</s-table-header>
              <s-table-header>Date</s-table-header>
              <s-table-header format="numeric">Total</s-table-header>
              <s-table-header>Fulfilment</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {orders.map((order) => (
                <s-table-row key={order.id}>
                  <s-table-cell>
                    <s-text>{order.name}</s-text>
                  </s-table-cell>
                  <s-table-cell>{fmtDate(order.createdAt)}</s-table-cell>
                  <s-table-cell>
                    {fmtMoney(parseFloat(order.total), order.currency)}
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={fulfillmentTone(order.displayFulfillmentStatus)}>
                      {order.displayFulfillmentStatus.replace(/_/g, " ").toLowerCase()}
                    </s-badge>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
