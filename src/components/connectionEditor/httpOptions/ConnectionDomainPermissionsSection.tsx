import React from "react";
import { LoaderCircle } from "lucide-react";
import { useSettings } from "../../../contexts/SettingsContext";
import { normalizeWebBrowserSettings } from "../../../utils/settings/webBrowserSettings";
import { OriginConnectionPermissions } from "../../SettingsDialog/sections/webBrowser/OriginBrowserPreferences";
import type { Mgr } from "./types";

/** Draft-only overrides; inherited shared rules are never copied into the connection. */
export default function ConnectionDomainPermissionsSection({
  mgr,
}: {
  mgr: Mgr;
}) {
  const { settings, settingsReady } = useSettings();
  if (settingsReady === false)
    return (
      <p
        role="status"
        className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm text-[var(--color-textSecondary)]"
      >
        <LoaderCircle
          size={16}
          aria-hidden="true"
          className="shrink-0 animate-spin motion-reduce:animate-none text-primary"
        />
        Loading shared website request permissions…
      </p>
    );
  let config;
  try {
    config = normalizeWebBrowserSettings(settings.webBrowser);
  } catch {
    return (
      <p
        role="alert"
        className="sor-alert-error text-sm text-[var(--color-text)]"
      >
        Shared browser settings are invalid. Correct them in Web Browser
        settings before editing inherited website permissions.
      </p>
    );
  }
  return (
    <OriginConnectionPermissions
      settings={mgr.formData.websiteDomainPermissions}
      sharedSettings={config.domainPermissions}
      onChange={(websiteDomainPermissions) =>
        mgr.setFormData((previous) =>
          previous.id !== mgr.formData.id
            ? previous
            : { ...previous, websiteDomainPermissions },
        )
      }
    />
  );
}
