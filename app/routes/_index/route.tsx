import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>StockLog — Inventory &amp; Order Tracking</h1>
        <p className={styles.text}>
          A persistent stock ledger and live order dashboard for your Shopify
          store — the simple way to track inventory as orders come in.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Import your Stocky data before 31 August 2026</strong>.
            Shopify permanently deletes all Stocky data at the end of August.
            StockLog syncs your current Shopify stock in one click and imports
            your Stocky CSV export, so nothing is lost.
          </li>
          <li>
            <strong>Live order dashboard</strong>. See every incoming order at a
            glance — status, revenue, and fulfilment state updated in real time.
          </li>
          <li>
            <strong>Automatic stock ledger</strong>. Every order decrements your
            on-hand quantity; cancellations and restocking refunds are put back
            automatically. No manual counting, no double-counting.
          </li>
          <li>
            <strong>Full audit history</strong>. Every movement — orders,
            cancellations, refunds, restocks, imports, corrections — is recorded
            with a timestamp and reason, and low-stock items are flagged against
            your reorder points.
          </li>
          <li>
            <strong>Simple pricing</strong>. $7.99/month after a 7-day free
            trial. Cancel any time from your Shopify admin.
          </li>
        </ul>
      </div>
    </div>
  );
}
