#!/usr/bin/env node
/**
 * One-off: wipe StockLog's ledger for a single shop so it can be reseeded clean.
 *
 *   node scripts/reset-ledger.mjs my-dev-store.myshopify.com --yes
 *
 * Deletes every StockMovement row for that shop, and (with --settings) the
 * VariantSettings reorder points too. Sessions and billing are never touched,
 * so the app stays installed — re-run Import / Sync afterwards to rebuild the
 * ledger from Shopify's current quantities.
 *
 * Scoped to one shop on purpose: there is no "all shops" mode, and the script
 * refuses to run without both an explicit shop domain and --yes.
 */
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
const shop = args.find((a) => !a.startsWith("--"));
const confirmed = args.includes("--yes");
const alsoSettings = args.includes("--settings");

function die(message) {
  console.error(`\n${message}\n`);
  console.error("Usage: node scripts/reset-ledger.mjs <shop.myshopify.com> --yes [--settings]");
  process.exit(1);
}

if (!shop) die("No shop given.");
if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
  die(`"${shop}" doesn't look like a myshopify.com domain.`);
}
if (!confirmed) {
  die(`This permanently deletes every stock movement for ${shop}. Re-run with --yes if that's what you want.`);
}

const prisma = new PrismaClient();

try {
  const movements = await prisma.stockMovement.count({ where: { shop } });
  const settings = await prisma.variantSettings.count({ where: { shop } });

  if (movements === 0 && (!alsoSettings || settings === 0)) {
    console.log(`Nothing to delete for ${shop}.`);
    process.exit(0);
  }

  const deleted = await prisma.stockMovement.deleteMany({ where: { shop } });
  console.log(`Deleted ${deleted.count} stock movement(s) for ${shop}.`);

  if (alsoSettings) {
    const s = await prisma.variantSettings.deleteMany({ where: { shop } });
    console.log(`Deleted ${s.count} reorder point(s) for ${shop}.`);
  } else if (settings > 0) {
    console.log(`Kept ${settings} reorder point(s). Pass --settings to clear those too.`);
  }

  console.log("Done. Open Import / Sync in the app to reseed from Shopify.");
} catch (err) {
  console.error("Reset failed:", err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
