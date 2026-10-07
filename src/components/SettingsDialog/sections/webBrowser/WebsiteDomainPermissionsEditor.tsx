"use client";

import React, { useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  WEBSITE_REQUEST_CLASSES,
  type WebsiteDomainPermissionsSettings,
  type WebsiteOriginPermissions,
  type WebsitePermissionApplicationDefaults,
  type WebsitePermissionSetting,
  type WebsitePermissionSource,
  type WebsiteRequestClass,
} from "../../../../types/settings/websiteDomainPermissions";
import {
  MAX_WEBSITE_PERMISSION_DESTINATIONS,
  MAX_WEBSITE_PERMISSION_ORIGIN_LENGTH,
  MAX_WEBSITE_PERMISSION_TOTAL_DESTINATIONS,
  MAX_WEBSITE_PERMISSION_WEBSITES,
  canonicalWebsitePermissionOrigin,
  normalizeWebsiteDomainPermissions,
  normalizeWebsitePermissionApplicationDefaults,
  resolveWebsiteRequestClassDefault,
  resolveWebsiteRequestPermission,
} from "../../../../utils/settings/websiteDomainPermissions";
import { Select } from "../../../ui/forms/Select";
import { TextInput } from "../../../ui/forms/TextInput";
import { FormField } from "../../../ui/forms/FormField";

export interface WebsiteDomainPermissionsEditorProps {
  settings: WebsiteDomainPermissionsSettings | undefined;
  onChange: (settings: WebsiteDomainPermissionsSettings) => void;
  scope?: "shared" | "connection";
  /** Read-only inheritance input for a connection editor. */
  sharedSettings?: WebsiteDomainPermissionsSettings;
  applicationDefaults?: WebsitePermissionApplicationDefaults;
  /** Known native denials for the preview, never editable policy grants. */
  nativeDeniedClasses?: readonly WebsiteRequestClass[];
  disabled?: boolean;
}

const CLASS_LABELS: Record<WebsiteRequestClass, string> = {
  script: "Scripts",
  stylesheet: "Stylesheets",
  font: "Fonts",
  "image-media": "Images and media",
  "fetch-xhr": "Fetch and XHR",
  frame: "Frames",
  worker: "Workers",
  websocket: "WebSockets",
  navigation: "Navigation",
};
const SOURCE_LABELS: Record<WebsitePermissionSource, string> = {
  "native-constraint": "Native restriction",
  "connection-destination": "Connection destination rule",
  "connection-class": "Connection request class",
  "shared-destination": "Shared destination rule",
  "shared-class": "Shared request class",
  "application-default": "Application default",
  "invalid-policy": "Invalid policy",
  "invalid-request": "Invalid request",
};
const OPTIONS = [
  { value: "inherit", label: "Inherit" },
  { value: "allow", label: "Allow" },
  { value: "deny", label: "Deny" },
];
const ORIGIN_HELP =
  "Use unique exact HTTPS origins, without paths, credentials, queries, fragments or wildcards.";
const emptyWebsite = (origin: string): WebsiteOriginPermissions => ({
  origin,
  requestClasses: {},
  destinations: [],
});

/** Controlled public-policy editor. Saving/applying to live sessions belongs to its owner. */
export default function WebsiteDomainPermissionsEditor(
  props: WebsiteDomainPermissionsEditorProps,
) {
  let settings: WebsiteDomainPermissionsSettings;
  let sharedSettings: WebsiteDomainPermissionsSettings;
  let applicationDefaults: WebsitePermissionApplicationDefaults;
  try {
    settings = normalizeWebsiteDomainPermissions(props.settings);
    sharedSettings = normalizeWebsiteDomainPermissions(
      props.scope === "connection" ? props.sharedSettings : undefined,
    );
    applicationDefaults = normalizeWebsitePermissionApplicationDefaults(
      props.applicationDefaults,
    );
  } catch {
    return (
      <p
        role="alert"
        className="sor-alert-error text-sm text-[var(--color-text)]"
      >
        Website request permissions are invalid. Correct the saved policy before
        editing; no rules have been changed.
      </p>
    );
  }
  return (
    <PermissionEditor
      {...props}
      settings={settings}
      sharedSettings={sharedSettings}
      applicationDefaults={applicationDefaults}
    />
  );
}

