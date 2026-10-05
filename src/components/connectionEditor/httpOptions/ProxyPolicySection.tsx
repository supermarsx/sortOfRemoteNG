import React, { useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { CheckboxField, Select, PasswordInput } from "../../ui/forms";
import type { HttpProxyPolicy } from "../../../types/connection/httpProxyPolicy";
import {
  normalizeHttpProxyPolicy,
  normalizeExternalFontOrigins,
} from "../../../utils/connection/httpProxyPolicy";
import type { Mgr } from "./types";
import RedirectAuthenticationOptions from "./RedirectAuthenticationOptions";
import TrustedRedirectDestinationsSection from "./TrustedRedirectDestinationsSection";
import SynologyRedirectDefaultsSection from "./SynologyRedirectDefaultsSection";
import ExternalResourceOriginsEditor from "../../security/ExternalResourceOriginsEditor";

/** Draft-only editor. Native validation is repeated before opening a proxy. */
export default function ProxyPolicySection({ mgr }: { mgr: Mgr }) {
  const id = useId();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [fontOrigin, setFontOrigin] = useState("");
  const [fontError, setFontError] = useState("");
  let policy: HttpProxyPolicy;
  try {
    policy = normalizeHttpProxyPolicy(mgr.formData.httpProxyPolicy);
  } catch {
    return (
      <section className="sor-settings-card space-y-3">
        <h3 className="font-medium">Internal proxy controls</h3>
        <p role="alert" className="text-sm text-error">
          The saved proxy policy is invalid. Opening this connection is blocked
          until it is corrected.
        </p>
        <button
          type="button"
          className="sor-btn-secondary"
          onClick={() =>
            mgr.setFormData((previous) => ({
              ...previous,
              httpProxyPolicy: normalizeHttpProxyPolicy(undefined),
            }))
          }
        >
          Reset proxy controls
        </button>
      </section>
    );
  }
  const update = (change: Partial<HttpProxyPolicy>) => {
    try {
      const next = normalizeHttpProxyPolicy({ ...policy, ...change });
      mgr.setFormData((previous) => ({ ...previous, httpProxyPolicy: next }));
      setError("");
      return true;
    } catch {
      setError(
        "Use unique parameter names (letters, numbers, dot, dash, underscore or tilde). Up to 16 parameters, 4 KB per value, and 16 KB total are allowed; reserved internal names are not allowed.",
      );
      return false;
    }
  };
  const fontOrigins = policy.externalFontOrigins ?? [];
  const fontsDisabled = policy.sameOriginOnly || !policy.allowExternalFonts;
  const updateFontOrigins = (origins: string[]) => {
    try {
      const normalized = normalizeExternalFontOrigins(origins);
      if (!update({ externalFontOrigins: normalized })) return false;
      setFontError("");
      return true;
    } catch {
      setFontError(
        "Use up to 16 unique exact HTTPS origins, at most 2048 bytes each. Paths, queries, fragments, credentials, control characters, backslashes and wildcards are not allowed. Duplicate origins are rejected.",
      );
      return false;
    }
  };
  return (
    <section className="sor-settings-card space-y-4">
      <div>
        <h3 className="font-medium">Internal proxy controls</h3>
        <p className="text-xs text-[var(--color-textMuted)] mt-1">
          Changes start a fresh proxy session. Credentials remain bound to the
          configured origin, and certificate trust is still checked.
        </p>
      </div>
      <div className="flex flex-wrap gap-4">
        <div className="w-64 max-w-full">
          <label htmlFor={`${id}-scripts`} className="block text-sm mb-2">
            Website scripts
          </label>
          <Select
            id={`${id}-scripts`}
            value={policy.pageScripts}
            onChange={(pageScripts) =>
              update({
                pageScripts: pageScripts as HttpProxyPolicy["pageScripts"],
                allowAllScripts: false,
              })
            }
            variant="form"
            options={[
              { value: "allow", label: "Allow website scripts" },
              { value: "inline-only", label: "Block external script files" },
              { value: "block", label: "Block website scripts and automation" },
            ]}
          />
        </div>
        <div className="w-56 max-w-full">
          <label htmlFor={`${id}-cache`} className="block text-sm mb-2">
            HTTP caching
          </label>
          <Select
            id={`${id}-cache`}
            value={policy.cacheMode}
            onChange={(cacheMode) =>
              update({ cacheMode: cacheMode as HttpProxyPolicy["cacheMode"] })
            }
            variant="form"
            options={[
              { value: "normal", label: "Respect server cache settings" },
              { value: "bypass", label: "Bypass cache / no-store" },
            ]}
          />
        </div>
      </div>
      {policy.pageScripts !== "allow" && (
        <p className="text-xs text-warning">
          Script restrictions can stop sign-in and application features.
          External script files includes same-origin files; inline scripts are
          allowed only in the inline-only mode.
        </p>
      )}
      <CheckboxField
        checked={policy.httpsOnly}
        onChange={(httpsOnly) => update({ httpsOnly })}
        label="Require HTTPS upstream"
        description="Refuse HTTP targets and insecure resources. This does not silently change the server's port or bypass certificate errors."
        variant="form"
      />
      {policy.httpsOnly && mgr.formData.protocol === "http" && (
        <p role="status" className="text-xs text-warning">
          This connection currently uses HTTP. Change its protocol to HTTPS
          before connecting.
        </p>
      )}
      <CheckboxField
        checked={policy.sameOriginOnly}
        onChange={(sameOriginOnly) =>
          update({
            sameOriginOnly,
            allowAllScripts: false,
          })
        }
        label="Same-origin resources and forms"
        description="Restrict page resources and form submissions to this origin. The proxy never forwards credentials to another origin. This is not a complete browser navigation sandbox and may break SSO or CDN-based apps."
        variant="form"
      />
      <div className="rounded-lg border border-[var(--color-border)] p-4 space-y-3">
        <CheckboxField
          checked={
            policy.allowAllScripts === true &&
            policy.pageScripts === "allow" &&
            !policy.sameOriginOnly
          }
          onChange={(allowAllScripts) =>
            update({
              allowAllScripts,
              ...(allowAllScripts
                ? { pageScripts: "allow", sameOriginOnly: false }
                : {}),
            })
          }
          label="Allow all website scripts"
          description="Trust all current and future HTTPS script sources, inline scripts and eval for this saved connection. Overrides script-specific website CSP, enables website scripts and turns off same-origin-only restrictions."
          variant="form"
        />
        <p className="text-xs leading-relaxed text-warning">
          Scripts can read and change this page, including information you
          enter. External scripts still download anonymously through the proxy;
          this does not grant saved credentials, login consent, other network
          resources or browser sandbox access. Invalid URLs and insecure
          external HTTP scripts remain blocked.
        </p>
        {policy.allowAllScripts &&
          policy.pageScripts === "allow" &&
          !policy.sameOriginOnly && (
            <p role="status" className="text-xs text-[var(--color-textMuted)]">
              All-script trust is active. The source list below still controls
              stylesheets; its script grants are preserved for when you turn
              this option off. Save and reload the website to apply changes.
            </p>
          )}
      </div>
      <div className="space-y-2">
        <CheckboxField
          checked={policy.allowExternalFonts === true && !policy.sameOriginOnly}
          disabled={policy.sameOriginOnly}
          onChange={(allowExternalFonts) => update({ allowExternalFonts })}
          label="Load external fonts through proxy"
          description="Allow anonymous font requests to the exact HTTPS origins below. No cookies or saved credentials are sent; certificate checks stay enabled."
          variant="form"
        />
        <p className="text-xs text-[var(--color-textMuted)]">
          Configure both font stylesheet and font binary destinations. Save the
          connection and reopen the session to apply changes.
        </p>
        {policy.sameOriginOnly && (
          <p role="status" className="text-xs text-warning">
            Same-origin resources and forms overrides external fonts. Your font
            settings are preserved but inactive while this restriction is
            enabled.
          </p>
        )}
        {fontOrigins.map((origin) => (
          <div key={origin} className="flex items-center gap-2 max-w-2xl">
            <span className="font-mono text-xs break-all">{origin}</span>
            <button
              type="button"
              className="sor-icon-btn-sm"
              disabled={fontsDisabled}
              aria-label={`Remove font origin ${origin}`}
              onClick={() =>
                updateFontOrigins(fontOrigins.filter((item) => item !== origin))
              }
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-80 max-w-full">
            <label htmlFor={`${id}-font-origin`} className="block text-xs mb-1">
              External font origin
            </label>
            <input
              id={`${id}-font-origin`}
              value={fontOrigin}
              disabled={fontsDisabled}
              onChange={(event) => setFontOrigin(event.target.value)}
              className="sor-form-input w-full"
              placeholder="https://fonts.example.com"
              aria-invalid={!!fontError}
              aria-describedby={`${id}-font-help${fontError ? ` ${id}-font-error` : ""}`}
            />
          </div>
          <button
            type="button"
            className="sor-btn-secondary"
            disabled={fontsDisabled || !fontOrigin}
            onClick={() => {
              if (updateFontOrigins([...fontOrigins, fontOrigin]))
                setFontOrigin("");
            }}
          >
            Add font origin
          </button>
          <button
            type="button"
            className="sor-btn-secondary"
            disabled={fontsDisabled}
            onClick={() =>
              updateFontOrigins([
                ...fontOrigins,
                ...[
                  "https://fonts.googleapis.com",
                  "https://fonts.gstatic.com",
                ].filter((origin) => !fontOrigins.includes(origin)),
              ])
            }
          >
            Add Google Fonts
          </button>
        </div>
        <p
          id={`${id}-font-help`}
          className="text-xs text-[var(--color-textMuted)]"
        >
          Up to 16 exact HTTPS origins. Add each origin to the list before
          saving. A trailing slash is allowed; paths and wildcards are not.
        </p>
        {fontError && (
          <p
            id={`${id}-font-error`}
            role="alert"
            className="text-sm text-error"
          >
            {fontError}
          </p>
        )}
      </div>
      <ExternalResourceOriginsEditor
        origins={policy.externalResourceOrigins ?? []}
        onChange={(externalResourceOrigins) =>
          update({ externalResourceOrigins })
        }
        sameOriginOnly={policy.sameOriginOnly}
        pageScripts={policy.pageScripts}
      />
      <CheckboxField
        checked={policy.allowCrossOriginRedirects === true}
        onChange={(allowCrossOriginRedirects) =>
          update({ allowCrossOriginRedirects })
        }
        label="Allow reviewed cross-origin redirects"
        description="Review the destination, then continue in this tab or open a new anonymous tab, with a fresh trust check for HTTPS. Authentication is stripped unless saved-login forwarding is explicitly configured and approved below."
        variant="form"
      />
      <CheckboxField
        checked={policy.allowHttpDowngradeRedirects === true}
        disabled={!policy.allowCrossOriginRedirects || policy.httpsOnly}
        onChange={(allowHttpDowngradeRedirects) =>
          update({ allowHttpDowngradeRedirects })
        }
        label="Allow reviewed HTTPS-to-HTTP downgrades"
        description="Separate security exception for temporary reverse-proxy handoffs. Each downgrade requires review. Requires reviewed cross-origin redirects and is overridden by the strict HTTPS setting above. This option alone never authorizes sending a password to HTTP."
        variant="form"
      />
      <RedirectAuthenticationOptions mgr={mgr} />
      <SynologyRedirectDefaultsSection mgr={mgr} />
      <TrustedRedirectDestinationsSection mgr={mgr} />
      <div className="space-y-2">
        <h4 className="text-sm font-medium">Extra upstream query parameters</h4>
        <p className="text-xs text-[var(--color-textMuted)]">
          Added to proxied requests on this origin, not to the address bar.
          Values may be sensitive and are excluded from credential-free exports.
          Do not put passwords here unless the service explicitly requires it.
        </p>
        {policy.queryParameters.map((entry, index) => (
          <div key={entry.name} className="flex items-center gap-2 max-w-2xl">
            <span
              className="font-mono text-xs w-40 shrink-0 truncate"
              title={entry.name}
            >
              {entry.name}
            </span>
            <PasswordInput
              value={entry.value}
              aria-label={`Value for ${entry.name}`}
              onChange={(event) =>
                update({
                  queryParameters: policy.queryParameters.map(
                    (item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, value: event.target.value }
                        : item,
                  ),
                })
              }
              className="sor-form-input"
            />
            <button
              type="button"
              className="sor-icon-btn-sm"
              title={`Remove ${entry.name}`}
              aria-label={`Remove ${entry.name}`}
              onClick={() =>
                update({
                  queryParameters: policy.queryParameters.filter(
                    (_, itemIndex) => itemIndex !== index,
                  ),
                })
              }
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-40">
            <label htmlFor={`${id}-name`} className="block text-xs mb-1">
              Parameter name
            </label>
            <input
              id={`${id}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="sor-form-input w-full"
              placeholder="tenant"
              maxLength={128}
            />
          </div>
          <div className="w-64 max-w-full">
            <label htmlFor={`${id}-value`} className="block text-xs mb-1">
              Parameter value
            </label>
            <PasswordInput
              id={`${id}-value`}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="sor-form-input"
              autoComplete="off"
            />
          </div>
          <button
            type="button"
            className="sor-btn-secondary flex items-center gap-1"
            disabled={!name || policy.queryParameters.length >= 16}
            onClick={() => {
              if (
                update({
                  queryParameters: [...policy.queryParameters, { name, value }],
                })
              ) {
                setName("");
                setValue("");
              }
            }}
          >
            <Plus size={14} />
            Add parameter
          </button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
      </div>
      <p className="text-xs text-[var(--color-textMuted)]">
        Use Clear session data in the browser toolbar to discard this session's
        proxy cookies and reopen it on a fresh protected origin. It does not
        erase other sessions or the system browser's data.
      </p>
    </section>
  );
}
