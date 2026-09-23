# StockLog — Compliance Notes

_For Shopify App Store submission. Last updated: 2026-09-23._

---

## Protected Customer Data (PCD) Posture

StockLog requests the `read_orders` scope to display order history and revenue summaries inside the embedded app. **No protected customer data is persisted, exported, or transmitted to any third party.**

| Field | Usage | Stored? |
|-------|-------|---------|
| Order name / number | Dashboard table | No — rendered in browser only |
| `customer.displayName` (Name field) | Dashboard "Customer" column | No — rendered in browser only |
| Email, address, phone | Not requested | No |
| Payment details | Not requested | No |

- **PCD access granted**: "App functionality" — merchants need to see their own order list.
- **Scopes requested**: `write_products, write_metaobjects, write_metaobject_definitions, read_orders`
- **Scopes deliberately NOT requested**: `write_orders`, `write_draft_orders` — these trigger additional PCD review and are not needed by the app.

---

## Data Retention

| Table | Contents | Retained until |
|-------|----------|----------------|
| `Session` | Shopify OAuth tokens | Deleted on `app/uninstalled` webhook |
| `StockMovement` | Stock ledger: orders, cancellations, refund restocks, syncs, imports and manual adjustments (no PII) | Kept while the app is installed; deleted on `shop/redact` |
| `VariantSettings` | Per-variant reorder points (no PII) | Kept while the app is installed; deleted on `shop/redact` |

Shopify sends `shop/redact` 48 hours after the merchant uninstalls the app, and
requires the deletion to be completed within 30 days of receipt. StockLog deletes
the shop's rows as soon as the webhook arrives, so shop data is gone about 48 hours
after uninstall. If the delete fails the handler returns a 500 so Shopify retries.

GDPR-mandatory webhooks implemented:

- `customers/data_request` — `/webhooks/customers.data_request` (no customer data stored; responds with empty data set)
- `customers/redact` — `/webhooks/customers.redact` (no customer data to redact; acknowledges immediately)
- `shop/redact` — `/webhooks/shop.redact` (deletes all `StockMovement`, `VariantSettings` and `Session` rows for the shop)

---

## Security Incident Response

1. **Identify** — Monitor Shopify Partner Dashboard alerts and application error logs.
2. **Contain** — Immediately rotate API credentials in Partners Dashboard; revoke access tokens if needed.
3. **Notify** — Contact affected merchants and file a report with Shopify Partner Support within 72 hours of confirmed breach.
4. **Remediate** — Patch, redeploy, and rotate all secrets; invalidate existing sessions.
5. **Review** — Document root cause, update controls, and record in incident log.

Security contact: lsandelands@hotmail.com

---

## Test / Production Data Separation

| Environment | Database | Notes |
|-------------|----------|-------|
| Local development | `prisma/dev.sqlite` | Git-ignored; never contains real merchant data |
| Production | PostgreSQL via `DATABASE_URL` env var | Managed separately; no overlap with dev |

Dev store orders (#1001–#1006 on `stocklog-dev.myshopify.com`) are synthetic test records created via the Shopify REST API. They are not real merchant or customer records.

---

## Attestation

The developer has formally attested to Shopify that:

- This app does **not** persist protected customer data.
- The Name field is read solely to render the dashboard order table within the merchant's own admin session.
- No customer PII is written to any database, log, or third-party service.
