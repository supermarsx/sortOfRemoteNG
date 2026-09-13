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
  const alias = synologyDefaultRedirectOrigins(
    context.originalOrigin,
  )[0]?.match(/^http:\/\/([a-z0-9-]+)\.quickconnect\.to$/)?.[1];
  return (
    <section className="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
      <CheckboxField
        variant="form"
        label="Use Synology default redirect destinations"
        checked={enabled}
        description="On by default. Allows anonymous handoffs to these destinations and, for a recognized original NAS alias, initial discovery through the app proxy at https://global.quickconnect.to/Serv.php, verified regional discovery, bounded relay setup and same-NAS direct checks. Require HTTPS upstream still blocks HTTP. Saved-login forwarding always needs separate approval."
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
      {alias && (
        <p className="break-all text-xs text-[var(--color-textSecondary)]">
          {enabled ? "Also permits" : "Disabled"}: same-NAS regional HTTPS
          portals{" "}
          <span className="font-mono">
            {alias}.&lt;region&gt;.quickconnect.to
          </span>{" "}
          on port 443, where the region is two lowercase letters followed by
          digits. This includes returning to the original region, not another
          NAS alias.
        </p>
      )}
      {alias && (
        <p className="break-all text-xs text-[var(--color-textSecondary)]">
          {enabled ? "Also permits" : "Disabled"}: same-NAS direct HTTPS
          endpoints{" "}
          <span className="font-mono">{alias}.direct.quickconnect.to</span> and
          one DNS label beneath it, only on ports 5001 or 5002. Each navigation
          uses a fresh anonymous proxy and independent certificate checks; other
          NAS aliases, HTTP and other ports are not included.
        </p>
      )}
      <p className="text-xs text-[var(--color-textSecondary)]">
        This list is derived from the original connection, not saved as
        individual trust entries. Disabling it does not remove destinations you
        explicitly trusted below or in Trust Center; those follow the general
        redirect policy. Supported requests are bounded get_server_info
        discovery POSTs, selected-NAS regional request_tunnel relay setup for
        mainapp_https or mainapp_http, and exact same-NAS pingpong reachability
        GETs. Control POSTs are limited to HTTPS port 443 at
        &lt;single-label&gt;.quickconnect.to/Serv.php with the original NAS
        alias and current document. Direct probes still require targets learned
        from verified discovery responses. Relay setup is sent once, never to
        global. Other APIs, relay subresources and wakeup calls need separate
        routing. No cookies, passwords, arbitrary destinations or certificate
        exceptions are granted. Save the connection to retain this preference.
      </p>
    </section>
  );
}
