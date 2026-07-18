-- Add sourceOrderId so refund_restock rows can be linked back to their parent order.
-- Without this, orders/cancelled cannot see what refunds/create already restocked,
-- causing double reversal when Shopify fires both webhooks for one cancellation.
ALTER TABLE "StockMovement" ADD COLUMN "sourceOrderId" TEXT;

CREATE INDEX "StockMovement_shop_sourceOrderId_idx" ON "StockMovement"("shop", "sourceOrderId");
