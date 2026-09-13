import React from "react";
import { ExternalLink } from "lucide-react";
import type { SectionProps } from "./types";

/** Guidance, not an inferred login state or a second credential collector. */
export default function ApplicationSignInNotice({ mgr }: SectionProps) {
  const target = mgr.applicationExternalTarget;
  if (!target) return null;
  return (
    <section
      aria-label={`${target.label} sign-in and two-factor authentication`}
      className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs"
    >
      <details key={target.url}>
        <summary className="cursor-pointer text-[var(--color-textSecondary)]">
          {target.label} · Sign-in &amp; 2FA help
        </summary>
        <div className="max-h-52 max-w-4xl space-y-2 overflow-y-auto py-2 text-[var(--color-textSecondary)]">
          <p>
            The external browser uses separate cookies and its own network route
            and TLS policy—not this app's proxy, trust settings, or saved
            passwords. Signing in there does not sign in this tab.
          </p>
          <button
            type="button"
            className="sor-btn sor-btn-secondary inline-flex items-center gap-2"
            disabled={mgr.openingApplicationExternal}
            onClick={() => void mgr.handleOpenApplicationExternal()}
            data-tooltip="Open the saved website's real HTTPS origin outside this app's proxy; no saved credentials are passed"
          >
            <ExternalLink size={14} aria-hidden="true" />
            {mgr.openingApplicationExternal
              ? "Opening system browser…"
              : `Open ${target.label} in system browser`}
          </button>
          <p className="mt-2">
            Complete unsupported authenticator, email, SMS or approval prompts
            in the website. The toolbar's 2FA Codes panel offers manual copying;
            automatic codes require a separate saved opt-in for a supported
            challenge. This does not enroll an account or create recovery codes.
          </p>
          <p className="mt-2">
            YubiKey and other WebAuthn security keys, passkeys and Windows Hello
            require the website's real relying-party origin. Use the system
            browser, not this localhost proxy. Social login, SSO and browser
            challenges may also need that browser. No hardware key is emulated
            and no private key is passed to the website.
          </p>
          <p className="mt-2 break-all">
            External destination: {target.url}. Current page queries and sign-in
            callbacks are not copied.
          </p>
        </div>
      </details>
    </section>
  );
}
