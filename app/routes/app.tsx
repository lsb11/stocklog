import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { MONTHLY_PLAN } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing } = await authenticate.admin(request);

  try {
    // Real charges only in production with BILLING_TEST unset/false.
    // Keep BILLING_TEST=true until the app passes review, then remove it.
    const isTest =
      process.env.BILLING_TEST === "true" ||
      process.env.NODE_ENV !== "production";
    await billing.require({
      plans: [MONTHLY_PLAN],
      isTest,
      onFailure: async () =>
        billing.request({ plan: MONTHLY_PLAN, isTest }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("public distribution") || msg.includes("billing")) {
      console.log("[StockLog] billing not active yet:", msg);
    } else {
      throw err;
    }
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/inventory">Inventory</s-link>
        <s-link href="/app/import">Import / Sync</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
