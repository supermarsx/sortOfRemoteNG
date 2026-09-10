import React, { useState } from "react";
import { Select, PasswordInput } from "../../ui/forms";
import { InfoTooltip } from "../../ui/InfoTooltip";
import type {
  HttpApplicationSettings,
  HttpAutoLoginSelectors,
} from "../../../types/connection/connection";
import {
  HTTP_APPLICATION_CATEGORIES,
  HTTP_APPLICATION_PROFILES,
  CLOUDFLARE_DASHBOARD_URL,
  getHttpApplicationProfile,
  getHttpApplicationLoginModes,
  normalizeHttpApplicationSettings,
} from "../../../utils/connection/httpApplicationProfiles";
import { resolveHttpBasicCredentials } from "../../../utils/auth/httpCredentials";
import type { Mgr } from "./types";
import ApplicationIconSuggestion from "./ApplicationIconSuggestion";
import AutomaticMfaSection from "./AutomaticMfaSection";

const MODE_LABELS = {
  manual: "Manual browsing — no saved credentials sent",
  form: "Automatic form login — explicitly opt in",
  basic: "HTTP Basic authentication",
  digest: "HTTP Digest authentication",
} as const;
const SELECTOR_EXAMPLES = {
  usernameSelector: 'input[name="username"]',
  passwordSelector: 'input[type="password"]',
  submitSelector: 'button[type="submit"]',
} as const;

