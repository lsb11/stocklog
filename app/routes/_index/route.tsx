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
  { title: "StockLog — the stock ledger for Shopify stores that lost Stocky" },
  {
    name: "description",
    content:
      "A persistent stock ledger for your Shopify store. Orders decrement, cancellations and refunds restock, every movement is audited. Still have your Stocky export? Import it. $7.99/month, 7-day free trial.",
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
  { sku: "TSHIRT-BLK-M", reason: "ORDER #1042", delta: "−2", onHand: "38", tone: "out" },
  { sku: "MUG-01", reason: "ORDER #1043", delta: "−1", onHand: "17", tone: "out" },
  { sku: "TSHIRT-BLK-M", reason: "REFUND · RESTOCK", delta: "+1", onHand: "39", tone: "in" },
  { sku: "CANDLE-OAK", reason: "STOCKY IMPORT", delta: "+240", onHand: "240", tone: "in" },
  { sku: "MUG-01", reason: "ORDER #1044", delta: "−3", onHand: "14", tone: "out" },
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

      <p className={styles.deadline}>
        <span className={styles.deadlineRule} aria-hidden="true" />
        Shopify shut Stocky down on <strong>31 August 2026</strong>. Still have your export? Import it.
        <span className={styles.deadlineRule} aria-hidden="true" />
      </p>

      <main className={styles.hero}>
        <section className={styles.heroCopy}>
          <h1 className={styles.heading}>
            Stocky’s gone.
            <br />
            Keep a stock ledger
            <br />
            that isn’t.
          </h1>
          <p className={styles.lede}>
            StockLog is a persistent stock ledger inside your Shopify admin.
            Orders decrement on-hand quantity, cancellations and restocking
            refunds put it back, and every movement is recorded with a
            timestamp and reason — like a bookkeeper for your inventory.
          </p>

          <div className={styles.cta}>
            <a className={styles.ctaButton} href="https://apps.shopify.com/">
              Install from the Shopify App Store
            </a>
            <p className={styles.formHint}>
              $7.99/month after a 7-day free trial · cancel any time from your Shopify admin
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
            title: "Bring your Stocky export with you",
            body: "Still have your Stocky export? Import it. Paste the CSV and every SKU's quantity is carried over with a full audit trail — or sync your current Shopify stock in one click and start from today.",
          },
          {
            tag: "ORDERS",
            tone: "out",
            title: "Decrements that never double-count",
            body: "Each order reduces on-hand quantity exactly once — retried webhooks are detected and skipped, so your counts stay honest.",
          },
          {
            tag: "REFUNDS",
            tone: "in",
            title: "Cancellations and restocks go back",
            body: "Cancelled orders reverse their exact movements; refunds marked for restock add units back automatically.",
          },
          {
            tag: "AUDIT",
            tone: "neutral",
            title: "Every movement, on the record",
            body: "Orders, imports, syncs, corrections — timestamped with a reason. Low-stock items are flagged against reorder points you set per variant.",
          },
          {
            tag: "PRICE",
            tone: "neutral",
            title: "One simple plan",
            body: "$7.99/month, 7-day free trial, billed through Shopify. No tiers, no per-SKU pricing, cancel any time.",
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
