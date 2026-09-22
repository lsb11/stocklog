export const links = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800&family=IBM+Plex+Mono:wght@400;600&display=swap",
  },
];

export const meta = () => [
  { title: "Privacy policy — StockLog" },
  {
    name: "description",
    content:
      "What StockLog stores, what it never stores, and how data is deleted. StockLog keeps order line items for inventory tracking and stores no customer personal information.",
  },
];

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f6f4ee",
    color: "#1c2620",
    fontFamily: '"Archivo", system-ui, sans-serif',
    padding: "0 clamp(20px, 5vw, 64px)",
  },
  topbar: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    padding: "22px 0 18px",
    borderBottom: "1px solid #ddd8cb",
  },
  wordmark: { fontWeight: 800, fontSize: 22, letterSpacing: "-0.02em", color: "#1c2620", textDecoration: "none" },
  main: { maxWidth: 720, padding: "40px 0 64px" },
  h1: { fontSize: "clamp(32px, 5vw, 44px)", fontWeight: 800, letterSpacing: "-0.03em", margin: "0 0 8px" },
  updated: { fontFamily: '"IBM Plex Mono", monospace', fontSize: 12.5, color: "#7c776b", margin: "0 0 32px" },
  h2: { fontSize: 20, fontWeight: 700, margin: "32px 0 10px", letterSpacing: "-0.01em" },
  p: { fontSize: 15.5, lineHeight: 1.7, color: "#3d443d", margin: "0 0 12px" },
  ul: { fontSize: 15.5, lineHeight: 1.7, color: "#3d443d", margin: "0 0 12px", paddingLeft: 22 },
  footer: {
    borderTop: "1px solid #ddd8cb",
    padding: "18px 0 24px",
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: 12.5,
    color: "#7c776b",
  },
};

export default function Privacy() {
  return (
    <div style={s.page}>
      <header style={s.topbar}>
        <a href="/" style={s.wordmark}>
          Stock<span style={{ color: "#0f7b4a" }}>Log</span>
        </a>
      </header>
      <main style={s.main}>
        <h1 style={s.h1}>Privacy policy</h1>
        <p style={s.updated}>Last updated: 17 July 2026</p>

        <p style={s.p}>
          StockLog is an inventory ledger for Shopify stores. This page explains
          exactly what the app stores, what it never stores, and how data is
          deleted. The policy is written to be read, not skimmed past.
        </p>

        <h2 style={s.h2}>What StockLog stores</h2>
        <ul style={s.ul}>
          <li>
            <strong>Your shop domain and an access token</strong>, so the app can
            operate inside your Shopify admin.
          </li>
          <li>
            <strong>Stock movements</strong>: product titles, SKUs, variant
            identifiers, quantities, timestamps, and the reason for each movement
            (order, cancellation, refund restock, sync, import, or manual
            adjustment), plus the order number a movement relates to.
          </li>
          <li>
            <strong>Settings you create</strong>, such as per-variant reorder
            points.
          </li>
        </ul>

        <h2 style={s.h2}>What StockLog never stores</h2>
        <p style={s.p}>
          No customer personal information. Order webhooks are read for their
          line items only — customer names, email addresses, shipping addresses,
          and payment details are not saved to our database. Billing is handled
          entirely by Shopify; StockLog never sees your card details.
        </p>

        <h2 style={s.h2}>Where data lives</h2>
        <p style={s.p}>
          Data is stored in a PostgreSQL database hosted on Render
          (render.com), reachable only by the StockLog application. It is not
          sold, shared, or used for anything other than showing you your own
          ledger.
        </p>

        <h2 style={s.h2}>Deletion</h2>
        <ul style={s.ul}>
          <li>
            <strong>Uninstalling the app</strong> revokes its access
            immediately, and Shopify&rsquo;s shop-redact process removes the
            shop&rsquo;s stored data within the timeframe Shopify mandates
            (currently 48 hours after the redaction request is issued).
          </li>
          <li>
            StockLog implements all of Shopify&rsquo;s mandatory privacy
            webhooks (customer data requests, customer redaction, and shop
            redaction). Because no customer personal information is stored,
            customer data requests return nothing to disclose.
          </li>
        </ul>

        <h2 style={s.h2}>Contact</h2>
        <p style={s.p}>
          Questions about this policy or your data: contact us through the
          support details on StockLog&rsquo;s Shopify App Store listing, and
          we&rsquo;ll respond within a few business days.
        </p>
      </main>
      <footer style={s.footer}>© 2026 StockLog</footer>
    </div>
  );
}
