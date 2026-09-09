import React from "react";
import { ExternalLink } from "lucide-react";
import type { SectionProps } from "./types";

/** Guidance, not an inferred login state or a second credential collector. */
export default function ApplicationSignInNotice({ mgr }: SectionProps) {
  if (!mgr.isCloudflareDashboard) return null;
  return (
    <section
      aria-label="Cloudflare sign-in and two-factor authentication"
      className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">
          Cloudflare: interactive sign-in &amp; 2FA
        </span>
        <button
          type="button"
          className="sor-btn-secondary inline-flex items-center gap-2"
          disabled={mgr.openingApplicationExternal}
          onClick={() => void mgr.handleOpenApplicationExternal()}
          title="Open the real HTTPS dashboard outside this app's proxy; no saved credentials are passed"
        >
          <ExternalLink size={14} aria-hidden="true" />
          {mgr.openingApplicationExternal
            ? "Opening system browser…"
            : "Open Cloudflare in system browser"}
        </button>
      </div>
      <details className="mt-1 text-xs text-[var(--color-textSecondary)] max-w-4xl">
        <summary className="cursor-pointer">
          Authenticator codes, security keys, SSO, and browser compatibility
        </summary>
        <p className="mt-2">
          Enter authenticator or Cloudflare email codes directly in the website.
          The toolbar's 2FA Codes panel can copy a code from an already
          configured authenticator; nothing is filled or submitted
          automatically.
        </p>
        <p className="mt-2">
          Security keys, Windows Hello, social login, SSO, and browser
          challenges may need the real website origin in your system browser.
          Embedded browser support is limited.
        </p>
        <p className="mt-2">
          The external browser uses separate cookies and its own network route
          and TLS policy—not this app's proxy, trust settings, or saved
          passwords. Signing in there does not sign in this tab.
        </p>
      </details>
    </section>
  );
}
