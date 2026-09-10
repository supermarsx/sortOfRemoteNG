import React from "react";
import type { Connection } from "../../types/connection/connection";
import {
  normalizeSynologySettings,
  setSynologyAccessMode,
  isSynologyFileConnection,
} from "../../types/protocols/synology";
import { Select, PasswordInput } from "../ui/forms";
import { resolveHttpBasicCredentials } from "../../utils/auth/httpCredentials";

export default function SynologyOptions({
  formData,
  setFormData,
}: {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}) {
  const savedSettings = normalizeSynologySettings(
    formData.synologySettings ?? {
      version: 1,
      useHttps: formData.protocol !== "http",
    },
  );
  const settings = {
    ...savedSettings,
    useHttps:
      formData.protocol === "http"
        ? false
        : formData.protocol === "https"
          ? true
          : savedSettings.useHttps,
  };
  const native = isSynologyFileConnection(formData);
  const credentials = resolveHttpBasicCredentials({
    ...formData,
    authType: "basic",
  });
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
            { value: "native", label: "Synology NAS API" },
            { value: "website", label: "Website — DSM in browser" },
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
                protocol: value === "https" ? "https" : "http",
                synologySettings: {
                  version: 1,
                  useHttps: value === "https",
                  accessMode: "native",
                },
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
      {native && (
        <div className="grid max-w-2xl gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            DSM username
            <input
              aria-label="DSM API username"
              className="sor-form-input"
              autoComplete="off"
              value={credentials?.username ?? ""}
              onChange={(event) =>
                setFormData((previous) => ({
                  ...previous,
                  basicAuthUsername: event.target.value,
                  basicAuthPassword: credentials?.password ?? "",
                }))
              }
            />
          </label>
          <label className="space-y-1 text-sm">
            DSM password
            <PasswordInput
              aria-label="DSM API password"
              autoComplete="new-password"
              value={credentials?.password ?? ""}
              onChange={(event) =>
                setFormData((previous) => ({
                  ...previous,
                  basicAuthUsername: credentials?.username ?? "",
                  basicAuthPassword: event.target.value,
                }))
              }
            />
          </label>
        </div>
      )}
      <p className="text-xs text-[var(--color-textSecondary)]">
        Synology NAS API provides File Station and supported NAS administration
        tools, subject to account permissions and installed packages. It uses
        the saved username/password and asks for one-time codes interactively.
        Codes are never saved. Native proxy/VPN routes and browser certificate
        overrides are not supported; configured overrides are refused, not
        ignored. Website sign-in does not unlock the native API.
      </p>
    </section>
  );
}
