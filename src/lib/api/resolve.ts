import type { DataSource, SearchResultSet } from "@/lib/contracts/domain";

/**
 * The shared shape of `POST /api/qloo/resolve`.
 *
 * Declared here rather than in the route file because the review stage needs the
 * type and a route handler must never end up in a browser bundle — importing a
 * TYPE from one is legal but invites importing a value from it. Same reasoning as
 * `src/lib/api/schemas.ts`, and for the same reason this module holds no secrets
 * and no `process.env` read, so it is not `server-only`.
 */

/**
 * What the catalogue did with one phrase.
 *
 * A verdict about the SEARCH, never a decision about the creator's intent.
 * `multiple` is the interesting case: it means the phrase is real but ambiguous,
 * and doc 02 §7 requires that all matches be presented rather than one chosen.
 */
export type ResolveStatus = "matched" | "multiple" | "none" | "error";

export interface ResolveEntry {
  /** The phrase exactly as it was sent, so the client can match it back up. */
  phrase: string;
  status: ResolveStatus;
  /** Every match the catalogue returned, in its own order. Never truncated to one. */
  matches: SearchResultSet["matches"];
  /** Present for `error`, so a failed lookup is not reported as "no match". */
  message?: string;
}

export interface ResolveResponse {
  results: ResolveEntry[];
  source: DataSource;
}
