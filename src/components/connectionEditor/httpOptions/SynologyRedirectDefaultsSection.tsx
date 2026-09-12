import React from "react";
import { CheckboxField } from "../../ui/forms";
import { normalizeSynologySettings } from "../../../types/protocols/synology";
import {
  synologyDefaultRedirectOrigins,
  synologyRedirectDefaultsForConnection,
} from "../../../utils/protocol/synologyRedirectDefaults";
import type { Mgr } from "./types";

/** Draft preference only; the runtime derives and fences its own origin context. */
export default function SynologyRedirectDefaultsSection({ mgr }: { mgr: Mgr }) {
  let context;
  let settings;
  try {
    settings = normalizeSynologySettings(mgr.formData.synologySettings);
    context = synologyRedirectDefaultsForConnection({
      ...mgr.formData,
      synologySettings: { ...settings, useDefaultRedirectDestinations: true },
    });
  } catch {
    if (mgr.formData.httpApplication?.id !== "synology-dsm") return null;
    return (
      <p role="alert" className="text-xs text-error">
        Review the Synology address and saved settings before changing default
        redirect permissions.
      </p>
    );
  }
  if (!context) return null;
  const enabled = settings.useDefaultRedirectDestinations !== false;
  return (
    <section className="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
      <CheckboxField
        variant="form"
        label="Use Synology default redirect destinations"
        checked={enabled}
        description="On by default. Allows anonymous handoffs to these exact destinations and, for a recognized original NAS alias, initial discovery through the app proxy at https://global.quickconnect.to/Serv.php. Require HTTPS upstream still blocks HTTP. Saved-login forwarding always needs separate approval."
        onChange={(useDefaultRedirectDestinations) =>
          mgr.setFormData((previous) => {
            try {
              const current = normalizeSynologySettings(
                previous.synologySettings,
              );
              if (
                !synologyRedirectDefaultsForConnection({
                  ...previous,
                  synologySettings: {
                    ...current,
                    useDefaultRedirectDestinations: true,
                  },
                })
              )
                return previous;
              return {
                ...previous,
                synologySettings: {
                  ...current,
                  useDefaultRedirectDestinations,
                },
              };
            } catch {
              return previous;
            }
          })
        }
      />
      <ul
        aria-label="Synology default redirect destinations"
        className="space-y-1 text-xs"
      >
        {synologyDefaultRedirectOrigins(context.originalOrigin).map(
          (origin) => (
            <li
              key={origin}
              className="break-all rounded border border-[var(--color-border)] px-3 py-2"
            >
              <span className="font-mono">{origin}</span>
              <span className="ml-2 text-[var(--color-textSecondary)]">
                {!enabled
                  ? "Default disabled"
                  : origin.startsWith("http:") &&
                      mgr.formData.httpProxyPolicy?.httpsOnly
                    ? "Blocked by Require HTTPS upstream"
                    : "Built-in default"}
              </span>
            </li>
          ),
        )}
      </ul>
      <p className="text-xs text-[var(--color-textSecondary)]">
        This list is derived from the original connection, not saved as
        individual trust entries. Disabling it does not remove destinations you
        explicitly trusted below or in Trust Center; those follow the general
        redirect policy. Only the initial get_server_info discovery POST is
        included; other APIs, tunnel requests, wakeup calls and NAS address
        probes need separate routing. No cookies, passwords, general resource
        origins or certificate exceptions are granted. Save the connection to
        retain this preference.
      </p>
    </section>
  );
}
