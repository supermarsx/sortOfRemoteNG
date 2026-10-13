import React, { useState } from "react";
import { Checkbox, Select, PasswordInput } from "../../ui/forms";
import { InfoTooltip } from "../../ui/InfoTooltip";
import type {
  HttpApplicationSettings,
  HttpAutoLoginSelectors,
} from "../../../types/connection/connection";
import type { HttpCustomLoginOptions } from "../../../types/connection/httpCustomLogin";
import {
  HTTP_APPLICATION_CATEGORIES,
  HTTP_APPLICATION_PROFILES,
  CLOUDFLARE_DASHBOARD_URL,
  getHttpApplicationProfile,
  getFirstPartyGoogleHostedApplicationUrl,
  getHttpApplicationLoginModes,
  getHttpLoginStepsEntryPage,
  normalizeHttpApplicationSettings,
  normalizeTacticalRmmApiOrigin,
  normalizeTacticalRmmMeshOrigin,
  isSafeHttpApplicationLoginPath,
  getJoomlaLoginSelectors,
  JOOMLA_VERSION_OPTIONS,
} from "../../../utils/connection/httpApplicationProfiles";
import { resolveHttpBasicCredentials } from "../../../utils/auth/httpCredentials";
import type { Mgr } from "./types";
import ApplicationIconSuggestion from "./ApplicationIconSuggestion";
import AutomaticMfaSection from "./AutomaticMfaSection";
import ExchangeOwaMailboxFields from "./ExchangeOwaMailboxFields";
import DroneScmBridgeFields from "./DroneScmBridgeFields";
import { isSynologyFileConnection } from "../../../types/protocols/synology";
import CredentialSourceSection from "../CredentialSourceSection";
import AmazonMarketplaceFields from "./AmazonMarketplaceFields";
import { resolveHttpApplicationEmail } from "../../../utils/auth/httpApplicationLogin";
import HttpCredentialWarning from "../../security/HttpCredentialWarning";
import { DECLARATIVE_LOGIN_SUPPORTED } from "../../../utils/connection/declarativeLoginSupport";
import { isUnverifiedHttpLoginSteps } from "../../../utils/connection/httpLoginSteps";

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
const CUSTOM_SUBMISSIONS = [
  { value: "click", label: "Click on the submit button" },
  { value: "spa", label: "Click on the button of a script-driven form" },
  { value: "enter", label: "Enter key in the password field" },
] as const;

