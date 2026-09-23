import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";

export const loader = () => {
  // A Sentry DSN is a public, write-only ingest key, so handing it to the
  // browser is expected. It is read at request time rather than inlined at
  // build time, because Render supplies it as a runtime env var and the Docker
  // image is built before it exists.
  return {
    // eslint-disable-next-line no-undef
    sentryDsn: process.env.SENTRY_DSN || "",
    // eslint-disable-next-line no-undef
    env: process.env.NODE_ENV || "development",
  };
};

export default function App() {
  const { sentryDsn, env } = useLoaderData<typeof loader>();

  // Runs while the head is parsed, so the values are in place before the
  // client bundle (rendered by <Scripts />) initialises Sentry. Escaping `<`
  // keeps a value from closing the script tag early.
  const sentryConfig = `window.__STOCKLOG_SENTRY_DSN__=${JSON.stringify(
    sentryDsn,
  )};window.__STOCKLOG_ENV__=${JSON.stringify(env)};`.replace(/</g, "\\u003c");

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
        <script dangerouslySetInnerHTML={{ __html: sentryConfig }} />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
