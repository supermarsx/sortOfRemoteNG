import React from "react";
import { CheckboxField } from "../../ui/forms";
import {
  DEFAULT_REDIRECT_AUTHENTICATION,
  normalizeRedirectAuthentication,
  type HttpRedirectAuthentication,
} from "../../../utils/protocol/httpRedirectAuthentication";
import type { Mgr } from "./types";

export default function RedirectAuthenticationOptions({ mgr }: { mgr: Mgr }) {
  let value: HttpRedirectAuthentication;
  try {
    value = normalizeRedirectAuthentication(
      mgr.formData.httpRedirectAuthentication,
    );
  } catch {
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-error">
          Redirect authentication settings are invalid. Login forwarding is
          blocked.
        </p>
        <button
          type="button"
          className="sor-btn-secondary-sm"
          onClick={() =>
            mgr.setFormData((previous) => ({
              ...previous,
              httpRedirectAuthentication: {
                ...DEFAULT_REDIRECT_AUTHENTICATION,
              },
            }))
          }
        >
          Reset redirect authentication
        </button>
      </div>
    );
  }
  const update = (changes: Partial<HttpRedirectAuthentication>) =>
    mgr.setFormData((previous) => ({
      ...previous,
      httpRedirectAuthentication: normalizeRedirectAuthentication({
        ...value,
        ...changes,
      }),
    }));
  return (
    <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
      <CheckboxField
        variant="form"
        checked={value.mode === "saved-login"}
        onChange={(enabled) =>
          update({ mode: enabled ? "saved-login" : "none" })
        }
        label="Carry saved login through reviewed redirects"
        description="Continue in the same tab using saved username/password or application form login. Each destination still needs approval, with at most five handoffs. Off by default; anonymous tabs always strip authentication."
      />
      <CheckboxField
        variant="form"
        checked={value.allowInsecureHttp}
        disabled={
          value.mode !== "saved-login" ||
          mgr.formData.httpProxyPolicy?.httpsOnly === true
        }
        onChange={(allowInsecureHttp) => update({ allowInsecureHttp })}
        label="Allow saved login to be sent to unencrypted HTTP"
        description="Passwords can be read on the network. Each HTTP handoff requires a separate warning acknowledgement. HTTPS-only and redirect restrictions still take precedence."
      />
      <p className="text-xs leading-relaxed text-[var(--color-textSecondary)]">
        Browser cookies, social login sessions, passkeys, authentication
        headers, MFA seeds and scripts are not transferred. A form login may
        sign in again; this does not merge browser sessions.
      </p>
    </div>
  );
}
