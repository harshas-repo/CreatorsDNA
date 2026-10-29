"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { SearchResultSet } from "@/lib/contracts/domain";
import type { ApiErrorBody } from "@/lib/api/respond";
import { EmptyState, ErrorState } from "@/components/ui/States";

/**
 * `SearchEntity` (doc 02 §30) — resolve free text to a cultural entity.
 *
 * This is the single entry point for every signal the analysis uses (doc 03 §8
 * step 1), so three separate rules land on one small component:
 *
 * **Ambiguity is never resolved by us.** Doc 02 §7: when more than one entity
 * matches, all matches are presented and the creator chooses. The response even
 * carries `ambiguous` per match. Auto-picking the top hit would substitute our
 * guess for their intent, and every number downstream would then describe a
 * different thing than the thing they asked about — the error would be invisible
 * because the result would still look plausible.
 *
 * **Identical requests are never repeated.** Doc 02 §32. Two mechanisms, because
 * they solve different problems: an `AbortController` cancels a superseded
 * in-flight request (fast typing would otherwise queue a burst), and a bounded
 * session cache serves a repeat query without touching the network at all
 * (typing "dune", backspacing, typing "dune" again is one call, not three).
 *
 * **Empty is not an error.** `not_found` on search is a legitimate, common
 * outcome and returns HTTP 200 with `matches: []`. Rendering it as a failure
 * would teach creators that the catalogue is broken rather than that their
 * spelling was specific.
 */

/** One match, typed straight off the contract so this cannot drift from it. */
export type SearchMatch = SearchResultSet["matches"][number];

export interface SearchEntityProps {
  /** Used for `<label htmlFor>` and to namespace the option ids. */
  id: string;
  label: string;
  placeholder?: string;
  /** `/search` `types`. Note this list differs from Insights `filter.type`. */
  types?: readonly string[];
  /** Result limit. Doc 02 §32: sensible limits, not the maximum. */
  take?: number;
  /** Below this the box stays idle. 1 char matches almost everything. */
  minimumChars?: number;
  debounceMs?: number;
  /** The match already chosen, so the box can show it and offer a clear. */
  selected?: Pick<SearchMatch["entity"], "id" | "name" | "subtype" | "disambiguation">;
  onSelect: (match: SearchMatch) => void;
  onClear?: () => void;
  disabled?: boolean;
  hint?: string;
  className?: string;
}

type Status = "idle" | "searching" | "done" | "error";

/** Session cache. Bounded so a long onboarding cannot grow it without limit. */
const CACHE_LIMIT = 40;
const sessionCache = new Map<string, SearchResultSet>();