export default function ApplicationSection({ mgr }: { mgr: Mgr }) {
  const [category, setCategory] = useState("all");
  const settings = normalizeHttpApplicationSettings(
    mgr.formData.httpApplication,
  );
  const profile = settings ? getHttpApplicationProfile(settings.id) : undefined;
  const credentials = resolveHttpBasicCredentials({
    ...mgr.formData,
    authType: "basic",
  });
  const selectProfile = (id: string) =>
    mgr.setFormData((previous) => ({
      ...previous,
      httpApplication: id ? { version: 1, id, loginMode: "manual" } : undefined,
      // A fresh selection must never revive a prior app's automatic submission.
      httpAutoLogin: false,
      httpAutoLoginSelectors: undefined,
      httpAutoMfa: { version: 1, enabled: false },
    }));
  const updateSettings = (change: Partial<HttpApplicationSettings>) => {
    if (!settings) return;
    mgr.setFormData((previous) => ({
      ...previous,
      httpApplication: { ...settings, ...change },
    }));
  };
  const updateCredential = (key: "username" | "password", value: string) => {
    const next = {
      username: credentials?.username ?? "",
      password: credentials?.password ?? "",
      [key]: value,
    };
    mgr.setFormData((previous) => ({
      ...previous,
      basicAuthUsername: next.username,
      basicAuthPassword: next.password,
    }));
  };
  const updateSelector = (key: keyof HttpAutoLoginSelectors, value: string) =>
    mgr.setFormData((previous) => ({
      ...previous,
      httpAutoLoginSelectors: {
        ...previous.httpAutoLoginSelectors,
        [key]: value || undefined,
      },
    }));
  const visibleProfiles = HTTP_APPLICATION_PROFILES.filter((item) =>
    category === "all"
      ? item.category !== "native"
      : item.category === category,
  );
  const options = [
    { value: "", label: "Generic website — existing HTTP settings" },
    ...visibleProfiles.map((item) => ({
      value: item.id,
      label: item.label,
      disabled: item.capability === "none",
      title: item.description,
    })),
  ];
  if (settings && !profile)
    options.push({
      value: settings.id,
      label: "Unavailable imported application — choose again",
    });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56 max-w-full">
          <label
            htmlFor="http-application-category"
            className="block text-sm font-medium mb-2"
          >
            Application category
          </label>
          <Select
            id="http-application-category"
            value={category}
            onChange={setCategory}
            options={[
              { value: "all", label: "All website applications" },
              ...Object.entries(HTTP_APPLICATION_CATEGORIES).map(
                ([value, label]) => ({ value, label }),
              ),
            ]}
            variant="form"
          />
        </div>
        <div className="w-80 max-w-full">
          <label
            htmlFor="http-application-profile"
            className="block text-sm font-medium mb-2"
          >
            Website application{" "}
            <InfoTooltip text="Profiles describe browser login, not native API sign-in. Selecting one never changes the host, port, TLS policy, or saved secret. Automatic form login requires your explicit choice." />
          </label>
          <Select
            id="http-application-profile"
            value={settings?.id ?? ""}
            placeholder={profile?.label}
            onChange={selectProfile}
            options={options}
            searchable
            searchPlaceholder={
              category === "all"
                ? "Search all website applications…"
                : "Search this category…"
            }
            variant="form"
          />
        </div>
      </div>
      {category === "native" && (
        <p className="text-sm text-[var(--color-textMuted)]">
          These native integrations do not provide a built-in website login.
          They cannot be selected as browser profiles; use Generic website for a
          separately installed UI.
        </p>
      )}
      {profile && (
        <p className="text-xs text-[var(--color-textMuted)]">
          Selected application: {HTTP_APPLICATION_CATEGORIES[profile.category]}{" "}
          / {profile.label}
        </p>
      )}
      {!settings && (
        <p className="text-sm text-[var(--color-textSecondary)]">
          Generic websites keep the existing Authentication and Advanced
          settings. Choose an application for clearly scoped website login
          options.
        </p>
      )}
      {settings?.invalid && (
        <p role="alert" className="text-sm text-error">
          This imported application profile is invalid or unavailable.
          Connecting is blocked until you choose an available application again.
        </p>
      )}
      {profile && (
        <>
          <p className="text-sm text-[var(--color-textSecondary)] max-w-2xl">
            {profile.description}
          </p>
          <ApplicationIconSuggestion
            formData={mgr.formData}
            setFormData={mgr.setFormData}
          />
          {profile.id === "cloudflare" && (
            <div className="max-w-2xl rounded border border-[var(--color-border)] p-3 space-y-3">
              <p className="text-sm text-[var(--color-textSecondary)]">
                Dashboard address:{" "}
                <span className="font-mono break-all">
                  {CLOUDFLARE_DASHBOARD_URL}
                </span>
                . This hosted preset requires HTTPS and port 443. Selecting it
                has not changed your address or TLS policy.
              </p>
              <button
                type="button"
                className="sor-btn-secondary"
                onClick={() =>
                  mgr.setFormData((previous) => {
                    const selected = normalizeHttpApplicationSettings(
                      previous.httpApplication,
                    );
                    if (selected?.id !== "cloudflare" || selected.invalid)
                      return previous;
                    return {
                      ...previous,
                      protocol: "https",
                      hostname: "dash.cloudflare.com",
                      port: 443,
                    };
                  })
                }
                disabled={settings?.invalid}
              >
                Use Cloudflare Dashboard address
              </button>
              <p className="text-xs text-[var(--color-textMuted)]">
                Complete the website's email/password and authenticator or
                email-code prompts yourself. For security keys, Windows Hello,
                social login, or SSO, use the session's explicit system-browser
                action. Embedded sign-in and challenge compatibility is not
                guaranteed; no 2FA seed or recovery code is stored by this
                preset.
              </p>
            </div>
          )}
          {profile.hostedLoginUrl && profile.id !== "cloudflare" && (
            <div className="max-w-2xl space-y-2 rounded border border-[var(--color-border)] p-3">
              <p className="text-sm">
                Hosted login address:{" "}
                <span className="font-mono break-all">
                  {profile.hostedLoginUrl}
                </span>
                . This preset requires that HTTPS origin. Selection has not
                changed your address or certificate policy.
              </p>
              <button
                type="button"
                className="sor-btn sor-btn-secondary"
                disabled={settings?.invalid}
                onClick={() =>
                  mgr.setFormData((previous) => {
                    if (
                      previous.httpApplication?.id !== profile.id ||
                      !profile.hostedLoginUrl
                    )
                      return previous;
                    const url = new URL(profile.hostedLoginUrl);
                    return {
                      ...previous,
                      protocol: "https",
                      hostname: url.hostname,
                      port: 443,
                      httpAutoMfa: { version: 1, enabled: false },
                    };
                  })
                }
              >
                Use {profile.label} login address
              </button>
              <p className="text-xs text-[var(--color-textMuted)]">
                Hosted redirects, MFA, SSO and security keys may need the
                session's system-browser action. That browser uses separate
                cookies and its own network/TLS settings.
              </p>
            </div>
          )}
          {profile.capability !== "none" && (
            <div className="max-w-md">
              <label
                htmlFor="http-application-mode"
                className="block text-sm font-medium mb-2"
              >
                Application login mode
              </label>
              <Select
                id="http-application-mode"
                value={settings?.loginMode ?? "manual"}
                onChange={(value) =>
                  updateSettings({
                    loginMode: value as HttpApplicationSettings["loginMode"],
                  })
                }
                options={getHttpApplicationLoginModes(profile).map((mode) => ({
                  value: mode,
                  label: MODE_LABELS[mode],
                }))}
                disabled={settings?.invalid}
                variant="form"
              />
            </div>
          )}
          {settings?.loginMode !== "manual" && !settings?.invalid && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
              <div>
                <label
                  htmlFor="http-application-user"
                  className="block text-sm mb-2"
                >
                  Website {profile.usernameLabel?.toLowerCase() ?? "username"}
                </label>
                <input
                  id="http-application-user"
                  className="sor-form-input"
                  autoComplete="off"
                  value={credentials?.username ?? ""}
                  onChange={(event) =>
                    updateCredential("username", event.target.value)
                  }
                />
              </div>
              <div>
                <label
                  htmlFor="http-application-password"
                  className="block text-sm mb-2"
                >
                  Website password
                </label>
                <PasswordInput
                  id="http-application-password"
                  className="sor-form-input"
                  autoComplete="new-password"
                  value={credentials?.password ?? ""}
                  onChange={(event) =>
                    updateCredential("password", event.target.value)
                  }
                />
              </div>
              {profile.id === "proxmox" && settings?.loginMode === "form" && (
                <div>
                  <label
                    htmlFor="http-application-realm"
                    className="block text-sm mb-2"
                  >
                    Account realm
                  </label>
                  <input
                    id="http-application-realm"
                    className="sor-form-input"
                    value={settings.realm ?? "pam"}
                    maxLength={128}
                    onChange={(event) =>
                      updateSettings({ realm: event.target.value || undefined })
                    }
                  />
                  <p className="mt-1 text-xs text-[var(--color-textMuted)]">
                    Appended only when the username has no @realm; the saved
                    username stays unchanged.
                  </p>
                </div>
              )}
            </div>
          )}
          {settings?.loginMode === "form" && !settings.invalid && (
            <>
              <p className="text-sm text-[var(--color-textSecondary)]">
                One automatic submission per proxy session. No preemptive Basic
                header is sent. Authenticator codes require the separate
                explicit setting below. CAPTCHA, external SSO, and a rejected
                login remain manual.
              </p>
              <details
                key={profile.id}
                open={profile.capability === "custom-form" ? true : undefined}
                className="max-w-2xl rounded border border-[var(--color-border)] p-3"
              >
                <summary className="cursor-pointer text-sm font-medium">
                  {profile.capability === "custom-form"
                    ? "Custom form selectors (required)"
                    : "Selector overrides (optional)"}
                </summary>
                <p className="text-xs text-[var(--color-textMuted)] my-3">
                  {profile.capability === "custom-form" ? (
                    "Provide all three CSS selectors for visible controls in the same login form. Missing or unmatched selectors block filling; no heuristic fallback is used."
                  ) : (
                    <>
                      Leave blank for{" "}
                      {profile.selectors
                        ? "the reviewed application selectors"
                        : "generic detection"}
                      . An unmatched override never falls back to a different
                      field.
                    </>
                  )}
                </p>
                <div className="space-y-3">
                  {(
                    [
                      ["usernameSelector", "Username field selector"],
                      ["passwordSelector", "Password field selector"],
                      ["submitSelector", "Submit button selector"],
                    ] as const
                  ).map(([key, label]) => (
                    <div key={key}>
                      <label
                        htmlFor={`http-app-${key}`}
                        className="block text-xs mb-1"
                      >
                        {label}
                      </label>
                      <input
                        id={`http-app-${key}`}
                        className="sor-form-input"
                        maxLength={512}
                        required={profile.capability === "custom-form"}
                        value={mgr.formData.httpAutoLoginSelectors?.[key] ?? ""}
                        placeholder={
                          profile.capability === "custom-form"
                            ? SELECTOR_EXAMPLES[key]
                            : (profile.selectors?.[key] ?? "Auto-detect")
                        }
                        onChange={(event) =>
                          updateSelector(key, event.target.value)
                        }
                      />
                    </div>
                  ))}
                </div>
              </details>
            </>
          )}
          {!settings?.invalid && (
            <AutomaticMfaSection key={profile.id} mgr={mgr} profile={profile} />
          )}
          <p className="text-xs text-[var(--color-textMuted)]">
            Saved passwords follow this connection database's existing
            protection policy. Profile metadata has no secrets. The profile does
            not install a web UI or turn API tokens into website sessions.
          </p>
        </>
      )}
    </div>
  );
}
