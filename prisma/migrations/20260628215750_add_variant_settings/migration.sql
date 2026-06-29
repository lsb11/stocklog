-- CreateTable
CREATE TABLE "VariantSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "reorderPoint" INTEGER,

    CONSTRAINT "VariantSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VariantSettings_shop_idx" ON "VariantSettings"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "VariantSettings_shop_variantId_key" ON "VariantSettings"("shop", "variantId");
