import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate, MONTHLY_PLAN } from "../shopify.server";
import { resolveIsTestBilling } from "../billing.server";
import { tagShop } from "../sentry.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);

  // Every error raised for the rest of this request is attributed to this shop.
  tagShop(session.shop);

  const isTest = await resolveIsTestBilling(session.shop, admin);

  await billing.require({
    plans: [MONTHLY_PLAN],
    isTest,
    onFailure: async () => billing.request({ plan: MONTHLY_PLAN, isTest }),
  });

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
