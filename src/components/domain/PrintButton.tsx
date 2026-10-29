"use client";

import { useCallback, useRef, useState } from "react";

/**
 * The one piece of interactivity in a document view: save the media kit to the
 * local drive as a PDF.
 *
 * Its own file because `MediaKit` is a Server Component and the browser APIs below
 * are not available during server rendering. Splitting it out keeps the kit out of
 * the client bundle apart from these few lines.
 *
 * WHY NOT `window.print()`
 * ------------------------
 * It used to open the print dialog and rely on the reader picking "Save as PDF" as
 * the destination. That is a dialog we do not control, one extra decision on the way
 * to a file, and on some setups it offers only a printer. The brief is a file on
 * disk, so this renders the kit straight to a PDF and triggers a download: one
 * click, a named `.pdf` in the downloads folder, no dialog.
 *
 * The generator (`html2pdf.js` — it rasterises the DOM through `html2canvas`, then
 * lays the pages with `jsPDF`) is imported dynamically, so its weight is fetched on
 * the first click and never shipped to someone who does not save a kit. The output
 * is an image-based PDF: it looks exactly like the screen, at the cost of text that
 * is not selectable. That is an acceptable trade for a one-page document a brand
 * reads and forwards, and it is why the disclosures live in the kit's content flow
 * rather than being added as PDF annotations that a raster pass would drop.
 */
export interface PrintButtonProps {
  /** Button label in the idle state. */
  label?: string;
  className?: string;
  /** File name for the download. Derived from the kit's heading when omitted. */
  filename?: string;
}

/**
 * Screen chrome that must never land in the saved file.
 *
 * `@media print` already hides the toolbar, but `html2canvas` captures the SCREEN,
 * not the print rendering, so it is excluded here too — a PDF must not carry the
 * button that produced it.
 */
function isExcludedFromPdf(element: Element): boolean {
  return element.classList.contains("cd-kit__toolbar");
}

/**
 * A file name from the creator's own heading, so the download is recognisable
 * ("jordan-lee-media-kit.pdf") rather than a generic string. Falls back when the kit
 * carries no readable name.
 */
function filenameFromKit(kit: HTMLElement): string {
  const name = kit.querySelector(".cd-kit__name")?.textContent?.trim() ?? "";
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? `${slug}-media-kit.pdf` : "creatorsdna-media-kit.pdf";
}

export function PrintButton({ label = "Save as PDF", className, filename }: PrintButtonProps) {
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const buttonRef = useRef<HTMLButtonElement>(null);

  const save = useCallback(async (): Promise<void> => {
    // The button renders both inside the kit's own toolbar and in a bar beside it
    // (the analyze flow's kit stage), so reach the document by class: `closest`
    // covers the first case and the page-wide query the second. There is only ever
    // one `.cd-kit` on screen.
    const kit =
      buttonRef.current?.closest<HTMLElement>(".cd-kit") ??
      document.querySelector<HTMLElement>(".cd-kit");

    if (kit === null) {
      setState("error");
      return;
    }

    setState("working");
    try {
      const { default: html2pdf } = await import("html2pdf.js");
      // Held in a variable rather than inlined so the extra `pagebreak` key — which
      // the bundled type does not list, though the library honours it — is not
      // rejected as an excess property. The `as const` casts keep the string and
      // tuple literals narrow enough for the options it DOES declare.
      const options = {
        filename: filename ?? filenameFromKit(kit),
        margin: [12, 10, 14, 10] as [number, number, number, number],
        image: { type: "jpeg" as const, quality: 0.96 },
        html2canvas: { scale: 2, useCORS: true, ignoreElements: isExcludedFromPdf },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" as const },
        pagebreak: { mode: ["avoid-all", "css", "legacy"] },
      };
      await html2pdf().set(options).from(kit).save();
      setState("idle");
    } catch {
      setState("error");
    }
  }, [filename]);

  const text =
    state === "working"
      ? "Preparing PDF…"
      : state === "error"
        ? "Could not save — try again"
        : label;

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`cd-button cd-button--ghost${className ? ` ${className}` : ""}`}
      onClick={() => void save()}
      disabled={state === "working"}
      aria-busy={state === "working" ? "true" : undefined}
    >
      {text}
    </button>
  );
}
