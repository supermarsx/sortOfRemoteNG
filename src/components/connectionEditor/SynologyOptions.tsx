import React from "react";
import type { Connection } from "../../types/connection/connection";
import {
  normalizeSynologySettings,
  setSynologyAccessMode,
} from "../../types/protocols/synology";
import { Select } from "../ui/forms";

export default function SynologyOptions({
  formData,
  setFormData,
}: {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}) {
  const settings = normalizeSynologySettings(
    formData.synologySettings ?? {
      version: 1,
      useHttps: formData.protocol !== "http",
    },
  );
  const native = formData.protocol === "synology";
  return (
    <section
      className="space-y-3 rounded-lg border border-[var(--color-border)] p-3"
      data-setting-key="synology-access"
    >
      <h3 className="text-sm font-medium">Synology access</h3>
      <label className="block text-sm">
        Access mode
        <Select
          label="Synology access mode"
          value={native ? "native" : "website"}
          options={[
            { value: "native", label: "Native File Station" },
            { value: "website", label: "DSM website (interactive sign-in)" },
          ]}
          onChange={(value) =>
            setFormData((previous) =>
              setSynologyAccessMode(
                { ...previous, synologySettings: settings },
                value === "native" ? "native" : "website",
              ),
            )
          }
        />
      </label>
      {native && (
        <label className="block text-sm">
          Transport
          <Select
            label="Synology transport"
            value={settings.useHttps ? "https" : "http"}
            options={[
              { value: "https", label: "HTTPS — verified system certificates" },
              {
                value: "http",
                label: "HTTP — unencrypted (trusted networks only)",
              },
            ]}
            onChange={(value) =>
              setFormData((previous) => ({
                ...previous,
                synologySettings: { version: 1, useHttps: value === "https" },
                port:
                  previous.port === 5000 ||
                  previous.port === 5001 ||
                  !previous.port
                    ? value === "https"
                      ? 5001
                      : 5000
                    : previous.port,
              }))
            }
          />
        </label>
      )}
      <p className="text-xs text-[var(--color-textSecondary)]">
        Native File Station uses the saved username/password and asks for
        one-time codes interactively. Codes are never saved. Native proxy/VPN
        routes and browser certificate overrides are not supported; configured
        overrides are refused, not ignored. Website sign-in does not unlock the
        native API.
      </p>
    </section>
  );
}