export default function ApplicationSection({ mgr }: { mgr: Mgr }) {
  const [category, setCategory] = useState("all");
  const settings = normalizeHttpApplicationSettings(
    mgr.formData.httpApplication,
  );
  const profile = settings ? getHttpApplicationProfile(settings.id) : undefined;
  const apiOrigin = mgr.formData.httpApplication?.apiOrigin;
  const normalizedApiOrigin = normalizeTacticalRmmApiOrigin(apiOrigin);
  const invalidApiOrigin = apiOrigin !== undefined && !normalizedApiOrigin;
  const meshOrigin = mgr.formData.httpApplication?.meshOrigin;
  const normalizedMeshOrigin = normalizeTacticalRmmMeshOrigin(meshOrigin);
  const invalidMeshOrigin = meshOrigin !== undefined && !normalizedMeshOrigin;
  const updateMeshOrigin = (value: string) =>
    mgr.setFormData((previous) => {
      if (previous.httpApplication?.id !== "tacticalrmm") return previous;
      return {
        ...previous,
        httpApplication: {
          ...previous.httpApplication,
          meshOrigin: value || undefined,
        },
      };
    });
  const updateApiOrigin = (value: string) =>
    mgr.setFormData((previous) => {
      if (previous.httpApplication?.id !== "tacticalrmm") return previous;
      return {
        ...previous,
        httpApplication: {
          ...previous.httpApplication,
          apiOrigin: value || undefined,
        },
      };
    });
  const reviewedSelectors =
    profile?.id === "joomla"
      ? getJoomlaLoginSelectors(settings?.joomlaVersion)
      : profile?.selectors;
  const fileApi = isSynologyFileConnection(mgr.formData);
  const boundedAiFlow = profile?.id === "chatgpt" || profile?.id === "claude";
  // Present only while the engine that runs login steps is supported.
  const declarativeLogin = profile?.declarativeLogin;
  const customProfile = profile?.capability === "custom-form";
  const customLogin = customProfile ? settings?.customLogin : undefined;
  const customOptions = DECLARATIVE_LOGIN_SUPPORTED && customProfile;
  // Additive steps leave the profile's own form detection in force, which
  // still needs the username even when the steps type a password only.
  const additiveSteps = profile?.declarativeLoginMode === "additive";
  const stepsEntryPage = profile
    ? getHttpLoginStepsEntryPage(profile)
    : undefined;
  const passwordOnly =
    (declarativeLogin?.passwordOnly === true && !additiveSteps) ||
    (customOptions && customLogin?.passwordOnly === true);
  const credentials = profile?.emailOnly
    ? { username: resolveHttpApplicationEmail(mgr.formData), password: "" }
    : resolveHttpBasicCredentials({
        ...mgr.formData,
        authType: "basic",
      });
  const vaultCredentials = mgr.formData.credentialSource?.kind === "vault";
  const selectProfile = (id: string) =>
    mgr.setFormData((previous) => {
      const googleHostedUrl = getFirstPartyGoogleHostedApplicationUrl(id);
      const previousGoogleHostedUrl = getFirstPartyGoogleHostedApplicationUrl(
        previous.httpApplication?.id,
      );
      const previousGoogleHost = previousGoogleHostedUrl
        ? new URL(previousGoogleHostedUrl).hostname
        : undefined;
      const applyBuiltInGoogleAuthority =
        googleHostedUrl !== undefined &&
        (!previous.hostname?.trim() ||
          (previousGoogleHost !== undefined &&
            previous.hostname.trim().toLowerCase() === previousGoogleHost));
      const googleUrl = applyBuiltInGoogleAuthority
        ? new URL(googleHostedUrl)
        : undefined;
      const hostedLoginUrl = getHttpApplicationProfile(id)?.hostedLoginUrl;
      // Preserve the three existing explicit-replacement presets. All other
      // hosted presets fill blank connections, never an unrelated saved host.
      const replaceAddress = ["cloudflare", "porkbun", "ptisp"].includes(id);
      const selectedUrl =
        hostedLoginUrl && (replaceAddress || !previous.hostname?.trim())
          ? new URL(hostedLoginUrl)
          : googleUrl;
      return {
        ...previous,
        ...(selectedUrl
          ? { protocol: "https", hostname: selectedUrl.hostname, port: 443 }
          : {}),
        httpApplication: id
          ? { version: 1, id, loginMode: "manual" }
          : undefined,
        // A fresh selection must never revive a prior app's automatic submission.
        httpAutoLogin: false,
        httpAutoLoginSelectors: undefined,
        // These staged adapters do not expose the advanced-form editor. Drop
        // another application's overrides on explicit selection so hidden
        // settings cannot make subsequent opt-in impossible to configure.
        ...(id === "chatgpt" || id === "claude" || id === "linkedin"
          ? { httpFormAutomation: undefined }
          : {}),
        httpAutoMfa: { version: 1, enabled: false },
        synologySettings: previous.synologySettings
          ? { ...previous.synologySettings, accessMode: "website" }
          : undefined,
      };
    });
  const updateSettings = (change: Partial<HttpApplicationSettings>) => {
    if (!settings) return;
    mgr.setFormData((previous) => ({
      ...previous,
      httpApplication: { ...settings, ...change },
    }));
  };
  const updateCredential = (key: "username" | "password", value: string) => {
    if (profile?.emailOnly) {
      if (key === "username")
        mgr.setFormData((previous) => ({
          ...previous,
          basicAuthUsername: value,
        }));
      return;
    }
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
  /** Stores only what differs from the defaults; an empty object is dropped. */
  const updateCustomLogin = (change: Partial<HttpCustomLoginOptions>) =>
    mgr.setFormData((previous) => {
      if (previous.httpApplication?.id !== "custom") return previous;
      const { customLogin: saved, ...application } = previous.httpApplication;
      const next = Object.fromEntries(
        Object.entries({ ...saved, ...change }).filter(
          ([, value]) => value !== undefined && value !== "",
        ),
      );
      return {
        ...previous,
        httpApplication: Object.keys(next).length
          ? { ...application, customLogin: next }
          : application,
      };
    });
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
            <InfoTooltip text="Profiles describe browser login, not native API sign-in. Selecting Cloudflare sets its HTTPS dashboard address and port 443, replacing any existing address. Google profiles fill a blank or previously managed Google address. TLS policy and saved credentials are preserved. Automatic form login requires your explicit choice." />
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
      {profile && !fileApi && (
        <>
          <p className="text-sm text-[var(--color-textSecondary)] max-w-2xl">
            {profile.description}
          </p>
          <ApplicationIconSuggestion
            formData={mgr.formData}
            setFormData={mgr.setFormData}
          />
          {profile.id === "exchange-owa" && (
            <ExchangeOwaMailboxFields mgr={mgr} />
          )}
          {profile.id === "tacticalrmm" && (
            <div className="max-w-xl space-y-2">
              <label
                htmlFor="tactical-api-origin"
                className="block text-sm font-medium"
              >
                Tactical RMM API origin (optional)
              </label>
              <input
                id="tactical-api-origin"
                className="sor-form-input"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                maxLength={2048}
                placeholder="https://api.example.com"
                value={typeof apiOrigin === "string" ? apiOrigin : ""}
                aria-invalid={invalidApiOrigin}
                aria-describedby="tactical-api-origin-help"
                onChange={(event) => updateApiOrigin(event.target.value)}
                onBlur={() => {
                  if (normalizedApiOrigin) updateApiOrigin(normalizedApiOrigin);
                }}
              />
              <p
                id="tactical-api-origin-help"
                className="text-xs text-[var(--color-textMuted)]"
              >
                The exact API address for this Tactical RMM deployment. Blank
                keeps default API routing. Use HTTPS on port 443 with no path,
                query, fragment or credentials. This is an address, not an API
                key; it does not change the dashboard address or login settings.
              </p>
              {invalidApiOrigin && (
                <p role="alert" className="text-sm text-error">
                  Enter an HTTPS origin such as https://api.example.com, without
                  a path, query, fragment, credentials or a non-443 port.
                </p>
              )}
            </div>
          )}
          {profile.id === "tacticalrmm" && (
            <div className="max-w-xl space-y-2">
              <label
                htmlFor="tactical-mesh-origin"
                className="block text-sm font-medium"
              >
                MeshCentral origin (optional)
              </label>
              <input
                id="tactical-mesh-origin"
                className="sor-form-input"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                maxLength={2048}
                placeholder="https://mesh.example.com"
                value={typeof meshOrigin === "string" ? meshOrigin : ""}
                aria-invalid={invalidMeshOrigin}
                aria-describedby="tactical-mesh-origin-help"
                onChange={(event) => updateMeshOrigin(event.target.value)}
                onBlur={() => {
                  if (normalizedMeshOrigin)
                    updateMeshOrigin(normalizedMeshOrigin);
                }}
              />
              <p
                id="tactical-mesh-origin-help"
                className="text-xs text-[var(--color-textMuted)]"
              >
                The exact HTTPS address of MeshCentral for this Tactical RMM
                connection. Internal hostnames, IP addresses and custom ports
                are supported. Enter only the origin, without a path, query,
                fragment or credentials.
              </p>
              {invalidMeshOrigin && (
                <p role="alert" className="text-sm text-error">
                  Enter a MeshCentral HTTPS origin such as
                  https://mesh.example.com:8443, without a path, query, fragment
                  or credentials.
                </p>
              )}
            </div>
          )}
          {profile.id === "drone-ci" && (
            <DroneScmBridgeFields
              formData={mgr.formData}
              setFormData={mgr.setFormData}
            />
          )}
          {profile.id === "joomla" && (
            <div className="max-w-xl space-y-2">
              <label
                htmlFor="joomla-version"
                className="block text-sm font-medium"
              >
                Joomla version
              </label>
              <div className="max-w-sm">
                <Select
                  id="joomla-version"
                  value={settings?.joomlaVersion ?? "auto"}
                  options={[...JOOMLA_VERSION_OPTIONS]}
                  searchable
                  variant="form"
                  onChange={(value) => {
                    const selected = JOOMLA_VERSION_OPTIONS.find(
                      (option) => option.value === value,
                    );
                    if (!selected) return;
                    updateSettings({ joomlaVersion: selected.value });
                  }}
                />
              </div>
              <p className="text-xs text-[var(--color-textMuted)]">
                Joomla 3 and 4.0–4.1 can request a secret code on the password
                form: saved username/password may be filled, but submission
                pauses for you to enter the code and submit yourself. Joomla
                4.2+, 5 and 6 use a separate captive MFA challenge after the
                password step. A code prompt is not proof that the password
                succeeded; email, authenticator and security-key methods remain
                manual. Version selection does not enable login or MFA, and
                selector overrides are preserved.
              </p>
              <label
                htmlFor="joomla-administrator-path"
                className="block text-sm font-medium"
              >
                Administrator path
              </label>
              <input
                id="joomla-administrator-path"
                className="sor-form-input"
                placeholder="/administrator/"
                value={mgr.formData.httpApplication?.loginPath ?? ""}
                onChange={(event) => {
                  if (!settings) return;
                  const loginPath = event.target.value || undefined;
                  mgr.setFormData((previous) => ({
                    ...previous,
                    httpApplication: {
                      ...settings,
                      loginPath,
                      invalid: undefined,
                    },
                  }));
                }}
              />
              <p className="text-xs text-[var(--color-textMuted)]">
                Blank uses /administrator/. For example, /site/administrator/ or
                an existing custom /staff-entry/ slug. Same-host paths only: no
                full URLs, query secrets, fragments or encoded characters. This
                does not configure or bypass a Joomla security extension;
                unsupported login templates remain manual.
              </p>
              {mgr.formData.httpApplication?.loginPath !== undefined &&
                !isSafeHttpApplicationLoginPath(
                  mgr.formData.httpApplication.loginPath,
                ) && (
                  <p role="alert" className="text-sm text-error">
                    Enter a path beginning with one slash, without a query,
                    fragment or traversal.
                  </p>
                )}
            </div>
          )}
          {profile.id === "cloudflare" && (
            <div className="max-w-2xl rounded border border-[var(--color-border)] p-3 space-y-3">
              <p className="text-sm text-[var(--color-textSecondary)]">
                Dashboard address:{" "}
                <span className="font-mono break-all">
                  {CLOUDFLARE_DASHBOARD_URL}
                </span>
                . Selecting this hosted preset sets HTTPS, this hostname and
                port 443, replacing any existing address. TLS policy and saved
                credentials are preserved. Later address edits remain until you
                select the profile again or use the address button.
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
                      hostname: new URL(CLOUDFLARE_DASHBOARD_URL).hostname,
                      port: 443,
                    };
                  })
                }
                disabled={settings?.invalid}
              >
                Use Cloudflare Dashboard address
              </button>
              <p className="text-xs text-[var(--color-textMuted)]">
                Manual browsing sends no saved credentials. Automatic form login
                uses your selected website email and password. Verification
                codes remain interactive unless you explicitly enable Automatic
                2FA for a reviewed challenge. CAPTCHA, security keys, Windows
                Hello and SSO remain interactive while automation waits. The
                session's system-browser action is available when a challenge
                needs it. API keys and tokens cannot sign into the website.
              </p>
            </div>
          )}
          {profile.id === "amazon-shopping" && (
            <AmazonMarketplaceFields mgr={mgr} />
          )}
          {profile.hostedLoginUrl &&
            profile.id !== "cloudflare" &&
            profile.id !== "amazon-shopping" && (
              <div className="max-w-2xl space-y-2 rounded border border-[var(--color-border)] p-3">
                <p className="text-sm">
                  Hosted login address:{" "}
                  <span className="font-mono break-all">
                    {profile.hostedLoginUrl}
                  </span>
                  . This preset requires that HTTPS origin.
                  {profile.id === "porkbun" || profile.id === "ptisp"
                    ? ` Selecting this preset sets HTTPS, ${new URL(profile.hostedLoginUrl).hostname} and port 443; certificate policy is preserved.`
                    : " Blank connections use this built-in address automatically; an existing custom address is preserved."}
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
              {declarativeLogin && (
                <p
                  role="note"
                  data-testid="login-steps-evidence"
                  className="mt-2 text-xs text-[var(--color-textSecondary)]"
                >
                  {isUnverifiedHttpLoginSteps(declarativeLogin) ? (
                    <>
                      <strong>Unverified layout.</strong> The login steps for{" "}
                      {profile.label} are an informed guess from public
                      material, recorded on {declarativeLogin.evidence.reviewed}
                      ; nobody has confirmed them with a real sign-in.
                    </>
                  ) : (
                    <>
                      <strong>Reviewed layout.</strong> Every control in the
                      login steps for {profile.label} was taken from a cited
                      source, reviewed on {declarativeLogin.evidence.reviewed}.
                    </>
                  )}{" "}
                  {additiveSteps
                    ? `They only add to what ${profile.label} already does: where they find nothing to act on, generic form detection signs in as before.`
                    : "If the page differs, nothing is typed and you sign in by hand."}
                </p>
              )}
              {stepsEntryPage && (
                <p
                  data-testid="login-steps-entry"
                  className="mt-2 text-xs text-[var(--color-textSecondary)]"
                >
                  Automatic sign-in starts on the sign-in page (
                  <span className="font-mono break-all">{stepsEntryPage}</span>
                  ), not on the page this connection opens. If the site does not
                  take you there by itself, follow its own sign-in link; the
                  login then fills.
                </p>
              )}
            </div>
          )}
          {customLogin && !customOptions && (
            <div className="max-w-2xl space-y-2">
              <p role="alert" className="text-sm text-error">
                This custom login was saved with a login frame, password-only,
                pre-step or submit option that this build cannot run. Automatic
                login is blocked until the options are removed.
              </p>
              <button
                type="button"
                className="sor-btn sor-btn-secondary"
                onClick={() =>
                  updateCustomLogin({
                    frame: undefined,
                    passwordOnly: undefined,
                    preStepSelector: undefined,
                    submission: undefined,
                  })
                }
              >
                Remove unsupported login options
              </button>
            </div>
          )}
          {/* Manual sign-in keeps the pair editable: it is typed on request. */}
          {settings && !settings.invalid && (
            <>
              {/* Only what the app itself sends; manual sends nothing. */}
              {settings.loginMode !== "manual" && (
                <HttpCredentialWarning connection={mgr.formData} />
              )}
              <div className="max-w-2xl space-y-2">
                <p className="text-sm font-medium">Website credential source</p>
                {settings.loginMode === "manual" ? (
                  <p
                    data-testid="manual-login-credentials-note"
                    className="text-xs text-[var(--color-textSecondary)]"
                  >
                    Manual sign-in never sends or types these credentials on its
                    own. To use them, open Credentials &amp; 2FA in the
                    tab&apos;s toolbar and choose Type username or Type password
                    with the site&apos;s field focused. Vault references never
                    copy or reveal their secrets in this connection.
                  </p>
                ) : (
                  <p className="text-xs text-[var(--color-textSecondary)]">
                    Choose connection-local credentials or a reusable database
                    vault credential for this automatic login. Vault references
                    never copy or reveal their secrets in this connection.
                  </p>
                )}
                <CredentialSourceSection
                  formData={mgr.formData}
                  setFormData={mgr.setFormData}
                />
              </div>
              {vaultCredentials && (
                <p
                  role="note"
                  className="max-w-2xl text-xs text-[var(--color-textSecondary)]"
                >
                  {profile.emailOnly ? (
                    "A database vault credential is selected. Only its email is used for this flow; no configured password is sent."
                  ) : (
                    <>
                      A database vault credential is selected. Website username
                      and password fields are locked here; select or edit the
                      reusable credential in the Database vault instead.
                      Automatic 2FA can use only that selected vault
                      credential's authenticator and requires separate consent
                      below.
                    </>
                  )}
                </p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
                {!passwordOnly && (
                  <div>
                    <label
                      htmlFor="http-application-user"
                      className="block text-sm mb-2"
                    >
                      Website{" "}
                      {profile.usernameLabel?.toLowerCase() ?? "username"}
                    </label>
                    <input
                      id="http-application-user"
                      className="sor-form-input"
                      autoComplete="off"
                      disabled={vaultCredentials}
                      placeholder={
                        vaultCredentials
                          ? "Stored in selected database vault"
                          : undefined
                      }
                      value={credentials?.username ?? ""}
                      onChange={(event) =>
                        updateCredential("username", event.target.value)
                      }
                    />
                  </div>
                )}
                {!profile.emailOnly && (
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
                      disabled={vaultCredentials}
                      placeholder={
                        vaultCredentials
                          ? "Stored in selected database vault"
                          : undefined
                      }
                      value={credentials?.password ?? ""}
                      onChange={(event) =>
                        updateCredential("password", event.target.value)
                      }
                    />
                  </div>
                )}
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
                        updateSettings({
                          realm: event.target.value || undefined,
                        })
                      }
                    />
                    <p className="mt-1 text-xs text-[var(--color-textMuted)]">
                      Appended only when the username has no @realm; the saved
                      username stays unchanged.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
          {settings?.loginMode === "form" && !settings.invalid && (
            <>
              <p className="text-sm text-[var(--color-textSecondary)]">
                {profile.emailOnly ? (
                  "Submit your email once, then complete the emailed link or code manually. No password is required or sent. SSO and security challenges remain interactive; this does not establish a signed-in session."
                ) : boundedAiFlow ? (
                  "Bounded fixture-tested email/password assistance, without verified live later stages. SSO, email codes, MFA, CAPTCHA and recovery remain interactive. Selector overrides and advanced automation are not supported."
                ) : profile.id === "adobe-admin-console" ? (
                  "Staged email and password sign-in uses the reviewed Adobe flow without HTTP Basic authentication. SSO, MFA, CAPTCHA and account/profile choice remain interactive. Selector overrides are not supported."
                ) : profile.id === "linkedin" ? (
                  "One submission on the recognized LinkedIn login page. Existing field values are preserved. Unknown layouts, MFA, CAPTCHA, passkeys and SSO remain interactive. Selector overrides are not supported."
                ) : additiveSteps ? (
                  <>
                    Automatic sign-in first tries the login steps recorded for{" "}
                    {profile.label}; where they find nothing to act on, generic
                    form detection runs as before. One automatic submission per
                    session. Authenticator codes require the separate explicit
                    setting below. CAPTCHA, external SSO, and a rejected login
                    remain manual.
                  </>
                ) : declarativeLogin ? (
                  <>
                    Automatic sign-in follows the login steps recorded for{" "}
                    {profile.label}: each step types only on the page and origin
                    it names, once.{" "}
                    {passwordOnly &&
                      "This device signs in with a password only; no username is typed. "}
                    Authenticator codes require the separate explicit setting
                    below. CAPTCHA, device approval, passkeys, security keys and
                    a rejected login remain manual.
                  </>
                ) : (
                  <>
                    One automatic submission per proxy session. No preemptive
                    Basic header is sent. Authenticator codes require the
                    separate explicit setting below. CAPTCHA, external SSO, and
                    a rejected login remain manual.
                  </>
                )}
              </p>
              {profile.id !== "adobe-admin-console" &&
                profile.id !== "linkedin" &&
                // A former manual profile has steps and no single form.
                profile.declarativeLoginMode !== "exclusive" &&
                !boundedAiFlow && (
                  <details
                    key={profile.id}
                    open={
                      profile.capability === "custom-form" ? true : undefined
                    }
                    className="max-w-2xl rounded border border-[var(--color-border)] p-3"
                  >
                    <summary className="cursor-pointer text-sm font-medium">
                      {profile.capability === "custom-form"
                        ? "Custom form selectors (required)"
                        : "Selector overrides (optional)"}
                    </summary>
                    <p className="text-xs text-[var(--color-textMuted)] my-3">
                      {profile.capability === "custom-form" ? (
                        customLogin && customOptions ? (
                          "Provide a CSS selector for every field shown below; each must be a visible control of the same login form. Missing or unmatched selectors block filling; no heuristic fallback is used."
                        ) : (
                          "Provide all three CSS selectors for visible controls in the same login form. Missing or unmatched selectors block filling; no heuristic fallback is used."
                        )
                      ) : (
                        <>
                          Leave blank for{" "}
                          {additiveSteps
                            ? `the login steps recorded for ${profile.label}, with generic detection as the fallback. Any override skips those steps and uses single-form detection with your selectors`
                            : reviewedSelectors
                              ? "the reviewed application selectors"
                              : "generic detection"}
                          . An unmatched override never falls back to a
                          different field.
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
                      )
                        .filter(
                          ([key]) =>
                            !customOptions ||
                            (key === "usernameSelector"
                              ? !customLogin?.passwordOnly
                              : key !== "submitSelector" ||
                                customLogin?.submission !== "enter"),
                        )
                        .map(([key, label]) => (
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
                              value={
                                mgr.formData.httpAutoLoginSelectors?.[key] ?? ""
                              }
                              placeholder={
                                profile.capability === "custom-form"
                                  ? SELECTOR_EXAMPLES[key]
                                  : (reviewedSelectors?.[key] ?? "Auto-detect")
                              }
                              onChange={(event) =>
                                updateSelector(key, event.target.value)
                              }
                            />
                          </div>
                        ))}
                      {customOptions && (
                        <>
                          <label className="flex items-center space-x-2 text-xs">
                            <Checkbox
                              checked={customLogin?.passwordOnly === true}
                              onChange={(checked) =>
                                updateCustomLogin({
                                  passwordOnly: checked || undefined,
                                })
                              }
                              variant="form"
                            />
                            <span>
                              Password-only device (no username field)
                            </span>
                          </label>
                          <div>
                            <label
                              htmlFor="http-app-custom-frame"
                              className="block text-xs mb-1"
                            >
                              Login frame id or name (optional)
                            </label>
                            <input
                              id="http-app-custom-frame"
                              className="sor-form-input"
                              maxLength={128}
                              autoComplete="off"
                              spellCheck={false}
                              placeholder="appFrame"
                              value={
                                mgr.formData.httpApplication?.customLogin
                                  ?.frame ?? ""
                              }
                              onChange={(event) =>
                                updateCustomLogin({
                                  frame:
                                    event.target.value
                                      .replace(/[^A-Za-z0-9_-]/g, "")
                                      .slice(0, 128) || undefined,
                                })
                              }
                            />
                            <p className="mt-1 text-xs text-[var(--color-textMuted)]">
                              The id or name of an iframe directly in the page,
                              served from this connection&apos;s own address.
                              Blank means the page itself. The selectors then
                              apply inside that frame only.
                            </p>
                          </div>
                          <div>
                            <label
                              htmlFor="http-app-custom-pre-step"
                              className="block text-xs mb-1"
                            >
                              Click before filling (optional)
                            </label>
                            <input
                              id="http-app-custom-pre-step"
                              className="sor-form-input"
                              maxLength={512}
                              autoComplete="off"
                              spellCheck={false}
                              placeholder="#login-tab"
                              value={
                                mgr.formData.httpApplication?.customLogin
                                  ?.preStepSelector ?? ""
                              }
                              onChange={(event) =>
                                updateCustomLogin({
                                  preStepSelector: event.target.value.trim()
                                    ? event.target.value
                                    : undefined,
                                })
                              }
                            />
                            <p className="mt-1 text-xs text-[var(--color-textMuted)]">
                              A CSS selector for one control that reveals the
                              form, such as a tab or a sign-in button. It is
                              clicked once, in the same document as the fields.
                            </p>
                          </div>
                          <div>
                            <label
                              htmlFor="http-app-custom-submission"
                              className="block text-xs mb-1"
                            >
                              Submit with
                            </label>
                            <Select
                              id="http-app-custom-submission"
                              value={customLogin?.submission ?? "click"}
                              options={[...CUSTOM_SUBMISSIONS]}
                              variant="form"
                              onChange={(value) => {
                                const selected = CUSTOM_SUBMISSIONS.find(
                                  (option) => option.value === value,
                                );
                                if (!selected) return;
                                updateCustomLogin({
                                  submission:
                                    selected.value === "click"
                                      ? undefined
                                      : selected.value,
                                });
                              }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </details>
                )}
            </>
          )}
          {!settings?.invalid &&
            profile.id !== "linkedin" &&
            !boundedAiFlow && (
              <AutomaticMfaSection
                key={profile.id}
                mgr={mgr}
                profile={profile}
              />
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
