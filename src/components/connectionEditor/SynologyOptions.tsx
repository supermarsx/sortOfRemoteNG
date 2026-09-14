import React from "react";
import type { Connection } from "../../types/connection/connection";
import {
  normalizeSynologySettings,
  setSynologyAccessMode,
  isSynologyFileConnection,
} from "../../types/protocols/synology";
import { Select, PasswordInput, CheckboxField } from "../ui/forms";
import { resolveHttpBasicCredentials } from "../../utils/auth/httpCredentials";
import { normalizeHttpProxyPolicy } from "../../utils/connection/httpProxyPolicy";

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
  const website =
    !native &&
    (formData.protocol === "http" || formData.protocol === "https") &&
    formData.httpApplication?.id === "synology-dsm";
  let proxyPolicy: ReturnType<typeof normalizeHttpProxyPolicy> | null = null;
  if (website) {
    try {
      proxyPolicy = normalizeHttpProxyPolicy(formData.httpProxyPolicy);
    } catch {
      // Do not repair malformed saved security controls through an alias.
    }
  }
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
      {website && (
        <div className="space-y-2">
          <CheckboxField
            variant="form"
            label="Allow reviewed redirects to another address"
            aria-label="Allow reviewed redirects to another address"
            checked={proxyPolicy?.allowCrossOriginRedirects === true}
            disabled={!proxyPolicy}
            description="Off by default. Review up to five website handoffs individually, with fresh HTTPS trust checks. This does not enable HTTP downgrades or saved-login forwarding. The same setting is available in Advanced."
            onChange={(allowCrossOriginRedirects) =>
              setFormData((previous) => {
                if (
                  isSynologyFileConnection(previous) ||
                  !["http", "https"].includes(previous.protocol ?? "") ||
                  previous.httpApplication?.id !== "synology-dsm"
                )
                  return previous;
                try {
                  const current = normalizeHttpProxyPolicy(
                    previous.httpProxyPolicy,
                  );
                  return {
                    ...previous,
                    httpProxyPolicy: { ...current, allowCrossOriginRedirects },
                  };
                } catch {
                  return previous;
                }
              })
            }
          />
          <CheckboxField
            variant="form"
            label="Allow insecure redirects — review each HTTPS-to-HTTP handoff"
            aria-label="Allow insecure redirects"
            checked={proxyPolicy?.allowHttpDowngradeRedirects === true}
            disabled={!proxyPolicy || proxyPolicy.httpsOnly}
            onChange={(enabled) =>
              setFormData((previous) => {
                if (
                  isSynologyFileConnection(previous) ||
                  !["http", "https"].includes(previous.protocol ?? "") ||
                  previous.httpApplication?.id !== "synology-dsm"
                )
                  return previous;
                try {
                  const current = normalizeHttpProxyPolicy(
                    previous.httpProxyPolicy,
                  );
                  if (enabled && current.httpsOnly) return previous;
                  return {
                    ...previous,
                    httpProxyPolicy: {
                      ...current,
                      allowHttpDowngradeRedirects: enabled,
                      allowCrossOriginRedirects:
                        enabled || current.allowCrossOriginRedirects === true,
                    },
                  };
                } catch {
                  return previous;
                }
              })
            }
          />
          <p className="text-xs text-[var(--color-textSecondary)]">
            DSM website only. Also enables reviewed cross-origin redirects in
            Advanced. Every handoff still requires your approval; continue in
            this tab or open an anonymous HTTP tab. Authentication is stripped
            unless saved-login forwarding is separately enabled and approved in
            Advanced. Cookies, form bodies, custom headers and query parameters
            are not carried over. Leave this off unless an HTTP reverse-proxy
            handoff is necessary.
          </p>
          {!proxyPolicy ? (
            <p role="alert" className="text-xs text-error">
              The saved proxy controls are invalid. Review Advanced → Internal
              proxy controls before changing redirect permissions.
            </p>
          ) : proxyPolicy.httpsOnly ? (
            <p role="status" className="text-xs text-warning">
              Require HTTPS upstream in Advanced blocks insecure redirects and
              takes precedence. This checkbox does not turn that protection off.
            </p>
          ) : proxyPolicy.allowHttpDowngradeRedirects &&
            !proxyPolicy.allowCrossOriginRedirects ? (
            <p role="status" className="text-xs text-warning">
              Reviewed cross-origin redirects are currently off, so insecure
              handoffs remain blocked. Enable reviewed redirects to another
              address above before reviewing a handoff.
            </p>
          ) : null}
        </div>
      )}
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
              className="sor-form-input"
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
        ignored. Website sign-in does not unlock the native API. The website
        redirect exception does not apply to the NAS API; it never forwards an
        authenticated API request to an insecure redirect.
      </p>
    </section>
  );
}
