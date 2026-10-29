import Link from "next/link";

import { ThemeToggle } from "@/components/theme/ThemeProvider";
import { Wordmark } from "@/components/site/Wordmark";

/**
 * Site chrome shared by the marketing pages and the app.
 *
 * Doc 02 §26: the public site's job is to explain and convince, and its CTA must
 * enter the app WITHOUT login. So the header carries exactly one primary action
 * and it points at `/analyze` — there is no sign-in to route a judge through.
 *
 * A Server Component: it has no state of its own, and the only interactive part
 * (the theme toggle) is the client island inside it.
 */

const NAV = [
  { href: "/#problem", label: "The problem" },
  { href: "/#how", label: "How it works" },
  { href: "/#qloo", label: "Qloo" },
  { href: "/examples", label: "Examples" },
] as const;

export function SiteHeader() {
  return (
    <header className="cd-header">
      <div className="cd-container cd-header__inner">
        <Link href="/" className="cd-header__brand" aria-label="CreatorsDNA home">
          <Wordmark />
        </Link>

        <nav className="cd-header__nav" aria-label="Primary">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="cd-header__link">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="cd-header__actions">
          <ThemeToggle />
          <Link href="/analyze" className="cd-button cd-button--primary cd-button--sm">
            Map your taste DNA
          </Link>
        </div>
      </div>
    </header>
  );
}
