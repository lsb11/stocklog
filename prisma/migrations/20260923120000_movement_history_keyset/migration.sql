-- Movement history is keyset-paged newest first on (createdAt, id), for all
-- movements and for one variant at a time (app/history.server.ts). These two
-- indexes let each page be a single range scan with a LIMIT. id is the
-- tiebreaker: a sync or an import writes many rows with the same createdAt.
--
-- The new indexes are created before the old ones are dropped, so there is no
-- moment with neither. Their leading columns cover every query the old
-- (shop, variantId) and (shop, createdAt) indexes served.

-- CreateIndex
CREATE INDEX "StockMovement_shop_variantId_createdAt_id_idx" ON "StockMovement"("shop", "variantId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "StockMovement_shop_createdAt_id_idx" ON "StockMovement"("shop", "createdAt", "id");

-- DropIndex
DROP INDEX "StockMovement_shop_variantId_idx";

-- DropIndex
DROP INDEX "StockMovement_shop_createdAt_idx";
