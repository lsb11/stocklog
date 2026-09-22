import type { authenticate } from "./shopify.server";

type AdminContext = Awaited<ReturnType<typeof authenticate.admin>>["admin"];

// A shop's plan doesn't change mid-session and this runs on every app load,
// so remember the answer per shop. Process-local: a restart just re-queries.
const partnerDevelopmentByShop = new Map<string, boolean>();

/**
 * Development stores get test charges; every other store gets a real one.
 * That lets Shopify's reviewers approve the subscription on their own dev
 * store without being billed, while live merchants are charged normally.
 *
 * BILLING_TEST=true forces test charges regardless, for exercising the
 * billing flow by hand.
 */
export async function resolveIsTestBilling(
  shop: string,
  admin: AdminContext,
): Promise<boolean> {
  if (process.env.BILLING_TEST === "true") return true;

  const cached = partnerDevelopmentByShop.get(shop);
  if (cached !== undefined) return cached;

  try {
    const response = await admin.graphql(
      `#graphql
        query ShopPlan {
          shop {
            plan {
              partnerDevelopment
            }
          }
        }`,
    );
    const body = await response.json();
    const partnerDevelopment = Boolean(
      body?.data?.shop?.plan?.partnerDevelopment,
    );
    partnerDevelopmentByShop.set(shop, partnerDevelopment);
    return partnerDevelopment;
  } catch (err) {
    // Never fall back to a test charge on an unknown plan: that would hand a
    // live merchant a free subscription. Charge for real and log it instead.
    console.error(
      `[StockLog] Could not read the plan for ${shop}; billing as a production store`,
      err,
    );
    return false;
  }
}