export function SearchEntity({
  id,
  label,
  placeholder = "Search an artist, show, game or topic…",
  types,
  take = 8,
  minimumChars = 2,
  debounceMs = 250,
  selected,
  onSelect,
  onClear,
  disabled = false,
  hint,
  className,
}: SearchEntityProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<SearchResultSet | undefined>(undefined);
  const [error, setError] = useState<{ message: string; recoverable: boolean } | undefined>();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  /** Bumped by the retry affordance. See the comment at `onRetry`. */
  const [attempt, setAttempt] = useState(0);

  const listId = `${id}-listbox`;

  /**
   * `types` is joined into a string rather than used directly in the dependency
   * array. An array literal prop is a new reference on every parent render, so
   * depending on it would restart the debounce on each keystroke of the PARENT
   * and fire a request the debounce was meant to prevent. Depending on the
   * joined value makes the effect stable for a stable list.
   */
  const typesKey = types ? types.join(",") : "";

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < minimumChars) {
      setStatus("idle");
      setResult(undefined);
      setError(undefined);
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    const cacheKey = `${trimmed.toLowerCase()}|${typesKey}|${take}`;
    const cached = sessionCache.get(cacheKey);
    if (cached) {
      // Re-inserting moves it to the newest end of the eviction order.
      sessionCache.delete(cacheKey);
      sessionCache.set(cacheKey, cached);
      setResult(cached);
      setStatus("done");
      setError(undefined);
      setOpen(true);
      setActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    setStatus("searching");
    setError(undefined);

    const timer = setTimeout(() => {
      void runSearch({ trimmed, typesKey, take, controller })
        .then((outcome) => {
          // The effect's cleanup aborts on every change, so a resolution
          // arriving here is either current or already cancelled.
          if (controller.signal.aborted) return;
          if (outcome.kind === "ok") {
            remember(cacheKey, outcome.result);
            setResult(outcome.result);
            setStatus("done");
            setOpen(true);
            setActiveIndex(-1);
          } else {
            setResult(undefined);
            setError(outcome.error);
            setStatus("error");
            setOpen(true);
          }
        })
        .catch(() => {
          /* handled below via the aborted check */
        });
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, minimumChars, typesKey, take, debounceMs, attempt]);

  const matches = useMemo(() => (status === "done" && result ? result.matches : []), [status, result]);

  const commit = useCallback(
    (match: SearchMatch) => {
      onSelect(match);
      setQuery(match.entity.name);
      setOpen(false);
      setActiveIndex(-1);
    },
    [onSelect],
  );

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!open || matches.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? matches.length - 1 : current - 1));
    } else if (event.key === "Enter") {
      const active = activeIndex >= 0 ? matches[activeIndex] : undefined;
      // Enter with nothing highlighted does NOT pick the top hit. Same rule as
      // the ambiguity one: a guess we made silently is a guess the creator
      // cannot see and therefore cannot correct.
      if (active) {
        event.preventDefault();
        commit(active);
      }
    }
  }

  const source = result?.meta.source;

  return (
    <div className={`cd-search${className ? ` ${className}` : ""}`}>
      <label className="cd-search__label" htmlFor={id}>
        {label}
      </label>

      <div className="cd-search__control">
        <input
          id={id}
          type="text"
          className="cd-search__input"
          value={query}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `${id}-opt-${activeIndex}` : undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Deferred so a click on an option registers before the list closes.
            window.setTimeout(() => setOpen(false), 120);
          }}
        />

        {status === "searching" ? <span className="cd-search__spinner" aria-hidden="true" /> : null}

        {selected ? (
          <button
            type="button"
            className="cd-search__clear"
            onClick={() => {
              setQuery("");
              setSelectedCleared();
              onClear?.();
            }}
          >
            Clear
            <span className="cd-sr-only"> the selected entity</span>
          </button>
        ) : null}
      </div>

      {hint ? (
        <p className="cd-search__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}

      {selected ? (
        <p className="cd-search__selected">
          <span className="cd-eyebrow">Selected</span>
          <span>{selected.name}</span>
          {selected.subtype ? <span className="cd-search__subtype">{selected.subtype}</span> : null}
        </p>
      ) : null}

      {open && status !== "idle" ? (
        <div className="cd-search__panel">
          {/* The source banner sits INSIDE the results, not on the page, so it
              cannot be scrolled away from the entries it qualifies. */}
          {source ? (
            <p
              className={
                source.isIllustrative ? "cd-datasource cd-datasource--synthetic" : "cd-datasource cd-datasource--live"
              }
            >
              <span className="cd-datasource__label">{source.label}</span>
              <span className="cd-datasource__body">
                {source.isIllustrative
                  ? "These entries are generated for development. They are not Qloo search results."
                  : "Returned by the Qloo catalogue."}
              </span>
            </p>
          ) : null}

          {status === "searching" ? (
            <p className="cd-search__status" role="status">
              Searching…
            </p>
          ) : null}

          {status === "error" && error ? (
            <ErrorState
              title="That search could not be completed"
              error={{ code: "search_failed", message: error.message, recoverable: error.recoverable }}
              onRetry={() => {
                // Re-running the same effect needs a changed dependency. Setting
                // `query` to itself would not retrigger it, and rewriting the
                // creator's text to force a change would be worse than doing
                // nothing — so the retry is an explicit counter instead.
                // Failures are never cached, so this genuinely refetches.
                setAttempt((current) => current + 1);
              }}
            />
          ) : null}

          {status === "done" && matches.length === 0 ? (
            <EmptyState
              title={`Nothing matched “${query.trim()}”`}
              message="The catalogue has no entry for that exact wording. This is not an error — very specific or newly released subjects often match nothing."
              hint="Try a broader term, a different spelling, or the original title rather than a translation."
            />
          ) : null}

          {matches.length > 0 ? (
            <ul className="cd-search__results" id={listId} role="listbox" aria-label={label}>
              {matches.map((match, index) => (
                <li
                  key={match.entity.id}
                  id={`${id}-opt-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`cd-search__result${index === activeIndex ? " cd-search__result--active" : ""}`}
                >
                  <button type="button" className="cd-search__result-button" onMouseDown={() => commit(match)}>
                    <span className="cd-search__result-name">{match.entity.name}</span>
                    {match.entity.subtype ? (
                      <span className="cd-search__result-subtype">{match.entity.subtype}</span>
                    ) : null}
                    {match.entity.disambiguation ? (
                      <span className="cd-search__result-disambig">{match.entity.disambiguation}</span>
                    ) : null}
                    {match.entity.releaseYear ? (
                      <span className="cd-search__result-year cd-tabular">{match.entity.releaseYear}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {/* Doc 02 §7, stated where the choice is being made. Without it a list
              of four near-identical titles reads as the app being unsure rather
              than as the catalogue genuinely containing four things. */}
          {matches.some((match) => match.ambiguous) ? (
            <p className="cd-search__ambiguous">
              Several entries match that wording. CreatorsDNA will not pick one for you — the whole
              analysis would then be about the wrong thing.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  /** Clears the local echo of the selection without touching the parent's copy. */
  function setSelectedCleared() {
    setResult(undefined);
    setStatus("idle");
  }
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

interface SearchArgs {
  trimmed: string;
  typesKey: string;
  take: number;
  controller: AbortController;
}

async function runSearch({
  trimmed,
  typesKey,
  take,
  controller,
}: SearchArgs): Promise<
  | { kind: "ok"; result: SearchResultSet }
  | { kind: "error"; error: { message: string; recoverable: boolean } }
> {
  const params = new URLSearchParams({ q: trimmed, take: String(take) });
  if (typesKey.length > 0) params.set("types", typesKey);

  let response: Response;
  try {
    response = await fetch(`/api/qloo/search?${params.toString()}`, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
  } catch (cause) {
    if (controller.signal.aborted) return { kind: "error", error: { message: "", recoverable: false } };
    return {
      kind: "error",
      // Doc 02 §33: a useful message, never a stack trace.
      error: {
        message:
          cause instanceof TypeError
            ? "The network could not be reached. Your typed search is still here."
            : "The request was interrupted. Your typed search is still here.",
        recoverable: true,
      },
    };
  }

  if (!response.ok) return { kind: "error", error: await readApiError(response) };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      kind: "error",
      error: { message: "The response was not valid JSON. Nothing was invented in its place.", recoverable: true },
    };
  }

  // Structural guard. The route is typed, but a proxy or an error page in front
  // of it can return HTML with a 200, and `body.matches.map` on that would throw
  // during render rather than showing a recoverable message.
  if (!isSearchResultSet(body)) {
    return {
      kind: "error",
      error: { message: "The response did not contain a match list.", recoverable: true },
    };
  }

  return { kind: "ok", result: body };
}

function isSearchResultSet(value: unknown): value is SearchResultSet {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { matches?: unknown; meta?: unknown };
  return Array.isArray(candidate.matches) && typeof candidate.meta === "object" && candidate.meta !== null;
}

/**
 * Read the shared error envelope from `src/lib/api/respond.ts`.
 *
 * `ApiErrorBody` is imported as a TYPE only, so nothing at runtime reaches the
 * `server-only` module that declares it — the import is erased by the compiler.
 * Duplicating the shape here instead would be the fourth place that has to be
 * updated when the envelope changes.
 */
async function readApiError(response: Response): Promise<{ message: string; recoverable: boolean }> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { message: `The request failed (HTTP ${response.status}).`, recoverable: response.status >= 500 };
  }

  const error = (body as ApiErrorBody | undefined)?.error;
  if (!error || typeof error.message !== "string") {
    return { message: `The request failed (HTTP ${response.status}).`, recoverable: response.status >= 500 };
  }
  return { message: error.message, recoverable: error.recoverable };
}

function remember(key: string, result: SearchResultSet): void {
  // Failed outcomes are never cached, so a transient 429 does not become a
  // permanent empty box for the rest of the session.
  sessionCache.set(key, result);
  while (sessionCache.size > CACHE_LIMIT) {
    const oldest = sessionCache.keys().next();
    if (oldest.done === true) break;
    sessionCache.delete(oldest.value);
  }
}
