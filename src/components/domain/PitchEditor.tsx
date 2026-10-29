"use client";

import { useEffect, useId, useMemo, useState } from "react";

import { EDITED_PITCH_DISCLOSURE, findHonestyViolations } from "@/lib/copy/honesty";

/**
 * `PitchEditor` (doc 02 §30) — the outreach draft a creator sends to a brand.
 *
 * The draft arrives ALREADY GENERATED, from `draftPitch()` on the server. That
 * keeps generation on one code path: the same templates produce the pitch whether
 * or not JavaScript has hydrated, so a creator who copies the text before
 * hydration gets the same words as one who copies it after.
 *
 * THE EDITING PROBLEM
 * -------------------
 * A generated pitch is safe by construction — every sentence is a deterministic
 * function of values already on screen. The moment a creator can type in the box,
 * that guarantee is gone, and this is the one place in the product where an
 * unverifiable claim can leave the building with our name attached to it. Doc 01
 * §37 and fact F13 forbid "N% of my audience…", but a human writing their own
 * email is not bound by our templates.
 *
 * So the editor re-checks the text against `FORBIDDEN_PATTERNS` as it is typed
 * and says what it found, in plain words, with the reason. It does NOT block the
 * export — refusing to let a creator copy their own email is paternalistic, and
 * they would paste it from the textarea anyway. Instead, when the text trips a
 * rule the exported copy carries an explicit disclosure that the claims were
 * added by hand and are unverified. That keeps the creator in control and keeps
 * the reader of the pitch informed, which is the only combination that is honest
 * to both.
 */

export interface PitchEditorProps {
  /** Produced by `draftPitch()`. Treated as the reset point. */
  draft: string;
  brandName: string;
  /**
   * `voice.illustrativeNotice`, resolved server-side. Passed in rather than
   * derived here because the voice is a property of the data source, and the
   * component has no business deciding that on its own.
   */
  illustrativeNotice?: string;
  /** Called with the exact string placed on the clipboard. */
  onCopied?: (exported: string) => void;
  className?: string;
}

type CopyState = "idle" | "copied" | "failed";

export function PitchEditor({
  draft,
  brandName,
  illustrativeNotice,
  onCopied,
  className,
}: PitchEditorProps) {
  const [text, setText] = useState(draft);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  // Generated rather than hardcoded: the brand-detail view can mount one editor
  // per brand, and duplicate ids would make `aria-describedby` point at whichever
  // came first in the document.
  const statusId = useId();

  const violations = useMemo(() => findHonestyViolations(text), [text]);
  const edited = text !== draft;
  const words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;

  /**
   * The disclosure is appended only when the text was BOTH edited and found to
   * trip a rule. Gating on the violation alone would print "edited by the
   * creator" over an untouched draft — and if a generated draft ever did trip a
   * rule, that would be a bug in a template, not something a disclosure should
   * paper over.
   */
  const needsDisclosure = edited && violations.length > 0;
  const exported = needsDisclosure ? `${text.trimEnd()}\n\n${EDITED_PITCH_DISCLOSURE}` : text;

  // Clear the "Copied" confirmation so a second copy is visibly a second event
  // rather than a stale label the creator has to trust.
  useEffect(() => {
    if (copyState !== "copied") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 4000);
    return () => window.clearTimeout(timer);
  }, [copyState, text]);

  async function copy() {
    // `navigator.clipboard` is undefined outside a secure context, so the
    // optional call is checked explicitly rather than relying on a throw.
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyState("failed");
      return;
    }
    try {
      await navigator.clipboard.writeText(exported);
      setCopyState("copied");
      onCopied?.(exported);
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section className={`cd-pitch${className ? ` ${className}` : ""}`} aria-label={`Pitch draft for ${brandName}`}>
      <header className="cd-pitch__head">
        <div>
          <span className="cd-eyebrow">Outreach draft</span>
          <h3 className="cd-pitch__title">To {brandName}</h3>
        </div>
        <p className="cd-pitch__provenance">
          Template-generated from your analysis. No language model wrote or rewrote this.
        </p>
      </header>

      {illustrativeNotice ? (
        <p className="cd-viz__synthetic" role="note">
          {illustrativeNotice}
        </p>
      ) : null}

      <textarea
        className="cd-pitch__textarea"
        value={text}
        rows={18}
        aria-describedby={statusId}
        onChange={(event) => {
          setText(event.target.value);
          if (copyState !== "idle") setCopyState("idle");
        }}
      />

      <p className="cd-pitch__status" id={statusId} role="status">
        <span className="cd-tabular">{words}</span> {words === 1 ? "word" : "words"}
        {edited ? <span className="cd-pitch__edited">Edited from the generated draft</span> : null}
      </p>

      {violations.length > 0 ? (
        <div className="cd-pitch__violations" role="alert">
          <p className="cd-pitch__violations-title">
            {violations.length === 1 ? "One claim" : `${violations.length} claims`} in this draft cannot be
            supported by the analysis
          </p>
          <ul>
            {violations.map((violation, index) => (
              <li key={`${index}|${violation.pattern}`}>
                <span>{violation.why}</span>
                <code>{violation.pattern}</code>
              </li>
            ))}
          </ul>
          <p className="cd-pitch__violations-note">
            {edited
              ? "You can still copy the pitch. A disclosure will be appended stating that the claims were added by hand and are unverified."
              : "This came from the generated draft rather than your edits, which means a template is at fault. Please report it."}
          </p>
        </div>
      ) : null}

      <div className="cd-pitch__actions">
        <button type="button" className="cd-button cd-button--primary" onClick={() => void copy()}>
          {copyState === "copied" ? "Copied" : needsDisclosure ? "Copy with disclosure" : "Copy pitch"}
        </button>

        {edited ? (
          <button
            type="button"
            className="cd-button cd-button--ghost"
            onClick={() => {
              setText(draft);
              setCopyState("idle");
            }}
          >
            Reset to generated draft
          </button>
        ) : null}
      </div>

      {copyState === "failed" ? (
        <p className="cd-pitch__copy-failed" role="alert">
          The clipboard is not available in this browser context. Use the plain-text copy below and select it
          manually.
        </p>
      ) : null}

      {/* Always present, not only on clipboard failure. A creator on a browser
          where the async clipboard is blocked still needs the text, and
          `document.execCommand("copy")` is deprecated enough that falling back
          to it would trade one problem for another. */}
      <details className="cd-pitch__plain">
        <summary>Plain text{needsDisclosure ? " (with disclosure)" : ""}</summary>
        <pre className="cd-pitch__pre">{exported}</pre>
      </details>
    </section>
  );
}
