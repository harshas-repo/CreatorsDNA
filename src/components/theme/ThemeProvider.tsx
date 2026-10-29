"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Theme switching (doc 01 §39: the theme must be swappable; doc 05 §16 keeps the
 * tokens as the single source so swapping is a data-theme attribute, not a
 * rewrite).
 *
 * Split into two pieces on purpose:
 *
 *  - `ThemeScript` renders a blocking inline script that sets `data-theme` on
 *    <html> BEFORE first paint. Without it, a visitor who chose dark sees a
 *    white flash on every navigation.
 *  - `ThemeToggle` is the interactive control. It reads the attribute the script
 *    already wrote rather than holding its own idea of the truth, so server and
 *    client can never disagree during hydration.
 *
 * The preference is persisted in localStorage and falls back to
 * `prefers-color-scheme`, so a first-time visitor gets the OS setting and a
 * returning visitor gets their own choice.
 */

const STORAGE_KEY = "creatorsdna-theme";

export type Theme = "light" | "dark";

/**
 * Inlined as a string rather than imported, because it must run before React
 * hydrates and therefore cannot depend on the module graph.
 */
const BOOT_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});var t=s==="light"||s==="dark"?s:(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />;
}

function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export function ThemeToggle({ className }: { className?: string }) {
  // Seeded as `undefined` and resolved in an effect: the server cannot know the
  // stored preference, and guessing "light" would flash the wrong icon.
  const [theme, setTheme] = useState<Theme | undefined>(undefined);

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = (current ?? readTheme()) === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Private browsing / disabled storage. The attribute still applies for
        // this session, so the control keeps working; it just will not persist.
      }
      return next;
    });
  }, []);

  const resolved = theme ?? "light";

  return (
    <button
      type="button"
      onClick={toggle}
      className={className ?? "cd-theme-toggle"}
      aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} theme`}
      aria-pressed={resolved === "dark"}
      title={theme === undefined ? "Theme" : `Theme: ${resolved}`}
    >
      <span aria-hidden="true" className="cd-theme-toggle__icon">
        {resolved === "dark" ? <MoonIcon /> : <SunIcon />}
      </span>
      <span className="cd-sr-only">{resolved === "dark" ? "Dark" : "Light"} theme active</span>
    </button>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="4.25" />
      <path
        strokeLinecap="round"
        d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z" />
    </svg>
  );
}