function PermissionEditor({
  settings,
  onChange,
  sharedSettings,
  applicationDefaults,
  scope = "shared",
  nativeDeniedClasses = [],
  disabled = false,
}: WebsiteDomainPermissionsEditorProps & {
  settings: WebsiteDomainPermissionsSettings;
  sharedSettings: WebsiteDomainPermissionsSettings;
}) {
  const id = useId();
  const [selectedWebsite, setSelectedWebsite] = useState("");
  const [selectedTarget, setSelectedTarget] = useState({
    website: "",
    origin: "",
  });
  const [websiteDraft, setWebsiteDraft] = useState("");
  const [destinationDraft, setDestinationDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const websiteOrigins = [
    ...new Set([
      ...settings.websites.map((row) => row.origin),
      ...sharedSettings.websites.map((row) => row.origin),
    ]),
  ];
  const websiteOrigin = websiteOrigins.includes(selectedWebsite)
    ? selectedWebsite
    : websiteOrigins[0];
  const own = settings.websites.find((row) => row.origin === websiteOrigin);
  const common = sharedSettings.websites.find(
    (row) => row.origin === websiteOrigin,
  );
  const destinations = [
    ...new Set([
      ...(own?.destinations.map((row) => row.origin) ?? []),
      ...(common?.destinations.map((row) => row.origin) ?? []),
    ]),
  ];
  const destinationOrigin =
    selectedTarget.website === websiteOrigin &&
    destinations.includes(selectedTarget.origin)
      ? selectedTarget.origin
      : "";
  const ownDestination = own?.destinations.find(
    (row) => row.origin === destinationOrigin,
  );
  const values = destinationOrigin
    ? ownDestination?.requestClasses
    : own?.requestClasses;
  const totalDestinations = settings.websites.reduce(
    (sum, row) => sum + row.destinations.length,
    0,
  );
  const websiteLimit =
    settings.websites.length >= MAX_WEBSITE_PERMISSION_WEBSITES;
  const destinationLimit =
    (own?.destinations.length ?? 0) >= MAX_WEBSITE_PERMISSION_DESTINATIONS ||
    totalDestinations >= MAX_WEBSITE_PERMISSION_TOTAL_DESTINATIONS;

  const publish = (websites: WebsiteOriginPermissions[]) => {
    if (disabled) return false;
    let next: WebsiteDomainPermissionsSettings;
    try {
      next = normalizeWebsiteDomainPermissions({ version: 1, websites });
    } catch {
      setError(`${ORIGIN_HELP} Check the website and destination limits.`);
      return false;
    }
    onChange(next);
    setError(null);
    return true;
  };
  const replace = (next: WebsiteOriginPermissions) =>
    publish(
      own
        ? settings.websites.map((row) =>
            row.origin === websiteOrigin ? next : row,
          )
        : [...settings.websites, next],
    );
  const setPermission = (
    requestClass: WebsiteRequestClass,
    setting: WebsitePermissionSetting,
  ) => {
    const website = own ?? emptyWebsite(websiteOrigin);
    const requestClasses = { ...values, [requestClass]: setting };
    if (!destinationOrigin) {
      replace({ ...website, requestClasses });
      return;
    }
    const destination = { origin: destinationOrigin, requestClasses };
    replace({
      ...website,
      destinations: ownDestination
        ? website.destinations.map((row) =>
            row.origin === destinationOrigin ? destination : row,
          )
        : [...website.destinations, destination],
    });
  };
  const addOrigin = (kind: "website" | "destination") => {
    if (disabled) return;
    let origin: string;
    try {
      origin = canonicalWebsitePermissionOrigin(
        kind === "website" ? websiteDraft : destinationDraft,
      );
      if ((kind === "website" ? websiteOrigins : destinations).includes(origin))
        throw new Error();
    } catch {
      setError(ORIGIN_HELP);
      return;
    }
    if (kind === "website") {
      if (publish([...settings.websites, emptyWebsite(origin)])) {
        setSelectedWebsite(origin);
        setWebsiteDraft("");
      }
    } else if (websiteOrigin) {
      const website = own ?? emptyWebsite(websiteOrigin);
      if (
        replace({
          ...website,
          destinations: [
            ...website.destinations,
            { origin, requestClasses: {} },
          ],
        })
      ) {
        setSelectedTarget({ website: websiteOrigin, origin });
        setDestinationDraft("");
      }
    }
  };

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="min-w-0 space-y-3 text-[var(--color-text)]"
    >
      <h4 id={`${id}-title`} className="sor-settings-section-header">
        {scope === "shared"
          ? "Shared website request permissions"
          : "Connection website request overrides"}
      </h4>
      <p
        role="note"
        className="sor-alert-warning text-xs leading-relaxed text-[var(--color-text)]"
      >
        Native real-origin browser only. The legacy rewrite browser does not
        enforce these rules. Enforcement requires native request-class
        integration; saving a rule does not activate it in an existing session.
      </p>
      <p
        id={`${id}-help`}
        className="text-xs text-[var(--color-textSecondary)]"
      >
        {ORIGIN_HELP} Subdomains and other ports need separate rules. These
        settings control network requests only; credentials, login consent and
        certificate exceptions are separate.
      </p>
      <p className="text-xs text-[var(--color-textMuted)]">
        Order: native restrictions, connection destination, connection request
        class, shared destination, shared request class, application default.
        Unset application defaults deny.
      </p>
      <fieldset disabled={disabled} className="min-w-0 space-y-3">
        <legend className="sr-only">Website request rules</legend>
        <div className="flex flex-wrap items-end gap-2">
          <FormField
            label="New website origin"
            htmlFor={`${id}-website`}
            className="min-w-0 flex-[1_1_16rem]"
          >
            <TextInput
              id={`${id}-website`}
              value={websiteDraft}
              onChange={setWebsiteDraft}
              variant="form-sm"
              className="w-full disabled:opacity-50"
              placeholder="https://example.com"
              maxLength={MAX_WEBSITE_PERMISSION_ORIGIN_LENGTH}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
            />
          </FormField>
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={!websiteDraft || websiteLimit}
            onClick={() => addOrigin("website")}
          >
            <Plus size={14} aria-hidden="true" />
            Add website
          </button>
        </div>
        {websiteLimit && (
          <p className="text-xs text-warning">
            The {MAX_WEBSITE_PERMISSION_WEBSITES}-website limit is reached.
          </p>
        )}
        {websiteOrigin ? (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <FormField
                label="Website origin"
                htmlFor={`${id}-selected-website`}
                className="min-w-0 flex-[1_1_16rem]"
              >
                <Select
                  id={`${id}-selected-website`}
                  label="Website origin"
                  value={websiteOrigin}
                  variant="form-sm"
                  className="min-w-0 w-full"
                  disabled={disabled}
                  options={websiteOrigins.map((origin) => ({
                    value: origin,
                    label: origin,
                    description: new URL(origin).hostname,
                  }))}
                  onChange={(value) => {
                    setSelectedWebsite(value);
                    setDestinationDraft("");
                    setError(null);
                  }}
                />
              </FormField>
              <button
                type="button"
                className="sor-btn sor-btn-secondary"
                disabled={!own}
                onClick={() =>
                  publish(
                    settings.websites.filter(
                      (row) => row.origin !== websiteOrigin,
                    ),
                  )
                }
              >
                <Trash2 size={14} aria-hidden="true" />
                {scope === "connection"
                  ? "Remove website overrides"
                  : "Remove website"}
              </button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <FormField
                label="Rule target"
                htmlFor={`${id}-selected-target`}
                className="min-w-0 flex-[1_1_16rem]"
              >
                <Select
                  id={`${id}-selected-target`}
                  label="Rule target"
                  value={destinationOrigin}
                  variant="form-sm"
                  className="min-w-0 w-full"
                  disabled={disabled}
                  options={[
                    { value: "", label: "Request-class defaults" },
                    ...destinations.map((origin) => ({
                      value: origin,
                      label: origin,
                    })),
                  ]}
                  onChange={(origin) => {
                    setSelectedTarget({ website: websiteOrigin, origin });
                    setError(null);
                  }}
                />
              </FormField>
              {destinationOrigin && (
                <button
                  type="button"
                  className="sor-btn sor-btn-secondary"
                  disabled={!ownDestination}
                  onClick={() =>
                    own &&
                    replace({
                      ...own,
                      destinations: own.destinations.filter(
                        (row) => row.origin !== destinationOrigin,
                      ),
                    })
                  }
                >
                  <Trash2 size={14} aria-hidden="true" />
                  {scope === "connection"
                    ? "Remove destination overrides"
                    : "Remove destination"}
                </button>
              )}
            </div>
            <p className="break-words text-xs text-[var(--color-textMuted)]">
              {destinationOrigin
                ? `Effective policy for requests to ${destinationOrigin}.`
                : "Class defaults apply when no destination rule has higher priority. Select a destination to see its effective policy."}
            </p>
            <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] px-3">
              {WEBSITE_REQUEST_CLASSES.map((requestClass) => {
                const query = {
                  websiteOrigin,
                  requestClass,
                  applicationDefaults,
                  sharedSettings:
                    scope === "shared" ? settings : sharedSettings,
                  connectionOverrides:
                    scope === "connection" ? settings : undefined,
                  nativeConstraint: nativeDeniedClasses.includes(requestClass)
                    ? ("deny" as const)
                    : undefined,
                };
                const effective = destinationOrigin
                  ? resolveWebsiteRequestPermission({
                      ...query,
                      destinationOrigin,
                    })
                  : resolveWebsiteRequestClassDefault(query);
                return (
                  <div
                    key={requestClass}
                    role="group"
                    aria-label={CLASS_LABELS[requestClass]}
                    className="sor-settings-select-row flex-wrap gap-2 py-2"
                  >
                    <div className="min-w-0">
                      <label
                        htmlFor={`${id}-${requestClass}`}
                        className="sor-settings-row-label"
                      >
                        {CLASS_LABELS[requestClass]}
                      </label>
                      <p className="text-xs text-[var(--color-textSecondary)]">
                        Effective{destinationOrigin ? "" : " default"}:{" "}
                        {effective.decision === "allow" ? "Allow" : "Deny"}
                        {" · "}
                        {SOURCE_LABELS[effective.source]}
                      </p>
                    </div>
                    <Select
                      id={`${id}-${requestClass}`}
                      label={CLASS_LABELS[requestClass]}
                      value={values?.[requestClass] ?? "inherit"}
                      options={OPTIONS}
                      variant="form-sm"
                      disabled={disabled}
                      onChange={(value) =>
                        setPermission(
                          requestClass,
                          value as WebsitePermissionSetting,
                        )
                      }
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <FormField
                label="New destination origin"
                htmlFor={`${id}-destination`}
                className="min-w-0 flex-[1_1_16rem]"
              >
                <TextInput
                  id={`${id}-destination`}
                  value={destinationDraft}
                  onChange={setDestinationDraft}
                  variant="form-sm"
                  className="w-full disabled:opacity-50"
                  placeholder="https://cdn.example.com"
                  maxLength={MAX_WEBSITE_PERMISSION_ORIGIN_LENGTH}
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
                />
              </FormField>
              <button
                type="button"
                className="sor-btn sor-btn-secondary"
                disabled={
                  !destinationDraft ||
                  destinationLimit ||
                  (!own && websiteLimit)
                }
                onClick={() => addOrigin("destination")}
              >
                <Plus size={14} aria-hidden="true" />
                Add destination
              </button>
            </div>
            {destinationLimit && (
              <p className="text-xs text-warning">
                Destination limit reached ({MAX_WEBSITE_PERMISSION_DESTINATIONS}{" "}
                per website, {MAX_WEBSITE_PERMISSION_TOTAL_DESTINATIONS} total).
              </p>
            )}
          </>
        ) : (
          <p className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs text-[var(--color-textMuted)]">
            No website rules. Requests inherit application defaults.
          </p>
        )}
      </fieldset>
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className="sor-alert-error text-xs text-[var(--color-text)]"
        >
          {error}
        </p>
      )}
    </section>
  );
}
