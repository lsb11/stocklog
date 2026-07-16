# StockLog — Inventory & Order Tracking for Shopify

A persistent stock ledger and live order dashboard, embedded in the Shopify
admin. Built on the official Shopify React Router app template.

**Positioning:** the hosted step up from spreadsheet-based Stocky
replacements — a real database, automatic order/cancel/refund handling,
one-click Stocky import, and a full audit trail. $7.99/month, 7-day trial.

## How the ledger works

The ledger is an append-only `StockMovement` table. On-hand per variant is
the sum of its movement deltas. Sources of movements:

| Reason | Source | Delta |
|---|---|---|
| `order` | `orders/create` webhook (idempotent — retries skipped) | −qty per line item |
| `order_cancelled` | `orders/cancelled` webhook | exact reversal of the recorded order |
| `refund_restock` | `refunds/create` webhook (skips `no_restock` lines) | +qty restocked |
| `shopify_sync` | Import / Sync page — corrects ledger to match Shopify's live `inventoryQuantity` | corrective |
| `stocky_import` | Import / Sync page — `SKU,quantity` CSV rows (Stocky export) | corrective |
| `manual` / `restock` | Inventory page adjustment form | as entered |

Onboarding flow for merchants: install → **Import / Sync → "Sync stock from
Shopify"** (baselines every variant) → optionally paste the Stocky CSV →
orders keep the ledger live from then on.

## Environment

- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`
- `SCOPES=read_orders,read_products` (must match `shopify.app.toml`)
- `DATABASE_URL` — Postgres. **Render note:** free Postgres is deleted 30
  days after creation; production requires a paid instance, and the web
  service must be a paid plan (free tier spin-down = 30–60 s cold starts).
- `BILLING_TEST=true` while in review; remove in production to charge for
  real. (Also defaults to test outside `NODE_ENV=production`.)

## Launch checklist

1. `npm run typecheck && npm run build` — both clean.
2. `shopify app deploy` — pushes webhook subscriptions + scope change
   (existing installs re-consent on next open).
3. Partner Dashboard → API access → request **Protected Customer Data**
   (Level: order data, no PII stored — required for `read_orders`; the
   dashboard shows an "access pending" state until granted).
4. Test on a dev store: order → −1 once (retry-safe) · cancel → restored ·
   refund w/ restock → restored · Sync · CSV import · billing prompt.
5. Pay the one-time $19 App Store registration fee, submit listing
   (screenshots of dashboard, inventory, import pages; lead copy with the
   31 Aug Stocky deadline).
6. On approval: remove `BILLING_TEST`, announce on stackarchitect.xyz
   Stocky pages.

## Stack

React Router 7 · `@shopify/shopify-app-react-router` · Prisma/Postgres ·
Polaris web components · Vite. Standard template commands: `npm run dev`
(Shopify CLI), `npm run build`, `npm run start`, `docker-start` for Render.
