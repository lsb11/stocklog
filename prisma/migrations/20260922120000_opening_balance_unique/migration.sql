-- Guarantees a variant can only ever have one opening balance, so two webhooks
-- racing to open the same previously-unseen variant cannot both write one.
-- Prisma's schema language has no partial-index syntax, so this index is
-- declared here only; `createMany({ skipDuplicates: true })` turns the losing
-- insert into a no-op via ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX IF NOT EXISTS "StockMovement_shop_variantId_opening_balance_key"
  ON "StockMovement" ("shop", "variantId")
  WHERE "reason" = 'opening_balance';
