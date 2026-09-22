import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import styles from "./styles.module.css";

export const links = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=IBM+Plex+Mono:wght@400;600&display=swap",
  },
];

export const meta = () => [
  { title: "StockLog: a stock ledger for Shopify" },
  {
    name: "description",
    content:
      "Every stock change in your Shopify store, recorded. Orders, refunds, restocks and manual counts in one history. $7.99/month with a 7-day free trial.",
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

const LEDGER_ROWS = [
  { sku: "TSHIRT-BLK-M", reason: "ORDER #1042", delta: "-2", onHand: "38", tone: "out" },
  { sku: "MUG-01", reason: "ORDER #1043", delta: "-1", onHand: "17", tone: "out" },
  { sku: "TSHIRT-BLK-M", reason: "REFUND", delta: "+1", onHand: "39", tone: "in" },
  { sku: "CANDLE-OAK", reason: "STOCKY IMPORT", delta: "+240", onHand: "240", tone: "in" },
  { sku: "MUG-01", reason: "ORDER #1044", delta: "-3", onHand: "14", tone: "out" },
  { sku: "TOTE-NAT", reason: "SHOPIFY SYNC", delta: "+52", onHand: "52", tone: "in" },
] as const;

export default function App() {
  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <span className={styles.wordmark}>
          Stock<span className={styles.wordmarkAccent}>Log</span>
        </span>
        <span className={styles.topbarNote}>A stock ledger for Shopify stores</span>
      </header>

      <main className={styles.hero}>
        <section className={styles.heroCopy}>
          <h1 className={styles.heading}>
            Stocky is gone.
            <br />
            Your stock history
            <br />
            doesn’t have to be.
          </h1>
          <p className={styles.lede}>
            StockLog records every change to your stock in one place. Orders
            take units off, restocked refunds put them back, and every manual
            count is logged with the date and a reason. When a number looks
            wrong, you can see exactly why.
          </p>

          <div className={styles.cta}>
            <a className={styles.ctaButton} href="https://apps.shopify.com/">
              Install from the Shopify App Store
            </a>
            <p className={styles.formHint}>
              $7.99 a month after a 7-day free trial. Cancel from your Shopify
              admin at any time.
            </p>
          </div>
        </section>

        <section className={styles.ledger} aria-label="Example stock ledger">
          <div className={styles.ledgerHead}>
            <span>Stock ledger</span>
            <span className={styles.ledgerLive}>LIVE</span>
          </div>
          <div className={`${styles.ledgerRow} ${styles.ledgerHeader}`}>
            <span>SKU</span>
            <span>Movement</span>
            <span className={styles.num}>Qty</span>
            <span className={styles.num}>On hand</span>
          </div>
          {LEDGER_ROWS.map((r, i) => (
            <div
              className={styles.ledgerRow}
              key={i}
              style={{ animationDelay: `${0.15 + i * 0.12}s` }}
            >
              <span className={styles.sku}>{r.sku}</span>
              <span className={r.tone === "in" ? styles.reasonIn : styles.reasonOut}>
                {r.reason}
              </span>
              <span className={`${styles.num} ${r.tone === "in" ? styles.qtyIn : styles.qtyOut}`}>
                {r.delta}
              </span>
              <span className={styles.num}>{r.onHand}</span>
            </div>
          ))}
          <div className={styles.ledgerClose}>
            <span>Audit trail · retained until you uninstall</span>
            <span className={styles.num}>✓ balanced</span>
          </div>
        </section>
      </main>

      <section className={styles.entries} aria-label="What StockLog does">
        {[
          {
            tag: "IMPORT",
            tone: "in",
            title: "Bring your Stocky numbers with you",
            body: "Sync your current Shopify stock in one click. If you saved a Stocky CSV export, paste it in and each SKU starts from its Stocky quantity, with the import recorded in the history.",
          },
          {
            tag: "ORDERS",
            tone: "out",
            title: "Each order counted once",
            body: "Shopify sometimes sends the same order notification twice. StockLog spots the repeat and skips it, so your counts stay right.",
          },
          {
            tag: "REFUNDS",
            tone: "in",
            title: "Refunds and cancellations put stock back",
            body: "Cancel an order and its units return. Refund with restock ticked and those units go back into your ledger.",
          },
          {
            tag: "HISTORY",
            tone: "neutral",
            title: "A full record for every product",
            body: "Every order, refund, import and correction is logged with the time and the reason. Set a reorder point on any variant and StockLog flags it when stock runs low.",
          },
          {
            tag: "PRICE",
            tone: "neutral",
            title: "One plan",
            body: "$7.99 a month, billed through Shopify, with a 7-day free trial. No tiers and no per-SKU charges.",
          },
        ].map((e) => (
          <article className={styles.entry} key={e.tag}>
            <span
              className={
                e.tone === "in"
                  ? styles.entryTagIn
                  : e.tone === "out"
                    ? styles.entryTagOut
                    : styles.entryTag
              }
            >
              {e.tag}
            </span>
            <div>
              <h2 className={styles.entryTitle}>{e.title}</h2>
              <p className={styles.entryBody}>{e.body}</p>
            </div>
          </article>
        ))}
      </section>

      <footer className={styles.footer}>
        <span>© 2026 StockLog</span>
        <nav className={styles.footerNav}>
          <a href="/privacy">Privacy policy</a>
        </nav>
      </footer>
    </div>
  );
}
