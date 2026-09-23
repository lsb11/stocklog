import prisma from "./db.server";
import { HISTORY_PAGE_SIZE } from "./history";

/**
 * Movement history, paged in the database.
 *
 * Keyset (cursor) pagination, not OFFSET. Rows are ordered newest first by
 * (createdAt, id); id breaks ties, because a Shopify sync or a Stocky import
 * writes many rows with the same timestamp and a page boundary that falls
 * inside such a run must not drop or repeat rows. A cursor is the
 * (createdAt, id) of the row at the edge of the current page, so every page,
 * however deep, is one index range scan with a LIMIT:
 *
 *   all movements      -> StockMovement(shop, createdAt, id)
 *   one variant        -> StockMovement(shop, variantId, createdAt, id)
 *
 * Both indexes are created in migration 20260923120000_movement_history_keyset.
 */

export type HistoryCursor = { createdAt: Date; id: string };

export type HistoryRequest = {
  /** Only this variant's movements, when set. */
  variantId: string | null;
  /** Rows older than this cursor (the "Next" direction). */
  after: HistoryCursor | null;
  /** Rows newer than this cursor (the "Previous" direction). Ignored if `after` is set. */
  before: HistoryCursor | null;
};

const movementSelect = {
  id: true,
  variantId: true,
  productTitle: true,
  sku: true,
  quantityDelta: true,
  reason: true,
  orderId: true,
  createdAt: true,
} as const;

/** Opaque, URL-safe cursor. */
export function encodeCursor(row: HistoryCursor): string {
  return Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString("base64url");
}

/** A cursor from the query string, or null if it is missing or malformed. */
export function decodeCursor(raw: string | null): HistoryCursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [iso, id] = parsed;
    if (typeof iso !== "string" || typeof id !== "string" || !id) return null;
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * Rows strictly past the cursor in the given direction, written as
 *   createdAt <= c AND NOT (createdAt = c AND id >= i)      (older)
 * rather than the equivalent OR, so the index's createdAt bound is a plain
 * range condition Postgres can seek to.
 */
function pastCursor(cursor: HistoryCursor, direction: "older" | "newer") {
  return direction === "older"
    ? {
        createdAt: { lte: cursor.createdAt },
        NOT: { createdAt: cursor.createdAt, id: { gte: cursor.id } },
      }
    : {
        createdAt: { gte: cursor.createdAt },
        NOT: { createdAt: cursor.createdAt, id: { lte: cursor.id } },
      };
}

export async function fetchMovementPage(shop: string, req: HistoryRequest) {
  const cursor = req.after ?? req.before;
  const direction = req.after ? "older" : req.before ? "newer" : null;
  const order = direction === "newer" ? "asc" : "desc";

  const rows = await prisma.stockMovement.findMany({
    where: {
      shop,
      ...(req.variantId ? { variantId: req.variantId } : {}),
      ...(cursor && direction ? pastCursor(cursor, direction) : {}),
    },
    orderBy: [{ createdAt: order }, { id: order }],
    // One extra row says whether another page exists past this one.
    take: HISTORY_PAGE_SIZE + 1,
    select: movementSelect,
  });

  const hasMore = rows.length > HISTORY_PAGE_SIZE;
  const page = rows.slice(0, HISTORY_PAGE_SIZE);
  // Walking back toward newer rows reads them oldest first; flip them so the
  // page always renders newest first.
  if (direction === "newer") page.reverse();

  const first = page[0];
  const last = page[page.length - 1];

  return {
    rows: page,
    // Coming from "Next" there is always a newer page behind us; coming from
    // "Previous" there is always an older one ahead.
    nextCursor: last && (direction === "newer" || hasMore) ? encodeCursor(last) : null,
    prevCursor: first && (direction === "older" || (direction === "newer" && hasMore)) ? encodeCursor(first) : null,
  };
}
